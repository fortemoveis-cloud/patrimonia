from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from datetime import date
from typing import List

from database import get_db
from models import Loan, LoanSnapshot, Institution, ExchangeRate
from schemas import LoanCreate, LoanOut, LoanSnapshotCreate, LoanSnapshotOut

router = APIRouter(prefix="/loans", tags=["loans"])


def _latest_rate(db: Session) -> float:
    rate = db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).first()
    return rate.usd_brl if rate else 5.0


def _current_balance(db: Session, loan_id: int, fallback: float) -> float:
    snap = (
        db.query(LoanSnapshot)
        .filter(LoanSnapshot.loan_id == loan_id)
        .order_by(LoanSnapshot.snapshot_date.desc())
        .first()
    )
    if snap and snap.outstanding_balance is not None:
        return snap.outstanding_balance
    return fallback or 0.0


def _get_or_create_inst(db: Session, name: str, currency: str) -> int:
    inst = db.query(Institution).filter(Institution.name == name).first()
    if not inst:
        country = "BR" if currency == "BRL" else "US"
        inst = Institution(name=name, country=country, currency=currency)
        db.add(inst)
        db.flush()
    return inst.id


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
            "interest_rate":       loan.interest_rate,
            "maturity_date":       loan.maturity_date.isoformat() if loan.maturity_date else None,
            "usd_value":           round(usd_val, 2),
            "brl_value":           round(brl_val, 2),
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
        db.add(LoanSnapshot(
            loan_id=loan.id,
            snapshot_date=date.today(),
            outstanding_balance=payload.outstanding_balance,
        ))

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

    if payload.institution_name:
        loan.institution_id = _get_or_create_inst(db, payload.institution_name, payload.currency)

    loan.description    = payload.description
    loan.currency       = payload.currency
    loan.interest_rate  = payload.interest_rate
    loan.start_date     = payload.start_date
    loan.maturity_date  = payload.maturity_date
    loan.loan_number    = payload.loan_number
    if payload.original_amount:
        loan.original_amount = payload.original_amount

    if payload.outstanding_balance is not None:
        db.add(LoanSnapshot(
            loan_id=loan.id,
            snapshot_date=date.today(),
            outstanding_balance=payload.outstanding_balance,
        ))

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
