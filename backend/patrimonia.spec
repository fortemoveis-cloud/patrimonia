# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for PatrimonIA backend
# Run from backend/ directory: pyinstaller patrimonia.spec --clean --noconfirm

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

# Collect pdfminer/pdfplumber data files (encoding maps, font cmap data)
pdfminer_datas, pdfminer_bins, pdfminer_hidden   = collect_all('pdfminer')
pdfplumber_datas, pdfplumber_bins, pdfplumber_hidden = collect_all('pdfplumber')

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=pdfminer_bins + pdfplumber_bins,
    datas=[
        # Parser and router source files (needed for dynamic imports)
        ('parsers',  'parsers'),
        ('routers',  'routers'),
        # Include any .env template so the app can find its config module
        ('config.py', '.'),
    ] + pdfminer_datas + pdfplumber_datas,
    hiddenimports=[
        # uvicorn — dynamic class loading
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'uvicorn.config',
        'uvicorn.main',
        # ASGI / async
        'anyio',
        'anyio._backends._asyncio',
        'anyio.lowlevel',
        # SQLAlchemy dialect
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.dialects.sqlite.pysqlite',
        # FastAPI / Starlette extras
        'starlette.routing',
        'starlette.staticfiles',
        'fastapi.responses',
        # python-multipart (file uploads)
        'multipart',
        'python_multipart',
        # httpx / h11
        'h11',
        'httpx',
        'httpcore',
        # email_validator (pydantic)
        'email_validator',
        # anthropic client
        'anthropic',
        # openpyxl
        'openpyxl',
        'openpyxl.styles.stylesheet',
        'openpyxl.cell.read_only',
        # dotenv
        'dotenv',
        'python_dotenv',
    ] + pdfminer_hidden + pdfplumber_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Trim unused heavy packages to reduce exe size
    excludes=['tkinter', 'matplotlib', 'scipy', 'notebook', 'IPython', 'PIL', 'Pillow'],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='patrimonia-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,           # compress with UPX if available (reduces size ~30%)
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,       # keep stdout/stderr valid (Electron hides the window via windowsHide:true)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
