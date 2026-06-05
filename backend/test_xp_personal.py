"""
Unit tests for XpPersonalXlsxParser logic.
Creates a minimal in-memory xlsx to validate section detection and column parsing.
"""
import io
import openpyxl
from datetime import date
from parsers.xp_personal_xlsx import XpPersonalXlsxParser, ACCOUNT_NUMBER, INSTITUTION_NAME


def _make_workbook(rows_by_sheet: dict) -> bytes:
    wb = openpyxl.Workbook()
    first = True
    for sheet_name, rows in rows_by_sheet.items():
        if first:
            ws = wb.active
            ws.title = sheet_name
            first = False
        else:
            ws = wb.create_sheet(sheet_name)
        for row in rows:
            ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


parser = XpPersonalXlsxParser()


def test_can_parse_with_account_number():
    content = _make_workbook({"Carteira": [
        ["Conta:", ACCOUNT_NUMBER, "Data:", "30/05/2026"],
    ]})
    assert parser.can_parse("PosicaoDetalhada__3_.xlsx", content)


def test_cannot_parse_without_account_number():
    content = _make_workbook({"Carteira": [
        ["Conta:", "9922712", "Data:", "30/05/2026"],
    ]})
    assert not parser.can_parse("PosicaoDetalhada__3_.xlsx", content)


def test_fixed_income_parsing():
    """CDB MIDWAY: bruto=132065.97, cost=120000, IR=3861.54, IOF=0, liq=128204.43"""
    aplic = date(2023, 3, 15)
    venc  = date(2027, 2, 28)
    content = _make_workbook({"Carteira": [
        ["Conta:", ACCOUNT_NUMBER, "30/05/2026"],
        [],
        ["Pós-Fixado"],
        ["Produto", "Posição na taxa de compra", "% Alocação", "Valor aplicado",
         "Valor aplicado original", "Taxa de compra", "Data aplicação", "Data vencimento",
         "Quantidade", "Preço Unitário", "IR", "IOF", "Valor Líquido"],
        ["CDB MIDWAY RIACHUELO", 132065.97, None, 120000.00, 120000.00, None,
         aplic, venc, 1, 132065.97, 3861.54, 0.0, 128204.43],
    ]})
    records = parser.parse("PosicaoDetalhada__3_.xlsx", content)
    assert len(records) == 1
    r = records[0]
    assert r.asset_name == "CDB MIDWAY RIACHUELO"
    assert r.asset_type == "fixed_income"
    assert r.institution_name == INSTITUTION_NAME
    assert r.market_value == 132065.97
    assert r.cost_basis == 120000.0
    assert r.tax_net == 128204.43
    assert r.maturity_date == venc
    assert r.purchase_date == aplic
    print(f"  fixed_income: market={r.market_value} cost={r.cost_basis} net={r.tax_net} purchase={r.purchase_date} maturity={r.maturity_date}")


def test_fund_parsing():
    """Trend Investback: posição=9836.91, aplicado=9800.00, liquido=9834.84"""
    content = _make_workbook({"Carteira": [
        ["Conta:", ACCOUNT_NUMBER, "30/05/2026"],
        [],
        ["Fundos de Investimento"],
        ["Produto", "Posição", "% Alocação", "Rentabilidade Líquida", "Rentabilidade Bruta",
         "Valor aplicado", "Valor líquido"],
        ["Trend Investback FIC FIRF", 9836.91, None, None, None, 9800.0, 9834.84],
    ]})
    records = parser.parse("PosicaoDetalhada__3_.xlsx", content)
    assert len(records) == 1
    r = records[0]
    assert r.asset_name == "Trend Investback FIC FIRF"
    assert r.asset_type == "fund"
    assert r.market_value == 9836.91
    assert r.cost_basis == 9800.0
    assert r.tax_net == 9834.84
    print(f"  fund: market={r.market_value} cost={r.cost_basis} net={r.tax_net}")


def test_fii_parsing():
    """XPML11: posição=92341, preço_médio=115.97, última=107.00, qtd=863"""
    content = _make_workbook({"Carteira": [
        ["Conta:", ACCOUNT_NUMBER, "30/05/2026"],
        [],
        ["Fundos Imobiliários"],
        ["Produto", "Posição", "% Alocação", "Rentabilidade c/ proventos",
         "Rentabilidade Bruta", "Preço médio", "Última cotação", "Quantidade de Cotas"],
        ["XPML11", 92341.0, None, None, None, 115.97, 107.0, 863],
    ]})
    records = parser.parse("PosicaoDetalhada__3_.xlsx", content)
    assert len(records) == 1
    r = records[0]
    assert r.asset_name == "XPML11"
    assert r.asset_type == "equity"
    assert r.market_value == 92341.0
    assert abs(r.cost_basis - 115.97 * 863) < 0.01
    assert r.units == 863
    assert r.price == 107.0
    print(f"  fii: market={r.market_value} cost={r.cost_basis:.2f} units={r.units} price={r.price}")


def test_multi_section():
    """All three sections in one file."""
    aplic = date(2023, 3, 15)
    venc  = date(2027, 2, 28)
    content = _make_workbook({"Carteira": [
        ["Conta:", ACCOUNT_NUMBER, "30/05/2026"],
        [],
        ["Pós-Fixado"],
        ["Produto", "Posição na taxa de compra", "% Alocação", "Valor aplicado",
         "Valor aplicado original", "Taxa de compra", "Data aplicação", "Data vencimento",
         "Quantidade", "Preço Unitário", "IR", "IOF", "Valor Líquido"],
        ["CDB MIDWAY RIACHUELO", 132065.97, None, 120000.0, 120000.0, None,
         aplic, venc, 1, 132065.97, 3861.54, 0.0, 128204.43],
        ["CDB BANCO C6", 63964.56, None, 60000.0, 60000.0, None,
         date(2023, 6, 1), date(2026, 6, 1), 1, 63964.56, 2618.80, 0.0, 61345.76],
        [],
        ["Fundos de Investimento"],
        ["Produto", "Posição", "% Alocação", "Rentabilidade Líquida", "Rentabilidade Bruta",
         "Valor aplicado", "Valor líquido"],
        ["Trend Investback FIC FIRF", 9836.91, None, None, None, 9800.0, 9834.84],
        [],
        ["Fundos Imobiliários"],
        ["Produto", "Posição", "% Alocação", "Rent. c/ proventos",
         "Rent. Bruta", "Preço médio", "Última cotação", "Quantidade de Cotas"],
        ["XPML11", 92341.0, None, None, None, 115.97, 107.0, 863],
    ]})
    records = parser.parse("PosicaoDetalhada__3_.xlsx", content)
    names = {r.asset_name for r in records}
    assert "CDB MIDWAY RIACHUELO" in names
    assert "CDB BANCO C6" in names
    assert "Trend Investback FIC FIRF" in names
    assert "XPML11" in names

    total_mv = sum(r.market_value or 0 for r in records)
    expected = 132065.97 + 63964.56 + 9836.91 + 92341.0
    assert abs(total_mv - expected) < 0.01, f"total {total_mv} != {expected}"
    print(f"  multi-section: {len(records)} records, total_mv={total_mv:.2f}")

    # Check institutions
    for r in records:
        assert r.institution_name == INSTITUTION_NAME
    print("  all institutions correct")


if __name__ == "__main__":
    tests = [
        test_can_parse_with_account_number,
        test_cannot_parse_without_account_number,
        test_fixed_income_parsing,
        test_fund_parsing,
        test_fii_parsing,
        test_multi_section,
    ]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{passed}/{len(tests)} passed")
