from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from config import DATABASE_URL

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _run_migrations():
    from sqlalchemy import text, inspect as sa_inspect
    inspector = sa_inspect(engine)
    tables = inspector.get_table_names()

    if "assets" in tables:
        existing = [c["name"] for c in inspector.get_columns("assets")]
        asset_new_cols = [
            ("notes",                       "TEXT"),
            ("monthly_dividends_expected",  "REAL"),
            ("user_edited",                 "INTEGER DEFAULT 0"),
            ("purchase_date",               "DATE"),
            ("is_active",                   "INTEGER DEFAULT 1"),
            ("source",                      "TEXT DEFAULT 'pdf_import'"),
            ("account_number",              "TEXT"),
        ]
        with engine.connect() as conn:
            for col, col_type in asset_new_cols:
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE assets ADD COLUMN {col} {col_type}"))
            conn.commit()

    if "snapshots" in tables:
        existing = [c["name"] for c in inspector.get_columns("snapshots")]
        snap_new_cols = [
            ("purchase_date", "DATE"),
        ]
        with engine.connect() as conn:
            for col, col_type in snap_new_cols:
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE snapshots ADD COLUMN {col} {col_type}"))
            conn.commit()

    if "properties" in tables:
        existing = [c["name"] for c in inspector.get_columns("properties")]
        new_cols = [
            ("cidade",              "TEXT"),
            ("bairro",              "TEXT"),
            ("matricula",           "TEXT"),
            ("iptu_anual",          "REAL"),
            ("condominio_mensal",   "REAL"),
            ("aluguel_mensal",      "REAL"),
            ("loan_id",             "INTEGER"),
            ("country",             "TEXT DEFAULT 'Brasil'"),
            ("currency",            "TEXT DEFAULT 'BRL'"),
            ("purchase_price_usd",  "REAL"),
            ("zillow_url",          "TEXT"),
        ]
        with engine.connect() as conn:
            for col, col_type in new_cols:
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE properties ADD COLUMN {col} {col_type}"))
            conn.commit()

    if "manual_asset_history" not in tables:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE manual_asset_history (
                    id       INTEGER PRIMARY KEY AUTOINCREMENT,
                    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
                    date     DATE NOT NULL,
                    value    REAL NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(asset_id, date)
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_mah_asset_id ON manual_asset_history(asset_id)"
            ))
            conn.commit()

    # import_sources table is created by SQLAlchemy create_all().
    # Backfill runs on every startup; INSERT OR IGNORE keeps it idempotent.
    _backfill_import_sources()

    if "property_valuations" in tables:
        existing = [c["name"] for c in inspector.get_columns("property_valuations")]
        new_cols = [
            ("current_value_usd",  "REAL"),
            ("valuation_source",   "TEXT DEFAULT 'manual'"),
        ]
        with engine.connect() as conn:
            for col, col_type in new_cols:
                if col not in existing:
                    conn.execute(text(f"ALTER TABLE property_valuations ADD COLUMN {col} {col_type}"))
            conn.commit()

    if "property_rental_income" not in tables:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE property_rental_income (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    property_id INTEGER NOT NULL
                                REFERENCES properties(id) ON DELETE CASCADE,
                    year        INTEGER NOT NULL,
                    month       INTEGER NOT NULL,
                    amount      REAL    NOT NULL,
                    currency    TEXT    NOT NULL DEFAULT 'BRL',
                    notes       TEXT,
                    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(property_id, year, month)
                )
            """))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_pri_property_id "
                "ON property_rental_income(property_id)"
            ))
            conn.commit()

    if "app_settings" not in tables:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS app_settings (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    key        TEXT NOT NULL UNIQUE,
                    value      TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
            conn.commit()

    if "reports" not in tables:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS reports (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    type         TEXT NOT NULL,
                    period_start DATE NOT NULL,
                    period_end   DATE NOT NULL,
                    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    payload      TEXT NOT NULL,
                    UNIQUE(type, period_start)
                )
            """))
            conn.commit()

    _backfill_app_settings()


def _get_app_setting(db, key: str, default: str = "") -> str:
    from sqlalchemy import text as _text
    row = db.execute(_text("SELECT value FROM app_settings WHERE key = :k"), {"k": key}).fetchone()
    return row[0] if row and row[0] is not None else default


def _slugify(name: str) -> str:
    import re as _re
    s = name.lower()
    for src, dst in [("ç","c"),("ã","a"),("â","a"),("á","a"),("à","a"),("ä","a"),
                      ("ê","e"),("é","e"),("è","e"),("ë","e"),("î","i"),("í","i"),
                      ("ô","o"),("ó","o"),("õ","o"),("ö","o"),("û","u"),("ú","u"),("ü","u")]:
        s = s.replace(src, dst)
    s = _re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _make_default_label(inst_name: str, account_number: str) -> str:
    if account_number:
        return f"{inst_name} (conta {account_number})"
    return inst_name


def _backfill_app_settings():
    from sqlalchemy import text
    defaults = [
        ("alert_drop_threshold_pct", "10"),
        ("alert_monitored_classes",  "equity,fixed_income,fund,cash"),
        ("alert_maturity_days",      "90"),
    ]
    with engine.connect() as conn:
        for key, value in defaults:
            conn.execute(
                text("INSERT OR IGNORE INTO app_settings (key, value) VALUES (:k, :v)"),
                {"k": key, "v": value},
            )
        conn.commit()


def _backfill_import_sources():
    from sqlalchemy import text
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT i.id, i.name, i.currency, a.account_number "
            "FROM institutions i "
            "JOIN assets a ON a.institution_id = i.id "
            "GROUP BY i.id, COALESCE(a.account_number, '')"
        )).fetchall()
        order = 0
        for inst_id, inst_name, currency, acct_raw in rows:
            acct = acct_raw or ""
            key  = _slugify(inst_name)
            label = _make_default_label(inst_name, acct)
            conn.execute(text(
                "INSERT OR IGNORE INTO import_sources "
                "(institution_id, account_number, institution_key, default_label, currency, display_order, visible) "
                "VALUES (:iid, :acct, :key, :label, :cur, :ord, 1)"
            ), {"iid": inst_id, "acct": acct, "key": key, "label": label,
                "cur": currency or "BRL", "ord": order})
            order += 1
        conn.commit()


def _cleanup_aluguel_assets():
    """Remove legacy XP '(Aluguel)' assets — both sides net to zero; loan tracked separately."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(
            "DELETE FROM snapshots WHERE asset_id IN ("
            "  SELECT id FROM assets WHERE name LIKE '% (Aluguel)'"
            "  AND institution_id IN (SELECT id FROM institutions WHERE name = 'XP Investimentos')"
            "  AND (source IS NULL OR source != 'manual')"
            ")"
        ))
        conn.execute(text(
            "DELETE FROM assets WHERE name LIKE '% (Aluguel)'"
            " AND institution_id IN (SELECT id FROM institutions WHERE name = 'XP Investimentos')"
            " AND (source IS NULL OR source != 'manual')"
        ))
        conn.commit()


def init_db():
    from models import Institution, Asset, Snapshot, ExchangeRate, Loan, LoanSnapshot, Property, PropertyValuation, PropertyPhoto, PriceReference, CdiRate, ImportLog, ChatHistory, ChatUsage, Dividend, ManualAssetHistory, ImportSource, AppSettings, Report, PropertyRentalIncome  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    _cleanup_aluguel_assets()
