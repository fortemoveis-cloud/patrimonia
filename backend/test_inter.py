import sys
from pathlib import Path
from parsers.inter_pdf import InterPdfParser

def main():
    if len(sys.argv) < 2:
        print("Uso: python test_inter.py <caminho_do_pdf>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Arquivo não encontrado: {path}")
        sys.exit(1)

    file_bytes = path.read_bytes()
    parser = InterPdfParser()

    if not parser.can_parse(path.name, file_bytes):
        print("ERRO: parser não reconheceu o arquivo como extrato Inter.")
        sys.exit(1)

    records = parser.parse(path.name, file_bytes)
    print(f"\n{len(records)} registro(s) encontrado(s):\n")
    for r in records:
        gain = (r.market_value or 0) - (r.cost_basis or 0)
        print(f"  Ativo       : {r.asset_name}")
        print(f"  Data        : {r.snapshot_date}")
        print(f"  Cost Basis  : R$ {r.cost_basis:,.2f}" if r.cost_basis is not None else "  Cost Basis  : —")
        print(f"  Market Value: R$ {r.market_value:,.2f}" if r.market_value is not None else "  Market Value: —")
        print(f"  Ganho bruto : R$ {gain:+,.2f}")
        print()

if __name__ == "__main__":
    main()
