import logging
import os
import threading
from pathlib import Path
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# Import config early so DATA_DIR is created before anything else
import config

# Load .env from AppData (packaged) or local backend/.env (dev)
load_dotenv(dotenv_path=str(config.ENV_FILE), encoding="utf-8-sig", override=False)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from database import init_db
from routers import upload, portfolio, exchange, loans, properties, alerts, reports, backup, logs, chat, manual_assets, settings

app = FastAPI(title="PatrimonIA", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:3000",
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(portfolio.router)
app.include_router(exchange.router)
app.include_router(loans.router)
app.include_router(properties.router)
app.include_router(alerts.router)
app.include_router(reports.router)
app.include_router(backup.router)
app.include_router(logs.router)
app.include_router(chat.router)
app.include_router(manual_assets.router)
app.include_router(settings.router)

# ── Static file mounts ─────────────────────────────────────────────────────────
config.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
(config.UPLOADS_DIR / "properties").mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(config.UPLOADS_DIR)), name="uploads")

# When packaged (Electron), serve the React frontend build
if config.FRONTEND_DIR:
    _assets_dir = Path(config.FRONTEND_DIR) / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="frontend-assets")


@app.on_event("startup")
def startup():
    init_db()
    from routers.reports import _backfill_reports
    threading.Thread(target=_backfill_reports, daemon=True, name="report-backfill").start()
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    rentcast = os.environ.get("RENTCAST_API_KEY", "").strip()
    rapidapi = os.environ.get("RAPIDAPI_KEY", "").strip()
    def _key_status(val: str) -> str:
        return f"OK ({len(val)} chars)" if val and val != "sua_chave_aqui" else "NAO ENCONTRADA"
    print(f"[PatrimonIA] ANTHROPIC_API_KEY : {_key_status(api_key)}")
    print(f"[PatrimonIA] RENTCAST_API_KEY  : {_key_status(rentcast)}")
    print(f"[PatrimonIA] RAPIDAPI_KEY      : {_key_status(rapidapi)}")


@app.get("/health")
def health():
    return {"status": "ok", "mode": "packaged" if os.environ.get("PATRIMONIA_DATA_DIR") else "dev"}


# ── SPA catch-all (MUST be last) ──────────────────────────────────────────────
# In packaged mode: serve React SPA for all unmatched routes so that
# BrowserRouter client-side navigation works correctly.
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    if not config.FRONTEND_DIR:
        raise HTTPException(status_code=404)
    frontend = Path(config.FRONTEND_DIR)
    # Serve existing files (favicon, manifest, etc.) directly
    candidate = frontend / full_path
    if candidate.exists() and candidate.is_file():
        return FileResponse(str(candidate))
    # For all other paths: return index.html (SPA entry point)
    idx = frontend / "index.html"
    if idx.exists():
        return FileResponse(str(idx))
    raise HTTPException(status_code=404)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        log_config=None,
        access_log=False,
        reload=False,
    )