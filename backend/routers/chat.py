import os
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import List

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env", encoding="utf-8-sig")

import anthropic
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import (
    Asset, ChatHistory, ChatUsage, Dividend, ExchangeRate,
    Institution, Loan, LoanSnapshot, Property, PropertyValuation, Snapshot,
)

router = APIRouter(prefix="/chat", tags=["chat"])

MONTHLY_LIMIT = 50
MODEL = "claude-sonnet-4-6"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_rate(db: Session, snap_date: date) -> float:
    rate = (
        db.query(ExchangeRate)
        .filter(ExchangeRate.date <= snap_date)
        .order_by(ExchangeRate.date.desc())
        .first()
    )
    return rate.usd_brl if rate else 5.0


def _days_until_next_month() -> int:
    today = date.today()
    if today.month == 12:
        nxt = date(today.year + 1, 1, 1)
    else:
        nxt = date(today.year, today.month + 1, 1)
    return (nxt - today).days


def _get_or_create_usage(db: Session, ym: str) -> ChatUsage:
    usage = db.query(ChatUsage).filter(ChatUsage.year_month == ym).first()
    if not usage:
        usage = ChatUsage(year_month=ym, message_count=0)
        db.add(usage)
        db.flush()
    return usage


# ── Context builder ────────────────────────────────────────────────────────────

def build_portfolio_context(db: Session) -> tuple[str, float]:
    today = date.today()
    rate  = _get_rate(db, today)

    latest_date = db.query(func.max(Snapshot.snapshot_date)).scalar()
    if not latest_date:
        return "Portfólio ainda vazio — nenhum arquivo foi importado.", rate

    snaps = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .filter(Snapshot.snapshot_date == latest_date)
        .all()
    )

    total_usd  = 0.0
    total_brl  = 0.0
    total_cb   = 0.0
    total_ug   = 0.0
    by_inst:  dict = defaultdict(float)
    by_type:  dict = defaultdict(float)
    by_curr:  dict = defaultdict(float)
    asset_rows: list = []

    for s in snaps:
        mv  = s.market_value  or 0.0
        cb  = s.cost_basis    or 0.0
        ug  = s.unrealized_gain or 0.0
        cur = s.asset.currency if s.asset else "USD"
        mv_usd = mv / rate if cur == "BRL" else mv
        cb_usd = cb / rate if cur == "BRL" else cb
        ug_usd = ug / rate if cur == "BRL" else ug
        mv_brl = mv * rate if cur == "USD" else mv

        total_usd += mv_usd
        total_brl += mv_brl
        total_cb  += cb_usd
        total_ug  += ug_usd

        inst = s.asset.institution.name if s.asset and s.asset.institution else "?"
        atype = s.asset.asset_type if s.asset else "other"
        by_inst[inst]  += mv_usd
        by_type[atype] += mv_usd
        by_curr[cur]   += mv_usd

        # Dividends for this asset
        divs = db.query(Dividend).filter(Dividend.asset_id == s.asset_id).all()
        div_total = 0.0
        div_12m   = 0.0
        cutoff_12m = today - timedelta(days=365)
        for d in divs:
            amt = d.amount or 0.0
            if d.currency == cur:
                native = amt
            elif d.currency == "USD" and cur == "BRL":
                native = amt * rate
            elif d.currency == "BRL" and cur == "USD":
                native = amt / rate
            else:
                native = amt
            div_total += native
            if d.payment_date >= cutoff_12m:
                div_12m += native

        # Total return = cap gain + dividends
        total_ret     = ug + div_total
        total_ret_pct = total_ret / cb * 100 if cb > 0 else 0
        div_yield_str = f"{div_12m / cb * 100:.2f}%" if (cb > 0 and div_12m > 0) else "N/A"

        ug_str  = f"{ug:+,.2f}" if s.unrealized_gain is not None else "N/A"
        mat_str = s.maturity_date.isoformat() if s.maturity_date else "N/A"
        yi_str  = f"{s.current_yield:.2f}%" if s.current_yield else "N/A"
        div_str = f" | proventos_total:{div_total:,.2f} | proventos_12m:{div_12m:,.2f} | div_yield:{div_yield_str} | rent_total:{total_ret:+,.2f}({total_ret_pct:+.1f}%)" if div_total > 0 else ""
        asset_rows.append(
            f"  • {s.asset.name if s.asset else '?'} | inst:{inst} | tipo:{atype} | "
            f"moeda:{cur} | valor:{mv:,.2f} | custo:{cb:,.2f} | ganho_capital:{ug_str} | "
            f"yield:{yi_str} | venc:{mat_str}{div_str}"
        )

    pct = lambda v: f"{v / total_usd * 100:.1f}%" if total_usd else "0%"
    gain_pct = f"{total_ug / total_cb * 100:+.2f}%" if total_cb else "N/A"

    lines = [
        f"## PORTFÓLIO FINANCEIRO (data-base: {latest_date.isoformat()})",
        f"Patrimônio total: USD {total_usd:,.2f} | BRL {total_brl:,.2f}",
        f"Custo total investido: USD {total_cb:,.2f}",
        f"Ganho/Perda não realizado: USD {total_ug:,.2f} ({gain_pct})",
        "",
        "Distribuição por instituição:",
        *[f"  {k}: USD {v:,.2f} ({pct(v)})" for k, v in sorted(by_inst.items(), key=lambda x: -x[1])],
        "",
        "Distribuição por tipo de ativo:",
        *[f"  {k}: USD {v:,.2f} ({pct(v)})" for k, v in sorted(by_type.items(), key=lambda x: -x[1])],
        "",
        "Distribuição por moeda:",
        *[f"  {k}: USD {v:,.2f} ({pct(v)})" for k, v in sorted(by_curr.items(), key=lambda x: -x[1])],
        "",
        f"### POSIÇÕES INDIVIDUAIS ({len(asset_rows)} ativos):",
        *asset_rows,
    ]

    # Vencimentos próximos 90 dias
    cutoff = today + timedelta(days=90)
    upcoming = sorted(
        [s for s in snaps if s.maturity_date and today <= s.maturity_date <= cutoff],
        key=lambda x: x.maturity_date,
    )
    lines.append("")
    lines.append("### VENCIMENTOS PRÓXIMOS 90 DIAS:")
    if upcoming:
        for s in upcoming:
            days = (s.maturity_date - today).days
            cur  = s.asset.currency if s.asset else "USD"
            lines.append(
                f"  • {s.asset.name if s.asset else '?'} | "
                f"valor: {s.market_value:,.2f} {cur} | "
                f"vence em {days} dias ({s.maturity_date.isoformat()})"
            )
    else:
        lines.append("  Nenhum vencimento nos próximos 90 dias.")

    # Empréstimos ativos
    loans = (
        db.query(Loan)
        .options(joinedload(Loan.institution))
        .filter(Loan.is_active == True)  # noqa: E712
        .all()
    )
    lines.append("")
    lines.append("### EMPRÉSTIMOS ATIVOS:")
    if loans:
        total_loan_usd = 0.0
        for loan in loans:
            snap = (
                db.query(LoanSnapshot)
                .filter(LoanSnapshot.loan_id == loan.id)
                .order_by(LoanSnapshot.snapshot_date.desc())
                .first()
            )
            balance = (snap.outstanding_balance if snap and snap.outstanding_balance is not None
                       else loan.original_amount or 0.0)
            bal_usd = balance / rate if loan.currency == "BRL" else balance
            total_loan_usd += bal_usd
            rate_str = f"{loan.interest_rate * 100:.2f}% a.a." if loan.interest_rate else "N/A"
            lines.append(
                f"  • {loan.description} | saldo: {balance:,.2f} {loan.currency} | "
                f"taxa: {rate_str} | USD equiv: {bal_usd:,.2f}"
            )
        lines.append(f"  Total empréstimos: USD {total_loan_usd:,.2f} | BRL {total_loan_usd * rate:,.2f}")
    else:
        lines.append("  Nenhum empréstimo ativo.")

    # Imóveis
    props = (
        db.query(Property)
        .filter(Property.is_active == True)  # noqa: E712
        .order_by(Property.description)
        .all()
    )
    lines.append("")
    lines.append("### IMÓVEIS:")
    if props:
        total_prop_brl = 0.0
        for prop in props:
            val = (
                db.query(PropertyValuation)
                .filter(PropertyValuation.property_id == prop.id)
                .order_by(PropertyValuation.valuation_date.desc())
                .first()
            )
            cur_brl      = val.current_value_brl if val else (prop.purchase_price_brl or 0.0)
            purchase_brl = prop.purchase_price_brl or 0.0
            total_prop_brl += cur_brl
            gain_brl = cur_brl - purchase_brl
            gain_pct = gain_brl / purchase_brl * 100 if purchase_brl > 0 else 0

            country  = prop.country  or "Brasil"
            currency = prop.currency or "BRL"

            # Annualized return
            annual_str = "N/A"
            if prop.purchase_date and purchase_brl > 0 and cur_brl > 0:
                days = max((today - prop.purchase_date).days, 1)
                years = days / 365.25
                annual_ret = ((cur_brl / purchase_brl) ** (1 / years) - 1) * 100
                annual_str = f"{annual_ret:.1f}% a.a."

            # Cap rate and costs
            aluguel = prop.aluguel_mensal or 0
            iptu    = prop.iptu_anual or 0
            cond_anual = (prop.condominio_mensal or 0) * 12
            custo_anual = iptu + cond_anual
            cap_str = ""
            if aluguel > 0 and cur_brl > 0:
                cap = aluguel * 12 / cur_brl * 100
                net = (aluguel * 12 - custo_anual) / cur_brl * 100
                cap_str = f" | cap rate:{cap:.2f}% | yield líq:{net:.2f}%"

            loc = ""
            if prop.cidade:
                loc = f" | {prop.cidade}"
                if prop.bairro:
                    loc += f"/{prop.bairro}"

            # Zillow zestimate
            zillow_str = ""
            if country == "Estados Unidos":
                zillow_val = (
                    db.query(PropertyValuation)
                    .filter(
                        PropertyValuation.property_id == prop.id,
                        PropertyValuation.valuation_source == "zillow",
                    )
                    .order_by(PropertyValuation.valuation_date.desc())
                    .first()
                )
                if zillow_val and zillow_val.current_value_usd:
                    zillow_str = f" | Zestimate Zillow: USD {zillow_val.current_value_usd:,.0f} ({zillow_val.valuation_date.isoformat()})"
                cur_usd = val.current_value_usd if (val and val.current_value_usd) else cur_brl / rate
                purchase_usd = prop.purchase_price_usd or (purchase_brl / rate)
                lines.append(
                    f"  • {prop.description}{loc} | país: {country} | moeda: {currency} | "
                    f"compra: USD {purchase_usd:,.0f} (BRL {purchase_brl:,.0f}) | "
                    f"atual: USD {cur_usd:,.0f} (BRL {cur_brl:,.0f}) | "
                    f"ganho: BRL {gain_brl:+,.0f} ({gain_pct:+.1f}%) | "
                    f"{annual_str}{zillow_str} | "
                    f"custos/ano: BRL {custo_anual:,.0f}{cap_str}"
                )
            else:
                val_source = (val.valuation_source if val else "manual") or "manual"
                lines.append(
                    f"  • {prop.description}{loc} | país: {country} | moeda: {currency} | "
                    f"compra: BRL {purchase_brl:,.0f} | atual: BRL {cur_brl:,.0f} | "
                    f"ganho: BRL {gain_brl:+,.0f} ({gain_pct:+.1f}%) | "
                    f"{annual_str} | "
                    f"custos/ano: BRL {custo_anual:,.0f}{cap_str}"
                )
        lines.append(
            f"  Total imóveis: BRL {total_prop_brl:,.2f} | USD {total_prop_brl / rate:,.2f}"
        )
    else:
        lines.append("  Nenhum imóvel cadastrado.")

    # Projeção de renda 12 meses
    months = []
    for i in range(12):
        y = today.year + (today.month - 1 + i) // 12
        m = (today.month - 1 + i) % 12 + 1
        months.append(f"{y:04d}-{m:02d}")
    months_set = set(months)

    subq = (
        db.query(Snapshot.asset_id, func.max(Snapshot.snapshot_date).label("md"))
        .group_by(Snapshot.asset_id)
        .subquery()
    )
    latest_snaps = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset))
        .join(subq, (Snapshot.asset_id == subq.c.asset_id) & (Snapshot.snapshot_date == subq.c.md))
        .all()
    )

    income_m   = {m: 0.0 for m in months}
    maturity_m = {m: 0.0 for m in months}

    for s in latest_snaps:
        cur    = s.asset.currency if s.asset else "USD"
        mv     = s.market_value or 0.0
        mv_usd = mv / rate if cur == "BRL" else mv

        if s.estimated_income:
            ei_usd = (s.estimated_income / rate if cur == "BRL" else s.estimated_income) / 12
            for m in months:
                income_m[m] += ei_usd

        if s.maturity_date:
            key = s.maturity_date.strftime("%Y-%m")
            if key in months_set and mv_usd > 0:
                maturity_m[key] += mv_usd

    total_annual = sum(income_m.values())
    lines.append("")
    lines.append("### PROJEÇÃO DE RENDA (próximos 12 meses):")
    lines.append(
        f"  Renda estimada anual total: USD {total_annual:,.2f} | BRL {total_annual * rate:,.2f}"
    )
    for m in months:
        if income_m[m] > 0.01 or maturity_m[m] > 0.01:
            lines.append(
                f"  {m}: renda mensal USD {income_m[m]:,.2f} | vencimentos USD {maturity_m[m]:,.2f}"
            )

    return "\n".join(lines), rate


# ── Schemas ────────────────────────────────────────────────────────────────────

class MessageIn(BaseModel):
    message: str
    conversation_history: List[dict] = []


class MessageOut(BaseModel):
    response: str
    input_tokens: int
    output_tokens: int
    messages_used: int
    messages_limit: int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/message", response_model=MessageOut)
def send_message(body: MessageIn, db: Session = Depends(get_db)):
    # Check usage limit
    ym    = date.today().strftime("%Y-%m")
    usage = _get_or_create_usage(db, ym)

    if usage.message_count >= MONTHLY_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Limite mensal de {MONTHLY_LIMIT} mensagens atingido. "
                f"Renova em {_days_until_next_month()} dias."
            ),
        )

    # Load API key — strip() handles any stray whitespace/BOM that slipped through
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key or api_key == "sua_chave_aqui":
        raise HTTPException(
            status_code=503,
            detail="Chave da API Anthropic não configurada. Edite backend/.env e adicione ANTHROPIC_API_KEY.",
        )

    # Build system prompt with live portfolio context
    context, rate = build_portfolio_context(db)
    today_str     = date.today().isoformat()

    system_prompt = f"""Você é a Patri, assistente de gestão patrimonial do PatrimonIA. Você é inteligente, empática e fala de forma natural — como uma amiga que entende muito de finanças, não como um robô.

PERSONALIDADE:
- Tom caloroso e próximo, mas profissional — como uma consultora de confiança
- Usa linguagem natural, sem jargão desnecessário
- Quando os números são bons, comemora junto com o usuário
- Quando há riscos, alerta com cuidado sem alarmar
- Usa emojis com moderação para deixar a conversa mais leve 📊💰
- Faz perguntas de acompanhamento quando faz sentido
- Às vezes faz observações espontâneas interessantes sobre o portfólio
- Nunca começa respostas com "Claro!", "Certamente!" ou frases robóticas
- Varia o início das respostas — às vezes vai direto ao ponto, às vezes contextualiza

APRESENTAÇÃO (primeira mensagem de cada conversa):
"Oi! Sou a Patri, sua assistente de gestão patrimonial 👋 Já dei uma olhada em tudo — seus investimentos, imóveis e empréstimos. O que você quer saber hoje?"

COMO RESPONDER:
- Perguntas simples: resposta direta e curta, sem enrolação
- Perguntas complexas: organiza em tópicos curtos, fáceis de ler
- Sempre cita números reais do portfólio quando relevante
- Quando detecta algo importante (vencimento próximo, concentração alta): menciona proativamente mesmo que não perguntado
- Se não souber algo: "Isso eu não tenho como saber com os dados que tenho aqui, mas posso te ajudar com..."

EXEMPLOS DE COMO FALAR:

❌ Mecânico: "Com base nos dados do seu portfólio, seu patrimônio total é de R$ 5.988.087,45."
✅ Natural: "Seu patrimônio está em R$ 5,9 milhões hoje. Considerando a cotação do dólar, você tem uma exposição bem interessante ao exterior também 🌎"

❌ Mecânico: "Foram identificados 2 títulos vencendo nos próximos 30 dias."
✅ Natural: "Ah, vale ficar de olho — você tem o US Treasury vencendo amanhã e o Sumisho Air Lease vencendo em 2 dias. Já pensou o que vai fazer com esse dinheiro?"

❌ Mecânico: "A concentração em renda fixa está em 60,28%, acima do limite recomendado de 30%."
✅ Natural: "Uma coisa que eu notei: 60% do seu portfólio está em renda fixa. Dependendo dos seus objetivos, pode valer uma conversa com seu assessor sobre diversificação 🤔"

LIMITES:
- Nunca recomenda compra ou venda de ativos específicos sem avisar: "Só lembrando que isso não é recomendação de investimento, tá? 😉"
- Nunca inventa dados que não estão no portfólio
- Se perguntarem sobre ela: "Sou a Patri, assistente do PatrimonIA. Fui criada para te ajudar a entender melhor seu patrimônio!"

PORTFÓLIO DO USUÁRIO:
{context}

Data de hoje: {today_str}
Cotação USD/BRL: {rate:.4f}"""

    # Build messages list
    messages = list(body.conversation_history)
    messages.append({"role": "user", "content": body.message})

    # Persist user message
    db.add(ChatHistory(role="user", content=body.message))
    db.flush()

    # Call Anthropic
    try:
        client   = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=system_prompt,
            messages=messages,
        )
    except anthropic.AuthenticationError:
        raise HTTPException(status_code=503, detail="Chave da API inválida. Verifique ANTHROPIC_API_KEY em backend/.env.")
    except anthropic.RateLimitError:
        raise HTTPException(status_code=503, detail="Limite de taxa da API atingido. Tente novamente em instantes.")
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Erro ao chamar a IA: {str(e)}")

    response_text = response.content[0].text
    in_tokens     = response.usage.input_tokens
    out_tokens    = response.usage.output_tokens

    # Persist AI response + increment counter
    db.add(ChatHistory(role="assistant", content=response_text, tokens=in_tokens + out_tokens))
    usage.message_count += 1
    db.commit()

    return MessageOut(
        response=response_text,
        input_tokens=in_tokens,
        output_tokens=out_tokens,
        messages_used=usage.message_count,
        messages_limit=MONTHLY_LIMIT,
    )


@router.get("/usage")
def get_usage(db: Session = Depends(get_db)):
    ym    = date.today().strftime("%Y-%m")
    usage = db.query(ChatUsage).filter(ChatUsage.year_month == ym).first()
    return {
        "messages_used":      usage.message_count if usage else 0,
        "messages_limit":     MONTHLY_LIMIT,
        "days_until_reset":   _days_until_next_month(),
    }
