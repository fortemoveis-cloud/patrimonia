"""
Centralized path and config resolution.

In packaged mode (Electron), the main process sets PATRIMONIA_DATA_DIR
to %APPDATA%/PatrimonIA before launching this executable.
In dev mode, local paths relative to backend/ are used unchanged.
"""
import os
from pathlib import Path

# ── Data directory ─────────────────────────────────────────────────────────────
_data_dir_env = os.environ.get("PATRIMONIA_DATA_DIR")

if _data_dir_env:
    DATA_DIR = Path(_data_dir_env)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH      = DATA_DIR / "patrimonia.db"
    UPLOADS_DIR  = DATA_DIR / "uploads"
    BACKUPS_DIR  = DATA_DIR / "backups"
    ENV_FILE     = DATA_DIR / ".env"
    DATABASE_URL = f"sqlite:///{DB_PATH}"
else:
    # Dev mode: keep existing behavior (files relative to backend/ working dir)
    DATA_DIR     = Path(__file__).resolve().parent
    DB_PATH      = DATA_DIR / "gestor.db"
    UPLOADS_DIR  = DATA_DIR / "uploads"
    BACKUPS_DIR  = DATA_DIR / "backups"
    ENV_FILE     = DATA_DIR / ".env"
    DATABASE_URL = "sqlite:///./gestor.db"  # relative for dev compatibility

# Frontend build dir (set by Electron when serving the React SPA from the backend)
FRONTEND_DIR: str | None = os.environ.get("PATRIMONIA_FRONTEND_DIR")
