from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


class InstitutionBase(BaseModel):
    name: str
    country: str = "US"
    currency: str = "USD"


class InstitutionOut(InstitutionBase):
    id: int

    model_config = {"from_attributes": True}


class AssetBase(BaseModel):
    identifier: Optional[str] = None
    name: str
    asset_type: str
    currency: str = "USD"
    is_active: bool = True


class AssetOut(AssetBase):
    id: int
    institution_id: int
    institution: Optional[InstitutionOut] = None

    model_config = {"from_attributes": True}


class SnapshotBase(BaseModel):
    snapshot_date: date
    units: Optional[float] = None
    price: Optional[float] = None
    cost_basis: Optional[float] = None
    market_value: Optional[float] = None
    unrealized_gain: Optional[float] = None
    estimated_income: Optional[float] = None
    accrued_income: Optional[float] = None
    current_yield: Optional[float] = None
    tax_gross: Optional[float] = None
    tax_net: Optional[float] = None
    rate_description: Optional[str] = None
    maturity_date: Optional[date] = None
    portfolio_name: Optional[str] = None
    raw_source_file: Optional[str] = None
    usd_brl_rate: Optional[float] = None


class SnapshotOut(SnapshotBase):
    id: int
    asset_id: int
    asset: Optional[AssetOut] = None
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ExchangeRateBase(BaseModel):
    date: date
    usd_brl: float
    source: str = "manual"


class ExchangeRateOut(ExchangeRateBase):
    id: int

    model_config = {"from_attributes": True}


class UploadResult(BaseModel):
    filename: str
    parser_used: str
    institution: str
    snapshot_date: date
    records_inserted: int
    records_updated: int = 0
    records_skipped: int = 0
    errors: List[str] = []


class PortfolioSummary(BaseModel):
    total_market_value_usd: float
    total_market_value_brl: float
    total_cost_basis_usd: float
    total_cost_basis_brl: float = 0.0
    total_unrealized_gain_usd: float
    by_institution: List[dict]
    by_asset_type: List[dict]
    by_currency: List[dict]
    snapshot_dates: List[date]
    latest_date: Optional[date] = None
    stale_sources: bool = False


class PortfolioHistory(BaseModel):
    dates: List[date]
    total_usd: List[float]
    total_brl: List[float]
    usd_brl_rates: List[float]
    asset_currency: Optional[str] = None
    series: List[dict] = []


class LoanCreate(BaseModel):
    institution_name: Optional[str] = None
    loan_number: Optional[str] = None
    description: str
    currency: str = "USD"
    original_amount: Optional[float] = None
    interest_rate: Optional[float] = None
    start_date: Optional[date] = None
    maturity_date: Optional[date] = None
    outstanding_balance: Optional[float] = None


class LoanOut(BaseModel):
    id: int
    institution_id: Optional[int] = None
    institution_name: Optional[str] = None
    loan_number: Optional[str] = None
    description: str
    currency: str
    original_amount: Optional[float] = None
    interest_rate: Optional[float] = None
    start_date: Optional[date] = None
    maturity_date: Optional[date] = None
    is_active: bool = True
    outstanding_balance: Optional[float] = None

    model_config = {"from_attributes": True}


class LoanSnapshotCreate(BaseModel):
    snapshot_date: date
    outstanding_balance: Optional[float] = None
    interest_accrued: Optional[float] = None
    monthly_payment: Optional[float] = None


class LoanSnapshotOut(LoanSnapshotCreate):
    id: int
    loan_id: int

    model_config = {"from_attributes": True}


class PropertyCreate(BaseModel):
    description: str
    address: Optional[str] = None
    property_type: str = "residencial"
    area_m2: Optional[float] = None
    cidade: Optional[str] = None
    bairro: Optional[str] = None
    matricula: Optional[str] = None
    purchase_date: Optional[date] = None
    purchase_price_brl: Optional[float] = None
    purchase_price_usd: Optional[float] = None
    current_value_brl: Optional[float] = None
    current_value_usd: Optional[float] = None
    country: str = "Brasil"
    currency: str = "BRL"
    zillow_url: Optional[str] = None
    iptu_anual: Optional[float] = None
    condominio_mensal: Optional[float] = None
    aluguel_mensal: Optional[float] = None
    loan_id: Optional[int] = None


class PropertyValuationCreate(BaseModel):
    valuation_date: date
    current_value_brl: Optional[float] = None
    current_value_usd: Optional[float] = None
    valuation_source: str = "manual"
    notes: Optional[str] = None


class PriceReferenceCreate(BaseModel):
    cidade: str
    bairro: Optional[str] = None
    preco_m2: float
    source: str = "manual"


class ManualAssetCreate(BaseModel):
    name: str
    asset_type: str = "other"
    currency: str = "BRL"
    notes: Optional[str] = None
    institution_name: Optional[str] = None
    quantity: Optional[float] = None
    current_value: float
    owner: Optional[str] = None


class ManualAssetHistoryOut(BaseModel):
    date: date
    value: float

    model_config = {"from_attributes": True}


class DividendCreate(BaseModel):
    asset_id: int
    payment_date: date
    amount: float
    dividend_type: str = "dividendo"  # dividendo/jcp/rendimento_fii/amortizacao/bonificacao
    currency: str = "USD"
    notes: Optional[str] = None
