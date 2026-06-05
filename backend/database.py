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


def _cleanup_aluguel_assets():
    """Remove legacy XP '(Aluguel)' assets — both sides net to zero; loan tracked separately."""
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text(
            "DELETE FROM snapshots WHERE asset_id IN ("
            "  SELECT id FROM assets WHERE name LIKE '% (Aluguel)'"
            "  AND institution_id IN (SELECT id FROM institutions WHERE name = 'XP Investimentos')"
            ")"
        ))
        conn.execute(text(
            "DELETE FROM assets WHERE name LIKE '% (Aluguel)'"
            " AND institution_id IN (SELECT id FROM institutions WHERE name = 'XP Investimentos')"
        ))
        conn.commit()


def init_db():
    from models import Institution, Asset, Snapshot, ExchangeRate, Loan, LoanSnapshot, Property, PropertyValuation, PropertyPhoto, PriceReference, CdiRate, ImportLog, ChatHistory, ChatUsage, Dividend  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _run_migrations()
    _cleanup_aluguel_assets()
