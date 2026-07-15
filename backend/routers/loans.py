from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from datetime import date
from typing import List, Optional

import fx
from database import get_db
from models import Loan, LoanEvent, LoanSnapshot, Institution
from schemas import (
    LoanCreate, LoanOut, LoanSnapshotCreate, LoanSnapshotOut,
    LoanPaymentCreate, LoanPayoffCreate, LoanBalanceSet, LoanEventOut,
)

router = APIRouter(prefix="/loans", tags=["loans"])


def _latest_rate(db: Session) -> float:
    rate, _ = fx.get_latest_rate(db)
    return rate


def _recompute_loan_balance(db: Session, loan_id: int) -> float:
    """Recalcula o saldo devedor a partir da sequência de eventos.

    Ordem cronológica com desempate por id (dois eventos no mesmo dia são
    aplicados na ordem de lançamento). Pagamento nunca deixa o saldo negativo.
    Materializa resulting_balance em cada evento e retorna o saldo final.
    """
    events = (
        db.query(LoanEvent)
        .filter(LoanEvent.loan_id == loan_id)
        .order_by(LoanEvent.event_date.asc(), LoanEvent.id.asc())
        .all()
    )
    balance = 0.0
    for ev in events:
        if ev.event_type == "balance_set":
            balance = ev.amount or 0.0
        elif ev.event_type == "payment":
            balance = max(0.0, balance - (ev.amount or 0.0))
        elif ev.event_type == "payoff":
            balance = 0.0
        ev.resulting_balance = round(balance, 2)
    return balance


def _current_balance(db: Session, loan_id: int, fallback: float) -> float:
    """Saldo devedor atual: último evento (event_date, id). Empréstimos
    anteriores à migração sem eventos caem no LoanSnapshot legado."""
    ev = (
        db.query(LoanEvent)
        .filter(LoanEvent.loan_id == loan_id)
        .order_by(LoanEvent.event_date.desc(), LoanEvent.id.desc())
        .first()
    )
    if ev is not None:
        return ev.resulting_balance
    snap = (
        db.query(LoanSnapshot)
        .filter(LoanSnapshot.loan_id == loan_id, LoanSnapshot.outstanding_balance.isnot(None))
        .order_by(LoanSnapshot.snapshot_date.desc(), LoanSnapshot.id.desc())
        .first()
    )
    if snap is not None:
        return snap.outstanding_balance
    return fallback or 0.0


def _add_event(db: Session, loan_id: int, event_type: str, event_date: date,
               amount: Optional[float], notes: Optional[str]) -> LoanEvent:
    ev = LoanEvent(
        loan_id=loan_id,
        event_date=event_date,
        event_type=event_type,
        amount=amount,
        resulting_balance=0.0,  # materializado pelo recálculo abaixo
        notes=notes,
    )
    db.add(ev)
    db.flush()
    _recompute_loan_balance(db, loan_id)
    return ev


def _get_or_create_inst(db: Session, name: str, currency: str) -> int:
    inst = db.query(Institution).filter(Institution.name == name).first()
    if not inst:
        country = "BR" if currency == "BRL" else "US"
        inst = Institution(name=name, country=country, currency=currency)
        db.add(inst)
        db.flush()
    return inst.id


def _validate_event_date(d: date):
    if d > date.today():
        raise HTTPException(status_code=422, detail="Data do evento não pode ser futura")


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    usd_brl = _latest_rate(db)
    loans = (
        db.query(Loan)
        .options(joinedload(Loan.institution))
        .filter(Loan.is_active == True)  # noqa: E712
        .all()
    )

    total_usd = 0.0
    total_brl = 0.0
    items = []

    for loan in loans:
        balance = _current_balance(db, loan.id, loan.original_amount or 0.0)
        if loan.currency == "BRL":
            usd_val = balance / usd_brl
            brl_val = balance
        else:
            usd_val = balance
            brl_val = balance * usd_brl

        total_usd += usd_val
        total_brl += brl_val

        items.append({
            "id":                  loan.id,
            "description":         loan.description,
            "institution_name":    loan.institution.name if loan.institution else None,
            "currency":            loan.currency,
            "outstanding_balance": balance,
            "original_amount":     loan.original_amount,
            "interest_rate":       loan.interest_rate,
            "maturity_date":       loan.maturity_date.isoformat() if loan.maturity_date else None,
            "usd_value":           round(usd_val, 2),
            "brl_value":           round(brl_val, 2),
            "paid_off":            balance == 0,
        })

    return {
        "total_usd":    round(total_usd, 2),
        "total_brl":    round(total_brl, 2),
        "active_count": len(loans),
        "loans":        items,
    }


@router.get("/", response_model=List[LoanOut])
def list_loans(db: Session = Depends(get_db)):
    loans = (
        db.query(Loan)
        .options(joinedload(Loan.institution))
        .order_by(Loan.is_active.desc(), Loan.description)
        .all()
    )
    result = []
    for loan in loans:
        balance = _current_balance(db, loan.id, loan.original_amount or 0.0)
        result.append(LoanOut(
            id=loan.id,
            institution_id=loan.institution_id,
            institution_name=loan.institution.name if loan.institution else None,
            loan_number=loan.loan_number,
            description=loan.description,
            currency=loan.currency,
            original_amount=loan.original_amount,
            interest_rate=loan.interest_rate,
            start_date=loan.start_date,
            maturity_date=loan.maturity_date,
            is_active=loan.is_active,
            outstanding_balance=balance,
        ))
    return result


@router.post("/", response_model=LoanOut)
def create_loan(payload: LoanCreate, db: Session = Depends(get_db)):
    institution_id = None
    if payload.institution_name:
        institution_id = _get_or_create_inst(db, payload.institution_name, payload.currency)

    loan = Loan(
        institution_id=institution_id,
        loan_number=payload.loan_number,
        description=payload.description,
        currency=payload.currency,
        original_amount=payload.original_amount or payload.outstanding_balance,
        interest_rate=payload.interest_rate,
        start_date=payload.start_date,
        maturity_date=payload.maturity_date,
        is_active=True,
    )
    db.add(loan)
    db.flush()

    if payload.outstanding_balance is not None:
        _add_event(db, loan.id, "balance_set", payload.start_date or date.today(),
                   payload.outstanding_balance, "Saldo inicial")

    db.commit()
    db.refresh(loan)

    return LoanOut(
        id=loan.id,
        institution_id=loan.institution_id,
        institution_name=payload.institution_name,
        loan_number=loan.loan_number,
        description=loan.description,
        currency=loan.currency,
        original_amount=loan.original_amount,
        interest_rate=loan.interest_rate,
        start_date=loan.start_date,
        maturity_date=loan.maturity_date,
        is_active=loan.is_active,
        outstanding_balance=payload.outstanding_balance,
    )


@router.put("/{loan_id}", response_model=LoanOut)
def update_loan(loan_id: int, payload: LoanCreate, db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")

    # Atualização parcial: só sobrescreve campos presentes no payload —
    # editar o saldo não pode apagar loan_number/start_date.
    data = payload.model_dump(exclude_unset=True)

    if data.get("institution_name"):
        loan.institution_id = _get_or_create_inst(db, payload.institution_name, payload.currency)

    for field in ("description", "currency", "interest_rate", "start_date",
                  "maturity_date", "loan_number"):
        if field in data:
            setattr(loan, field, data[field])
    if data.get("original_amount"):
        loan.original_amount = data["original_amount"]

    # Compat: saldo via PUT vira evento balance_set (preserva histórico)
    if data.get("outstanding_balance") is not None:
        _add_event(db, loan.id, "balance_set", date.today(),
                   data["outstanding_balance"], "Ajuste de saldo")

    db.commit()
    db.refresh(loan)

    balance = _current_balance(db, loan.id, loan.original_amount or 0.0)
    inst = db.query(Institution).filter(Institution.id == loan.institution_id).first() if loan.institution_id else None

    return LoanOut(
        id=loan.id,
        institution_id=loan.institution_id,
        institution_name=inst.name if inst else payload.institution_name,
        loan_number=loan.loan_number,
        description=loan.description,
        currency=loan.currency,
        original_amount=loan.original_amount,
        interest_rate=loan.interest_rate,
        start_date=loan.start_date,
        maturity_date=loan.maturity_date,
        is_active=loan.is_active,
        outstanding_balance=balance,
    )


@router.delete("/{loan_id}")
def archive_loan(loan_id: int, db: Session = Depends(get_db)):
    loan = db.query(Loan).filter(Loan.id == loan_id).first()
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    loan.is_active = False
    db.commit()
    return {"ok": True}


# ── Eventos (pagamentos, quitação, ajuste de saldo) ───────────────────────────

@router.get("/{loan_id}/events", response_model=List[LoanEventOut])
def list_events(loan_id: int, db: Session = Depends(get_db)):
    if not db.query(Loan).filter(Loan.id == loan_id).first():
        raise HTTPException(status_code=404, detail="Loan not found")
    return (
        db.query(LoanEvent)
        .filter(LoanEvent.loan_id == loan_id)
        .order_by(LoanEvent.event_date.desc(), LoanEvent.id.desc())
        .all()
    )


@router.post("/{loan_id}/payments", response_model=LoanEventOut)
def register_payment(loan_id: int, payload: LoanPaymentCreate, db: Session = Depends(get_db)):
    if not db.query(Loan).filter(Loan.id == loan_id).first():
        raise HTTPException(status_code=404, detail="Loan not found")
    if payload.amount <= 0:
        raise HTTPException(status_code=422, detail="Valor do pagamento deve ser maior que zero")
    _validate_event_date(payload.date)
    ev = _add_event(db, loan_id, "payment", payload.date, payload.amount, payload.notes)
    db.commit()
    db.refresh(ev)
    return ev


@router.post("/{loan_id}/payoff", response_model=LoanEventOut)
def payoff_loan(loan_id: int, payload: LoanPayoffCreate, db: Session = Depends(get_db)):
    if not db.query(Loan).filter(Loan.id == loan_id).first():
        raise HTTPException(status_code=404, detail="Loan not found")
    _validate_event_date(payload.date)
    ev = _add_event(db, loan_id, "payoff", payload.date, None,
                    payload.notes or "Quitação")
    db.commit()
    db.refresh(ev)
    return ev


@router.post("/{loan_id}/balance", response_model=LoanEventOut)
def set_balance(loan_id: int, payload: LoanBalanceSet, db: Session = Depends(get_db)):
    if not db.query(Loan).filter(Loan.id == loan_id).first():
        raise HTTPException(status_code=404, detail="Loan not found")
    if payload.amount < 0:
        raise HTTPException(status_code=422, detail="Saldo não pode ser negativo")
    _validate_event_date(payload.date)
    ev = _add_event(db, loan_id, "balance_set", payload.date, payload.amount, payload.notes)
    db.commit()
    db.refresh(ev)
    return ev


@router.delete("/{loan_id}/events/{event_id}")
def delete_event(loan_id: int, event_id: int, db: Session = Depends(get_db)):
    ev = db.query(LoanEvent).filter(
        LoanEvent.id == event_id, LoanEvent.loan_id == loan_id,
    ).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Evento não encontrado")
    remaining = db.query(LoanEvent).filter(LoanEvent.loan_id == loan_id).count()
    if remaining <= 1:
        raise HTTPException(
            status_code=422,
            detail="Não é possível remover o único evento do histórico — ajuste o saldo em vez disso.",
        )
    db.delete(ev)
    db.flush()
    balance = _recompute_loan_balance(db, loan_id)
    db.commit()
    return {"ok": True, "outstanding_balance": round(balance, 2)}


# ── Legado ─────────────────────────────────────────────────────────────────────

@router.post("/{loan_id}/snapshots", response_model=LoanSnapshotOut)
def add_snapshot(loan_id: int, payload: LoanSnapshotCreate, db: Session = Depends(get_db)):
    if not db.query(Loan).filter(Loan.id == loan_id).first():
        raise HTTPException(status_code=404, detail="Loan not found")
    snap = LoanSnapshot(
        loan_id=loan_id,
        snapshot_date=payload.snapshot_date,
        outstanding_balance=payload.outstanding_balance,
        interest_accrued=payload.interest_accrued,
        monthly_payment=payload.monthly_payment,
    )
    db.add(snap)
    db.commit()
    db.refresh(snap)
    return snap
