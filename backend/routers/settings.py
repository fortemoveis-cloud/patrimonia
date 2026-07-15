from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from database import get_db, _slugify, _make_default_label, _get_app_setting
from models import ImportSource, Institution, AppSettings
from schemas import ImportSourceUpdate, SourcesReorder, AppSettingUpdate

router = APIRouter(prefix="/settings", tags=["settings"])

_ALLOWED_SETTING_KEYS = {"alert_drop_threshold_pct", "alert_monitored_classes", "alert_maturity_days"}


@router.get("/sources")
def list_sources(db: Session = Depends(get_db)):
    sources = (
        db.query(ImportSource)
        .order_by(ImportSource.display_order, ImportSource.id)
        .all()
    )
    result = []
    for s in sources:
        inst = db.query(Institution).filter(Institution.id == s.institution_id).first()
        result.append({
            "id": s.id,
            "institution_id": s.institution_id,
            "institution_name": inst.name if inst else "—",
            "account_number": s.account_number or None,
            "institution_key": s.institution_key,
            "default_label": s.default_label,
            "custom_label": s.custom_label,
            "label": s.custom_label or s.default_label,
            "currency": s.currency,
            "display_order": s.display_order,
            "visible": bool(s.visible),
        })
    return result


@router.patch("/sources/{source_id}")
def update_source(source_id: int, payload: ImportSourceUpdate, db: Session = Depends(get_db)):
    src = db.query(ImportSource).filter(ImportSource.id == source_id).first()
    if not src:
        raise HTTPException(status_code=404, detail="Fonte não encontrada")

    data = payload.model_dump(exclude_unset=True)

    if "custom_label" in data:
        v = data["custom_label"]
        src.custom_label = str(v).strip() if v not in (None, "", "null") else None

    if "visible" in data and data["visible"] is not None:
        src.visible = bool(data["visible"])

    if "display_order" in data and data["display_order"] is not None:
        src.display_order = int(data["display_order"])

    db.commit()
    return {
        "id": src.id,
        "label": src.custom_label or src.default_label,
        "visible": bool(src.visible),
        "display_order": src.display_order,
    }


@router.post("/sources/reorder")
def reorder_sources(payload: SourcesReorder, db: Session = Depends(get_db)):
    """Bulk update display_order. payload: {ordered_ids: [1, 3, 2, ...]}"""
    ordered_ids: List[int] = payload.ordered_ids
    for i, sid in enumerate(ordered_ids):
        src = db.query(ImportSource).filter(ImportSource.id == sid).first()
        if src:
            src.display_order = i
    db.commit()
    return {"ok": True}


@router.get("/app")
def get_app_settings(db: Session = Depends(get_db)):
    rows = db.query(AppSettings).all()
    return {r.key: r.value for r in rows}


@router.put("/app/{key}")
def update_app_setting(key: str, payload: AppSettingUpdate, db: Session = Depends(get_db)):
    if key not in _ALLOWED_SETTING_KEYS:
        raise HTTPException(status_code=400, detail=f"Chave não permitida: {key}")
    value = str(payload.value)
    row = db.query(AppSettings).filter(AppSettings.key == key).first()
    if row:
        row.value = value
    else:
        db.add(AppSettings(key=key, value=value))
    db.commit()
    db.refresh(row) if row else None
    updated = db.query(AppSettings).filter(AppSettings.key == key).first()
    return {
        "key":        updated.key,
        "value":      updated.value,
        "updated_at": updated.updated_at.isoformat() if updated.updated_at else None,
    }
