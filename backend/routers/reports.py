import json

from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, distinct
from datetime import date, timedelta
from typing import Optional
from io import BytesIO
from collections import defaultdict

import fx
from database import get_db
from models import Snapshot, Asset, Institution, ExchangeRate, Loan, LoanSnapshot, Property, PropertyValuation, Report
from routers.loans import _current_balance
from schemas import ReportGenerateRequest

router = APIRouter(prefix="/reports", tags=["reports"])


def _rate(db):
    rate, _ = fx.get_latest_rate(db)
    return rate


def _to_usd(v, currency, rate):
    if v is None:
        return 0.0
    return v / rate if currency == "BRL" else v


def _fmtbrl(v):
    if v is None:
        return "—"
    return f"R$ {v:,.2f}"


def _fmtusd(v):
    if v is None:
        return "—"
    return f"US$ {v:,.2f}"


# ── Period helpers ────────────────────────────────────────────────────────────

def _iso_week_bounds(d: date):
    monday = d - timedelta(days=d.weekday())
    return monday, monday + timedelta(days=6)


def _month_bounds(d: date):
    first = d.replace(day=1)
    last = date(d.year, 12, 31) if d.month == 12 else date(d.year, d.month + 1, 1) - timedelta(days=1)
    return first, last


def _all_closed_periods(earliest: date, today: date):
    periods = []
    cur_monday = earliest - timedelta(days=earliest.weekday())
    while True:
        cur_sunday = cur_monday + timedelta(days=6)
        if cur_sunday >= today:
            break
        periods.append(("weekly", cur_monday, cur_sunday))
        cur_monday += timedelta(weeks=1)
    cur_first = earliest.replace(day=1)
    while True:
        _, cur_last = _month_bounds(cur_first)
        if cur_last >= today:
            break
        periods.append(("monthly", cur_first, cur_last))
        cur_first = date(cur_first.year + 1, 1, 1) if cur_first.month == 12 else date(cur_first.year, cur_first.month + 1, 1)
    return periods


# ── Report computation ─────────────────────────────────────────────────────────

def _compute_report_payload(db, period_start: date, period_end: date) -> dict:
    usd_brl, _ = fx.get_rate_for_date(db, period_end)

    assets = (
        db.query(Asset)
        .options(joinedload(Asset.institution))
        .filter(Asset.is_active.isnot(False))
        .all()
    )
    assets_data  = []
    total_end    = 0.0
    total_start  = 0.0
    by_type: dict = defaultdict(float)
    by_cur:  dict = defaultdict(float)

    for asset in assets:
        snap_end = (
            db.query(Snapshot)
            .filter(Snapshot.asset_id == asset.id, Snapshot.snapshot_date <= period_end)
            .order_by(Snapshot.snapshot_date.desc()).first()
        )
        if snap_end is None:
            continue
        snap_start = (
            db.query(Snapshot)
            .filter(Snapshot.asset_id == asset.id, Snapshot.snapshot_date <= period_start)
            .order_by(Snapshot.snapshot_date.desc()).first()
        )
        mv_end    = snap_end.market_value or 0.0
        end_brl   = mv_end * usd_brl if asset.currency == "USD" else mv_end
        mv_start  = (snap_start.market_value or 0.0) if snap_start else 0.0
        start_brl = mv_start * usd_brl if asset.currency == "USD" else mv_start
        total_end   += end_brl
        total_start += start_brl
        by_type[asset.asset_type] += end_brl
        by_cur[asset.currency]    += end_brl
        chg = round((end_brl - start_brl) / start_brl * 100, 2) if start_brl > 0 else None
        assets_data.append({
            "asset_id":        asset.id,
            "asset_name":      asset.name,
            "institution":     asset.institution.name if asset.institution else "—",
            "asset_type":      asset.asset_type,
            "currency":        asset.currency,
            "value_start_brl": round(start_brl, 2),
            "value_end_brl":   round(end_brl, 2),
            "change_pct":      chg,
        })

    assets_data.sort(key=lambda x: -x["value_end_brl"])
    with_pct = [a for a in assets_data if a["change_pct"] is not None]
    gainers  = sorted(with_pct, key=lambda x: -(x["change_pct"] or 0))[:5]
    losers   = [a for a in sorted(with_pct, key=lambda x: (x["change_pct"] or 0))[:5] if (a["change_pct"] or 0) < 0]
    chg_brl  = total_end - total_start
    chg_pct  = round(chg_brl / total_start * 100, 2) if total_start > 0 else None
    TYPE_LABELS = {"equity": "Renda Variável", "fixed_income": "Renda Fixa", "fund": "Fundos", "cash": "Caixa"}

    return {
        "total_brl":    round(total_end, 2),
        "total_usd":    round(total_end / usd_brl, 2) if usd_brl else 0.0,
        "change_brl":   round(chg_brl, 2),
        "change_pct":   chg_pct,
        "usd_brl_rate": usd_brl,
        "by_asset_type": [
            {"type": t, "label": TYPE_LABELS.get(t, t), "value_brl": round(v, 2),
             "pct": round(v / total_end * 100, 1) if total_end > 0 else 0.0}
            for t, v in sorted(by_type.items(), key=lambda x: -x[1])
        ],
        "by_currency": [
            {"currency": c, "value_brl": round(v, 2),
             "pct": round(v / total_end * 100, 1) if total_end > 0 else 0.0}
            for c, v in sorted(by_cur.items(), key=lambda x: -x[1])
        ],
        "assets":  assets_data,
        "gainers": gainers,
        "losers":  losers,
    }


@router.get("/pdf")
def export_pdf(
    snapshot_date: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

    usd_brl = _rate(db)

    # Resolve snapshot date
    target = snapshot_date or db.query(func.max(Snapshot.snapshot_date)).scalar() or date.today()

    snaps = (
        db.query(Snapshot)
        .options(joinedload(Snapshot.asset).joinedload(Asset.institution))
        .join(Asset, Asset.id == Snapshot.asset_id)
        .filter(Snapshot.snapshot_date == target, Asset.is_active.isnot(False))
        .all()
    )

    # Portfolio totals
    total_mv_usd = total_mv_brl = total_cb_usd = 0.0
    by_inst: dict = defaultdict(list)

    for s in snaps:
        mv  = s.market_value or 0.0
        cb  = s.cost_basis   or 0.0
        cur = s.asset.currency if s.asset else "USD"
        mv_usd = _to_usd(mv, cur, usd_brl)
        cb_usd = _to_usd(cb, cur, usd_brl)
        mv_brl = mv * usd_brl if cur == "USD" else mv
        total_mv_usd += mv_usd
        total_mv_brl += mv_brl
        total_cb_usd += cb_usd
        inst = s.asset.institution.name if s.asset and s.asset.institution else "Outros"
        by_inst[inst].append(s)

    # Loans
    loans = db.query(Loan).filter(Loan.is_active == True).all()  # noqa: E712
    loan_total_usd = loan_total_brl = 0.0
    loan_rows = []
    for loan in loans:
        # Saldo via eventos (mesma fonte do dashboard); saldo 0 (quitado) é
        # respeitado — nunca cair no original_amount por causa de falsy.
        bal = _current_balance(db, loan.id, loan.original_amount or 0.0)
        bal_usd = bal / usd_brl if loan.currency == "BRL" else bal
        bal_brl = bal * usd_brl if loan.currency == "USD" else bal
        loan_total_usd += bal_usd
        loan_total_brl += bal_brl
        loan_rows.append((loan.description, loan.institution_id, loan.currency, bal))

    # Properties
    props = db.query(Property).filter(Property.is_active == True).all()  # noqa: E712
    prop_total_brl = prop_total_usd = 0.0
    prop_rows = []
    for prop in props:
        val = db.query(PropertyValuation).filter(PropertyValuation.property_id == prop.id).order_by(PropertyValuation.valuation_date.desc()).first()
        if val is not None and val.current_value_brl is not None:
            cur_val = val.current_value_brl
        else:
            cur_val = prop.purchase_price_brl or 0.0
        prop_total_brl += cur_val
        prop_total_usd += cur_val / usd_brl
        gain = cur_val - (prop.purchase_price_brl or 0)
        prop_rows.append((prop.description or "—", prop.property_type, _fmtbrl(cur_val), _fmtbrl(gain)))

    net_usd = total_mv_usd + prop_total_usd - loan_total_usd

    # ── Build PDF ──────────────────────────────────────────────────────────────
    buf  = BytesIO()
    doc  = SimpleDocTemplate(buf, pagesize=A4,
                              leftMargin=2*cm, rightMargin=2*cm,
                              topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()

    # PatrimonIA brand palette — light variant for PDF
    NAVY   = colors.HexColor("#0F1547")
    PURPLE = colors.HexColor("#1a237e")
    VIOLET = colors.HexColor("#7C3AED")
    ACCENT = colors.HexColor("#A78BFA")
    LIGHT  = colors.HexColor("#f8f9fc")
    GRAY   = colors.HexColor("#6b7280")

    h1 = ParagraphStyle("h1", parent=styles["Heading1"], textColor=NAVY,   fontSize=20, spaceAfter=2, fontName="Helvetica-Bold")
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], textColor=PURPLE, fontSize=11, spaceBefore=14, spaceAfter=4, fontName="Helvetica-Bold")
    sm = ParagraphStyle("sm", parent=styles["Normal"],   fontSize=8,  textColor=GRAY)

    def hdr_style(cols):
        return TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, LIGHT]),
            ("GRID",          (0, 0), (-1, -1), 0.3, colors.HexColor("#e5e7eb")),
            ("TOPPADDING",    (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ALIGN",         (0, 0), (-1, 0), "CENTER"),
        ] + [("ALIGN", (i, 1), (i, -1), "RIGHT") for i in range(2, cols)])

    # Header: logo text (light variant) + meta line
    logo_style = ParagraphStyle("logo", parent=styles["Normal"],
                                fontSize=22, leading=24,
                                fontName="Helvetica-Bold", spaceAfter=2)
    story = [
        Paragraph('<font color="#0F1547">Patrimon</font><font color="#7C3AED">IA</font>', logo_style),
        Paragraph(
            f"Relatório de Investimentos  ·  {target.strftime('%d/%m/%Y')}  ·  "
            f"Cotação USD/BRL: R$ {usd_brl:.4f}  ·  Gerado em: {date.today().strftime('%d/%m/%Y')}",
            sm,
        ),
        Spacer(1, 0.35*cm),
        HRFlowable(width="100%", thickness=1.5, color=NAVY),
        Spacer(1, 0.3*cm),
    ]

    # Summary table
    story.append(Paragraph("Resumo Patrimonial", h2))
    sum_data = [
        ["Categoria", "Valor USD", "Valor BRL"],
        ["Investimentos Financeiros", _fmtusd(total_mv_usd), _fmtbrl(total_mv_brl)],
        ["Custo Total Investimentos",  _fmtusd(total_cb_usd), "—"],
        ["Imóveis",                    _fmtusd(prop_total_usd), _fmtbrl(prop_total_brl)],
        ["(−) Empréstimos",            _fmtusd(loan_total_usd), _fmtbrl(loan_total_brl)],
        ["Patrimônio Líquido Total",   _fmtusd(net_usd), _fmtbrl(net_usd * usd_brl)],
    ]
    t = Table(sum_data, colWidths=[7*cm, 5*cm, 5*cm])
    t.setStyle(hdr_style(3))
    t.setStyle(TableStyle([
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#ede7f6")),
    ]))
    story += [t, Spacer(1, 0.5*cm)]

    # Assets by institution
    story.append(Paragraph("Ativos por Instituição", h2))
    for inst_name, inst_snaps in sorted(by_inst.items()):
        story.append(Paragraph(inst_name, ParagraphStyle("inst", parent=styles["Normal"],
                                                          fontSize=9, textColor=PURPLE,
                                                          fontName="Helvetica-Bold", spaceBefore=6, spaceAfter=2)))
        asset_data = [["Ativo", "Tipo", "Moeda", "Custo", "Valor Atual", "Ganho/Perda", "Vencimento"]]
        for s in sorted(inst_snaps, key=lambda x: (x.asset.name if x.asset else "")):
            cur  = s.asset.currency if s.asset else "USD"
            gain = (s.market_value or 0) - (s.cost_basis or 0)
            asset_data.append([
                (s.asset.name or "—")[:40],
                s.asset.asset_type if s.asset else "—",
                cur,
                _fmtusd(_to_usd(s.cost_basis, cur, usd_brl)) if cur == "USD" else _fmtbrl(s.cost_basis),
                _fmtusd(_to_usd(s.market_value, cur, usd_brl)) if cur == "USD" else _fmtbrl(s.market_value),
                f"+{_fmtusd(_to_usd(gain, cur, usd_brl))}" if gain >= 0 else _fmtusd(_to_usd(gain, cur, usd_brl)),
                s.maturity_date.strftime("%d/%m/%Y") if s.maturity_date else "—",
            ])
        at = Table(asset_data, colWidths=[5.5*cm, 2.2*cm, 1.5*cm, 3*cm, 3*cm, 3*cm, 2.5*cm])
        at.setStyle(hdr_style(7))
        story += [at, Spacer(1, 0.2*cm)]

    # Properties
    if prop_rows:
        story.append(Paragraph("Imóveis", h2))
        prop_hdr = [["Descrição", "Tipo", "Valor Atual", "Ganho/Perda"]]
        pt = Table(prop_hdr + prop_rows, colWidths=[7*cm, 3*cm, 4.5*cm, 4.5*cm])
        pt.setStyle(hdr_style(4))
        story += [pt, Spacer(1, 0.5*cm)]

    # Loans
    if loan_rows:
        story.append(Paragraph("Empréstimos", h2))
        loan_hdr = [["Descrição", "Instituição ID", "Moeda", "Saldo Devedor"]]
        formatted = [(d, str(i) if i else "—", c, _fmtusd(b) if c == "USD" else _fmtbrl(b)) for d, i, c, b in loan_rows]
        lt = Table(loan_hdr + formatted, colWidths=[7*cm, 3*cm, 2*cm, 5*cm])
        lt.setStyle(hdr_style(4))
        story += [lt, Spacer(1, 0.5*cm)]

    # Net worth footer
    story += [
        HRFlowable(width="100%", thickness=1, color=PURPLE),
        Spacer(1, 0.3*cm),
        Paragraph(f"<b>Patrimônio Líquido Total: {_fmtusd(net_usd)}  |  {_fmtbrl(net_usd * usd_brl)}</b>",
                  ParagraphStyle("net", parent=styles["Normal"], fontSize=11, textColor=PURPLE, alignment=TA_RIGHT)),
    ]

    doc.build(story)
    buf.seek(0)
    fname = f"relatorio-{target}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Report generation + backfill ──────────────────────────────────────────────

def _generate_period_report(db, report_type: str, period_start: date, period_end: date) -> bool:
    if db.query(Report).filter(Report.type == report_type, Report.period_start == period_start).first():
        return False
    payload = _compute_report_payload(db, period_start, period_end)
    db.add(Report(type=report_type, period_start=period_start, period_end=period_end, payload=json.dumps(payload)))
    db.commit()
    return True


def _do_backfill(db) -> int:
    earliest = db.query(func.min(Snapshot.snapshot_date)).scalar()
    if not earliest:
        return 0
    periods = _all_closed_periods(earliest, date.today())
    return sum(1 for t, ps, pe in periods if _generate_period_report(db, t, ps, pe))


def _backfill_reports():
    import logging
    from database import SessionLocal
    db = SessionLocal()
    try:
        n = _do_backfill(db)
        if n:
            logging.getLogger(__name__).info("report backfill: generated %d reports", n)
    except Exception as exc:
        logging.getLogger(__name__).warning("report backfill failed: %s", exc)
    finally:
        db.close()


# ── New archived-report endpoints ─────────────────────────────────────────────

@router.get("/list")
def list_reports(db: Session = Depends(get_db)):
    rows = db.query(Report).order_by(Report.period_start.desc()).all()
    result = []
    for r in rows:
        p = json.loads(r.payload)
        result.append({
            "id":           r.id,
            "type":         r.type,
            "period_start": r.period_start.isoformat(),
            "period_end":   r.period_end.isoformat(),
            "generated_at": r.generated_at.isoformat() if r.generated_at else None,
            "total_brl":    p.get("total_brl"),
            "change_brl":   p.get("change_brl"),
            "change_pct":   p.get("change_pct"),
            "asset_count":  len(p.get("assets", [])),
        })
    return {"reports": result}


@router.post("/generate")
def generate_reports(payload: ReportGenerateRequest, db: Session = Depends(get_db)):
    if payload.backfill_all:
        n = _do_backfill(db)
        return {"generated": n, "skipped": 0}
    rtype = payload.type
    if not rtype or not payload.period_start:
        raise HTTPException(status_code=400, detail="Forneça backfill_all ou type+period_start")
    ps, pe = _iso_week_bounds(payload.period_start) if rtype == "weekly" else _month_bounds(payload.period_start)
    created = _generate_period_report(db, rtype, ps, pe)
    return {"generated": 1 if created else 0, "skipped": 0 if created else 1}


@router.get("/{report_id}")
def get_report(report_id: int, db: Session = Depends(get_db)):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    return {
        "id":           r.id,
        "type":         r.type,
        "period_start": r.period_start.isoformat(),
        "period_end":   r.period_end.isoformat(),
        "generated_at": r.generated_at.isoformat() if r.generated_at else None,
        "payload":      json.loads(r.payload),
    }


@router.get("/{report_id}/pdf")
def export_period_report_pdf(
    report_id:   int,
    asset_types: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Relatório não encontrado")
    payload  = json.loads(r.payload)
    allowed  = {t.strip() for t in asset_types.split(",")} if asset_types else None
    assets   = payload.get("assets", [])
    if allowed:
        assets = [a for a in assets if a.get("asset_type") in allowed]
    total_filtered = sum(a["value_end_brl"] for a in assets)
    return _build_period_pdf(r, payload, assets, total_filtered)


def _build_period_pdf(r, payload, filtered_assets, total_brl):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT

    NAVY   = colors.HexColor("#0F1547")
    PURPLE = colors.HexColor("#1a237e")
    LIGHT  = colors.HexColor("#f8f9fc")
    GRAY   = colors.HexColor("#6b7280")
    styles = getSampleStyleSheet()

    def hdr_style(cols):
        return TableStyle([
            ("BACKGROUND",    (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
            ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",      (0, 0), (-1, -1), 8),
            ("ROWBACKGROUNDS",(0, 1), (-1, -1), [colors.white, LIGHT]),
            ("GRID",          (0, 0), (-1, -1), 0.3, colors.HexColor("#e5e7eb")),
            ("TOPPADDING",    (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("ALIGN",         (0, 0), (-1, 0), "CENTER"),
        ] + [("ALIGN", (i, 1), (i, -1), "RIGHT") for i in range(2, cols)])

    logo_style = ParagraphStyle("logo", parent=styles["Normal"], fontSize=22, leading=24, fontName="Helvetica-Bold", spaceAfter=2)
    h2  = ParagraphStyle("h2", parent=styles["Heading2"], textColor=PURPLE, fontSize=11, spaceBefore=14, spaceAfter=4, fontName="Helvetica-Bold")
    sm  = ParagraphStyle("sm", parent=styles["Normal"],   fontSize=8, textColor=GRAY)
    net = ParagraphStyle("net", parent=styles["Normal"],  fontSize=11, textColor=PURPLE, alignment=TA_RIGHT)

    type_label = "Semanal" if r.type == "weekly" else "Mensal"
    chg_pct    = payload.get("change_pct")
    chg_brl    = payload.get("change_brl", 0)
    chg_str    = (f"{chg_pct:+.2f}%" if chg_pct is not None else "—")

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    story = [
        Paragraph('<font color="#0F1547">Patrimon</font><font color="#7C3AED">IA</font>', logo_style),
        Paragraph(
            f"Relatório {type_label}  ·  {r.period_start.strftime('%d/%m/%Y')} – {r.period_end.strftime('%d/%m/%Y')}  ·  "
            f"USD/BRL: R$ {payload.get('usd_brl_rate', 5):.4f}",
            sm,
        ),
        Spacer(1, 0.35*cm),
        HRFlowable(width="100%", thickness=1.5, color=NAVY),
        Spacer(1, 0.3*cm),
        Paragraph("Resumo do Período", h2),
    ]
    t = Table([
        ["Métrica", "Valor"],
        ["Patrimônio no final do período", _fmtbrl(total_brl)],
        ["Variação no período (R$)", _fmtbrl(chg_brl)],
        ["Variação no período (%)", chg_str],
    ], colWidths=[10*cm, 7*cm])
    t.setStyle(hdr_style(2))
    story += [t, Spacer(1, 0.4*cm)]

    by_type = payload.get("by_asset_type", [])
    if by_type:
        story.append(Paragraph("Alocação por Classe", h2))
        tt = Table(
            [["Classe", "Valor (R$)", "%"]] +
            [[row["label"], _fmtbrl(row["value_brl"]), f"{row['pct']:.1f}%"] for row in by_type],
            colWidths=[7*cm, 6*cm, 4*cm],
        )
        tt.setStyle(hdr_style(3))
        story += [tt, Spacer(1, 0.4*cm)]

    if filtered_assets:
        story.append(Paragraph("Evolução dos Ativos", h2))
        a_data = [["Ativo", "Instituição", "Tipo", "Início (R$)", "Fim (R$)", "Var. %"]]
        for a in filtered_assets:
            pct = f"{a['change_pct']:+.2f}%" if a.get("change_pct") is not None else "—"
            a_data.append([a["asset_name"][:35], a["institution"][:20], a.get("asset_type","—"),
                           _fmtbrl(a["value_start_brl"]), _fmtbrl(a["value_end_brl"]), pct])
        at = Table(a_data, colWidths=[5*cm, 3.5*cm, 2.5*cm, 3*cm, 3*cm, 2.5*cm])
        at.setStyle(hdr_style(6))
        story += [at, Spacer(1, 0.4*cm)]

    gl_rows = []
    for a in payload.get("gainers", []):
        gl_rows.append([a["asset_name"][:40], f"+{a['change_pct']:.2f}%", a.get("asset_type","—")])
    for a in payload.get("losers", []):
        gl_rows.append([a["asset_name"][:40], f"{a['change_pct']:.2f}%", a.get("asset_type","—")])
    if gl_rows:
        story.append(Paragraph("Maiores Variações", h2))
        gl = Table([["Ativo", "Variação %", "Tipo"]] + gl_rows, colWidths=[9*cm, 4*cm, 4.5*cm])
        gl.setStyle(hdr_style(3))
        story += [gl, Spacer(1, 0.3*cm)]

    story += [
        HRFlowable(width="100%", thickness=1, color=PURPLE),
        Spacer(1, 0.3*cm),
        Paragraph(f"<b>Total: {_fmtbrl(total_brl)}</b>", net),
    ]
    doc.build(story)
    buf.seek(0)
    fname = f"relatorio-{r.type}-{r.period_start}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})
