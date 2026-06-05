"""
Script de teste Rentcast AVM para o imóvel Orla 1 (id=7).
Uso: python test_rentcast.py
Requer RENTCAST_API_KEY preenchido no backend/.env
"""
import asyncio
import json
import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent / ".env", encoding="utf-8-sig", override=True)

import httpx

from database import SessionLocal
from models import ExchangeRate, Property, PropertyValuation


PROPERTY_ID = 7
ADDRESS_PARAMS = {
    "address": "2605 Gala Rd S 101",
    "city":    "Kissimmee",
    "state":   "FL",
    "zipCode": "34746",
}


def _latest_usd_brl(db) -> float:
    rate = db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).first()
    return rate.usd_brl if rate else 5.0


async def main():
    api_key = os.environ.get("RENTCAST_API_KEY", "").strip()
    if not api_key:
        print("ERRO: RENTCAST_API_KEY está vazia no .env — preencha e tente novamente.")
        return

    print(f"\n{'='*60}")
    print("TESTE RENTCAST AVM")
    print(f"{'='*60}")
    print(f"Endpoint : GET https://api.rentcast.io/v1/avm/value")
    print(f"Parâmetros: {json.dumps(ADDRESS_PARAMS, indent=2)}")
    print(f"API Key  : {api_key[:8]}...{api_key[-4:]}")
    print(f"{'='*60}\n")

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://api.rentcast.io/v1/avm/value",
            params=ADDRESS_PARAMS,
            headers={"X-Api-Key": api_key, "accept": "application/json"},
        )

    print(f"HTTP Status : {resp.status_code}")
    print(f"Headers     : {dict(resp.headers)}")
    print(f"\n--- JSON RESPONSE COMPLETO ---")

    try:
        data = resp.json()
        print(json.dumps(data, indent=2, ensure_ascii=False))
    except Exception:
        print(f"(resposta não é JSON válido)\n{resp.text}")
        return

    print(f"\n{'='*60}")

    if resp.status_code != 200:
        print(f"FALHOU com status {resp.status_code} — não atualizando o imóvel.")
        return

    price = data.get("price") or data.get("value")
    if not price or float(price) <= 0:
        print("Resposta OK mas sem campo 'price'/'value' — não atualizando.")
        print(f"Campos disponíveis: {list(data.keys())}")
        return

    value_usd = float(price)
    print(f"\nValor encontrado: USD {value_usd:,.2f}")

    db = SessionLocal()
    try:
        prop = db.query(Property).filter(Property.id == PROPERTY_ID).first()
        if not prop:
            print(f"Imóvel id={PROPERTY_ID} não encontrado no banco.")
            return

        usd_brl = _latest_usd_brl(db)
        value_brl = round(value_usd * usd_brl, 2)

        v = PropertyValuation(
            property_id=PROPERTY_ID,
            valuation_date=date.today(),
            current_value_brl=value_brl,
            current_value_usd=value_usd,
            valuation_source="zillow",
            notes="Rentcast AVM (teste manual)",
        )
        db.add(v)
        db.commit()

        print(f"Imóvel '{prop.description}' (id={PROPERTY_ID}) atualizado:")
        print(f"  USD : ${value_usd:,.2f}")
        print(f"  BRL : R$ {value_brl:,.2f}  (taxa {usd_brl})")
        print(f"  Data: {date.today().isoformat()}")
        print(f"  Fonte: Rentcast AVM")
    finally:
        db.close()

    print(f"\n{'='*60}")
    print("CONCLUIDO — retorne ao painel Imóveis para ver o valor atualizado.")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    asyncio.run(main())
