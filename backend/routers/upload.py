import time
import traceback
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date
from typing import List, Tuple

from database import get_db, _slugify, _make_default_label
from models import Institution, Asset, Snapshot, ImportLog, ImportSource
from schemas import UploadResult
from parsers.registry import detect_and_parse, get_supported_parsers
from parsers.base import ParsedRecord

router = APIRouter(prefix="/upload", tags=["upload"])


def _upsert_institution(db: Session, name: str, country: str, currency: str) -> Institution:
    inst = db.query(Institution).filter(Institution.name == name).first()
    if not inst:
        inst = Institution(name=name, country=country, currency=currency)
        db.add(inst)
        db.flush()
    return inst


def _upsert_asset(db: Session, inst: Institution, rec: ParsedRecord, is_reimport: bool = False) -> Asset:
    asset = db.query(Asset).filter(
        Asset.institution_id == inst.id,
        Asset.name == rec.asset_name,
        Asset.asset_type == rec.asset_type,
        Asset.account_number == getattr(rec, "account_number", None),
        Asset.source != "manual",
    ).first()
    if not asset:
        asset = Asset(
            institution_id=inst.id,
            identifier=rec.asset_identifier,
            name=rec.asset_name,
            asset_type=rec.asset_type,
            currency=rec.asset_currency,
            purchase_date=rec.purchase_date,
            source="pdf_import",
            account_number=getattr(rec, "account_number", None),
        )
        db.add(asset)
        db.flush()
    else:
        # Store earliest purchase_date detected by parser; never override manual (user_edited) entry
        if rec.purchase_date is not None and not asset.user_edited:
            if asset.purchase_date is None or rec.purchase_date < asset.purchase_date:
                asset.purchase_date = rec.purchase_date
        if not asset.user_edited and not asset.account_number:
            asset.account_number = getattr(rec, "account_number", None)
    # Never overwrite user-edited notes/monthly_dividends_expected
    return asset


def _upsert_import_source(db: Session, inst: Institution, account_number: str) -> ImportSource:
    acct = account_number or ""
    src = db.query(ImportSource).filter(
        ImportSource.institution_id == inst.id,
        ImportSource.account_number == acct,
    ).first()
    if not src:
        label = _make_default_label(inst.name, acct)
        order = db.query(ImportSource).count()
        src = ImportSource(
            institution_id=inst.id,
            account_number=acct,
            institution_key=_slugify(inst.name),
            default_label=label,
            currency=inst.currency or "BRL",
            display_order=order,
            visible=True,
        )
        db.add(src)
        db.flush()
    return src


def _upsert_snapshot(db: Session, asset_id: int, filename: str, rec: ParsedRecord, is_reimport: bool = False) -> Tuple[bool, bool]:
    """Insert or update snapshot. Returns (inserted, updated)."""
    if is_reimport:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()
        if asset and getattr(asset, "source", None) == "manual":
            return False, False

    existing = db.query(Snapshot).filter(
        Snapshot.asset_id == asset_id,
        Snapshot.snapshot_date == rec.snapshot_date,
    ).first()

    if existing:
        existing.raw_source_file = filename
        existing.units = rec.units
        existing.price = rec.price
        existing.cost_basis = rec.cost_basis
        existing.market_value = rec.market_value
        existing.unrealized_gain = rec.unrealized_gain
        existing.estimated_income = rec.estimated_income
        existing.accrued_income = rec.accrued_income
        existing.current_yield = rec.current_yield
        existing.tax_gross = rec.tax_gross
        existing.tax_net = rec.tax_net
        existing.rate_description = rec.rate_description
        existing.maturity_date = rec.maturity_date
        existing.purchase_date = rec.purchase_date
        existing.portfolio_name = rec.portfolio_name
        return False, True

    snap = Snapshot(
        asset_id=asset_id,
        snapshot_date=rec.snapshot_date,
        units=rec.units,
        price=rec.price,
        cost_basis=rec.cost_basis,
        market_value=rec.market_value,
        unrealized_gain=rec.unrealized_gain,
        estimated_income=rec.estimated_income,
        accrued_income=rec.accrued_income,
        current_yield=rec.current_yield,
        tax_gross=rec.tax_gross,
        tax_net=rec.tax_net,
        rate_description=rec.rate_description,
        maturity_date=rec.maturity_date,
        purchase_date=rec.purchase_date,
        portfolio_name=rec.portfolio_name,
        raw_source_file=filename,
    )
    db.add(snap)
    return True, False


@router.post("/", response_model=UploadResult)
async def upload_file(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    filename = file.filename or "unknown"
    file_size_kb = round(len(content) / 1024, 1)
    start_ms = time.time()

    log = ImportLog(
        filename=filename,
        file_size_kb=file_size_kb,
        status="error",
        records_inserted=0,
        records_updated=0,
        records_failed=0,
    )

    try:
        parser_name, records = detect_and_parse(filename, content)

        if parser_name is None or not records:
            supported = ", ".join(get_supported_parsers())
            log.error_message = f"Nenhum parser encontrou correspondência para '{filename}'. Parsers registrados: {supported}."
            log.processing_time_ms = int((time.time() - start_ms) * 1000)
            db.add(log)
            db.commit()
            raise HTTPException(
                status_code=422,
                detail=f"No parser could handle '{filename}'. Supported: {supported}.",
            )

        log.parser_name = parser_name
        institution_name = records[0].institution_name if records else "Unknown"
        snap_date = records[0].snapshot_date if records else date.today()
        log.institution_name = institution_name
        log.snapshot_date = snap_date

        inserted = 0
        updated = 0
        errors: List[str] = []

        for rec in records:
            try:
                inst = _upsert_institution(db, rec.institution_name, rec.institution_country, rec.institution_currency)
                asset = _upsert_asset(db, inst, rec, is_reimport=True)
                _upsert_import_source(db, inst, getattr(rec, "account_number", None) or "")
                was_inserted, was_updated = _upsert_snapshot(db, asset.id, filename, rec, is_reimport=True)
                if was_inserted:
                    inserted += 1
                elif was_updated:
                    updated += 1
            except Exception as e:
                errors.append(f"{rec.asset_name}: {str(e)}")

        db.commit()

        if errors and (inserted + updated) == 0:
            status = "error"
        elif errors:
            status = "partial"
        else:
            status = "success"

        log.status = status
        log.records_inserted = inserted
        log.records_updated = updated
        log.records_failed = len(errors)
        log.error_message = "; ".join(errors) if errors else None
        log.processing_time_ms = int((time.time() - start_ms) * 1000)
        db.add(log)
        db.commit()

        return UploadResult(
            filename=filename,
            parser_used=parser_name,
            institution=institution_name,
            snapshot_date=snap_date,
            records_inserted=inserted,
            records_updated=updated,
            errors=errors,
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error_message = str(e)
        log.stack_trace = traceback.format_exc()
        log.processing_time_ms = int((time.time() - start_ms) * 1000)
        db.add(log)
        try:
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao processar arquivo: {str(e)}")
