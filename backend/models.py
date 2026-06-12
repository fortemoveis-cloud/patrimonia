from sqlalchemy import Column, Integer, String, Float, Date, Boolean, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Institution(Base):
    __tablename__ = "institutions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    country = Column(String, default="US")
    currency = Column(String, default="USD")
    assets         = relationship("Asset", back_populates="institution")
    loans          = relationship("Loan", back_populates="institution")
    import_sources = relationship("ImportSource", back_populates="institution")


class Asset(Base):
    __tablename__ = "assets"

    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    identifier = Column(String, index=True)
    name = Column(String, nullable=False)
    asset_type = Column(String, nullable=False)  # equity, fixed_income, cash, fund
    currency = Column(String, default="USD")
    is_active = Column(Boolean, default=True)

    notes = Column(String)
    monthly_dividends_expected = Column(Float)
    user_edited = Column(Boolean, default=False)
    purchase_date = Column(Date)                 # earliest application date (for vs CDI)
    source = Column(String, default="pdf_import")  # pdf_import | manual
    account_number = Column(String, nullable=True)

    institution = relationship("Institution", back_populates="assets")
    snapshots = relationship("Snapshot", back_populates="asset")
    dividends = relationship("Dividend", back_populates="asset", order_by="Dividend.payment_date.desc()")
    manual_history = relationship("ManualAssetHistory", back_populates="asset",
                                  order_by="ManualAssetHistory.date.desc()", cascade="all, delete-orphan")


class Snapshot(Base):
    __tablename__ = "snapshots"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("assets.id"), nullable=False)
    snapshot_date = Column(Date, nullable=False, index=True)
    units = Column(Float)
    price = Column(Float)
    cost_basis = Column(Float)
    market_value = Column(Float)
    unrealized_gain = Column(Float)
    estimated_income = Column(Float)
    accrued_income = Column(Float)
    current_yield = Column(Float)
    tax_gross = Column(Float)
    tax_net = Column(Float)
    rate_description = Column(String)
    maturity_date = Column(Date)
    purchase_date = Column(Date)
    portfolio_name = Column(String)
    raw_source_file = Column(String)
    usd_brl_rate = Column(Float)
    created_at = Column(DateTime, server_default=func.now())

    asset = relationship("Asset", back_populates="snapshots")


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"

    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    usd_brl = Column(Float, nullable=False)
    source = Column(String, default="manual")


class Loan(Base):
    __tablename__ = "loans"

    id             = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"), nullable=True)
    loan_number    = Column(String)
    description    = Column(String, nullable=False)
    currency       = Column(String, default="USD")
    original_amount = Column(Float)
    interest_rate  = Column(Float)           # annual rate as decimal (0.125 = 12.5% a.a.)
    start_date     = Column(Date)
    maturity_date  = Column(Date)
    is_active      = Column(Boolean, default=True)
    created_at     = Column(DateTime, server_default=func.now())

    institution = relationship("Institution", back_populates="loans")
    snapshots   = relationship("LoanSnapshot", back_populates="loan",
                               order_by="LoanSnapshot.snapshot_date.desc()")


class LoanSnapshot(Base):
    __tablename__ = "loan_snapshots"

    id                  = Column(Integer, primary_key=True, index=True)
    loan_id             = Column(Integer, ForeignKey("loans.id"), nullable=False)
    snapshot_date       = Column(Date, nullable=False)
    outstanding_balance = Column(Float)
    interest_accrued    = Column(Float)
    monthly_payment     = Column(Float)
    raw_source_file     = Column(String)
    created_at          = Column(DateTime, server_default=func.now())

    loan = relationship("Loan", back_populates="snapshots")


class Property(Base):
    __tablename__ = "properties"

    id                  = Column(Integer, primary_key=True, index=True)
    description         = Column(String, nullable=False)
    address             = Column(String)
    property_type       = Column(String, default="residencial")  # residencial/comercial/terreno/outro
    area_m2             = Column(Float)
    cidade              = Column(String)
    bairro              = Column(String)
    matricula           = Column(String)
    purchase_date       = Column(Date)
    purchase_price_brl  = Column(Float)
    purchase_price_usd  = Column(Float)          # original USD amount for US properties
    country             = Column(String, default="Brasil")    # Brasil / Estados Unidos
    currency            = Column(String, default="BRL")       # BRL / USD
    zillow_url          = Column(String)         # e.g. https://www.zillow.com/homedetails/...
    iptu_anual          = Column(Float)
    condominio_mensal   = Column(Float)
    aluguel_mensal      = Column(Float)
    loan_id             = Column(Integer, ForeignKey("loans.id"), nullable=True)
    is_active           = Column(Boolean, default=True)
    created_at          = Column(DateTime, server_default=func.now())

    valuations = relationship(
        "PropertyValuation", back_populates="property",
        order_by="PropertyValuation.valuation_date.desc()",
    )
    photos = relationship("PropertyPhoto", back_populates="property", cascade="all, delete-orphan")


class PropertyPhoto(Base):
    __tablename__ = "property_photos"

    id          = Column(Integer, primary_key=True, index=True)
    property_id = Column(Integer, ForeignKey("properties.id"), nullable=False)
    filename    = Column(String, nullable=False)
    created_at  = Column(DateTime, server_default=func.now())

    property = relationship("Property", back_populates="photos")


class PriceReference(Base):
    __tablename__ = "price_references"

    id         = Column(Integer, primary_key=True, index=True)
    cidade     = Column(String, nullable=False, index=True)
    bairro     = Column(String)
    preco_m2   = Column(Float, nullable=False)
    source     = Column(String, default="manual")
    updated_at = Column(DateTime, server_default=func.now())


class PropertyValuation(Base):
    __tablename__ = "property_valuations"

    id                = Column(Integer, primary_key=True, index=True)
    property_id       = Column(Integer, ForeignKey("properties.id"), nullable=False)
    valuation_date    = Column(Date, nullable=False)
    current_value_brl = Column(Float, nullable=False)
    current_value_usd = Column(Float)             # original USD for US properties
    valuation_source  = Column(String, default="manual")  # manual / zillow
    notes             = Column(String)
    created_at        = Column(DateTime, server_default=func.now())

    property = relationship("Property", back_populates="valuations")


class Dividend(Base):
    __tablename__ = "dividends"

    id             = Column(Integer, primary_key=True, index=True)
    asset_id       = Column(Integer, ForeignKey("assets.id"), nullable=False)
    payment_date   = Column(Date, nullable=False, index=True)
    amount         = Column(Float, nullable=False)
    dividend_type  = Column(String, default="dividendo")  # dividendo/jcp/rendimento_fii/amortizacao/bonificacao
    currency       = Column(String, default="USD")
    notes          = Column(String)
    created_at     = Column(DateTime, server_default=func.now())

    asset = relationship("Asset", back_populates="dividends")


class CdiRate(Base):
    __tablename__ = "cdi_rates"

    id       = Column(Integer, primary_key=True, index=True)
    date     = Column(Date, nullable=False, unique=True, index=True)
    rate_pct = Column(Float, nullable=False)  # daily rate as % (e.g. 0.0497)


class ChatHistory(Base):
    __tablename__ = "chat_history"

    id         = Column(Integer, primary_key=True, index=True)
    role       = Column(String, nullable=False)   # user / assistant
    content    = Column(String, nullable=False)
    tokens     = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())


class ChatUsage(Base):
    __tablename__ = "chat_usage"

    id            = Column(Integer, primary_key=True, index=True)
    year_month    = Column(String, nullable=False, unique=True)  # e.g. "2026-05"
    message_count = Column(Integer, default=0)


class ManualAssetHistory(Base):
    __tablename__ = "manual_asset_history"

    id         = Column(Integer, primary_key=True, index=True)
    asset_id   = Column(Integer, ForeignKey("assets.id"), nullable=False)
    date       = Column(Date, nullable=False, index=True)
    value      = Column(Float, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    asset = relationship("Asset", back_populates="manual_history")

    __table_args__ = (UniqueConstraint("asset_id", "date", name="uq_manual_history_asset_date"),)


class ImportSource(Base):
    __tablename__ = "import_sources"

    id              = Column(Integer, primary_key=True, index=True)
    institution_id  = Column(Integer, ForeignKey("institutions.id"), nullable=False)
    account_number  = Column(String, nullable=False, default="")  # "" = no specific account
    institution_key = Column(String, nullable=False)              # stable slug
    default_label   = Column(String, nullable=False)
    custom_label    = Column(String, nullable=True)
    currency        = Column(String, nullable=False, default="BRL")
    display_order   = Column(Integer, nullable=False, default=0)
    visible         = Column(Boolean, nullable=False, default=True)

    institution = relationship("Institution", back_populates="import_sources")

    __table_args__ = (UniqueConstraint("institution_id", "account_number", name="uq_import_source"),)


class ImportLog(Base):
    __tablename__ = "import_logs"

    id                 = Column(Integer, primary_key=True, index=True)
    filename           = Column(String, nullable=False)
    parser_name        = Column(String)
    institution_name   = Column(String)
    snapshot_date      = Column(Date)
    status             = Column(String, nullable=False)  # success / partial / error
    records_inserted   = Column(Integer, default=0)
    records_updated    = Column(Integer, default=0)
    records_failed     = Column(Integer, default=0)
    error_message      = Column(String)
    stack_trace        = Column(String)
    file_size_kb       = Column(Float)
    processing_time_ms = Column(Integer)
    created_at         = Column(DateTime, server_default=func.now())


class AppSettings(Base):
    __tablename__ = "app_settings"

    id         = Column(Integer, primary_key=True, index=True)
    key        = Column(String, nullable=False, unique=True)
    value      = Column(String, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Report(Base):
    __tablename__ = "reports"

    id           = Column(Integer, primary_key=True, index=True)
    type         = Column(String, nullable=False)
    period_start = Column(Date, nullable=False)
    period_end   = Column(Date, nullable=False)
    generated_at = Column(DateTime, server_default=func.now())
    payload      = Column(String, nullable=False)

    __table_args__ = (UniqueConstraint("type", "period_start", name="uq_report_type_period"),)
