import { useEffect, useState } from "react";
import { getSummary, getDates, getLoanSummary, getPropertySummary, getMaturityAlerts, getRiskAnalysis, getProjections, getImportStats, downloadPdf } from "../api/client";
import StatCard from "../components/StatCard";
import DonutChart from "../components/DonutChart";
import { Wallet, ShoppingCart, TrendingUp, TrendingDown, CreditCard, Home, Building2, AlertTriangle, FileDown, BarChart2, Activity, DollarSign, Banknote, PiggyBank, Tag } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";

const TYPE_LABELS_RISK = {
  equity: "Renda Variável", fixed_income: "Renda Fixa",
  cash: "Caixa", fund: "Fundos", other: "Outros",
};

const fmt = (v, currency = "USD") =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v ?? 0);

const TYPE_LABELS = {
  equity: "Renda Variável",
  fixed_income: "Renda Fixa",
  cash: "Caixa",
  fund: "Fundos",
  other: "Outros",
};

export default function Dashboard() {
  const [summary, setSummary]           = useState(null);
  const [loanSummary, setLoanSummary]   = useState(null);
  const [propSummary, setPropSummary]   = useState(null);
  const [alerts, setAlerts]             = useState(null);
  const [riskData, setRiskData]         = useState(null);
  const [projData, setProjData]         = useState(null);
  const [importStats, setImportStats]   = useState(null);
  const [dates, setDates]               = useState([]);
  const [selected, setSelected]         = useState(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    getDates().then((r) => { setDates(r.data); });
    getLoanSummary().then((r) => setLoanSummary(r.data)).catch(() => {});
    getPropertySummary().then((r) => setPropSummary(r.data)).catch(() => {});
    getMaturityAlerts().then((r) => setAlerts(r.data)).catch(() => {});
    getRiskAnalysis().then((r) => setRiskData(r.data)).catch(() => {});
    getProjections().then((r) => setProjData(r.data)).catch(() => {});
    getImportStats().then((r) => setImportStats(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getSummary(selected)
      .then((r) => setSummary(r.data))
      .finally(() => setLoading(false));
  }, [selected]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!summary?.latest_date) {
    return (
      <div className="card text-center py-16">
        <p className="text-gray-400 text-lg">Nenhum dado encontrado.</p>
        <p className="text-gray-400 text-sm mt-2">
          Importe arquivos na aba <strong className="text-gray-600">Importar</strong>.
        </p>
      </div>
    );
  }

  // ── Currency splits ──────────────────────────────────────────────────────────
  const usdCurr    = summary.by_currency?.find((c) => c.currency === "USD") ?? {};
  const brlCurr    = summary.by_currency?.find((c) => c.currency === "BRL") ?? {};

  const investUSD    = usdCurr.market_value_usd ?? 0;
  const investUSDBRL = usdCurr.market_value_brl ?? 0;
  const investBRL    = brlCurr.market_value_brl ?? 0;
  const investBRLUSD = brlCurr.market_value_usd ?? 0;

  const cbUSD    = usdCurr.cost_basis_usd ?? 0;
  const cbUSDBRL = usdCurr.cost_basis_brl ?? 0;
  const cbBRL    = brlCurr.cost_basis_brl ?? 0;
  const cbBRLUSD = brlCurr.cost_basis_usd ?? 0;

  const gainBRL = summary.total_market_value_brl - (summary.total_cost_basis_brl ?? 0);
  const gainUSD = summary.total_market_value_usd - summary.total_cost_basis_usd;
  const gainPct = (summary.total_cost_basis_brl ?? 0) > 0
    ? (gainBRL / (summary.total_cost_basis_brl ?? 1)) * 100
    : 0;

  // ── Properties ───────────────────────────────────────────────────────────────
  const loanUSD = loanSummary?.total_usd ?? 0;
  const loanBRL = loanSummary?.total_brl ?? 0;
  const propUSD = propSummary?.total_usd ?? 0;
  const propBRL = propSummary?.total_brl ?? 0;

  const propBRLBrasil = propSummary?.total_brl_brasil ?? 0;
  const propUSDUsa    = propSummary?.total_usd_usa    ?? 0;
  const propBRLUsa    = propSummary?.total_brl_usa    ?? 0;

  const gainPropBRLBrasil = propSummary?.gain_brl_brasil ?? 0;
  const gainPropUSDUsa    = propSummary?.gain_usd_usa    ?? 0;
  const gainPropBRLUsa    = propSummary?.gain_brl_usa    ?? 0;

  const netUSD = summary.total_market_value_usd + propUSD - loanUSD;
  const netBRL = summary.total_market_value_brl + propBRL - loanBRL;

  const hasBothCountries = propSummary && propSummary.count_brasil > 0 && propSummary.count_usa > 0;
  const distData = [
    { name: "Invest. Financeiros", value: summary.total_market_value_usd, value_brl: summary.total_market_value_brl },
    ...(hasBothCountries
      ? [
          { name: "Imóveis 🇧🇷 Brasil", value: (propSummary.total_brl_brasil || 0) / (propUSD > 0 ? propBRL / propUSD : 5), value_brl: propSummary.total_brl_brasil || 0 },
          { name: "Imóveis 🇺🇸 EUA",    value: propSummary.total_usd_usa || 0, value_brl: propSummary.total_brl_usa || 0 },
        ]
      : propUSD > 0 ? [{ name: "Imóveis", value: propUSD, value_brl: propBRL }] : []
    ),
    ...(loanUSD > 0 ? [{ name: "(−) Empréstimos", value: loanUSD, value_brl: loanBRL }] : []),
  ];

  const byTypeData = summary.by_asset_type.map((d) => ({
    name: TYPE_LABELS[d.type] || d.type,
    value: Math.abs(d.market_value_usd),
    value_brl: Math.abs(d.market_value_brl),
  }));

  const byInstData = summary.by_institution.map((d) => ({
    name: d.name,
    value: Math.abs(d.market_value_usd),
    value_brl: Math.abs(d.market_value_brl),
  }));

  const fmtUSD = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v ?? 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-4 flex items-center justify-between"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-800">Dashboard</h2>
          <p className="text-gray-400 text-sm">Posição consolidada</p>
        </div>
        <div className="flex items-center gap-2">
          {dates.length > 0 && (
            <select
              value={selected || ""}
              onChange={(e) => setSelected(e.target.value || null)}
              className="input-base"
            >
              <option value="">Atual</option>
              {dates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <button onClick={() => downloadPdf(selected)} className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5">
            <FileDown size={13} /> PDF
          </button>
        </div>
      </div>

      {/* Import error banner */}
      {importStats && importStats.last_import_status && importStats.last_import_status !== "success" && (
        <div
          className="rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:opacity-90 transition-opacity"
          style={{ background: "#fef2f2", border: "1px solid #fecaca" }}
          onClick={() => window.location.href = "/logs"}
        >
          <Activity size={18} style={{ color: "#dc2626", flexShrink: 0 }} />
          <p className="text-sm font-medium text-red-700">
            {importStats.last_import_status === "error"
              ? "Última importação falhou."
              : "Última importação foi concluída com erros parciais."}
            {" "}<span className="underline">Ver logs →</span>
          </p>
        </div>
      )}

      {/* Alert banner */}
      {alerts && (alerts.critical > 0 || alerts.warning > 0) && (
        <div
          className="rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:opacity-90 transition-opacity"
          style={{ background: alerts.critical > 0 ? "#fef2f2" : "#fffbeb", border: `1px solid ${alerts.critical > 0 ? "#fecaca" : "#fde68a"}` }}
          onClick={() => window.location.href = "/alerts"}
        >
          <AlertTriangle size={18} style={{ color: alerts.critical > 0 ? "#dc2626" : "#d97706", flexShrink: 0 }} />
          <p className="text-sm font-medium" style={{ color: alerts.critical > 0 ? "#dc2626" : "#d97706" }}>
            {alerts.critical > 0
              ? `${alerts.critical} título(s) vencendo em até 30 dias!`
              : `${alerts.warning} título(s) vencendo em 31–60 dias.`}
            {" "}<span className="underline">Ver alertas →</span>
          </p>
        </div>
      )}

      {/* Stale-data banner */}
      {summary?.stale_sources && !selected && (
        <div
          className="rounded-xl px-4 py-3 flex items-center gap-3"
          style={{ background: "#fff7ed", border: "1px solid #fed7aa" }}
        >
          <AlertTriangle size={18} style={{ color: "#c2410c", flexShrink: 0 }} />
          <p className="text-sm font-medium text-orange-700">
            Parte dos dados está desatualizada — algumas instituições exibem a última posição conhecida (marcadas em vermelho abaixo).
          </p>
        </div>
      )}

      {/* ── LINHA 1: Investimentos Financeiros ─────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Investimentos Financeiros</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Invest. Financeiros (USD)"
            value={fmt(investUSD, "USD")}
            sub={fmt(investUSDBRL, "BRL")}
            subColor="green"
            color="blue"
            icon={DollarSign}
          />
          <StatCard
            title="Invest. Financeiros (BRL)"
            value={fmt(investBRL, "BRL")}
            sub={fmt(investBRLUSD, "USD")}
            subColor="blue"
            color="green"
            icon={Banknote}
          />
          <StatCard
            title="Total Investido"
            value={fmt(summary.total_market_value_brl, "BRL")}
            sub={fmt(summary.total_market_value_usd, "USD")}
            subColor="blue"
            color="green"
            icon={Wallet}
          />
        </div>
      </div>

      {/* ── LINHA 2: Custos e Ganhos ─────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Custos e Ganhos</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Custo Aquisição (USD)"
            value={fmt(cbUSD, "USD")}
            sub={fmt(cbUSDBRL, "BRL")}
            subColor="green"
            color="blue"
            icon={Tag}
          />
          <StatCard
            title="Custo Aquisição (BRL)"
            value={fmt(cbBRL, "BRL")}
            sub={fmt(cbBRLUSD, "USD")}
            subColor="blue"
            color="green"
            icon={Tag}
          />
          <StatCard
            title="Ganhos Não Realizados"
            value={fmt(Math.abs(gainBRL), "BRL")}
            sub={`${fmt(Math.abs(gainUSD), "USD")} · ${gainPct.toFixed(2)}% s/ custo`}
            subColor={gainBRL >= 0 ? "blue" : "red"}
            color={gainBRL >= 0 ? "green" : "red"}
            trend={gainPct}
            icon={gainBRL >= 0 ? TrendingUp : TrendingDown}
          />
        </div>
      </div>

      {/* ── LINHA 3: Patrimônio Completo ─────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Patrimônio Completo</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Imóveis (BRL)"
            value={fmt(propBRLBrasil, "BRL")}
            sub={propSummary?.count_brasil ? `${propSummary.count_brasil} imóvel(eis) · ${fmt(propBRLBrasil / ((propBRL / propUSD) || 5), "USD")}` : fmt(0, "USD")}
            subColor="blue"
            color="green"
            icon={Home}
          />
          <StatCard
            title="Imóveis (USD)"
            value={fmt(propUSDUsa, "USD")}
            sub={propSummary?.count_usa ? `${propSummary.count_usa} imóvel(eis) · ${fmt(propBRLUsa, "BRL")}` : fmt(0, "BRL")}
            subColor="green"
            color="blue"
            icon={Building2}
          />
          <StatCard
            title="Total Empréstimos (USD)"
            value={fmt(loanUSD, "USD")}
            sub={loanSummary ? `${loanSummary.active_count} posição(ões) · ${fmt(loanBRL, "BRL")}` : "—"}
            subColor="green"
            color="red"
            icon={CreditCard}
          />
          <StatCard
            title="Patrimônio Total (USD)"
            value={fmt(Math.abs(netUSD), "USD")}
            sub={`Invest. + Imóveis − Dívidas · ${fmt(Math.abs(netBRL), "BRL")}`}
            subColor="green"
            color={netUSD >= 0 ? "green" : "red"}
            trend={(summary.total_market_value_usd + propUSD) > 0 ? (netUSD / (summary.total_market_value_usd + propUSD)) * 100 : 0}
            icon={PiggyBank}
          />
        </div>
      </div>

      {/* ── LINHA 4: Ganhos de Imóveis (só se houver imóveis) ─────────── */}
      {propSummary && propSummary.active_count > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Ganhos Detalhados — Imóveis</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {propSummary.count_brasil > 0 && (
              <StatCard
                title="Ganho Imóveis (BRL)"
                value={fmt(Math.abs(gainPropBRLBrasil), "BRL")}
                sub={fmt(Math.abs(gainPropBRLBrasil / ((propBRL / propUSD) || 5)), "USD")}
                subColor={gainPropBRLBrasil >= 0 ? "blue" : "red"}
                color={gainPropBRLBrasil >= 0 ? "green" : "red"}
                icon={gainPropBRLBrasil >= 0 ? TrendingUp : TrendingDown}
              />
            )}
            {propSummary.count_usa > 0 && (
              <StatCard
                title="Ganho Imóveis (USD)"
                value={fmt(Math.abs(gainPropUSDUsa), "USD")}
                sub={fmt(Math.abs(gainPropBRLUsa), "BRL")}
                subColor={gainPropUSDUsa >= 0 ? "green" : "red"}
                color={gainPropUSDUsa >= 0 ? "green" : "red"}
                icon={gainPropUSDUsa >= 0 ? TrendingUp : TrendingDown}
              />
            )}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DonutChart data={byTypeData} nameKey="name" valueKey="value" title="Alocação por Tipo de Ativo" />
        <div>
          <DonutChart data={byInstData} nameKey="name" valueKey="value" title="Alocação por Instituição" />
          {!selected && summary.by_institution.some((d) => d.stale) && (
            <div className="mt-2 space-y-1 px-1">
              {summary.by_institution.filter((d) => d.stale).map((d, i) => {
                const [, m, day] = (d.snapshot_date || "").split("-");
                return (
                  <div key={i} className="flex items-center gap-2 text-xs" style={{ color: "#dc2626" }}>
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "#dc2626" }} />
                    <span><strong>{d.name}</strong> — posição de {day}/{m}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {distData.length > 1 && (
        <DonutChart
          data={distData}
          nameKey="name"
          valueKey="value"
          title="Distribuição do Patrimônio"
          colors={["#2196f3", "#9333ea", "#dc2626"]}
        />
      )}

      {/* ── Concentração de Risco ─────────────────────────────────────── */}
      {riskData && riskData.total_usd > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={16} style={{ color: "#4a148c" }} />
            <p className="text-sm font-semibold text-gray-700">Concentração de Risco</p>
          </div>

          {riskData.alerts.length > 0 && (
            <div className="space-y-2 mb-4">
              {riskData.alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                  style={{ background: "#fffbeb", color: "#d97706" }}>
                  <AlertTriangle size={13} />
                  <span>
                    <strong>{a.type === "institution" ? a.name : a.type === "asset_type" ? (TYPE_LABELS_RISK[a.name] || a.name) : a.name}</strong>
                    {" "}representa <strong>{a.pct}%</strong> do portfólio (limite: {a.threshold}%)
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Por Instituição</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={riskData.by_institution.slice(0, 6)} layout="vertical" margin={{ left: 0, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={90} />
                  <Tooltip formatter={(v) => [`${v}%`, "Concentração"]} />
                  <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                    {riskData.by_institution.slice(0, 6).map((entry, i) => (
                      <Cell key={i} fill={entry.pct > 20 ? "#f59e0b" : "#4a148c"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Top 10 Posições</p>
              <div className="space-y-1.5">
                {riskData.top_positions.slice(0, 8).map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-700 truncate">{p.name}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="w-16 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (p.value_usd / riskData.total_usd) * 100)}%`, background: "#4a148c" }} />
                      </div>
                      <span className="text-xs text-gray-500 w-10 text-right">{((p.value_usd / riskData.total_usd) * 100).toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Renda Projetada (12 meses) ────────────────────────────────── */}
      {projData && (projData.total_annual_usd > 0 || projData.total_maturities_usd > 0) && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} style={{ color: "#4a148c" }} />
              <p className="text-sm font-semibold text-gray-700">Renda Projetada — Próximos 12 Meses</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
              {projData.total_fixed_usd > 0 && (
                <span>Juros: <strong className="text-blue-600">{fmtUSD(projData.total_fixed_usd)}</strong></span>
              )}
              {projData.total_dividends_usd > 0 && (
                <span>Dividendos: <strong className="text-green-600">{fmtUSD(projData.total_dividends_usd)}</strong></span>
              )}
              <span>Vencimentos: <strong style={{ color: "#16a34a" }}>{fmtUSD(projData.total_maturities_usd)}</strong></span>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={projData.months.map((m, i) => ({
              month:      m.slice(5) + "/" + m.slice(2, 4),
              juros:      projData.income_fixed?.[i]    ?? projData.income[i],
              dividendos: projData.income_dividends?.[i] ?? 0,
              maturity:   projData.maturities[i],
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v, n) => [
                fmtUSD(v),
                n === "juros" ? "Juros / Renda Fixa" : n === "dividendos" ? "Dividendos / FII" : "Vencimentos",
              ]} />
              <Legend formatter={(v) => (
                <span style={{ fontSize: 11 }}>
                  {v === "juros" ? "Juros Renda Fixa" : v === "dividendos" ? "Dividendos/FII" : "Vencimentos"}
                </span>
              )} />
              <Bar dataKey="juros"      stackId="income" fill="#2196f3" radius={[0, 0, 0, 0]} />
              <Bar dataKey="dividendos" stackId="income" fill="#4caf50" radius={[4, 4, 0, 0]} />
              <Bar dataKey="maturity"   fill="#9c27b0"  radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>

          {projData.events.length > 0 && (
            <div className="mt-4 pt-4" style={{ borderTop: "1px solid #f3f4f6" }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Próximos vencimentos</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {projData.events.slice(0, 8).map((ev, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">{ev.month} · {ev.asset_name}</span>
                    <span className="font-mono font-medium text-green-600">{fmtUSD(ev.amount_usd)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
