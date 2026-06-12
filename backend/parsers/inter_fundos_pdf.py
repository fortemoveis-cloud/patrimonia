import io
import logging
import re
from datetime import date, datetime
from typing import List, Optional

import pdfplumber

from parsers.base import BaseParser, ParsedRecord

logger = logging.getLogger(__name__)

_RE_CONTA    = re.compile(r"Conta:\s*(\d+)")
_RE_POS_DATE = re.compile(r"(\d{2}/\d{2}/\d{4})")


class InterFundosPdfParser(BaseParser):

    def can_parse(self, filename: str, file_bytes: bytes) -> bool:
        if not filename.lower().endswith(".pdf"):
            return False
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                text0 = (pdf.pages[0].extract_text() or "")[:400].upper()
                return "FUNDOS DE INVESTIMENTO" in text0
        except Exception:
            return False

    def _extract_position_date(self, pdf) -> date:
        # "Posição em: DD/MM/YYYY" is in page 0 text, inside the header table cell
        try:
            header_text = pdf.pages[0].extract_text() or ""
            dates = _RE_POS_DATE.findall(header_text)
            if dates:
                return datetime.strptime(dates[0], "%d/%m/%Y").date()
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
                    if not table or len(table) < 3:
                        continue
                    row0 = table[0]
                    row2 = table[2]
                    # Fund table: row[0] has fund name in col 0, rest None; row[2] is data
                    if not (row0 and row0[0] and all(not (row0[k] or "") for k in range(1, min(len(row0), 4)))):
                        continue
                    fund_name = str(row0[0]).strip()
                    # Skip the TOTAL CONSOLIDADO table
                    if "TOTAL" in fund_name.upper():
                        continue

                    rec = self._build_record(fund_name, row2, snap_date, filename, account_number)
                    if rec:
                        records.append(rec)

            self._validate_total(pdf, records, filename)

        return records

    def _build_record(
        self, fund_name: str, data_row: list, snap_date: date,
        filename: str, account_number: Optional[str],
    ) -> Optional[ParsedRecord]:
        try:
            # Columns: [0] Data Cotação, [1] Qtde Cota, [2] Valor Cota,
            #          [3] Valor Aplicado, [4] Valor Bruto, [5] IR Previsto,
            #          [6] IOF Previsto, [7] Valor Liquido
            market_value = self.clean_float(data_row[7]) if len(data_row) > 7 else None
            tax_gross    = self.clean_float(data_row[4]) if len(data_row) > 4 else None
            units        = self.clean_float(data_row[1]) if len(data_row) > 1 else None
            price        = self.clean_float(data_row[2]) if len(data_row) > 2 else None
            cost_basis   = self.clean_float(data_row[3]) if len(data_row) > 3 else None

            if not market_value:
                return None

            return ParsedRecord(
                institution_name="Banco Inter",
                institution_country="BR",
                institution_currency="BRL",
                asset_identifier=None,
                asset_name=fund_name,
                asset_type="fund",
                asset_currency="BRL",
                snapshot_date=snap_date,
                units=units,
                price=price,
                cost_basis=cost_basis,
                market_value=market_value,
                tax_gross=tax_gross,
                tax_net=market_value,
                raw_source_file=filename,
                account_number=account_number,
            )
        except Exception as e:
            logger.warning("InterFundosPdfParser: erro ao parsear fundo '%s': %s", fund_name, e)
            return None

    def _validate_total(self, pdf, records: List[ParsedRecord], filename: str):
        try:
            for page in reversed(pdf.pages):
                for table in page.extract_tables():
                    if not table:
                        continue
                    for row in table:
                        if not row or not row[0]:
                            continue
                        if "TOTAL CONSOLIDADO" in str(row[0]).upper():
                            # Row: [label, Bruto, IR, IOF, Liquido]
                            expected = self.clean_float(row[4]) if len(row) > 4 else None
                            if expected is None:
                                for cell in reversed(row):
                                    v = self.clean_float(cell)
                                    if v is not None:
                                        expected = v
                                        break
                            if expected is not None:
                                actual = sum(r.market_value for r in records if r.market_value)
                                diff = abs(actual - expected)
                                if diff > 0.02:
                                    logger.warning(
                                        "InterFundosPdfParser: TOTAL CONSOLIDADO mismatch — "
                                        "expected=%.2f actual_sum=%.2f diff=%.2f (file=%s)",
                                        expected, actual, diff, filename,
                                    )
                            return
        except Exception as e:
            logger.warning("InterFundosPdfParser: falha ao verificar TOTAL CONSOLIDADO: %s", e)
