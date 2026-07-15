"""Cotação USD/BRL centralizada.

Todos os routers devem obter a cotação por aqui. Se o banco ainda não tem
nenhuma cotação, tenta buscar da AwesomeAPI na hora; só em último caso usa
o FALLBACK_RATE — e sinaliza isso ao chamador para a UI poder avisar.
"""
import logging
from datetime import date
from typing import Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from models import ExchangeRate

log = logging.getLogger("fx")

FALLBACK_RATE = 5.0
_LAST_URL = "https://economia.awesomeapi.com.br/last/USD-BRL"


def fetch_and_store_latest(db: Session) -> Optional[float]:
    """Busca a cotação atual na AwesomeAPI e grava no banco. None se falhar."""
    try:
        with httpx.Client(timeout=5) as client:
            resp = client.get(_LAST_URL)
            resp.raise_for_status()
        bid = float(resp.json()["USDBRL"]["bid"])
        if bid <= 0:
            return None
        today = date.today()
        if not db.query(ExchangeRate).filter(ExchangeRate.date == today).first():
            db.add(ExchangeRate(date=today, usd_brl=bid, source="awesomeapi"))
            db.commit()
        return bid
    except Exception as exc:
        log.warning("Falha ao buscar USD/BRL na AwesomeAPI: %s", exc)
        return None


def get_latest_rate(db: Session) -> Tuple[float, bool]:
    """Retorna (cotação mais recente, is_fallback).

    is_fallback=True significa que nenhuma cotação real está disponível e o
    valor retornado é o FALLBACK_RATE — números convertidos não são confiáveis.
    """
    row = db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).first()
    if row:
        return row.usd_brl, False
    fetched = fetch_and_store_latest(db)
    if fetched:
        return fetched, False
    return FALLBACK_RATE, True


def get_rate_for_date(db: Session, target: date) -> Tuple[float, bool]:
    """Cotação vigente em `target` (última cotação <= target).

    Sem cotação anterior à data, usa a mais antiga disponível (melhor do que
    um valor fixo); sem nenhuma cotação no banco, tenta buscar on-demand.
    """
    row = (
        db.query(ExchangeRate)
        .filter(ExchangeRate.date <= target)
        .order_by(ExchangeRate.date.desc())
        .first()
    )
    if row:
        return row.usd_brl, False
    earliest = db.query(ExchangeRate).order_by(ExchangeRate.date.asc()).first()
    if earliest:
        return earliest.usd_brl, False
    fetched = fetch_and_store_latest(db)
    if fetched:
        return fetched, False
    return FALLBACK_RATE, True
