import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const fmtUSD = (v) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v ?? 0);

const fmtBRL = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);

const fmtTick = (s) => {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${d}/${months[parseInt(m, 10) - 1] || m}/${y.slice(2)}`;
};

const CustomTooltip = ({ active, payload, label, assetCurrency }) => {
  if (!active || !payload?.length) return null;
  const usd  = payload.find((p) => p.dataKey === "total_usd")?.value;
  const brl  = payload.find((p) => p.dataKey === "total_brl")?.value;
  const rate = payload[0]?.payload?.usd_brl_rate;
  const [y, m, d] = (label || "").split("-");
  const dateStr = y && m && d ? `${d}/${m}/${y}` : label;
  const brlFirst = assetCurrency === "BRL";

  return (
    <div style={{
      background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
      padding: "12px 16px", boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 215,
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#4b5563", marginBottom: 10 }}>{dateStr}</p>
      {brlFirst ? (
        <>
          {brl  != null && <p style={{ fontSize: 13, color: "#4caf50", fontWeight: 500, marginBottom: 4 }}>{fmtBRL(brl)}</p>}
          {usd  != null && <p style={{ fontSize: 13, color: "#2196f3", fontWeight: 500, marginBottom: 4 }}>{fmtUSD(usd)}</p>}
        </>
      ) : (
        <>
          {usd  != null && <p style={{ fontSize: 13, color: "#2196f3", fontWeight: 500, marginBottom: 4 }}>{fmtUSD(usd)}</p>}
          {brl  != null && <p style={{ fontSize: 13, color: "#4caf50", fontWeight: 500, marginBottom: 4 }}>{fmtBRL(brl)}</p>}
        </>
      )}
      {rate != null && (
        <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 6, paddingTop: 6, borderTop: "1px solid #f3f4f6" }}>
          Cotação do dia: R$ {rate.toFixed(2)}
        </p>
      )}
    </div>
  );
};

export default function AreaChart({ points = [], title, assetCurrency }) {
  const usdPrimary = !assetCurrency || assetCurrency === "USD";

  return (
    <div className="card">
      {title && <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={points} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradUSD" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#2196f3" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#2196f3" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradBRL" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#4caf50" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#4caf50" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtTick}
            tick={{ fill: "#9ca3af", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="usd"
            orientation={usdPrimary ? "left" : "right"}
            tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            tick={{ fill: "#2196f3", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={62}
          />
          <YAxis
            yAxisId="brl"
            orientation={usdPrimary ? "right" : "left"}
            tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
            tick={{ fill: "#4caf50", fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={66}
          />
          <Tooltip content={<CustomTooltip assetCurrency={assetCurrency} />} />
          <Legend
            formatter={(v) => (
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                {v === "total_usd" ? "USD" : "BRL"}
              </span>
            )}
          />
          <Area
            yAxisId="usd"
            type="monotone"
            dataKey="total_usd"
            stroke="#2196f3"
            fill="url(#gradUSD)"
            strokeWidth={usdPrimary ? 2.5 : 1.5}
            name="total_usd"
            dot={false}
            activeDot={{ r: 4, fill: "#2196f3" }}
          />
          <Area
            yAxisId="brl"
            type="monotone"
            dataKey="total_brl"
            stroke="#4caf50"
            fill="url(#gradBRL)"
            strokeWidth={usdPrimary ? 1.5 : 2.5}
            name="total_brl"
            dot={false}
            activeDot={{ r: 4, fill: "#4caf50" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
