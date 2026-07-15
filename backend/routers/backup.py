import os
import shutil
import json
from datetime import date, datetime
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from io import BytesIO

from database import get_db, SessionLocal
import config

router = APIRouter(prefix="/backup", tags=["backup"])

DB_PATH    = str(config.DB_PATH)
BACKUP_DIR = str(config.BACKUPS_DIR)


@router.get("/sqlite")
def download_sqlite():
    if not os.path.exists(DB_PATH):
        return {"error": "Database not found"}
    return FileResponse(
        path=DB_PATH,
        media_type="application/octet-stream",
        filename=f"gestor-{date.today()}.db",
    )


@router.post("/create")
def create_backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts       = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"gestor-{ts}.db"
    dest     = os.path.join(BACKUP_DIR, filename)
    shutil.copy2(DB_PATH, dest)

    # Keep only latest 30
    files = sorted(f for f in os.listdir(BACKUP_DIR) if f.endswith(".db"))
    for old in files[:-30]:
        os.remove(os.path.join(BACKUP_DIR, old))

    size_kb = round(os.path.getsize(dest) / 1024, 1)
    return {"filename": filename, "size_kb": size_kb, "created_at": datetime.now().isoformat()}


@router.get("/list")
def list_backups():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    result = []
    for f in sorted(os.listdir(BACKUP_DIR), reverse=True):
        if not f.endswith(".db"):
            continue
        path = os.path.join(BACKUP_DIR, f)
        result.append({
            "filename":   f,
            "size_kb":    round(os.path.getsize(path) / 1024, 1),
            "created_at": datetime.fromtimestamp(os.path.getmtime(path)).isoformat(),
        })
    return result[:30]


@router.get("/json")
def export_json(db: Session = Depends(get_db)):
    from models import (
        Institution, Asset, Snapshot, ExchangeRate, Loan, LoanSnapshot, LoanEvent,
        Property, PropertyValuation, PropertyRentalIncome, ManualAssetHistory, Dividend,
    )

    def rows(model):
        items = db.query(model).all()
        cols  = [c.name for c in model.__table__.columns]
        out   = []
        for row in items:
            d = {c: getattr(row, c) for c in cols}
            # Serialize dates
            for k, v in d.items():
                if hasattr(v, "isoformat"):
                    d[k] = v.isoformat()
            out.append(d)
        return out

    data = {
        "exported_at":     datetime.now().isoformat(),
        "institutions":    rows(Institution),
        "assets":          rows(Asset),
        "snapshots":       rows(Snapshot),
        "exchange_rates":  rows(ExchangeRate),
        "loans":           rows(Loan),
        "loan_snapshots":  rows(LoanSnapshot),
        "loan_events":     rows(LoanEvent),
        "properties":      rows(Property),
        "property_valuations": rows(PropertyValuation),
        "property_rental_income": rows(PropertyRentalIncome),
        "manual_asset_history": rows(ManualAssetHistory),
        "dividends":       rows(Dividend),
    }

    buf = BytesIO(json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8"))
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="gestor-{date.today()}.json"'},
    )
