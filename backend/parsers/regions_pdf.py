import pdfplumber
import io
import re
from datetime import date
from typing import List, Optional
from parsers.base import BaseParser, ParsedRecord


CATEGORY_MAP = {
    "Fixed Income": "fixed_income",
    "Equity": "equity",
    "Cash and Equivalents": "cash",
    "Cash & Equivalents": "cash",
    "Fund": "fund",
    "Alternative Investments": "fund",
    "Mutual Funds": "fund",
}


class RegionsPdfParser(BaseParser):
    def can_parse(self, filename: str, file_bytes: bytes) -> bool:
        if not filename.lower().endswith(".pdf"):
            return False
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                if not pdf.pages:
                    return False
                text = pdf.pages[0].extract_text() or ""
                tu = text.upper()
                return "ALL MY ACCOUNTS" in tu and ("COST BASIS" in tu or "UNREALIZED GAIN" in tu)
        except Exception:
            pass
        return False

    def _extract_date(self, filename: str, pdf) -> date:
        from datetime import datetime
        try:
            text = pdf.pages[0].extract_text() or ""
            # "as of April 30, 2026"
            m = re.search(r"(?:as of|As of)\s+(\w+ \d+,\s*\d{4})", text)
            if m:
                return datetime.strptime(m.group(1).strip(), "%B %d, %Y").date()
            # "as of MM/DD/YYYY" (numeric)
            m = re.search(r"(?:as of|As of)\s+(\d{2})/(\d{2})/(\d{4})", text)
            if m:
                return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
            # "Current Holding (05/27/2026)" or "Current Holdings (05/27/2026)"
            m = re.search(r"Current Holdings?\s*\((\d{2})/(\d{2})/(\d{4})\)", text, re.IGNORECASE)
            if m:
                return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        except Exception:
            pass
        # Filename MM-DD-YYYY (Regions portal format: Investments_05-27-2026_...)
        m = re.search(r"(\d{2})-(\d{2})-(\d{4})", filename)
        if m:
            try:
                return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
            except ValueError:
                pass
        # Filename YYYY-MM-DD or YYYY_MM_DD
        m = re.search(r"(\d{4})[-_](\d{2})[-_](\d{2})", filename)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                pass
        return date.today()

    def _detect_category(self, text: str) -> Optional[str]:
        text_up = text.upper()
        for k, v in CATEGORY_MAP.items():
            if k.upper() in text_up:
                return v
        return None

    def parse(self, filename: str, file_bytes: bytes) -> List[ParsedRecord]:
        records: List[ParsedRecord] = []

        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            snap_date = self._extract_date(filename, pdf)
            current_category = "other"

            for page in pdf.pages:
                text = page.extract_text() or ""

                # Detect category headers in page text
                for line in text.split("\n"):
                    cat = self._detect_category(line)
                    if cat:
                        current_category = cat

                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if not row:
                            continue
                        # Filter out header rows
                        row_text = " ".join(str(c) for c in row if c)
                        if any(h in row_text for h in ["Asset Name", "Identifier", "Market Value", "Category"]):
                            continue

                        # Row structure: [Name+ID, Category?, Units, Price, CostBasis, UnrealizedGL, MarketValue, EstIncome]
                        # Name and identifier are often combined with \n
                        cell0 = str(row[0] or "").strip()
                        if not cell0:
                            continue

                        # Split name and identifier
                        parts = cell0.split("\n")
                        asset_name = parts[0].strip()
                        identifier = parts[1].strip() if len(parts) > 1 else None

                        if not asset_name or asset_name.lower() in ("none", "", "total"):
                            continue
                        if "PLEDGED TO SECURE" in asset_name.upper():
                            continue

                        # Detect inline category
                        if len(row) >= 2 and row[1]:
                            cat = self._detect_category(str(row[1]))
                            if cat:
                                current_category = cat

                        def safe(idx):
                            if idx < len(row):
                                return self.clean_float(row[idx])
                            return None

                        # Flexible column mapping depending on table width
                        if len(row) >= 7:
                            units = safe(2)
                            price = safe(3)
                            cost_basis = safe(4)
                            unrealized = safe(5)
                            market_value = safe(6)
                            est_income = safe(7) if len(row) > 7 else None
                        elif len(row) >= 5:
                            units = safe(1)
                            price = safe(2)
                            cost_basis = safe(3)
                            market_value = safe(4)
                            unrealized = None
                            est_income = None
                        else:
                            continue

                        records.append(ParsedRecord(
                            institution_name="Regions Bank",
                            institution_country="US",
                            institution_currency="USD",
                            asset_identifier=identifier,
                            asset_name=asset_name,
                            asset_type=current_category,
                            asset_currency="USD",
                            snapshot_date=snap_date,
                            units=units,
                            price=price,
                            cost_basis=cost_basis,
                            market_value=market_value,
                            unrealized_gain=unrealized,
                            estimated_income=est_income,
                            raw_source_file=filename,
                        ))

        return records
