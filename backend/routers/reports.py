from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, distinct
from datetime import date
from typing import Optional
from io import BytesIO
from collections import defaultdict

from database import get_db
from models import Snapshot, Asset, Institution, ExchangeRate, Loan, LoanSnapshot, Property, PropertyValuation

router = APIRouter(prefix="/reports", tags=["reports"])


def _rate(db):
    r = db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).first()
    return r.usd_brl if r else 5.0


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
        .filter(Snapshot.snapshot_date == target)
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
        snap = db.query(LoanSnapshot).filter(LoanSnapshot.loan_id == loan.id).order_by(LoanSnapshot.snapshot_date.desc()).first()
        bal = (snap.outstanding_balance if snap else None) or loan.original_amount or 0.0
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
        cur_val = (val.current_value_brl if val else None) or prop.purchase_price_brl or 0.0
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
