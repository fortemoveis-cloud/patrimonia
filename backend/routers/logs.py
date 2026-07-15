import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, or_
from datetime import datetime, timedelta, date
from typing import List, Optional
from pydantic import BaseModel

from database import get_db
from models import ImportLog, Asset, Snapshot, Dividend

router = APIRouter(prefix="/logs", tags=["logs"])

_log = logging.getLogger(__name__)


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


@router.delete("/imports/{log_id}")
def delete_import(log_id: int, db: Session = Depends(get_db)):
    """Desfaz uma importação: remove os snapshots criados por aquele
    arquivo naquela data e os ativos importados que ficarem sem nenhum
    snapshot. Ativos manuais nunca são tocados. Um backup do .db é criado
    antes da exclusão.

    Atenção: se o mesmo arquivo foi importado mais de uma vez (reimport),
    os snapshots são compartilhados — excluir qualquer uma das importações
    remove os dados daquele arquivo+data.
    """
    log = db.query(ImportLog).filter(ImportLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="Importação não encontrada")

    snapshots_deleted = 0
    assets_deleted = 0

    if log.snapshot_date is not None:
        # Backup automático antes de destruir dados
        try:
            from routers.backup import create_backup
            create_backup()
        except Exception as exc:
            _log.warning("Backup pré-exclusão falhou (seguindo mesmo assim): %s", exc)

        # Snapshots deste arquivo nesta data — nunca de ativos manuais
        snaps = (
            db.query(Snapshot)
            .join(Asset, Asset.id == Snapshot.asset_id)
            .filter(
                Snapshot.raw_source_file == log.filename,
                Snapshot.snapshot_date == log.snapshot_date,
                or_(Asset.source.is_(None), Asset.source != "manual"),
            )
            .all()
        )
        touched_asset_ids = {s.asset_id for s in snaps}
        for s in snaps:
            db.delete(s)
        snapshots_deleted = len(snaps)
        db.flush()

        # Ativos importados que ficaram órfãos (sem snapshots e sem proventos)
        for aid in touched_asset_ids:
            remaining = db.query(Snapshot).filter(Snapshot.asset_id == aid).count()
            has_dividends = db.query(Dividend).filter(Dividend.asset_id == aid).count()
            if remaining == 0 and has_dividends == 0:
                asset = db.query(Asset).filter(Asset.id == aid).first()
                if asset and asset.source != "manual":
                    db.delete(asset)
                    assets_deleted += 1

    db.delete(log)
    db.commit()

    _log.info(
        "Importação %d excluída (%s @ %s): %d snapshots, %d ativos órfãos",
        log_id, log.filename, log.snapshot_date, snapshots_deleted, assets_deleted,
    )
    return {
        "ok": True,
        "snapshots_deleted": snapshots_deleted,
        "assets_deleted": assets_deleted,
    }
