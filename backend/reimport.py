import httpx

FILES = [
    # Regions Bank: use PDF (ALL MY ACCOUNTS) as the single source of truth.
    # The XLSX export covers a sub-portfolio that overlaps with the PDF total,
    # so importing both would double-count ~$394K of holdings.
    (
        r"C:\Users\forte\Downloads\Investments_05-27-2026_10-38-17_AM.pdf",
        "Investments_05-27-2026_10-38-17_AM.pdf",
    ),
    (
        r"C:\Users\forte\OneDrive\Área de Trabalho\XLS - Carteira XP empresa.xlsx",
        "XLS - Carteira XP empresa.xlsx",
    ),
]

XLSX_MT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_MT  = "application/pdf"

for path, name in FILES:
    try:
        with open(path, "rb") as f:
            data = f.read()
    except FileNotFoundError:
        print(f"NOT FOUND: {path}")
        continue

    mt = PDF_MT if name.endswith(".pdf") else XLSX_MT

    with httpx.Client(timeout=30) as client:
        resp = client.post("http://localhost:8000/upload/", files={"file": (name, data, mt)})

    if resp.status_code == 200:
        r = resp.json()
        print(f"OK   {name}")
        print(f"     parser   = {r.get('parser_used')}")
        print(f"     date     = {r.get('snapshot_date')}")
        print(f"     inserted = {r.get('records_inserted', 0)}")
        print(f"     updated  = {r.get('records_updated', 0)}")
        errs = r.get("errors", [])
        if errs:
            for e in errs[:3]:
                print(f"     ERR: {e}")
    else:
        print(f"FAIL {name}: {resp.status_code}")
        print(f"     {resp.text[:300]}")
