from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, distinct
from datetime import date, timedelta
from typing import Optional

from database import get_db, _get_app_setting
from models import Snapshot, Asset, Institution, Property, PropertyValuation

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/maturity")
def get_maturity_alerts(db: Session = Depends(get_db)):
    today  = date.today()
    days_window = int(_get_app_setting(db, "alert_maturity_days", "90"))
    cutoff = today + timedelta(days=days_window)

    # Latest snapshot per asset that has a maturity_date in the window
    subq = (
        db.query(
            Snapshot.asset_id,
            func.max(Snapshot.snapshot_date).label("max_date"),
        )
        .filter(Snapshot.maturity_date >= today, Snapshot.maturity_date <= cutoff)
        .group_by(Snapshot.asset_id)
        .subquery()
    )

    snaps = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .join(
            subq,
            (Snapshot.asset_id == subq.c.asset_id)
            & (Snapshot.snapshot_date == subq.c.max_date),
        )
        .all()
    )

    items = []
    critical = warning = info = 0

    for s in snaps:
        if not s.maturity_date:
            continue
        days = (s.maturity_date - today).days
        if days < 0:
            continue

        if days <= 30:
            severity = "critical"; critical += 1
        elif days <= min(60, days_window):
            severity = "warning"; warning += 1
        else:
            severity = "info"; info += 1

        items.append({
            "asset_id":         s.asset_id,
            "asset_name":       s.asset.name if s.asset else "—",
            "institution_name": s.asset.institution.name if s.asset and s.asset.institution else "—",
            "asset_type":       s.asset.asset_type if s.asset else "other",
            "currency":         s.asset.currency if s.asset else "USD",
            "market_value":     s.market_value,
            "maturity_date":    s.maturity_date.isoformat(),
            "days_remaining":   days,
            "severity":         severity,
        })

    items.sort(key=lambda x: x["days_remaining"])

    return {
        "count":    len(items),
        "critical": critical,
        "warning":  warning,
        "info":     info,
        "items":    items,
    }


@router.get("/properties")
def get_property_alerts(db: Session = Depends(get_db)):
    today  = date.today()
    stale_cutoff = today - timedelta(days=180)

    props = (
        db.query(Property)
        .filter(Property.is_active == True)  # noqa: E712
        .all()
    )

    items = []

    for prop in props:
        last_val = (
            db.query(PropertyValuation)
            .filter(PropertyValuation.property_id == prop.id)
            .order_by(PropertyValuation.valuation_date.desc())
            .first()
        )

        # Alert: valuation not updated in 6+ months
        if last_val is None or last_val.valuation_date <= stale_cutoff:
            months_ago = (
                int((today - last_val.valuation_date).days / 30)
                if last_val else None
            )
            items.append({
                "property_id":   prop.id,
                "description":   prop.description,
                "type":          "stale_valuation",
                "severity":      "warning",
                "message":       (
                    f"Valor não atualizado há {months_ago} meses"
                    if months_ago else "Nenhuma avaliação registrada"
                ),
            })

        # Alert: annual return potentially below inflation (need CDI data)
        if last_val and prop.purchase_date and prop.purchase_price_brl:
            purchase_brl = prop.purchase_price_brl
            current_brl  = last_val.current_value_brl or purchase_brl
            if purchase_brl > 0 and current_brl > 0:
                from models import CdiRate
                rates = db.query(CdiRate).filter(
                    CdiRate.date >= prop.purchase_date,
                    CdiRate.date <= today,
                ).all()
                if rates:
                    cdi_acc = 1.0
                    for r in rates:
                        cdi_acc *= (1 + r.rate_pct / 100)
                    cdi_pct = (cdi_acc - 1) * 100
                    gain_pct = (current_brl - purchase_brl) / purchase_brl * 100
                    if gain_pct < cdi_pct * 0.5:  # less than half CDI
                        items.append({
                            "property_id": prop.id,
                            "description": prop.description,
                            "type":        "below_cdi",
                            "severity":    "info",
                            "message":     (
                                f"Valorização total {gain_pct:.1f}% vs CDI acumulado {cdi_pct:.1f}% "
                                f"desde a compra — rendimento abaixo do esperado"
                            ),
                        })

    return {"count": len(items), "items": items}


@router.get("/drops")
def get_drop_alerts(
    threshold_pct: Optional[float] = Query(None),
    asset_types:   Optional[str]   = Query(None),
    db: Session = Depends(get_db),
):
    threshold = threshold_pct if threshold_pct is not None else float(_get_app_setting(db, "alert_drop_threshold_pct", "10"))
    monitored_raw = asset_types if asset_types is not None else _get_app_setting(db, "alert_monitored_classes", "equity,fixed_income,fund,cash")
    monitored = set(c.strip() for c in monitored_raw.split(",") if c.strip())

    # Two most recent distinct snapshot dates across all assets
    dates_desc = [
        r[0]
        for r in db.query(distinct(Snapshot.snapshot_date))
        .order_by(Snapshot.snapshot_date.desc())
        .limit(2)
        .all()
    ]
    if len(dates_desc) < 2:
        return {"count": 0, "items": [], "date_before": None, "date_after": None}

    date_after, date_before = dates_desc[0], dates_desc[1]

    def _load_snaps(d):
        return {
            s.asset_id: s
            for s in (
                db.query(Snapshot)
                .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
                .filter(Snapshot.snapshot_date == d)
                .all()
            )
        }

    snaps_after  = _load_snaps(date_after)
    snaps_before = _load_snaps(date_before)
    common_ids   = set(snaps_after.keys()) & set(snaps_before.keys())

    def _eff(s):
        if s.asset and s.asset.currency == "BRL" and s.tax_net is not None:
            return s.tax_net
        return s.market_value or 0.0

    items = []
    for asset_id in common_ids:
        s_after  = snaps_after[asset_id]
        s_before = snaps_before[asset_id]
        asset    = s_after.asset
        if not asset or asset.asset_type not in monitored:
            continue

        mv_before = _eff(s_before)
        mv_after  = _eff(s_after)
        if mv_before <= 0:
            continue

        drop_pct = (mv_before - mv_after) / mv_before * 100

        # Asymmetric fixed-income anomaly: any drop > 0.5% is suspicious
        fi_anomaly = asset.asset_type == "fixed_income" and drop_pct > 0.5

        if drop_pct >= threshold or fi_anomaly:
            items.append({
                "asset_id":        asset_id,
                "asset_name":      asset.name,
                "institution_name": asset.institution.name if asset.institution else "—",
                "asset_type":      asset.asset_type,
                "currency":        asset.currency,
                "value_before":    round(mv_before, 2),
                "value_after":     round(mv_after, 2),
                "drop_pct":        round(drop_pct, 2),
                "date_before":     date_before.isoformat(),
                "date_after":      date_after.isoformat(),
                "anomaly_type":    "fixed_income_drop" if fi_anomaly and drop_pct < threshold else None,
            })

    items.sort(key=lambda x: -x["drop_pct"])
    return {
        "count":       len(items),
        "date_before": date_before.isoformat(),
        "date_after":  date_after.isoformat(),
        "threshold_pct": threshold,
        "items":       items,
    }
