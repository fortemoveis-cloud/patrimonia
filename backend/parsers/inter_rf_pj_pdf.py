import io
import logging
import re
from datetime import date, datetime
from typing import List, Optional

import pdfplumber

from parsers.base import BaseParser, ParsedRecord

logger = logging.getLogger(__name__)

_RE_CONTA       = re.compile(r"Conta:\s*(\d+)")
_RE_POS_DATE    = re.compile(r"Posi.{0,5}o\s+em[:\s]+(\d{2}/\d{2}/\d{4})", re.IGNORECASE)
# Totals in merged cell: "Valor Bruto Total: R$ X  Valor Líquido Total: R$ Y ..."
# "Líquido" may be encoded as "L?quido" or "Líquido"
_RE_LIQ_TOTAL   = re.compile(r"Valor\s+L.{0,5}quido\s+Total.*?R\$\s*([\d.,]+)", re.IGNORECASE)


def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s or str(s).strip() in ("-", ""):
        return None
    s = str(s).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


class InterRfPjPdfParser(BaseParser):

    def can_parse(self, filename: str, file_bytes: bytes) -> bool:
        if not filename.lower().endswith(".pdf"):
            return False
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                text0 = (pdf.pages[0].extract_text() or "").upper()
                is_rf = "EXTRATO DE POSI" in text0 and "RENDA FIXA" in text0
                if not is_rf:
                    return False
                # PJ-specific: has a table with "Nota" as first cell of a header row
                for tbl in pdf.pages[0].extract_tables():
                    for row in (tbl or [])[:5]:
                        if row and str(row[0] or "").strip() == "Nota":
                            return True
        except Exception:
            pass
        return False

    def _extract_position_date(self, pdf) -> date:
        try:
            text = pdf.pages[0].extract_text() or ""
            m = _RE_POS_DATE.search(text)
            if m:
                return datetime.strptime(m.group(1), "%d/%m/%Y").date()
        except Exception:
            pass
        return date.today()

    def _extract_account_number(self, pdf) -> Optional[str]:
        try:
            text = pdf.pages[0].extract_text() or ""
            m = _RE_CONTA.search(text)
            return m.group(1) if m else None
        except Exception:
            return None

    def parse(self, filename: str, file_bytes: bytes) -> List[ParsedRecord]:
        records: List[ParsedRecord] = []

        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            snap_date      = self._extract_position_date(pdf)
            account_number = self._extract_account_number(pdf)

            for page in pdf.pages:
                for table in page.extract_tables():
                    if not table or len(table) < 4:
                        continue
                    row0 = table[0]
                    if not row0 or not row0[0]:
                        continue
                    product_name = str(row0[0]).strip()
                    # Skip non-product tables (bank header, footer)
                    if not product_name or product_name.startswith("SAC") or len(product_name) < 3:
                        continue
                    # Confirm this is a product table: row[2] header must have "Nota"
                    if len(table) < 3 or not table[2] or str(table[2][0] or "").strip() != "Nota":
                        continue

                    # row[1][0] = merged totals cell
                    totals_text = str(table[1][0] or "") if len(table) > 1 else ""

                    group_records: List[ParsedRecord] = []
                    for data_row in table[3:]:
                        if not data_row or not data_row[0]:
                            continue
                        nota_str = str(data_row[0]).strip()
                        if not nota_str or not nota_str[0].isdigit():
                            continue

                        rec = self._build_record(
                            product_name, data_row, snap_date, filename, account_number
                        )
                        if rec:
                            group_records.append(rec)

                    self._validate_group(product_name, group_records, totals_text, filename)
                    records.extend(group_records)

        return records

    def _build_record(
        self, product_name: str, row: list, snap_date: date,
        filename: str, account_number: Optional[str],
    ) -> Optional[ParsedRecord]:
        try:
            # Columns:
            # [0] Nota, [1] Data Início, [2] Data Vencimento, [3] Valor Aplicação,
            # [4] Tipo, [5] Taxa, [6] Valor Rendimento, [7] Valor Retirada,
            # [8] Valor Desconto, [9] Valor Bruto, [10] Valor Previsão Desconto,
            # [11] Valor Líquido,  [12] IR/IOF % ← IGNORED (unreliable)
            nota        = str(row[0]).strip()
            start_date  = _parse_date(row[1])
            end_date    = _parse_date(row[2])
            cost_basis  = self.clean_float(row[3])
            asset_type  = str(row[4] or "").strip()
            rate_desc   = str(row[5] or "").strip()
            tax_gross   = self.clean_float(row[9])
            market_value = self.clean_float(row[11])  # Valor Líquido → market_value

            if not market_value:
                return None

            rate_description = f"{asset_type} {rate_desc}".strip() if rate_desc else asset_type

            return ParsedRecord(
                institution_name="Banco Inter",
                institution_country="BR",
                institution_currency="BRL",
                asset_identifier=nota,
                asset_name=f"{product_name} #{nota}",
                asset_type="fixed_income",
                asset_currency="BRL",
                snapshot_date=snap_date,
                cost_basis=cost_basis,
                market_value=market_value,
                tax_gross=tax_gross,
                tax_net=market_value,
                rate_description=rate_description,
                purchase_date=start_date,
                maturity_date=end_date,
                raw_source_file=filename,
                account_number=account_number,
            )
        except Exception as e:
            logger.warning("InterRfPjPdfParser: erro ao parsear nota '%s': %s", row[0], e)
            return None

    def _validate_group(
        self, group_name: str, group_records: List[ParsedRecord],
        totals_text: str, filename: str,
    ):
        if not totals_text:
            return
        m = _RE_LIQ_TOTAL.search(totals_text)
        if not m:
            return
        expected = self.clean_float(m.group(1))
        if expected is None:
            return
        actual = sum(r.market_value for r in group_records if r.market_value)
        diff = abs(actual - expected)
        if diff > 0.02:
            logger.warning(
                "InterRfPjPdfParser: grupo '%s' Valor Liquido mismatch — "
                "expected=%.2f actual_sum=%.2f diff=%.2f (file=%s)",
                group_name, expected, actual, diff, filename,
            )
