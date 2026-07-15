from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional

from database import get_db
from models import Asset, Institution, Snapshot, ManualAssetHistory
from parsers.base import ParsedRecord
from routers.upload import _upsert_snapshot, _upsert_import_source
from schemas import ManualAssetCreate, ManualAssetValueUpdate

router = APIRouter(prefix="/manual-assets", tags=["manual-assets"])

_MANUAL_INST_NAME = "Manual"


def _get_or_create_manual_inst(db: Session, name: str, currency: str) -> Institution:
    inst = db.query(Institution).filter(Institution.name == name).first()
    if not inst:
        country = "BR" if currency == "BRL" else "US"
        inst = Institution(name=name, country=country, currency=currency)
        db.add(inst)
        db.flush()
    return inst


def _make_snapshot_rec(asset: Asset, value: float, snapshot_date: date) -> ParsedRecord:
    return ParsedRecord(
        institution_name="",
        institution_country="",
        institution_currency="",
        asset_identifier=asset.identifier,
        asset_name=asset.name,
        asset_type=asset.asset_type,
        asset_currency=asset.currency,
        snapshot_date=snapshot_date,
        market_value=value,
        raw_source_file="manual",
    )


@router.post("/", status_code=201)
def create_manual_asset(payload: ManualAssetCreate, db: Session = Depends(get_db)):
    name          = payload.name.strip()
    asset_type    = payload.asset_type
    currency      = payload.currency
    notes         = payload.notes
    inst_name     = (payload.institution_name or _MANUAL_INST_NAME).strip()
    quantity      = payload.quantity
    current_value = payload.current_value
    owner         = payload.owner

    if not name:
        raise HTTPException(status_code=422, detail="name é obrigatório")
    if current_value <= 0:
        raise HTTPException(status_code=422, detail="current_value deve ser > 0")

    inst = _get_or_create_manual_inst(db, inst_name, currency)

    notes_full = notes or ""
    if owner:
        notes_full = f"Titular: {owner}" + (f"\n{notes}" if notes else "")

    asset = Asset(
        institution_id=inst.id,
        name=name,
        asset_type=asset_type,
        currency=currency,
        source="manual",
        notes=notes_full or None,
        purchase_date=date.today(),
    )
    if quantity is not None:
        asset.identifier = str(quantity)
    db.add(asset)
    db.flush()

    _upsert_import_source(db, inst, "")

    today = date.today()
    history = ManualAssetHistory(asset_id=asset.id, date=today, value=current_value)
    db.add(history)

    rec = _make_snapshot_rec(asset, current_value, today)
    _upsert_snapshot(db, asset.id, "manual", rec, is_reimport=False)

    db.commit()
    return {"id": asset.id, "name": asset.name, "current_value": current_value}


@router.get("/")
def list_manual_assets(db: Session = Depends(get_db)):
    assets = (
        db.query(Asset)
        .filter(Asset.source == "manual", Asset.is_active == True)  # noqa: E712
        .order_by(Asset.name)
        .all()
    )
    result = []
    for a in assets:
        latest_hist = (
            db.query(ManualAssetHistory)
            .filter(ManualAssetHistory.asset_id == a.id)
            .order_by(ManualAssetHistory.date.desc())
            .first()
        )
        inst = db.query(Institution).filter(Institution.id == a.institution_id).first()
        result.append({
            "id": a.id,
            "name": a.name,
            "asset_type": a.asset_type,
            "currency": a.currency,
            "institution_name": inst.name if inst else None,
            "notes": a.notes,
            "current_value": latest_hist.value if latest_hist else None,
            "last_updated": latest_hist.date.isoformat() if latest_hist else None,
        })
    return result


@router.get("/{asset_id}/history")
def get_history(asset_id: int, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.source == "manual").first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo manual não encontrado")
    history = (
        db.query(ManualAssetHistory)
        .filter(ManualAssetHistory.asset_id == asset_id)
        .order_by(ManualAssetHistory.date.asc())
        .all()
    )
    return [{"date": h.date.isoformat(), "value": h.value} for h in history]


@router.post("/{asset_id}/update-value")
def update_value(asset_id: int, payload: ManualAssetValueUpdate, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.source == "manual").first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo manual não encontrado")

    value = payload.value
    if value <= 0:
        raise HTTPException(status_code=422, detail="value deve ser > 0")

    entry_date = payload.date or date.today()
    if entry_date > date.today():
        raise HTTPException(status_code=422, detail="Data não pode ser futura")

    # Upsert history record (INSERT OR REPLACE via SQLAlchemy)
    existing = (
        db.query(ManualAssetHistory)
        .filter(ManualAssetHistory.asset_id == asset_id, ManualAssetHistory.date == entry_date)
        .first()
    )
    if existing:
        existing.value = value
    else:
        db.add(ManualAssetHistory(asset_id=asset_id, date=entry_date, value=value))

    # Also upsert snapshot so the asset appears in portfolio queries
    rec = _make_snapshot_rec(asset, value, entry_date)
    _upsert_snapshot(db, asset_id, "manual", rec, is_reimport=False)

    db.commit()
    return {"asset_id": asset_id, "date": entry_date.isoformat(), "value": value}


@router.delete("/{asset_id}")
def archive_manual_asset(asset_id: int, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.source == "manual").first()
    if not asset:
        raise HTTPException(status_code=404, detail="Ativo manual não encontrado")
    asset.is_active = False
    db.commit()
    return {"archived": True}
