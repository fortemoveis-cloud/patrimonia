from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from datetime import date, timedelta

from database import get_db
from models import Snapshot, Asset, Institution, Property, PropertyValuation

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/maturity")
def get_maturity_alerts(db: Session = Depends(get_db)):
    today  = date.today()
    cutoff = today + timedelta(days=90)

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
        elif days <= 60:
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
