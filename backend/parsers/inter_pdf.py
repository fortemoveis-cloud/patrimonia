import pdfplumber
import io
import re
from datetime import date, datetime
from typing import List, Optional, Tuple
from parsers.base import BaseParser, ParsedRecord


INTER_PRODUCTS = [
    "CDB AGROLEND",
    "CDB DI 60 PZF PJ",
    "CDB LIQUIDEZ DIARIA PJ",
    "CDB LIQUIDEZ DIÁRIA PJ",
    "CDB NEON",
    "CDB",
    "LCI",
    "LCA",
    "CRI",
    "CRA",
    "DEBENTURE",
    "DEBÊNTURE",
    "TESOURO",
]

_RE_BRUTO         = re.compile(r"Valor Bruto Total\s*:?\s*R\$\s*([\d.,]+)", re.IGNORECASE)
_RE_LIQUIDO       = re.compile(r"Valor L[íi]quido Total\s*:?\s*R\$\s*([\d.,]+)", re.IGNORECASE)
_RE_APLICADO      = re.compile(r"Valor Aplicado Total\s*:?\s*R\$\s*([\d.,]+)", re.IGNORECASE)
_RE_RETIRADA      = re.compile(r"Valor\s+(?:de\s+)?Retira(?:da|do)(?:\s+Total)?\s*:?\s*R\$\s*([\d.,]+)", re.IGNORECASE)
_RE_DATA_APLIC    = re.compile(r"Data\s+(?:de\s+)?(?:Aplica[cç][aã]o|Emiss[aã]o|Compra)\s*:?\s*(\d{2}/\d{2}/\d{4})", re.IGNORECASE)


class InterPdfParser(BaseParser):
    def can_parse(self, filename: str, file_bytes: bytes) -> bool:
        if not filename.lower().endswith(".pdf"):
            return False
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                for page in pdf.pages[:2]:
                    text = page.extract_text() or ""
                    text_up = text.upper()
                    if "EXTRATO DE POSIÇÃO DE RENDA FIXA" in text_up:
                        return True
                    if "inter.co" in text.lower() and ("RENDA FIXA" in text_up or "EXTRATO" in text_up):
                        return True
        except Exception:
            pass
        return False

    def _extract_date(self, filename: str, pdf) -> date:
        try:
            text = pdf.pages[0].extract_text() or ""
            m = re.search(r"(\d{2})/(\d{2})/(\d{4})", text)
            if m:
                return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except Exception:
            pass
        m = re.search(r"(\d{4})[-_]?(\d{2})[-_]?(\d{2})", filename)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
        return date.today()

    def _is_product_header(self, text: str) -> Optional[str]:
        text_up = text.upper().strip()
        for prod in INTER_PRODUCTS:
            if text_up.startswith(prod):
                return text.strip()
        return None

    def _extract_retirada_from_table(self, block_lines: List[str], bruto: float) -> Optional[float]:
        """Fallback: find Retirada column value when no labeled line exists.

        Some Inter PDFs show values only in a column-based table (no 'Valor Retirada: R$...' line).
        We locate the header line that contains both 'Retirada' and 'Bruto' column names,
        compute their word-offset, then read the data row using that offset.
        """
        header_line = None
        for line in block_lines:
            lu = line.upper()
            if "RETIRA" in lu and "BRUTO" in lu and "R$" not in line:
                header_line = line
                break

        if not header_line:
            return None

        words = re.split(r"\s+", header_line.upper().strip())
        retira_idx = next((i for i, w in enumerate(words) if "RETIRA" in w), None)
        bruto_idx  = next((i for i, w in enumerate(words) if w == "BRUTO"),  None)

        if retira_idx is None or bruto_idx is None or bruto_idx <= retira_idx:
            return None

        col_offset  = bruto_idx - retira_idx
        bruto_cents = round(bruto * 100)

        for line in block_lines:
            if "R$" not in line:
                continue
            amounts = [self.clean_float(m.group(1))
                       for m in re.finditer(r"R\$\s*([\d.,]+)", line)]
            amounts = [a for a in amounts if a is not None]

            bruto_pos = next(
                (i for i, v in enumerate(amounts) if abs(round(v * 100) - bruto_cents) < 2),
                None,
            )
            if bruto_pos is None:
                continue

            retira_pos = bruto_pos - col_offset
            if 0 <= retira_pos < len(amounts):
                return amounts[retira_pos]

        return None

    def _parse_block(self, product_name: str, lines: List[str], snap_date: date, filename: str) -> Optional[ParsedRecord]:
        bruto = liquido = aplicado = retirada = None
        purchase_date: Optional[date] = None

        for line in lines:
            if bruto is None:
                m = _RE_BRUTO.search(line)
                if m:
                    bruto = self.clean_float(m.group(1))
            if liquido is None:
                m = _RE_LIQUIDO.search(line)
                if m:
                    liquido = self.clean_float(m.group(1))
            if aplicado is None:
                m = _RE_APLICADO.search(line)
                if m:
                    aplicado = self.clean_float(m.group(1))
            if retirada is None:
                m = _RE_RETIRADA.search(line)
                if m:
                    retirada = self.clean_float(m.group(1))
            if purchase_date is None:
                m = _RE_DATA_APLIC.search(line)
                if m:
                    try:
                        purchase_date = datetime.strptime(m.group(1), "%d/%m/%Y").date()
                    except ValueError:
                        pass

        # Fallback: Retirada not on a labeled line — extract from column-based data row
        if retirada is None and bruto is not None:
            retirada = self._extract_retirada_from_table(lines, bruto)

        if not bruto:
            return None

        retirada_val  = retirada or 0.0
        cost_basis_raw = aplicado or 0.0

        if cost_basis_raw > 0 and retirada_val >= cost_basis_raw:
            # Principal fully redeemed — remaining value is pure yield (use gross before taxes)
            cost_basis   = 0.0
            market_value = bruto
        else:
            cost_basis   = max(0.0, cost_basis_raw - retirada_val)
            market_value = liquido or bruto

        if not market_value or market_value <= 0:
            return None

        return ParsedRecord(
            institution_name="Banco Inter",
            institution_country="BR",
            institution_currency="BRL",
            asset_identifier=None,
            asset_name=product_name,
            asset_type="fixed_income",
            asset_currency="BRL",
            snapshot_date=snap_date,
            cost_basis=cost_basis,
            market_value=market_value,
            tax_gross=bruto,
            tax_net=liquido,
            purchase_date=purchase_date,
            raw_source_file=filename,
        )

    def parse(self, filename: str, file_bytes: bytes) -> List[ParsedRecord]:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            snap_date = self._extract_date(filename, pdf)
            all_lines: List[str] = []
            for page in pdf.pages:
                all_lines.extend((page.extract_text() or "").split("\n"))

        # Collect lines into product blocks, then extract values from each whole block
        blocks: List[Tuple[str, List[str]]] = []
        current_product: Optional[str] = None
        current_lines: List[str] = []

        for raw_line in all_lines:
            line = raw_line.strip()
            prod = self._is_product_header(line)
            if prod:
                if current_product is not None:
                    blocks.append((current_product, current_lines))
                current_product = prod
                current_lines = []
            elif current_product is not None:
                current_lines.append(line)

        if current_product is not None:
            blocks.append((current_product, current_lines))

        records: List[ParsedRecord] = []
        for product_name, lines in blocks:
            rec = self._parse_block(product_name, lines, snap_date, filename)
            if rec:
                records.append(rec)

        return records
