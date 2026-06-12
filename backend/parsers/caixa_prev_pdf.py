import io
import logging
import re
from datetime import date, datetime
from typing import List, Optional

import pdfplumber

from parsers.base import BaseParser, ParsedRecord

logger = logging.getLogger(__name__)

_RE_CERT    = re.compile(r"Certificado:\s*(\d+)")
_RE_PRODUCT = re.compile(r"Produto:\s*(.+)")
_RE_PROVIS  = re.compile(r"([\d.,]+)\s+(\d{2}/\d{2}/\d{4})")   # "71.744,59 09/06/2026"
_RE_DATES   = re.compile(r"(\d{2}/\d{2}/\d{4})")
_RE_REGIME  = re.compile(r"(PROGRESSIV[AO]|REGRESSIV[AO]|FIXA?)", re.IGNORECASE)


class CaixaPrevPdfParser(BaseParser):

    def can_parse(self, filename: str, file_bytes: bytes) -> bool:
        if not filename.lower().endswith(".pdf"):
            return False
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                text = (pdf.pages[0].extract_text() or "").upper()
                return "PREV RENDA CAIXA" in text
        except Exception:
            return False

    def parse(self, filename: str, file_bytes: bytes) -> List[ParsedRecord]:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            all_tables = pdf.pages[0].extract_tables()

        certificado  = None
        product_name = "PREV RENDA CAIXA VGBL"
        market_value = None
        snapshot_date: Optional[date] = None
        start_date:   Optional[date] = None
        end_date:     Optional[date] = None
        regime       = None

        for table in all_tables:
            for row in (table or []):
                cell = str(row[0] or "").strip() if row else ""

                m = _RE_CERT.search(cell)
                if m:
                    certificado = m.group(1)

                m = _RE_PRODUCT.search(cell)
                if m and "PREV" in cell.upper():
                    product_name = m.group(1).strip()

                # "Data de\nProvisão matemática: 71.744,59 09/06/2026\nprovisão:"
                if "." in cell and "/" in cell and any(c.isdigit() for c in cell):
                    m = _RE_PROVIS.search(cell)
                    if m:
                        v = self.clean_float(m.group(1))
                        d_str = m.group(2)
                        if v and v > 1000:   # sanity: provisão must be substantial
                            market_value = v
                            try:
                                snapshot_date = datetime.strptime(d_str, "%d/%m/%Y").date()
                            except ValueError:
                                pass

                # "Final da\nInício de vigência: 27/12/2022 26/12/2027\nvigência:"
                if "vig" in cell.lower() or "Vig" in cell:
                    dates_found = _RE_DATES.findall(cell)
                    if len(dates_found) >= 2:
                        try:
                            start_date = datetime.strptime(dates_found[0], "%d/%m/%Y").date()
                            end_date   = datetime.strptime(dates_found[1], "%d/%m/%Y").date()
                        except ValueError:
                            pass
                    elif len(dates_found) == 1 and start_date is None:
                        try:
                            start_date = datetime.strptime(dates_found[0], "%d/%m/%Y").date()
                        except ValueError:
                            pass

                # "Regime de\nTaxa de carregamento: 00,00 % FIXA\ntributação:"
                m = _RE_REGIME.search(cell)
                if m:
                    regime = m.group(1).upper()

        if not market_value:
            logger.warning("CaixaPrevPdfParser: Provisão matemática não encontrada (file=%s)", filename)
            return []

        return [ParsedRecord(
            institution_name="Caixa Econômica Federal",
            institution_country="BR",
            institution_currency="BRL",
            asset_identifier=certificado,
            asset_name=product_name,
            asset_type="fund",
            asset_currency="BRL",
            snapshot_date=snapshot_date or date.today(),
            market_value=market_value,
            tax_net=market_value,
            purchase_date=start_date,
            maturity_date=end_date,
            rate_description=regime,
            raw_source_file=filename,
        )]
