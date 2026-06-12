import { useEffect, useState } from "react";
import { getMaturityAlerts, getDropAlerts } from "../api/client";
import { Bell, AlertTriangle, Info, Clock, TrendingDown } from "lucide-react";
import { useNavigate } from "react-router-dom";

const SEVERITY = {
  critical: { label: "Vence em ≤ 30 dias", bg: "#fef2f2", border: "#fecaca", text: "#dc2626", icon: AlertTriangle },
  warning:  { label: "Vence em 31–60 dias", bg: "#fffbeb", border: "#fde68a", text: "#d97706", icon: Clock },
  info:     { label: "Vence em 61–90 dias", bg: "#eff6ff", border: "#bfdbfe", text: "#2563eb", icon: Info },
};

const TYPE_LABELS = {
  equity: "Renda Variável", fixed_income: "Renda Fixa",
  cash: "Caixa", fund: "Fundos", other: "Outros",
};

const fmtMoney = (v, currency = "USD") =>
  v != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 0 }).format(v)
    : "—";

function VencimentosTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getMaturityAlerts()
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;

  const items    = data?.items ?? [];
  const critical = data?.critical ?? 0;
  const warning  = data?.warning  ?? 0;
  const info     = data?.info     ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {[
          { label: `${critical} vencendo em até 30 dias`, color: "#dc2626", bg: "#fef2f2" },
          { label: `${warning} vencendo em 31–60 dias`,   color: "#d97706", bg: "#fffbeb" },
          { label: `${info} vencendo em 61–90 dias`,      color: "#2563eb", bg: "#eff6ff" },
        ].map(({ label, color, bg }) => (
          <div key={label} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium" style={{ background: bg, color }}>{label}</div>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="card text-center py-16">
          <Bell size={24} className="mx-auto mb-3 text-green-500" />
          <p className="text-gray-600 font-medium">Nenhum vencimento nos próximos dias</p>
          <p className="text-gray-400 text-sm mt-1">Sua carteira está tranquila por enquanto.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const sev = SEVERITY[item.severity];
            const SevIcon = sev.icon;
            return (
              <div key={item.asset_id} className="card cursor-pointer hover:shadow-md transition-all" style={{ borderLeft: `4px solid ${sev.text}` }}
                onClick={() => navigate(`/asset/${item.asset_id}`)}>
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: sev.bg }}>
                    <SevIcon size={16} style={{ color: sev.text }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-bold text-gray-800 truncate">{item.asset_name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: sev.bg, color: sev.text }}>
                        {item.days_remaining === 0 ? "Hoje!" : `${item.days_remaining} dias`}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{item.institution_name} · {TYPE_LABELS[item.asset_type] || item.asset_type}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-800">{fmtMoney(item.market_value, item.currency)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">vence em {new Date(item.maturity_date + "T12:00:00").toLocaleDateString("pt-BR")}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuedasTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getDropAlerts()
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><div className="w-7 h-7 border-2 border-red-500 border-t-transparent rounded-full animate-spin" /></div>;

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      {data && (
        <p className="text-xs text-gray-400">
          Comparando {data.date_before} → {data.date_after} · threshold: {data.threshold_pct}%
        </p>
      )}
      {items.length === 0 ? (
        <div className="card text-center py-16">
          <TrendingDown size={24} className="mx-auto mb-3 text-green-500" />
          <p className="text-gray-600 font-medium">Nenhuma queda detectada</p>
          <p className="text-gray-400 text-sm mt-1">Todos os ativos estão estáveis ou em alta.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isAnomaly = item.anomaly_type === "fixed_income_drop";
            const borderColor = isAnomaly ? "#d97706" : "#dc2626";
            const bgColor     = isAnomaly ? "#fffbeb" : "#fef2f2";
            return (
              <div key={item.asset_id} className="card cursor-pointer hover:shadow-md transition-all" style={{ borderLeft: `4px solid ${borderColor}` }}
                onClick={() => navigate(`/asset/${item.asset_id}`)}>
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: bgColor }}>
                    <TrendingDown size={16} style={{ color: borderColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-bold text-gray-800 truncate">{item.asset_name}</p>
                      {isAnomaly && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">anomalia RF</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{item.institution_name} · {TYPE_LABELS[item.asset_type] || item.asset_type}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{item.date_before} → {item.date_after}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-red-600">−{item.drop_pct.toFixed(2)}%</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {fmtMoney(item.value_before, item.currency)} → {fmtMoney(item.value_after, item.currency)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Alerts() {
  const [tab, setTab] = useState("vencimentos");

  const tabs = [
    { key: "vencimentos", label: "Vencimentos", icon: Bell },
    { key: "quedas",      label: "Quedas",      icon: TrendingDown },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 md:pt-6 pb-4"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#fef2f2" }}>
            <Bell size={18} style={{ color: "#dc2626" }} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Alertas</h2>
            <p className="text-gray-400 text-sm">Vencimentos próximos e quedas detectadas</p>
          </div>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === key ? "bg-white shadow-sm text-gray-800" : "text-gray-500 hover:text-gray-700"
              }`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </div>
      </div>

      {tab === "vencimentos" ? <VencimentosTab /> : <QuedasTab />}
    </div>
  );
}
