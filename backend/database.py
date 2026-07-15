import logging

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker
from config import DATABASE_URL

_log = logging.getLogger(__name__)

# Versão do schema esperada por esta versão do código. Incrementar sempre que
# _run_migrations ganhar um passo novo; um valor gravado menor dispara backup
# automático do .db antes de migrar.
SCHEMA_VERSION = 2

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA busy_timeout=5000")
    cur.close()


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

    # loan_events é criada por create_all(); aqui só o backfill idempotente:
    # empréstimos sem nenhum evento ganham 1 balance_set com o saldo atual.
    _backfill_loan_events()

    # Índices para tabelas antigas (create_all não altera tabelas existentes)
    with engine.connect() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_snapshots_asset_id ON snapshots(asset_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_loan_snapshots_loan_id ON loan_snapshots(loan_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_loan_events_loan_id ON loan_events(loan_id)"))
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


def _backfill_loan_events():
    """Cria o evento inicial (balance_set) para empréstimos sem histórico.

    Idempotente: só insere quando o loan não tem NENHUM evento, então
    reiniciar o app não duplica nada. Fonte do saldo: LoanSnapshot mais
    recente (desempate por id); fallback original_amount. Comparações usam
    IS NOT NULL para não descartar saldo legítimo igual a 0.
    """
    from sqlalchemy import text
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT l.id, l.original_amount, l.start_date FROM loans l "
            "WHERE NOT EXISTS (SELECT 1 FROM loan_events e WHERE e.loan_id = l.id)"
        )).fetchall()
        for loan_id, original_amount, start_date in rows:
            snap = conn.execute(text(
                "SELECT outstanding_balance, snapshot_date FROM loan_snapshots "
                "WHERE loan_id = :lid AND outstanding_balance IS NOT NULL "
                "ORDER BY snapshot_date DESC, id DESC LIMIT 1"
            ), {"lid": loan_id}).fetchone()
            if snap is not None:
                balance, event_date = snap[0], snap[1]
            elif original_amount is not None:
                balance, event_date = original_amount, start_date
            else:
                balance, event_date = 0.0, start_date
            conn.execute(text(
                "INSERT INTO loan_events (loan_id, event_date, event_type, amount, resulting_balance, notes) "
                "VALUES (:lid, COALESCE(:dt, DATE('now')), 'balance_set', :bal, :bal, 'Saldo inicial (migração)')"
            ), {"lid": loan_id, "dt": event_date, "bal": balance})
        conn.commit()


def _get_stored_schema_version() -> int:
    from sqlalchemy import text, inspect as sa_inspect
    if "schema_version" not in sa_inspect(engine).get_table_names():
        return 0
    with engine.connect() as conn:
        row = conn.execute(text("SELECT version FROM schema_version LIMIT 1")).fetchone()
        return row[0] if row else 0


def _set_stored_schema_version(version: int):
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"))
        if conn.execute(text("SELECT COUNT(*) FROM schema_version")).fetchone()[0]:
            conn.execute(text("UPDATE schema_version SET version = :v"), {"v": version})
        else:
            conn.execute(text("INSERT INTO schema_version (version) VALUES (:v)"), {"v": version})
        conn.commit()


def _pre_migration_backup(stored_version: int):
    """Copia o .db para backups/ antes de aplicar migrações de schema."""
    import shutil
    from datetime import datetime
    import config
    if not config.DB_PATH.exists():
        return
    try:
        config.BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        dest = config.BACKUPS_DIR / f"pre-migration-v{stored_version}-to-v{SCHEMA_VERSION}-{ts}.db"
        shutil.copy2(config.DB_PATH, dest)
        _log.info("Backup pré-migração criado: %s", dest)
    except Exception as exc:
        _log.warning("Falha ao criar backup pré-migração: %s", exc)


def init_db():
    from models import Institution, Asset, Snapshot, ExchangeRate, Loan, LoanSnapshot, LoanEvent, Property, PropertyValuation, PropertyPhoto, PriceReference, CdiRate, ImportLog, ChatHistory, ChatUsage, Dividend, ManualAssetHistory, ImportSource, AppSettings, Report, PropertyRentalIncome  # noqa: F401
    stored = _get_stored_schema_version()
    if stored < SCHEMA_VERSION:
        _pre_migration_backup(stored)
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    if stored < SCHEMA_VERSION:
        _set_stored_schema_version(SCHEMA_VERSION)
