from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from typing import Optional, List
import re


@dataclass
class ParsedRecord:
    institution_name: str
    institution_country: str
    institution_currency: str
    asset_identifier: Optional[str]
    asset_name: str
    asset_type: str  # equity, fixed_income, cash, fund
    asset_currency: str
    snapshot_date: date
    units: Optional[float] = None
    price: Optional[float] = None
    cost_basis: Optional[float] = None
    market_value: Optional[float] = None
    unrealized_gain: Optional[float] = None
    estimated_income: Optional[float] = None
    accrued_income: Optional[float] = None
    current_yield: Optional[float] = None
    tax_gross: Optional[float] = None
    tax_net: Optional[float] = None
    rate_description: Optional[str] = None
    maturity_date: Optional[date] = None
    purchase_date: Optional[date] = None
    portfolio_name: Optional[str] = None
    raw_source_file: Optional[str] = None


class BaseParser(ABC):
    @abstractmethod
    def can_parse(self, filename: str, file_bytes: bytes) -> bool:
        """Return True if this parser can handle the given file."""

    @abstractmethod
    def parse(self, filename: str, file_bytes: bytes) -> List[ParsedRecord]:
        """Parse file and return list of records."""

    @staticmethod
    def clean_float(value) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        s = str(value).strip()
        if not s or s in ("-", "—", "N/A", ""):
            return None
        # Remove currency symbols and whitespace
        s = re.sub(r"[R$\s]", "", s)
        # Determine number format by position of last comma vs last dot.
        # BR format: 1.234.567,89  (dot=thousands, comma=decimal)
        # US format: 1,234,567.89  (comma=thousands, dot=decimal)
        if "," in s and "." in s:
            if s.rfind(",") > s.rfind("."):
                # BR: decimal separator is the comma → strip dots, swap comma→dot
                s = s.replace(".", "").replace(",", ".")
            else:
                # US: decimal separator is the dot → strip commas only
                s = s.replace(",", "")
        elif "," in s:
            s = s.replace(",", ".")
        elif re.match(r"^\d{1,3}(\.\d{3})+$", s):
            # BR thousands-only (no decimal): "113.027" or "1.234.567"
            s = s.replace(".", "")
        s = s.replace("(", "-").replace(")", "")
        try:
            return float(s)
        except (ValueError, TypeError):
            return None
