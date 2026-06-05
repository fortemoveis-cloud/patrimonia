import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getAsset, getHistory } from "../api/client";
import AreaChart from "../components/AreaChart";
import StatCard from "../components/StatCard";
import { ArrowLeft } from "lucide-react";

const TYPE_LABELS = {
  equity: "Renda Variável",
  fixed_income: "Renda Fixa",
  cash: "Caixa",
  fund: "Fundos",
  other: "Outros",
};

const fmt = (v, currency = "USD") => {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v);
};

const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const assetId = parseInt(id, 10);

  const [asset, setAsset] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([getAsset(assetId), getHistory("institution", assetId)])
      .then(([assetRes, histRes]) => {
        setAsset(assetRes.data);
        setHistory(histRes.data);
      })
      .catch((e) => setError(e.response?.data?.detail || e.message || "Erro ao carregar"))
      .finally(() => setLoading(false));
  }, [assetId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="card text-center py-16">
        <p className="text-red-400">{error || "Ativo não encontrado."}</p>
        <button onClick={() => navigate(-1)} className="btn-secondary mt-4 text-sm">
          Voltar
        </button>
      </div>
    );
  }

  const snap = asset.latest_snapshot;
  const currency = asset.currency;
  const gain = snap?.market_value != null && snap?.cost_basis != null
    ? snap.market_value - snap.cost_basis
    : null;
  const gainPct = gain != null && snap.cost_basis
    ? (gain / snap.cost_basis) * 100
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 mb-4 transition-colors"
        >
          <ArrowLeft size={14} />
          Voltar à Carteira
        </button>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white break-words">{asset.name}</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              {asset.institution_name}
              {asset.identifier && (
                <span className="ml-2 font-mono text-xs bg-gray-800 px-1.5 py-0.5 rounded">
                  {asset.identifier}
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <span className="badge bg-gray-700 text-gray-300 text-xs">
              {TYPE_LABELS[asset.asset_type] || asset.asset_type}
            </span>
            <span className="badge bg-gray-700 text-gray-300 text-xs font-mono">
              {currency}
            </span>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      {snap && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title={`Valor Atual (${currency})`}
            value={fmt(snap.market_value, currency)}
            color="blue"
          />
          <StatCard
            title={`Custo (${currency})`}
            value={fmt(snap.cost_basis, currency)}
            color="yellow"
          />
          {gain !== null && (
            <StatCard
              title="Ganho / Perda"
              value={`${gain >= 0 ? "+" : ""}${fmt(gain, currency)}`}
              sub={gainPct !== null ? `${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(2)}% sobre custo` : undefined}
              color={gain >= 0 ? "green" : "red"}
              trend={gainPct ?? undefined}
            />
          )}
          {snap.estimated_income != null && (
            <StatCard
              title="Renda Anual Est."
              value={fmt(snap.estimated_income, currency)}
              color="purple"
            />
          )}
        </div>
      )}

      {/* Detail fields */}
      {snap && (
        snap.maturity_date ||
        snap.accrued_income != null ||
        snap.current_yield != null ||
        snap.units != null ||
        snap.price != null ||
        snap.portfolio_name
      ) && (
        <div className="card">
          <p className="text-sm font-medium text-gray-400 mb-4">Detalhes do Ativo</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {snap.maturity_date && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Vencimento</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">{snap.maturity_date}</p>
              </div>
            )}
            {snap.accrued_income != null && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Juros Acumulados</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">{fmt(snap.accrued_income, currency)}</p>
              </div>
            )}
            {snap.current_yield != null && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Yield Corrente</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">{fmtPct(snap.current_yield)}</p>
              </div>
            )}
            {snap.units != null && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Unidades</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">
                  {snap.units.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}
                </p>
              </div>
            )}
            {snap.price != null && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Preço</p>
                <p className="text-sm text-gray-200 font-mono mt-0.5">{fmt(snap.price, currency)}</p>
              </div>
            )}
            {snap.portfolio_name && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Portfólio</p>
                <p className="text-sm text-gray-200 mt-0.5">{snap.portfolio_name}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Última Atualização</p>
              <p className="text-sm text-gray-200 mt-0.5">{snap.snapshot_date}</p>
            </div>
          </div>
        </div>
      )}

      {/* History chart */}
      {history?.dates?.length > 1 ? (
        <AreaChart
          dates={history.dates}
          series={history.series}
          title="Evolução Histórica (USD)"
        />
      ) : (
        <div className="card text-center py-10">
          <p className="text-gray-500 text-sm">
            {history?.dates?.length === 1
              ? "Apenas um ponto histórico. Importe arquivos de datas diferentes para ver a evolução."
              : "Sem histórico disponível para este ativo."}
          </p>
        </div>
      )}
    </div>
  );
}
