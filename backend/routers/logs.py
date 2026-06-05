from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta, date
from typing import List, Optional
from pydantic import BaseModel

from database import get_db
from models import ImportLog

router = APIRouter(prefix="/logs", tags=["logs"])


class ImportLogOut(BaseModel):
    id: int
    filename: str
    parser_name: Optional[str] = None
    institution_name: Optional[str] = None
    snapshot_date: Optional[date] = None
    status: str
    records_inserted: int = 0
    records_updated: int = 0
    records_failed: int = 0
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None
    file_size_kb: Optional[float] = None
    processing_time_ms: Optional[int] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ImportLogStats(BaseModel):
    total: int
    success: int
    partial: int
    error: int
    success_rate: float
    recent_errors: int
    last_import_at: Optional[datetime] = None
    last_import_status: Optional[str] = None


@router.get("/imports", response_model=List[ImportLogOut])
def list_import_logs(limit: int = Query(50, le=200), db: Session = Depends(get_db)):
    logs = db.query(ImportLog).order_by(desc(ImportLog.created_at)).limit(limit).all()
    return logs


@router.get("/imports/stats", response_model=ImportLogStats)
def import_stats(db: Session = Depends(get_db)):
    total   = db.query(func.count(ImportLog.id)).scalar() or 0
    success = db.query(func.count(ImportLog.id)).filter(ImportLog.status == "success").scalar() or 0
    partial = db.query(func.count(ImportLog.id)).filter(ImportLog.status == "partial").scalar() or 0
    error   = db.query(func.count(ImportLog.id)).filter(ImportLog.status == "error").scalar() or 0

    cutoff = datetime.utcnow() - timedelta(days=7)
    recent_errors = db.query(func.count(ImportLog.id)).filter(
        ImportLog.status != "success",
        ImportLog.created_at >= cutoff,
    ).scalar() or 0

    last = db.query(ImportLog).order_by(desc(ImportLog.created_at)).first()

    return ImportLogStats(
        total=total,
        success=success,
        partial=partial,
        error=error,
        success_rate=round(success / total, 3) if total else 0.0,
        recent_errors=recent_errors,
        last_import_at=last.created_at if last else None,
        last_import_status=last.status if last else None,
    )
