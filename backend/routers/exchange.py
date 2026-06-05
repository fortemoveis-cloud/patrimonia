from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date, timedelta
from typing import List, Optional
import httpx

from database import get_db
from models import ExchangeRate
from schemas import ExchangeRateBase, ExchangeRateOut

router = APIRouter(prefix="/exchange", tags=["exchange"])

AWESOMEAPI_URL = "https://economia.awesomeapi.com.br/json/daily/USD-BRL/{days}"


@router.get("/rates", response_model=List[ExchangeRateOut])
def list_rates(
    from_date: Optional[date] = Query(None),
    limit: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    q = db.query(ExchangeRate).order_by(ExchangeRate.date.desc())
    if from_date:
        q = q.filter(ExchangeRate.date >= from_date)
    return q.limit(limit).all()


@router.post("/rates", response_model=ExchangeRateOut)
def create_rate(payload: ExchangeRateBase, db: Session = Depends(get_db)):
    existing = db.query(ExchangeRate).filter(ExchangeRate.date == payload.date).first()
    if existing:
        existing.usd_brl = payload.usd_brl
        existing.source = payload.source
        db.commit()
        db.refresh(existing)
        return existing

    rate = ExchangeRate(date=payload.date, usd_brl=payload.usd_brl, source=payload.source)
    db.add(rate)
    db.commit()
    db.refresh(rate)
    return rate


@router.post("/fetch", response_model=List[ExchangeRateOut])
def fetch_from_api(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Fetch USD/BRL rates from AwesomeAPI and store them."""
    try:
        url = AWESOMEAPI_URL.format(days=days)
        with httpx.Client(timeout=10) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch exchange rates: {e}")

    saved: List[ExchangeRateOut] = []
    for item in data:
        try:
            # AwesomeAPI returns timestamp in seconds
            import datetime
            ts = int(item.get("timestamp", 0))
            if ts:
                d = datetime.date.fromtimestamp(ts)
            else:
                continue

            bid = float(item.get("bid", 0))
            if bid <= 0:
                continue

            existing = db.query(ExchangeRate).filter(ExchangeRate.date == d).first()
            if existing:
                existing.usd_brl = bid
                existing.source = "awesomeapi"
                db.flush()
                saved.append(ExchangeRateOut(id=existing.id, date=existing.date, usd_brl=existing.usd_brl, source=existing.source))
            else:
                rate = ExchangeRate(date=d, usd_brl=bid, source="awesomeapi")
                db.add(rate)
                db.flush()
                db.refresh(rate)
                saved.append(ExchangeRateOut(id=rate.id, date=rate.date, usd_brl=rate.usd_brl, source=rate.source))
        except Exception:
            continue

    db.commit()
    return saved


@router.get("/latest", response_model=Optional[ExchangeRateOut])
def get_latest(db: Session = Depends(get_db)):
    rate = db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).first()
    return rate
