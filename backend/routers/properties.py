import logging
import os
import re
import uuid
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import CdiRate, ExchangeRate, Loan, Property, PropertyPhoto, PropertyValuation, PriceReference
from schemas import PriceReferenceCreate, PropertyCreate, PropertyValuationCreate
import config

router = APIRouter(prefix="/properties", tags=["properties"])

UPLOAD_DIR = config.UPLOADS_DIR / "properties"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _latest_rate(db: Session) -> float:
    rate = db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).first()
    return rate.usd_brl if rate else 5.0


def _latest_valuation(db: Session, property_id: int) -> Optional[PropertyValuation]:
    return (
        db.query(PropertyValuation)
        .filter(PropertyValuation.property_id == property_id)
        .order_by(PropertyValuation.valuation_date.desc())
        .first()
    )


def _current_value(db: Session, property_id: int, fallback: float) -> float:
    v = _latest_valuation(db, property_id)
    return v.current_value_brl if (v and v.current_value_brl is not None) else (fallback or 0.0)


def _last_valuation_date(db: Session, property_id: int) -> Optional[date]:
    v = _latest_valuation(db, property_id)
    return v.valuation_date if v else None


def _get_price_ref(db: Session, cidade: Optional[str], bairro: Optional[str]) -> Optional[PriceReference]:
    if not cidade:
        return None
    q = db.query(PriceReference).filter(
        func.lower(PriceReference.cidade) == (cidade or "").lower()
    )
    if bairro:
        specific = q.filter(
            func.lower(PriceReference.bairro) == bairro.lower()
        ).first()
        if specific:
            return specific
    return q.filter(PriceReference.bairro == None).first()  # noqa: E711


def _compute_rentability(prop: Property, current_brl: float, purchase_brl: float, db: Session) -> dict:
    today = date.today()
    result: dict = {
        "years_owned":       None,
        "gain_pct":          None,
        "annual_return_pct": None,
        "cap_rate":          None,
        "custo_anual":       None,
        "net_yield":         None,
        "cdi_period_pct":    None,
        "vs_cdi_pp":         None,
        "last_valuation_date": None,
        "stale_valuation":   False,
    }

    last_val = _last_valuation_date(db, prop.id)
    result["last_valuation_date"] = last_val.isoformat() if last_val else None
    if last_val and (today - last_val).days > 180:
        result["stale_valuation"] = True

    if purchase_brl > 0:
        gain = current_brl - purchase_brl
        result["gain_pct"] = round(gain / purchase_brl * 100, 2)

    if prop.purchase_date:
        days_owned = (today - prop.purchase_date).days
        years = max(days_owned / 365.25, 0.01)
        result["years_owned"] = round(years, 2)

        if purchase_brl > 0 and current_brl > 0:
            result["annual_return_pct"] = round(
                ((current_brl / purchase_brl) ** (1 / years) - 1) * 100, 2
            )

        rates = (
            db.query(CdiRate)
            .filter(CdiRate.date >= prop.purchase_date, CdiRate.date <= today)
            .all()
        )
        if rates:
            cdi_acc = 1.0
            for r in rates:
                cdi_acc *= (1 + r.rate_pct / 100)
            cdi_pct = (cdi_acc - 1) * 100
            result["cdi_period_pct"] = round(cdi_pct, 2)
            if result["gain_pct"] is not None:
                result["vs_cdi_pp"] = round(result["gain_pct"] - cdi_pct, 2)

    aluguel   = prop.aluguel_mensal or 0
    iptu      = prop.iptu_anual or 0
    cond_anual = (prop.condominio_mensal or 0) * 12
    custo_anual = iptu + cond_anual
    result["custo_anual"] = round(custo_anual, 2)

    if aluguel > 0 and current_brl > 0:
        result["cap_rate"]  = round(aluguel * 12 / current_brl * 100, 2)
        renda_liq = aluguel * 12 - custo_anual
        result["net_yield"] = round(renda_liq / current_brl * 100, 2)

    return result


def _prop_dict(prop: Property, current_brl: float, usd_brl: float, db: Session) -> dict:
    purchase_brl = prop.purchase_price_brl or 0.0
    gain_brl     = current_brl - purchase_brl
    rent         = _compute_rentability(prop, current_brl, purchase_brl, db)

    estimated_brl = None
    ref = _get_price_ref(db, prop.cidade, prop.bairro)
    if ref and prop.area_m2:
        estimated_brl = round(prop.area_m2 * ref.preco_m2, 2)

    photos = [
        {"id": p.id, "url": f"/uploads/properties/{p.filename}"}
        for p in db.query(PropertyPhoto).filter(PropertyPhoto.property_id == prop.id).all()
    ]

    loan_desc = None
    if prop.loan_id:
        loan = db.query(Loan).filter(Loan.id == prop.loan_id).first()
        loan_desc = loan.description if loan else None

    # Latest valuation metadata
    latest_val = _latest_valuation(db, prop.id)
    valuation_source = (latest_val.valuation_source if latest_val else "manual") or "manual"
    current_value_usd = latest_val.current_value_usd if latest_val else None

    # Latest auto valuation (Zillow, Rentcast, ATTOM)
    zillow_val = (
        db.query(PropertyValuation)
        .filter(
            PropertyValuation.property_id == prop.id,
            PropertyValuation.valuation_source.in_(["zillow", "rentcast_avm", "attom_avm"]),
        )
        .order_by(PropertyValuation.valuation_date.desc())
        .first()
    )
    zillow_zestimate_usd    = zillow_val.current_value_usd  if zillow_val else None
    zillow_zestimate_date   = zillow_val.valuation_date.isoformat() if zillow_val else None
    zillow_zestimate_source = zillow_val.valuation_source   if zillow_val else None

    # USD values
    currency = prop.currency or "BRL"
    country  = prop.country  or "Brasil"
    current_usd  = current_value_usd if current_value_usd else round(current_brl / usd_brl, 2)
    purchase_usd = prop.purchase_price_usd

    return {
        "id":                   prop.id,
        "description":          prop.description,
        "address":              prop.address,
        "property_type":        prop.property_type,
        "area_m2":              prop.area_m2,
        "cidade":               prop.cidade,
        "bairro":               prop.bairro,
        "matricula":            prop.matricula,
        "country":              country,
        "currency":             currency,
        "purchase_date":        prop.purchase_date.isoformat() if prop.purchase_date else None,
        "purchase_price_brl":   purchase_brl,
        "purchase_price_usd":   purchase_usd,
        "current_value_brl":    round(current_brl, 2),
        "current_value_usd":    round(current_usd, 2),
        "estimated_value_brl":  estimated_brl,
        "gain_brl":             round(gain_brl, 2),
        "iptu_anual":           prop.iptu_anual,
        "condominio_mensal":    prop.condominio_mensal,
        "aluguel_mensal":       prop.aluguel_mensal,
        "loan_id":              prop.loan_id,
        "loan_description":     loan_desc,
        "is_active":            prop.is_active,
        "valuation_source":     valuation_source,
        "zillow_url":             prop.zillow_url,
        "zillow_zestimate_usd":    zillow_zestimate_usd,
        "zillow_zestimate_date":   zillow_zestimate_date,
        "zillow_zestimate_source": zillow_zestimate_source,
        "photos":               photos,
        **rent,
    }


# ── Summary ────────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    usd_brl = _latest_rate(db)
    props = (
        db.query(Property)
        .filter(Property.is_active == True)  # noqa: E712
        .order_by(Property.description)
        .all()
    )

    total_brl        = 0.0
    total_gain       = 0.0
    total_brl_brasil = 0.0
    total_brl_usa    = 0.0
    total_usd_usa    = 0.0
    gain_brl_brasil  = 0.0
    gain_brl_usa     = 0.0
    gain_usd_usa     = 0.0
    count_brasil     = 0
    count_usa        = 0
    items = []

    for prop in props:
        current_brl  = _current_value(db, prop.id, prop.purchase_price_brl or 0.0)
        purchase_brl = prop.purchase_price_brl or 0.0
        total_brl   += current_brl
        total_gain  += current_brl - purchase_brl

        country = prop.country or "Brasil"
        if country == "Estados Unidos":
            total_brl_usa += current_brl
            total_usd_usa += current_brl / usd_brl
            count_usa     += 1
            gain_brl_usa  += current_brl - purchase_brl
            current_usd_v  = current_brl / usd_brl
            purchase_usd_v = prop.purchase_price_usd or (purchase_brl / usd_brl if usd_brl else 0.0)
            gain_usd_usa  += current_usd_v - purchase_usd_v
        else:
            total_brl_brasil += current_brl
            count_brasil     += 1
            gain_brl_brasil  += current_brl - purchase_brl

        items.append(_prop_dict(prop, current_brl, usd_brl, db))

    return {
        "total_brl":         round(total_brl, 2),
        "total_usd":         round(total_brl / usd_brl, 2) if usd_brl else 0.0,
        "total_gain_brl":    round(total_gain, 2),
        "gain_brl_brasil":   round(gain_brl_brasil, 2),
        "gain_brl_usa":      round(gain_brl_usa, 2),
        "gain_usd_usa":      round(gain_usd_usa, 2),
        "active_count":      len(props),
        "count_brasil":      count_brasil,
        "count_usa":         count_usa,
        "total_brl_brasil":  round(total_brl_brasil, 2),
        "total_brl_usa":     round(total_brl_usa, 2),
        "total_usd_usa":     round(total_usd_usa, 2),
        "properties":        items,
    }


# ── CRUD ───────────────────────────────────────────────────────────────────────

def _resolve_purchase_price(payload: PropertyCreate, usd_brl: float):
    """Return (purchase_price_brl, purchase_price_usd) resolving currency conversions."""
    brl = payload.purchase_price_brl
    usd = payload.purchase_price_usd
    if payload.currency == "USD":
        if usd and not brl:
            brl = round(usd * usd_brl, 2)
        elif brl and not usd:
            usd = round(brl / usd_brl, 2)
    return brl, usd


def _resolve_current_value(payload: PropertyCreate, usd_brl: float):
    """Return (current_value_brl, current_value_usd) resolving currency conversions."""
    brl = payload.current_value_brl
    usd = payload.current_value_usd
    if payload.currency == "USD":
        if usd and not brl:
            brl = round(usd * usd_brl, 2)
        elif brl and not usd:
            usd = round(brl / usd_brl, 2)
    return brl, usd


@router.post("/")
def create_property(payload: PropertyCreate, db: Session = Depends(get_db)):
    usd_brl = _latest_rate(db)
    purchase_brl, purchase_usd = _resolve_purchase_price(payload, usd_brl)
    current_brl, current_usd   = _resolve_current_value(payload, usd_brl)

    prop = Property(
        description=payload.description,
        address=payload.address,
        property_type=payload.property_type,
        area_m2=payload.area_m2,
        cidade=payload.cidade,
        bairro=payload.bairro,
        matricula=payload.matricula,
        purchase_date=payload.purchase_date,
        purchase_price_brl=purchase_brl,
        purchase_price_usd=purchase_usd,
        country=payload.country,
        currency=payload.currency,
        zillow_url=payload.zillow_url or None,
        iptu_anual=payload.iptu_anual,
        condominio_mensal=payload.condominio_mensal,
        aluguel_mensal=payload.aluguel_mensal,
        loan_id=payload.loan_id,
        is_active=True,
    )
    db.add(prop)
    db.flush()

    init_brl = current_brl or purchase_brl
    init_usd = current_usd or purchase_usd
    if init_brl:
        init_date = (payload.purchase_date if not current_brl else date.today()) or date.today()
        note = "Valor inicial" if current_brl else "Valor de compra"
        db.add(PropertyValuation(
            property_id=prop.id,
            valuation_date=init_date,
            current_value_brl=init_brl,
            current_value_usd=init_usd,
            valuation_source="manual",
            notes=note,
        ))

    db.commit()
    db.refresh(prop)
    usd_brl = _latest_rate(db)
    current_brl = _current_value(db, prop.id, prop.purchase_price_brl or 0.0)
    return _prop_dict(prop, current_brl, usd_brl, db)


@router.put("/{property_id}")
def update_property(property_id: int, payload: PropertyCreate, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    usd_brl = _latest_rate(db)
    purchase_brl, purchase_usd = _resolve_purchase_price(payload, usd_brl)

    prop.description        = payload.description
    prop.address            = payload.address
    prop.property_type      = payload.property_type
    prop.area_m2            = payload.area_m2
    prop.cidade             = payload.cidade
    prop.bairro             = payload.bairro
    prop.matricula          = payload.matricula
    prop.purchase_date      = payload.purchase_date
    prop.purchase_price_brl = purchase_brl
    prop.purchase_price_usd = purchase_usd
    prop.country            = payload.country
    prop.currency           = payload.currency
    prop.zillow_url         = payload.zillow_url or None
    prop.iptu_anual         = payload.iptu_anual
    prop.condominio_mensal  = payload.condominio_mensal
    prop.aluguel_mensal     = payload.aluguel_mensal
    prop.loan_id            = payload.loan_id

    db.commit()
    db.refresh(prop)
    usd_brl = _latest_rate(db)
    current_brl = _current_value(db, prop.id, prop.purchase_price_brl or 0.0)
    return _prop_dict(prop, current_brl, usd_brl, db)


@router.delete("/{property_id}")
def archive_property(property_id: int, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    prop.is_active = False
    db.commit()
    return {"ok": True}


# ── Valuations ─────────────────────────────────────────────────────────────────

@router.post("/{property_id}/valuations")
def add_valuation(property_id: int, payload: PropertyValuationCreate, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    usd_brl = _latest_rate(db)
    brl = payload.current_value_brl
    usd = payload.current_value_usd

    if brl is None and usd is not None:
        brl = round(usd * usd_brl, 2)
    elif brl is not None and usd is None and (prop.currency or "BRL") == "USD":
        usd = round(brl / usd_brl, 2)

    if brl is None:
        raise HTTPException(status_code=400, detail="Informe current_value_brl ou current_value_usd")

    v = PropertyValuation(
        property_id=property_id,
        valuation_date=payload.valuation_date,
        current_value_brl=brl,
        current_value_usd=usd,
        valuation_source=payload.valuation_source or "manual",
        notes=payload.notes,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return {
        "id":                v.id,
        "property_id":       v.property_id,
        "valuation_date":    v.valuation_date.isoformat(),
        "current_value_brl": v.current_value_brl,
        "current_value_usd": v.current_value_usd,
        "valuation_source":  v.valuation_source,
        "notes":             v.notes,
    }


@router.get("/{property_id}/valuations")
def get_valuations(property_id: int, db: Session = Depends(get_db)):
    if not db.query(Property).filter(Property.id == property_id).first():
        raise HTTPException(status_code=404, detail="Property not found")
    vals = (
        db.query(PropertyValuation)
        .filter(PropertyValuation.property_id == property_id)
        .order_by(PropertyValuation.valuation_date.asc())
        .all()
    )
    return [
        {
            "id":                v.id,
            "property_id":       v.property_id,
            "valuation_date":    v.valuation_date.isoformat(),
            "current_value_brl": v.current_value_brl,
            "current_value_usd": v.current_value_usd,
            "valuation_source":  v.valuation_source,
            "notes":             v.notes,
        }
        for v in vals
    ]


# ── Valuation Integration (Rentcast / ATTOM / Manual fallback) ─────────────────

_US_ADDR_RE = re.compile(r"^(.+?),\s*(.+?),\s*([A-Z]{2})\s*(\d{5})?")

def _parse_us_address(full: str) -> dict:
    """Split 'street, city, ST zip' into components for Rentcast / ATTOM."""
    m = _US_ADDR_RE.match(full.strip())
    if m:
        parts = {
            "address": m.group(1).strip(),
            "city":    m.group(2).strip(),
            "state":   m.group(3).strip(),
        }
        if m.group(4):
            parts["zipCode"] = m.group(4)
        return parts
    return {"address": full.strip()}


@router.post("/{property_id}/zillow")
async def update_property_valuation(property_id: int, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")
    if (prop.country or "Brasil") != "Estados Unidos":
        raise HTTPException(status_code=400, detail="Disponível apenas para imóveis nos EUA")

    value_usd: Optional[float] = None
    source_detail = ""

    async with httpx.AsyncClient(timeout=15.0) as client:

        # ── Opção 1: Rentcast AVM (50 consultas/mês grátis) ─────────────────
        rentcast_key = os.environ.get("RENTCAST_API_KEY", "").strip()
        if rentcast_key and prop.address and not value_usd:
            parsed = _parse_us_address(prop.address)
            # Supplement missing city/state/zip from stored property fields
            if "city" not in parsed and prop.cidade:
                parsed["city"] = prop.cidade
            if "state" not in parsed and prop.bairro:
                parsed["state"] = prop.bairro
            if "zipCode" not in parsed and prop.matricula:
                zip_clean = re.sub(r"[^0-9]", "", prop.matricula or "")
                if len(zip_clean) >= 5:
                    parsed["zipCode"] = zip_clean[:5]
            try:
                resp = await client.get(
                    "https://api.rentcast.io/v1/avm/value",
                    params=parsed,
                    headers={"X-Api-Key": rentcast_key, "accept": "application/json"},
                )
                logger.info("[Rentcast] status=%s body=%s", resp.status_code, resp.text[:1000])
                if resp.status_code == 200:
                    data = resp.json()
                    price = data.get("price") or data.get("value")
                    if price and float(price) > 0:
                        value_usd = float(price)
                        source_detail = "rentcast_avm"
            except Exception as exc:
                logger.warning("[Rentcast] error: %s", exc)

        # ── Opção 2: ATTOM AVM ───────────────────────────────────────────────
        attom_key = os.environ.get("ATTOM_API_KEY", "").strip()
        if attom_key and prop.address and not value_usd:
            parsed = _parse_us_address(prop.address)
            a1 = parsed.get("address", prop.address)
            a2 = ", ".join(filter(None, [parsed.get("city"), parsed.get("state"), parsed.get("zipCode")]))
            try:
                resp = await client.get(
                    "https://api.developer.attomdata.com/propertyapi/v1.0.0/avm/detail",
                    params={"address1": a1, "address2": a2},
                    headers={"apikey": attom_key, "accept": "application/json"},
                )
                logger.info("[ATTOM] status=%s body=%s", resp.status_code, resp.text[:1000])
                if resp.status_code == 200:
                    props_list = resp.json().get("property", [])
                    if props_list:
                        avm_val = props_list[0].get("avm", {}).get("amount", {}).get("value")
                        if avm_val and float(avm_val) > 0:
                            value_usd = float(avm_val)
                            source_detail = "attom_avm"
            except Exception as exc:
                logger.warning("[ATTOM] error: %s", exc)

    # ── Opção 3: Fallback manual ─────────────────────────────────────────────
    if not value_usd:
        zillow_url = (prop.zillow_url or "").strip() or None
        logger.info("Nenhuma API disponível — retornando fallback manual para property_id=%s", property_id)
        return {
            "manual_fallback": True,
            "zillow_url": zillow_url,
            "message": "APIs de avaliação não configuradas. Abra o Zillow e insira o Zestimate manualmente.",
        }

    usd_brl = _latest_rate(db)
    value_brl = round(value_usd * usd_brl, 2)

    v = PropertyValuation(
        property_id=property_id,
        valuation_date=date.today(),
        current_value_brl=value_brl,
        current_value_usd=value_usd,
        valuation_source=source_detail,
        notes=f"AVM automático ({source_detail})",
    )
    db.add(v)
    db.commit()

    logger.info("Valuation salva — property_id=%s usd=%.2f source=%s", property_id, value_usd, source_detail)

    return {
        "zestimate_usd": value_usd,
        "zestimate_brl": value_brl,
        "usd_brl_rate":  usd_brl,
        "date":          date.today().isoformat(),
        "source_detail": source_detail,
    }


@router.post("/{property_id}/zillow/manual")
async def save_zillow_manual(property_id: int, payload: dict, db: Session = Depends(get_db)):
    prop = db.query(Property).filter(Property.id == property_id).first()
    if not prop:
        raise HTTPException(status_code=404, detail="Property not found")

    try:
        value_usd = float(payload.get("value_usd", 0))
    except (TypeError, ValueError):
        value_usd = 0.0

    if value_usd <= 0:
        raise HTTPException(status_code=400, detail="value_usd deve ser maior que zero")

    usd_brl = _latest_rate(db)
    value_brl = round(value_usd * usd_brl, 2)

    v = PropertyValuation(
        property_id=property_id,
        valuation_date=date.today(),
        current_value_brl=value_brl,
        current_value_usd=value_usd,
        valuation_source="zillow",
        notes="Zestimate Zillow (manual)",
    )
    db.add(v)
    db.commit()

    return {
        "zestimate_usd": value_usd,
        "zestimate_brl": value_brl,
        "usd_brl_rate":  usd_brl,
        "date":          date.today().isoformat(),
        "source_detail": "manual",
    }


# ── Photos ─────────────────────────────────────────────────────────────────────

@router.post("/{property_id}/photos")
async def upload_photo(
    property_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not db.query(Property).filter(Property.id == property_id).first():
        raise HTTPException(status_code=404, detail="Property not found")

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "photo.jpg").suffix.lower() or ".jpg"
    filename = f"{property_id}_{uuid.uuid4().hex[:8]}{ext}"
    content = await file.read()
    (UPLOAD_DIR / filename).write_bytes(content)

    photo = PropertyPhoto(property_id=property_id, filename=filename)
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return {"id": photo.id, "url": f"/uploads/properties/{filename}"}


@router.delete("/{property_id}/photos/{photo_id}")
def delete_photo(property_id: int, photo_id: int, db: Session = Depends(get_db)):
    photo = db.query(PropertyPhoto).filter(
        PropertyPhoto.id == photo_id,
        PropertyPhoto.property_id == property_id,
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    path = UPLOAD_DIR / photo.filename
    if path.exists():
        path.unlink()
    db.delete(photo)
    db.commit()
    return {"ok": True}


# ── Price references (FipeZAP alternative) ─────────────────────────────────────

@router.get("/price-refs")
def list_price_refs(db: Session = Depends(get_db)):
    return db.query(PriceReference).order_by(PriceReference.cidade, PriceReference.bairro).all()


@router.post("/price-refs")
def upsert_price_ref(payload: PriceReferenceCreate, db: Session = Depends(get_db)):
    existing = db.query(PriceReference).filter(
        func.lower(PriceReference.cidade) == payload.cidade.lower(),
        PriceReference.bairro == payload.bairro,
    ).first()
    if existing:
        existing.preco_m2  = payload.preco_m2
        existing.source    = payload.source
        existing.updated_at = func.now()
    else:
        existing = PriceReference(
            cidade=payload.cidade,
            bairro=payload.bairro,
            preco_m2=payload.preco_m2,
            source=payload.source,
        )
        db.add(existing)
    db.commit()
    db.refresh(existing)
    return existing


@router.delete("/price-refs/{ref_id}")
def delete_price_ref(ref_id: int, db: Session = Depends(get_db)):
    ref = db.query(PriceReference).filter(PriceReference.id == ref_id).first()
    if not ref:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(ref)
    db.commit()
    return {"ok": True}
