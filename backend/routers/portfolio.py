import logging

import bisect

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, distinct, or_
from datetime import date, timedelta
from typing import List, Optional
from collections import defaultdict
import httpx

import fx
from database import get_db
from models import Snapshot, Asset, Institution, ExchangeRate, Dividend, ImportSource
from schemas import (
    SnapshotOut, PortfolioSummary, PortfolioHistory, DividendCreate,
    AssetNotesUpdate, AssetPurchaseDateUpdate, ExpectedIncomeUpdate,
)

AWESOME_URL = "https://economia.awesomeapi.com.br/json/daily/USD-BRL/{days}"

router = APIRouter(prefix="/portfolio", tags=["portfolio"])

_ensure_log = logging.getLogger("portfolio")

# Ativos arquivados saem de todos os cálculos. NULL conta como ativo
# (linhas anteriores à migração da coluna is_active).
_ACTIVE = Asset.is_active.isnot(False)


def _not_manual():
    return or_(Asset.source.is_(None), Asset.source != "manual")


def _get_rate(db: Session, snap_date: date) -> float:
    rate, _ = fx.get_rate_for_date(db, snap_date)
    return rate


def _ensure_rates(db: Session, dates: list) -> None:
    """Fetch missing historical rates from AwesomeAPI if DB has no coverage for oldest date."""
    if not dates:
        return
    min_date = min(dates)
    has_coverage = db.query(ExchangeRate).filter(ExchangeRate.date <= min_date).first()
    if has_coverage:
        return
    try:
        days = min((date.today() - min_date).days + 30, 365)
        with httpx.Client(timeout=15) as client:
            resp = client.get(AWESOME_URL.format(days=days))
            resp.raise_for_status()
        for item in resp.json():
            ts = int(item.get("timestamp", 0) or 0)
            if not ts:
                continue
            d = date.fromtimestamp(ts)
            bid = float(item.get("bid", 0) or 0)
            if bid <= 0:
                continue
            if not db.query(ExchangeRate).filter(ExchangeRate.date == d).first():
                db.add(ExchangeRate(date=d, usd_brl=bid, source="awesomeapi"))
        db.commit()
    except Exception as exc:
        _ensure_log.warning("Falha ao buscar cotações históricas: %s", exc)


def _carry_forward_snaps(db: Session) -> List[Snapshot]:
    """Snapshots vigentes para a visão 'Atual'.

    Importados: última data POR FONTE (instituição + conta) — uma fonte
    atualizada não esconde as demais. Manuais: última data POR ATIVO — todos
    compartilham a fonte 'Manual', e atualizar um ativo não pode sumir com os
    outros que foram atualizados em datas diferentes.
    """
    source_max_sq = (
        db.query(
            Asset.institution_id,
            func.coalesce(Asset.account_number, "").label("account_number"),
            func.max(Snapshot.snapshot_date).label("max_snap_date"),
        )
        .join(Snapshot, Snapshot.asset_id == Asset.id)
        .filter(_not_manual(), _ACTIVE)
        .group_by(Asset.institution_id, func.coalesce(Asset.account_number, ""))
        .subquery()
    )
    imported = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .join(Asset, Asset.id == Snapshot.asset_id)
        .join(
            source_max_sq,
            (Asset.institution_id == source_max_sq.c.institution_id)
            & (func.coalesce(Asset.account_number, "") == source_max_sq.c.account_number)
            & (Snapshot.snapshot_date == source_max_sq.c.max_snap_date),
        )
        .filter(_not_manual(), _ACTIVE)
        .all()
    )
    manual_max_sq = (
        db.query(Snapshot.asset_id.label("aid"), func.max(Snapshot.snapshot_date).label("md"))
        .join(Asset, Asset.id == Snapshot.asset_id)
        .filter(Asset.source == "manual", _ACTIVE)
        .group_by(Snapshot.asset_id)
        .subquery()
    )
    manual = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .join(manual_max_sq, (Snapshot.asset_id == manual_max_sq.c.aid)
              & (Snapshot.snapshot_date == manual_max_sq.c.md))
        .all()
    )
    return imported + manual


def _to_usd(value: Optional[float], currency: str, rate: float) -> float:
    if value is None:
        return 0.0
    if currency == "BRL":
        return value / rate
    return value


def _effective_mv(s) -> float:
    """Return net-of-tax market value for BRL assets when IR/IOF has been recorded."""
    currency = s.asset.currency if s.asset else "USD"
    if currency == "BRL" and s.tax_net is not None:
        return s.tax_net
    return s.market_value or 0.0


@router.get("/summary", response_model=PortfolioSummary)
def get_summary(
    snapshot_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    dates_query = db.query(distinct(Snapshot.snapshot_date)).order_by(Snapshot.snapshot_date.desc()).all()
    available_dates = [r[0] for r in dates_query]

    if not available_dates:
        return PortfolioSummary(
            total_market_value_usd=0,
            total_market_value_brl=0,
            total_cost_basis_usd=0,
            total_unrealized_gain_usd=0,
            by_institution=[],
            by_asset_type=[],
            by_currency=[],
            snapshot_dates=[],
            latest_date=None,
        )

    # Load import_sources for label resolution: {(institution_id, account_number): src}
    all_sources = db.query(ImportSource).all()
    src_map = {(s.institution_id, s.account_number): s for s in all_sources}
    src_order = {(s.institution_id, s.account_number): s.display_order for s in all_sources}

    def _src_label(inst_id: int, acct: str) -> Optional[str]:
        src = src_map.get((inst_id, acct))
        if src:
            return src.custom_label or src.default_label
        return None

    def _src_visible(inst_id: int, acct: str) -> bool:
        src = src_map.get((inst_id, acct))
        return src.visible if src else True

    # ── Carry-forward mode: latest snapshot per source (institution + account) ─
    source_dates: dict = {}  # (institution_id, acct_norm) → max snapshot_date
    overall_max = None

    if snapshot_date is None:
        snaps = _carry_forward_snaps(db)
        pdf_max_dates = []  # max dates from pdf_import sources only (for staleness comparison)
        for s in snaps:
            if s.asset:
                key = (s.asset.institution_id, s.asset.account_number or "")
                if key not in source_dates or s.snapshot_date > source_dates[key]:
                    source_dates[key] = s.snapshot_date
                if s.asset.source != "manual":
                    pdf_max_dates.append(s.snapshot_date)
        # overall_max computed from pdf_import sources only so that manual
        # asset updates don't make all import sources appear stale
        overall_max = max(pdf_max_dates) if pdf_max_dates else (max(source_dates.values()) if source_dates else None)
        # Visão "Atual": cotação mais recente, a mesma usada por empréstimos e
        # imóveis — assim os cards do dashboard fecham entre si.
        rate, rate_fallback = fx.get_latest_rate(db)
    else:
        snaps = (
            db.query(Snapshot)
            .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
            .join(Asset, Asset.id == Snapshot.asset_id)
            .filter(Snapshot.snapshot_date == snapshot_date, _ACTIVE)
            .all()
        )
        rate, rate_fallback = fx.get_rate_for_date(db, snapshot_date)

    total_mv_usd = 0.0
    total_mv_brl = 0.0
    total_cb_usd = 0.0
    total_cb_brl = 0.0
    total_ug_usd = 0.0
    # Ganho calculado só sobre ativos COM custo de aquisição — ativos manuais
    # não têm cost_basis e entrariam como 100% de "ganho" fantasma.
    total_gain_usd = 0.0
    total_gain_brl = 0.0
    gain_cb_usd = 0.0
    gain_cb_brl = 0.0
    by_inst: dict = {}  # label → {market_value_usd, market_value_brl, _order, snapshot_date, stale}
    by_type: dict = defaultdict(lambda: {"market_value_usd": 0.0, "market_value_brl": 0.0})
    by_currency: dict = defaultdict(lambda: {
        "market_value_usd": 0.0, "market_value_brl": 0.0,
        "cost_basis_usd": 0.0, "cost_basis_brl": 0.0,
    })

    for s in snaps:
        mv = _effective_mv(s)
        cb = s.cost_basis or 0.0
        ug = s.unrealized_gain or 0.0
        currency = s.asset.currency if s.asset else "USD"

        mv_usd = _to_usd(mv, currency, rate)
        cb_usd = _to_usd(cb, currency, rate)
        ug_usd = _to_usd(ug, currency, rate)
        mv_brl = mv * rate if currency == "USD" else mv
        cb_brl = cb * rate if currency == "USD" else cb

        total_mv_usd += mv_usd
        total_mv_brl += mv_brl
        total_cb_usd += cb_usd
        total_cb_brl += cb_brl
        total_ug_usd += ug_usd

        if s.cost_basis is not None and s.cost_basis > 0:
            total_gain_usd += mv_usd - cb_usd
            total_gain_brl += mv_brl - cb_brl
            gain_cb_usd += cb_usd
            gain_cb_brl += cb_brl

        if s.asset and s.asset.institution:
            inst_id = s.asset.institution_id
            acct = s.asset.account_number or ""
            label = _src_label(inst_id, acct) or s.asset.institution.name
            visible = _src_visible(inst_id, acct)
            order = src_order.get((inst_id, acct), 999)
            src_date = source_dates.get((inst_id, acct))
            is_manual = getattr(s.asset, "source", None) == "manual"
            src_stale = bool(not is_manual and src_date and overall_max and src_date < overall_max)
        else:
            label = "Unknown"
            visible = True
            order = 999
            src_date = None
            src_stale = False

        if visible:
            if label not in by_inst:
                by_inst[label] = {
                    "market_value_usd": 0.0, "market_value_brl": 0.0,
                    "_order": order, "snapshot_date": src_date, "stale": src_stale,
                    # nome cru da instituição (não o label) — usado pela
                    # Carteira para filtrar ao clicar no gráfico do dashboard
                    "institution_name": s.asset.institution.name if s.asset and s.asset.institution else None,
                    "institution_id": inst_id if s.asset else None,
                    "account_number": acct if s.asset else None,
                }
            by_inst[label]["market_value_usd"] += mv_usd
            by_inst[label]["market_value_brl"] += mv_brl

        atype = s.asset.asset_type if s.asset else "other"
        by_type[atype]["market_value_usd"] += mv_usd
        by_type[atype]["market_value_brl"] += mv_brl

        by_currency[currency]["market_value_usd"] += mv_usd
        by_currency[currency]["market_value_brl"] += mv_brl
        by_currency[currency]["cost_basis_usd"]   += cb_usd
        by_currency[currency]["cost_basis_brl"]   += cb_brl

    sorted_inst = sorted(by_inst.items(), key=lambda x: x[1]["_order"])
    by_inst_out = [
        {
            "name":             k,
            "market_value_usd": v["market_value_usd"],
            "market_value_brl": v["market_value_brl"],
            "snapshot_date":    v["snapshot_date"].isoformat() if v["snapshot_date"] else None,
            "stale":            v["stale"],
            "institution_name": v["institution_name"],
            "institution_id":   v["institution_id"],
            "account_number":   v["account_number"],
        }
        for k, v in sorted_inst
    ]
    stale_sources = any(v["stale"] for v in by_inst.values())

    return PortfolioSummary(
        total_market_value_usd=round(total_mv_usd, 2),
        total_market_value_brl=round(total_mv_brl, 2),
        total_cost_basis_usd=round(total_cb_usd, 2),
        total_cost_basis_brl=round(total_cb_brl, 2),
        total_unrealized_gain_usd=round(total_ug_usd, 2),
        total_gain_usd=round(total_gain_usd, 2),
        total_gain_brl=round(total_gain_brl, 2),
        gain_cost_basis_usd=round(gain_cb_usd, 2),
        gain_cost_basis_brl=round(gain_cb_brl, 2),
        usd_brl_rate=round(rate, 4),
        rate_fallback=rate_fallback,
        by_institution=by_inst_out,
        by_asset_type=[{"type": k, **v} for k, v in by_type.items()],
        by_currency=[{"currency": k, **v} for k, v in by_currency.items()],
        snapshot_dates=available_dates,
        latest_date=available_dates[0] if available_dates else None,
        stale_sources=stale_sources,
    )


@router.get("/history", response_model=PortfolioHistory)
def get_history(
    asset_id: Optional[int] = Query(None),
    group_by: Optional[str] = Query(None),
    days: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    valid_groups = {"institution", "asset_type", "currency"}
    if group_by not in valid_groups:
        group_by = None

    if asset_id is not None:
        dates_q = (
            db.query(distinct(Snapshot.snapshot_date))
            .filter(Snapshot.asset_id == asset_id)
            .order_by(Snapshot.snapshot_date.asc())
            .all()
        )
    else:
        dates_q = (
            db.query(distinct(Snapshot.snapshot_date))
            .order_by(Snapshot.snapshot_date.asc())
            .all()
        )

    all_dates = [r[0] for r in dates_q]

    if days:
        cutoff = date.today() - timedelta(days=days)
        all_dates = [d for d in all_dates if d >= cutoff]

    dates = all_dates
    if not dates:
        return PortfolioHistory(dates=[], total_usd=[], total_brl=[], usd_brl_rates=[])

    _ensure_rates(db, dates)
    rate_cache = {d: _get_rate(db, d) for d in dates}

    # ── Single-asset mode ──────────────────────────────────────────────────────
    if asset_id is not None:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()
        currency = asset.currency if asset else "USD"

        snaps = (
            db.query(Snapshot)
            .filter(Snapshot.asset_id == asset_id)
            .order_by(Snapshot.snapshot_date.asc())
            .all()
        )
        dates_set = set(dates)
        mv_by_date = {d: 0.0 for d in dates}
        for s in snaps:
            if s.snapshot_date in dates_set:
                mv_by_date[s.snapshot_date] += _effective_mv(s)

        total_usd, total_brl, rates_out = [], [], []
        for d in dates:
            rate = rate_cache[d]
            mv = mv_by_date[d]
            mv_usd = mv / rate if currency == "BRL" else mv
            mv_brl = mv * rate if currency == "USD" else mv
            total_usd.append(round(mv_usd, 2))
            total_brl.append(round(mv_brl, 2))
            rates_out.append(round(rate, 4))

        return PortfolioHistory(
            dates=dates,
            total_usd=total_usd,
            total_brl=total_brl,
            usd_brl_rates=rates_out,
            asset_currency=currency,
        )

    # ── Full portfolio (carry-forward por fonte) ──────────────────────────────
    # Em cada data do gráfico, cada fonte contribui com sua última importação
    # ATÉ aquela data — sem isso o total "despenca" em datas em que só uma
    # fonte foi importada. Manuais são carregados por ativo (mesma regra do
    # /summary).
    all_snaps = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .join(Asset, Asset.id == Snapshot.asset_id)
        .filter(_ACTIVE)
        .all()
    )

    # Load import_sources once for label resolution in history series
    _hist_src_map: dict = {}
    if group_by == "institution":
        _hist_src_map = {(x.institution_id, x.account_number): x
                         for x in db.query(ImportSource).all()}

    # Agrupa snapshots: importados por (instituição, conta), manuais por ativo
    src_snaps: dict = defaultdict(lambda: defaultdict(list))  # key → snap_date → [snaps]
    for s in all_snaps:
        a = s.asset
        if a and a.source == "manual":
            key = ("manual", s.asset_id)
        elif a:
            key = ("src", a.institution_id, a.account_number or "")
        else:
            key = ("orphan", s.asset_id)
        src_snaps[key][s.snapshot_date].append(s)
    key_dates = {k: sorted(v.keys()) for k, v in src_snaps.items()}

    usd_by_date: dict = {d: 0.0 for d in dates}
    brl_by_date: dict = {d: 0.0 for d in dates}
    series_acc:  dict = defaultdict(lambda: {d: 0.0 for d in dates})

    for d in dates:
        rate = rate_cache[d]
        for key, kdates in key_dates.items():
            idx = bisect.bisect_right(kdates, d) - 1
            if idx < 0:
                continue  # fonte ainda não existia nessa data
            for s in src_snaps[key][kdates[idx]]:
                currency = s.asset.currency if s.asset else "USD"
                mv = _effective_mv(s)

                if currency == "BRL":
                    brl_by_date[d] += mv
                    mv_usd = mv / rate
                    usd_by_date[d] += mv_usd
                else:
                    mv_usd = mv
                    usd_by_date[d] += mv
                    brl_by_date[d] += mv * rate

                if group_by:
                    if group_by == "institution":
                        if s.asset and s.asset.institution:
                            src = _hist_src_map.get((s.asset.institution_id, s.asset.account_number or ""))
                            gkey = (src.custom_label or src.default_label) if src else s.asset.institution.name
                        else:
                            gkey = "Unknown"
                    elif group_by == "asset_type":
                        gkey = s.asset.asset_type if s.asset else "other"
                    else:
                        gkey = currency
                    series_acc[gkey][d] += mv_usd

    result_series = (
        [{"name": k, "data": [round(v[d], 2) for d in dates]} for k, v in series_acc.items()]
        if group_by else []
    )

    return PortfolioHistory(
        dates=dates,
        total_usd=[round(usd_by_date[d], 2) for d in dates],
        total_brl=[round(brl_by_date[d], 2) for d in dates],
        usd_brl_rates=[round(rate_cache[d], 4) for d in dates],
        series=result_series,
    )


@router.get("/snapshots", response_model=List[SnapshotOut])
def get_snapshots(
    snapshot_date: Optional[date] = Query(None),
    institution: Optional[str] = Query(None),
    asset_type: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    q = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .join(Asset, Asset.id == Snapshot.asset_id)
        .filter(_ACTIVE)
    )

    if snapshot_date:
        q = q.filter(Snapshot.snapshot_date == snapshot_date)

    if institution:
        q = q.join(Institution).filter(Institution.name.ilike(f"%{institution}%"))

    if asset_type:
        q = q.filter(Asset.asset_type == asset_type)

    snaps = q.order_by(Snapshot.snapshot_date.desc()).offset(skip).limit(limit).all()
    return snaps


@router.get("/dates", response_model=List[date])
def get_available_dates(db: Session = Depends(get_db)):
    rows = db.query(distinct(Snapshot.snapshot_date)).order_by(Snapshot.snapshot_date.desc()).all()
    return [r[0] for r in rows]


def _div_total_in_asset_currency(dividends, asset_currency: str, rate: float) -> float:
    """Sum all dividends converted to the asset's native currency."""
    total = 0.0
    for d in dividends:
        amt = d.amount or 0.0
        if d.currency == asset_currency:
            total += amt
        elif d.currency == "USD" and asset_currency == "BRL":
            total += amt * rate
        elif d.currency == "BRL" and asset_currency == "USD":
            total += amt / rate
        else:
            total += amt
    return total


def _div_last_12m(dividends, asset_currency: str, rate: float) -> float:
    cutoff = date.today() - timedelta(days=365)
    recent = [d for d in dividends if d.payment_date >= cutoff]
    return _div_total_in_asset_currency(recent, asset_currency, rate)


@router.get("/assets")
def list_assets(db: Session = Depends(get_db)):
    assets = (
        db.query(Asset)
        .options(joinedload(Asset.institution))
        .order_by(Asset.name)
        .all()
    )
    return [
        {
            "id":                          a.id,
            "name":                        a.name,
            "asset_type":                  a.asset_type,
            "currency":                    a.currency,
            "institution_name":            a.institution.name if a.institution else None,
            "notes":                       a.notes,
            "monthly_dividends_expected":  a.monthly_dividends_expected,
            "user_edited":                 bool(a.user_edited),
            "purchase_date":               a.purchase_date.isoformat() if a.purchase_date else None,
        }
        for a in assets
    ]


@router.get("/assets/{asset_id}")
def get_asset(asset_id: int, db: Session = Depends(get_db)):
    asset = (
        db.query(Asset)
        .options(joinedload(Asset.institution))
        .filter(Asset.id == asset_id)
        .first()
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    latest = (
        db.query(Snapshot)
        .filter(Snapshot.asset_id == asset_id)
        .order_by(Snapshot.snapshot_date.desc())
        .first()
    )

    rate = _get_rate(db, date.today())
    divs = db.query(Dividend).filter(Dividend.asset_id == asset_id).order_by(Dividend.payment_date.desc()).all()
    total_divs = _div_total_in_asset_currency(divs, asset.currency, rate)
    last_12m   = _div_last_12m(divs, asset.currency, rate)

    # Total return including dividends
    cap_gain  = None
    total_ret = None
    total_pct = None
    if latest and latest.cost_basis and latest.market_value is not None:
        cap_gain  = latest.market_value - latest.cost_basis
        total_ret = cap_gain + total_divs
        total_pct = (total_ret / latest.cost_basis * 100) if latest.cost_basis > 0 else None

    div_yield_12m = None
    if last_12m > 0 and latest and latest.cost_basis and latest.cost_basis > 0:
        div_yield_12m = last_12m / latest.cost_basis * 100

    return {
        "id":               asset.id,
        "name":             asset.name,
        "asset_type":       asset.asset_type,
        "currency":         asset.currency,
        "identifier":       asset.identifier,
        "notes":            asset.notes,
        "monthly_dividends_expected": asset.monthly_dividends_expected,
        "user_edited":      bool(asset.user_edited),
        "institution_name": asset.institution.name if asset.institution else None,
        "dividends_total":  round(total_divs, 2),
        "dividends_last_12m": round(last_12m, 2),
        "dividends_count":  len(divs),
        "dividend_yield_12m_pct": round(div_yield_12m, 2) if div_yield_12m is not None else None,
        "capital_gain":     round(cap_gain, 2) if cap_gain is not None else None,
        "total_return":     round(total_ret, 2) if total_ret is not None else None,
        "total_return_pct": round(total_pct, 2) if total_pct is not None else None,
        "latest_snapshot": {
            "snapshot_date":    latest.snapshot_date.isoformat(),
            "market_value":     latest.market_value,
            "cost_basis":       latest.cost_basis,
            "unrealized_gain":  latest.unrealized_gain,
            "estimated_income": latest.estimated_income,
            "accrued_income":   latest.accrued_income,
            "current_yield":    latest.current_yield,
            "maturity_date":    latest.maturity_date.isoformat() if latest.maturity_date else None,
            "units":            latest.units,
            "price":            latest.price,
            "portfolio_name":   latest.portfolio_name,
        } if latest else None,
    }


@router.put("/assets/{asset_id}/notes")
def update_asset_notes(asset_id: int, body: AssetNotesUpdate, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.notes      = body.notes or ""
    asset.user_edited = True
    db.commit()
    return {"ok": True, "notes": asset.notes}


@router.put("/assets/{asset_id}/purchase-date")
def update_asset_purchase_date(asset_id: int, body: AssetPurchaseDateUpdate, db: Session = Depends(get_db)):
    from datetime import datetime as dt_
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    val = body.purchase_date
    if val:
        try:
            pd = dt_.strptime(str(val), "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato inválido. Use YYYY-MM-DD")
        if pd > date.today():
            raise HTTPException(status_code=422, detail="Data de aplicação não pode ser futura")
        asset.purchase_date = pd
        # Propagate to all snapshots that have no purchase_date
        db.query(Snapshot).filter(
            Snapshot.asset_id == asset_id,
            Snapshot.purchase_date == None,  # noqa: E711
        ).update({"purchase_date": pd})
    else:
        asset.purchase_date = None
    db.commit()
    return {"ok": True, "purchase_date": asset.purchase_date.isoformat() if asset.purchase_date else None}


@router.put("/assets/{asset_id}/expected-income")
def update_expected_income(asset_id: int, body: ExpectedIncomeUpdate, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset.monthly_dividends_expected = body.monthly_dividends_expected
    asset.user_edited = True
    db.commit()
    return {"ok": True, "monthly_dividends_expected": asset.monthly_dividends_expected}


# ── Dividends ──────────────────────────────────────────────────────────────────

@router.get("/dividends")
def list_dividends(asset_id: int = Query(...), db: Session = Depends(get_db)):
    divs = (
        db.query(Dividend)
        .filter(Dividend.asset_id == asset_id)
        .order_by(Dividend.payment_date.desc())
        .all()
    )
    return [
        {
            "id":            d.id,
            "asset_id":      d.asset_id,
            "payment_date":  d.payment_date.isoformat(),
            "amount":        d.amount,
            "dividend_type": d.dividend_type,
            "currency":      d.currency,
            "notes":         d.notes,
            "created_at":    d.created_at.isoformat() if d.created_at else None,
        }
        for d in divs
    ]


@router.get("/dividends/summary")
def dividends_summary(db: Session = Depends(get_db)):
    """Return per-asset dividend totals for portfolio table display."""
    rate = _get_rate(db, date.today())
    cutoff_12m = date.today() - timedelta(days=365)

    divs = db.query(Dividend).options(joinedload(Dividend.asset)).all()

    by_asset: dict = defaultdict(lambda: {"total": 0.0, "last_12m": 0.0, "count": 0, "currency": "USD"})

    for d in divs:
        a_cur = d.asset.currency if d.asset else "USD"
        amt = d.amount or 0.0
        # Convert to asset currency
        if d.currency == a_cur:
            native = amt
        elif d.currency == "USD" and a_cur == "BRL":
            native = amt * rate
        elif d.currency == "BRL" and a_cur == "USD":
            native = amt / rate
        else:
            native = amt

        by_asset[d.asset_id]["total"]    += native
        by_asset[d.asset_id]["count"]    += 1
        by_asset[d.asset_id]["currency"]  = a_cur
        if d.payment_date >= cutoff_12m:
            by_asset[d.asset_id]["last_12m"] += native

    return {
        str(k): {
            "total":    round(v["total"], 2),
            "last_12m": round(v["last_12m"], 2),
            "count":    v["count"],
            "currency": v["currency"],
        }
        for k, v in by_asset.items()
    }


@router.post("/dividends")
def create_dividend(payload: DividendCreate, db: Session = Depends(get_db)):
    asset = db.query(Asset).filter(Asset.id == payload.asset_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    d = Dividend(
        asset_id=payload.asset_id,
        payment_date=payload.payment_date,
        amount=payload.amount,
        dividend_type=payload.dividend_type,
        currency=payload.currency,
        notes=payload.notes,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return {
        "id":            d.id,
        "asset_id":      d.asset_id,
        "payment_date":  d.payment_date.isoformat(),
        "amount":        d.amount,
        "dividend_type": d.dividend_type,
        "currency":      d.currency,
        "notes":         d.notes,
    }


@router.delete("/dividends/{dividend_id}")
def delete_dividend(dividend_id: int, db: Session = Depends(get_db)):
    d = db.query(Dividend).filter(Dividend.id == dividend_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Dividend not found")
    db.delete(d)
    db.commit()
    return {"ok": True}


@router.get("/risk")
def get_risk_analysis(
    snapshot_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    if snapshot_date is None:
        # Carry-forward: mesma seleção de snapshots do get_summary
        # (por fonte para importados, por ativo para manuais).
        snaps = _carry_forward_snaps(db)
        rate, _ = fx.get_latest_rate(db)
    else:
        snaps = (
            db.query(Snapshot)
            .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
            .join(Asset, Asset.id == Snapshot.asset_id)
            .filter(Snapshot.snapshot_date == snapshot_date, _ACTIVE)
            .all()
        )
        rate, _ = fx.get_rate_for_date(db, snapshot_date)

    if not snaps:
        return {"total_usd": 0, "alerts": [], "by_institution": [], "by_type": [], "by_currency": [], "top_positions": []}

    # Mesmos labels e visibilidade do /summary, para os gráficos baterem
    all_sources = db.query(ImportSource).all()
    src_map = {(x.institution_id, x.account_number): x for x in all_sources}

    total_usd = 0.0
    by_inst: dict = defaultdict(float)
    by_type: dict = defaultdict(float)
    by_curr: dict = defaultdict(float)
    positions = []

    for s in snaps:
        mv  = _effective_mv(s)
        cur = s.asset.currency if s.asset else "USD"
        mv_usd = mv / rate if cur == "BRL" else mv

        if s.asset and s.asset.institution:
            src = src_map.get((s.asset.institution_id, s.asset.account_number or ""))
            if src and not src.visible:
                continue
            inst = (src.custom_label or src.default_label) if src else s.asset.institution.name
        else:
            inst = "Unknown"

        total_usd += mv_usd
        by_inst[inst] += mv_usd
        by_type[s.asset.asset_type if s.asset else "other"] += mv_usd
        by_curr[cur] += mv_usd
        positions.append({
            "asset_id": s.asset_id,
            "name": s.asset.name if s.asset else "—",
            "institution": inst,
            "value_usd": mv_usd,
        })

    if total_usd == 0:
        return {"total_usd": 0, "alerts": [], "by_institution": [], "by_type": [], "by_currency": [], "top_positions": []}

    def pct(v): return round(v / total_usd * 100, 2)

    alerts = []
    for inst, v in by_inst.items():
        if pct(v) > 20:
            alerts.append({"type": "institution", "name": inst, "pct": pct(v), "threshold": 20, "level": "warning"})
    for cur, v in by_curr.items():
        if pct(v) > 50:
            alerts.append({"type": "currency", "name": cur, "pct": pct(v), "threshold": 50, "level": "info"})
    for atype, v in by_type.items():
        if pct(v) > 30:
            alerts.append({"type": "asset_type", "name": atype, "pct": pct(v), "threshold": 30, "level": "info"})

    return {
        "total_usd":       round(total_usd, 2),
        "alerts":          sorted(alerts, key=lambda x: x["pct"], reverse=True),
        "by_institution":  sorted([{"name": k, "value_usd": round(v, 2), "pct": pct(v)} for k, v in by_inst.items()], key=lambda x: -x["value_usd"]),
        "by_type":         sorted([{"name": k, "value_usd": round(v, 2), "pct": pct(v)} for k, v in by_type.items()], key=lambda x: -x["value_usd"]),
        "by_currency":     sorted([{"name": k, "value_usd": round(v, 2), "pct": pct(v)} for k, v in by_curr.items()], key=lambda x: -x["value_usd"]),
        "top_positions":   sorted(positions, key=lambda x: -x["value_usd"])[:10],
    }


@router.get("/projections")
def get_income_projections(db: Session = Depends(get_db)):
    today = date.today()
    rate  = _get_rate(db, today)

    # Latest snapshot per asset (só ativos não arquivados)
    subq = (
        db.query(Snapshot.asset_id, func.max(Snapshot.snapshot_date).label("md"))
        .join(Asset, Asset.id == Snapshot.asset_id)
        .filter(_ACTIVE)
        .group_by(Snapshot.asset_id)
        .subquery()
    )
    snaps = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .join(subq, (Snapshot.asset_id == subq.c.asset_id) & (Snapshot.snapshot_date == subq.c.md))
        .all()
    )

    months = []
    for i in range(12):
        y = today.year  + (today.month - 1 + i) // 12
        m = (today.month - 1 + i) % 12 + 1
        months.append(f"{y:04d}-{m:02d}")

    months_set = set(months)
    income_m   = {m: 0.0 for m in months}
    maturity_m = {m: 0.0 for m in months}
    events     = []

    income_fixed_m     = {m: 0.0 for m in months}  # estimated_income from snapshots (juros)
    income_dividends_m = {m: 0.0 for m in months}  # monthly_dividends_expected from Asset

    for s in snaps:
        cur    = s.asset.currency if s.asset else "USD"
        mv     = _effective_mv(s)
        mv_usd = mv / rate if cur == "BRL" else mv

        if s.estimated_income:
            ei_usd = (s.estimated_income / rate if cur == "BRL" else s.estimated_income) / 12
            for m in months:
                income_m[m]      += ei_usd
                income_fixed_m[m] += ei_usd

        # monthly_dividends_expected from Asset model
        if s.asset and s.asset.monthly_dividends_expected:
            mde     = s.asset.monthly_dividends_expected
            mde_usd = mde / rate if cur == "BRL" else mde
            for m in months:
                income_m[m]          += mde_usd
                income_dividends_m[m] += mde_usd

        if s.maturity_date:
            key = s.maturity_date.strftime("%Y-%m")
            if key in months_set and mv_usd > 0:
                maturity_m[key] += mv_usd
                events.append({
                    "month":         key,
                    "asset_id":      s.asset_id,
                    "asset_name":    s.asset.name if s.asset else "—",
                    "institution":   s.asset.institution.name if s.asset and s.asset.institution else "—",
                    "currency":      cur,
                    "amount_usd":    round(mv_usd, 2),
                    "amount_native": round(mv, 2),
                })

    events.sort(key=lambda x: x["month"])

    return {
        "months":                months,
        "income":                [round(income_m[m], 2)          for m in months],
        "income_fixed":          [round(income_fixed_m[m], 2)    for m in months],
        "income_dividends":      [round(income_dividends_m[m], 2) for m in months],
        "maturities":            [round(maturity_m[m], 2)        for m in months],
        "total_annual_usd":      round(sum(income_m.values()), 2),
        "total_annual_brl":      round(sum(income_m.values()) * rate, 2),
        "total_fixed_usd":       round(sum(income_fixed_m.values()), 2),
        "total_dividends_usd":   round(sum(income_dividends_m.values()), 2),
        "total_maturities_usd":  round(sum(maturity_m.values()), 2),
        "events":                events,
    }


_cdi_log = logging.getLogger("cdi_comparison")


@router.get("/cdi-comparison")
def get_cdi_comparison(
    snapshot_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    from models import CdiRate

    if snapshot_date is not None:
        snaps = (
            db.query(Snapshot)
            .options(joinedload(Snapshot.asset))
            .join(Asset, Asset.id == Snapshot.asset_id)
            .filter(Snapshot.snapshot_date == snapshot_date, _ACTIVE)
            .all()
        )
    else:
        # Carry-forward: mesma seleção do /summary — uma atualização de ativo
        # manual não pode esconder os importados do comparativo CDI.
        snaps = _carry_forward_snaps(db)

    if not snaps:
        return []

    _ensure_cdi_cache(db)

    result = []
    for s in snaps:
        # Fim do período CDI: a data do próprio snapshot (fontes podem estar
        # em datas diferentes no modo carry-forward)
        target = snapshot_date or s.snapshot_date
        if not s.asset or s.asset.currency != "BRL":
            continue
        if not s.cost_basis or s.cost_basis <= 0 or (s.market_value is None and s.tax_net is None):
            continue

        # Priority: Asset.purchase_date (manual or parser) → Snapshot.purchase_date → None
        # Do NOT fall back to min(snapshot_date): that collapses the CDI period to 0-3 days
        # when the user only has one import, producing absurd vs_cdi values.
        period_start = None
        if s.asset and s.asset.purchase_date:
            period_start = s.asset.purchase_date
        elif s.purchase_date:
            period_start = s.purchase_date

        mv = _effective_mv(s)
        total_return = (mv - s.cost_basis) / s.cost_basis

        if period_start is None:
            _cdi_log.info(
                "%-45s | no purchase_date — skipping vs_cdi", s.asset.name[:45]
            )
            result.append({
                "asset_id":           s.asset_id,
                "asset_name":         s.asset.name,
                "period_start":       None,
                "asset_purchase_date": None,
                "total_return_pct":   round(total_return * 100, 2),
                "cdi_period_pct":     None,
                "vs_cdi_pct":         None,
                "needs_purchase_date": True,
            })
            continue

        rates = (
            db.query(CdiRate)
            .filter(CdiRate.date >= period_start, CdiRate.date <= target)
            .order_by(CdiRate.date)
            .all()
        )

        # Accumulate daily CDI: fator = ∏(1 + taxa_diaria/100)
        cdi_fator = 1.0
        for r in rates:
            cdi_fator *= (1 + r.rate_pct / 100)
        cdi_acc = cdi_fator - 1.0

        # Guard: fewer than 10 business days → period too short to be meaningful
        vs_cdi = None
        if cdi_acc > 0.0001 and len(rates) >= 10:
            vs_cdi = total_return / cdi_acc

        _cdi_log.info(
            "%-45s | start=%s end=%s | dias=%d | CDI=%.4f%% | ret=%.4f%% | vs_cdi=%s",
            s.asset.name[:45], period_start, target, len(rates),
            cdi_acc * 100, total_return * 100,
            f"{vs_cdi * 100:.1f}%" if vs_cdi is not None else "N/A (periodo curto)",
        )

        result.append({
            "asset_id":            s.asset_id,
            "asset_name":          s.asset.name,
            "period_start":        period_start.isoformat(),
            "asset_purchase_date": s.asset.purchase_date.isoformat() if s.asset and s.asset.purchase_date else None,
            "total_return_pct":    round(total_return * 100, 2),
            "cdi_period_pct":      round(cdi_acc * 100, 2),
            "cdi_days":            len(rates),
            "vs_cdi_pct":          round(vs_cdi * 100, 2) if vs_cdi is not None else None,
            "needs_purchase_date": False,
        })

    return result


def _ensure_cdi_cache(db: Session):
    from models import CdiRate
    latest = db.query(func.max(CdiRate.date)).scalar()
    today  = date.today()
    if latest and (today - latest).days < 3:
        return
    try:
        start = (latest.strftime("%d/%m/%Y") if latest else "01/01/2020")
        end   = today.strftime("%d/%m/%Y")
        url   = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial={start}&dataFinal={end}"
        import httpx
        from datetime import datetime as dt_
        with httpx.Client(timeout=20) as client:
            resp = client.get(url)
            resp.raise_for_status()
        for item in resp.json():
            try:
                d    = dt_.strptime(item["data"], "%d/%m/%Y").date()
                rate = float(str(item["valor"]).replace(",", "."))
                if not db.query(CdiRate).filter(CdiRate.date == d).first():
                    db.add(CdiRate(date=d, rate_pct=rate))
            except Exception:
                continue
        db.commit()
    except Exception as exc:
        _cdi_log.warning("Falha ao atualizar cache do CDI (BCB): %s", exc)
