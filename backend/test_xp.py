import sys
from pathlib import Path
from parsers.xp_xlsx import XpXlsxParser

def main():
    if len(sys.argv) < 2:
        print("Uso: python test_xp.py <caminho_do_xlsx>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Arquivo não encontrado: {path}")
        sys.exit(1)

    file_bytes = path.read_bytes()
    parser = XpXlsxParser()

    if not parser.can_parse(path.name, file_bytes):
        print("ERRO: parser não reconheceu o arquivo como carteira XP.")
        sys.exit(1)

    records = parser.parse(path.name, file_bytes)
    print(f"\n{len(records)} registro(s) encontrado(s):\n")

    by_type: dict = {}
    total_mv = 0.0

    for r in records:
        by_type.setdefault(r.asset_type, []).append(r)
        total_mv += r.market_value or 0.0
        gain = ((r.market_value or 0) - (r.cost_basis or 0)) if r.cost_basis is not None else None
        print(f"  [{r.asset_type:12s}] {r.asset_name}")
        print(f"             Cost: R$ {r.cost_basis:>12,.2f}" if r.cost_basis is not None else "             Cost: —")
        print(f"           Market: R$ {r.market_value:>12,.2f}" if r.market_value is not None else "           Market: —")
        if gain is not None:
            print(f"             Gain: R$ {gain:>+12,.2f}")
        if r.maturity_date:
            print(f"          Vencto: {r.maturity_date}")
        print()

    print(f"--- TOTAL MARKET VALUE: R$ {total_mv:,.2f} ---")
    print(f"\nPor tipo:")
    for t, recs in sorted(by_type.items()):
        subtotal = sum(r.market_value or 0 for r in recs)
        print(f"  {t:14s} {len(recs):3d} ativos  R$ {subtotal:>12,.2f}")

if __name__ == "__main__":
    main()
