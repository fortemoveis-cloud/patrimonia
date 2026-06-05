import sys
from pathlib import Path
from parsers.regions_xlsx import RegionsXlsxParser

def main():
    if len(sys.argv) < 2:
        print("Uso: python test_regions.py <caminho_do_xlsx>")
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"Arquivo não encontrado: {path}")
        sys.exit(1)

    file_bytes = path.read_bytes()
    parser = RegionsXlsxParser()

    if not parser.can_parse(path.name, file_bytes):
        print("ERRO: parser não reconheceu o arquivo como Regions XLSX.")
        sys.exit(1)

    records = parser.parse(path.name, file_bytes)
    print(f"\n{len(records)} registro(s) encontrado(s):\n")
    for r in records:
        print(f"  Ativo          : {r.asset_name}")
        print(f"  Tipo           : {r.asset_type}")
        print(f"  Vencimento     : {r.maturity_date or '—'}")
        print(f"  Cost Basis     : {r.cost_basis}")
        print(f"  Market Value   : {r.market_value}")
        print(f"  Estimated Inc. : {r.estimated_income}")
        print(f"  Accrued Income : {r.accrued_income}")
        print(f"  Current Yield  : {r.current_yield}")
        print()

if __name__ == "__main__":
    main()
