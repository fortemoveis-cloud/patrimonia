import { useEffect, useState } from "react";
import { getMaturityAlerts } from "../api/client";
import { Bell, AlertTriangle, Info, Clock } from "lucide-react";
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

export default function Alerts() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getMaturityAlerts()
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const items    = data?.items ?? [];
  const critical = data?.critical ?? 0;
  const warning  = data?.warning  ?? 0;
  const info     = data?.info     ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 md:pt-6 pb-4"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "#fef2f2" }}>
            <Bell size={18} style={{ color: "#dc2626" }} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">Alertas de Vencimento</h2>
            <p className="text-gray-400 text-sm">Títulos vencendo nos próximos 90 dias</p>
          </div>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-3">
        {[
          { label: `${critical} vencendo em até 30 dias`, color: "#dc2626", bg: "#fef2f2" },
          { label: `${warning} vencendo em 31–60 dias`,   color: "#d97706", bg: "#fffbeb" },
          { label: `${info} vencendo em 61–90 dias`,      color: "#2563eb", bg: "#eff6ff" },
        ].map(({ label, color, bg }) => (
          <div key={label} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium"
            style={{ background: bg, color }}>
            {label}
          </div>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#f0fdf4" }}>
            <Bell size={24} style={{ color: "#16a34a" }} />
          </div>
          <p className="text-gray-600 font-medium">Nenhum vencimento nos próximos 90 dias</p>
          <p className="text-gray-400 text-sm mt-1">Sua carteira está tranquila por enquanto.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const sev = SEVERITY[item.severity];
            const SevIcon = sev.icon;
            return (
              <div
                key={item.asset_id}
                className="card cursor-pointer hover:shadow-md transition-all"
                style={{ borderLeft: `4px solid ${sev.text}` }}
                onClick={() => navigate(`/asset/${item.asset_id}`)}
              >
                <div className="flex items-start gap-4">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: sev.bg }}>
                    <SevIcon size={16} style={{ color: sev.text }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="font-bold text-gray-800 truncate">{item.asset_name}</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: sev.bg, color: sev.text }}>
                        {item.days_remaining === 0 ? "Hoje!" : `${item.days_remaining} dias`}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">{item.institution_name} · {TYPE_LABELS[item.asset_type] || item.asset_type}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-gray-800">
                      {fmtMoney(item.market_value, item.currency)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      vence em {new Date(item.maturity_date + "T12:00:00").toLocaleDateString("pt-BR")}
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
