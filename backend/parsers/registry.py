import logging
from datetime import date
from typing import List, Optional
from parsers.base import BaseParser, ParsedRecord

_log = logging.getLogger(__name__)
from parsers.regions_xlsx import RegionsXlsxParser
from parsers.regions_pdf import RegionsPdfParser
from parsers.xp_xlsx import XpXlsxParser
from parsers.xp_personal_xlsx import XpPersonalXlsxParser
from parsers.inter_pdf import InterPdfParser
from parsers.inter_fundos_pdf import InterFundosPdfParser
from parsers.inter_rf_pj_pdf import InterRfPjPdfParser
from parsers.caixa_prev_pdf import CaixaPrevPdfParser

# Order matters: more specific parsers first.
# XpPersonalXlsxParser must come before XpXlsxParser so that account 6200983
# files are claimed before the generic XP parser runs.
# InterRfPjPdfParser and InterFundosPdfParser must come before InterPdfParser
# because all three share the same Inter CNPJ; the subtype parsers use structural
# discriminators (table layout) to claim their files first.
_PARSERS: List[BaseParser] = [
    RegionsXlsxParser(),      # Excel preferred over PDF for Regions
    XpPersonalXlsxParser(),   # XP Pessoal (conta 6200983) — before generic XP
    XpXlsxParser(),           # XP Empresa (conta 9922712)
    InterRfPjPdfParser(),     # Inter RF PJ — before generic Inter (same title, distinct table layout)
    InterFundosPdfParser(),   # Inter Fundos — before generic Inter (distinct title)
    InterPdfParser(),         # Inter RF PF (fallback for remaining Inter PDFs)
    CaixaPrevPdfParser(),     # Caixa Previdência VGBL
    RegionsPdfParser(),       # PDF fallback for Regions
]


def get_supported_parsers() -> List[str]:
    return [type(p).__name__ for p in _PARSERS]


def _clamp_future_dates(parser_name: str, records: List[ParsedRecord]) -> None:
    """Nenhum extrato pode ter posição em data futura — um snapshot futuro
    contamina o max global e marca todas as outras fontes como desatualizadas.
    Guarda central: vale para todos os parsers, atuais e futuros."""
    today = date.today()
    for rec in records:
        if rec.snapshot_date and rec.snapshot_date > today:
            _log.warning(
                "%s: snapshot_date futura %s em '%s' — ajustada para hoje",
                parser_name, rec.snapshot_date, rec.asset_name,
            )
            rec.snapshot_date = today


def detect_and_parse(filename: str, file_bytes: bytes) -> tuple[Optional[str], List[ParsedRecord]]:
    """Return (parser_name, records). Returns (None, []) if no parser matches."""
    for parser in _PARSERS:
        if parser.can_parse(filename, file_bytes):
            name = type(parser).__name__
            records = parser.parse(filename, file_bytes)
            _clamp_future_dates(name, records)
            return name, records
    return None, []
