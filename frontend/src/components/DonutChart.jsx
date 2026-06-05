import { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

const DEFAULT_COLORS = ["#2196f3", "#4caf50", "#ff9800", "#9c27b0", "#f44336", "#00bcd4", "#ff5722"];

const fmtUSD = (v) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v ?? 0);

const fmtBRL = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const { name, value, payload: item } = payload[0];
  const brl = item?.value_brl ?? null;
  return (
    <div
      className="bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm"
      style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.12)", minWidth: 160 }}
    >
      <p className="font-semibold text-gray-800 mb-1.5">{name}</p>
      <p className="text-blue-600 font-medium">{fmtUSD(value)}</p>
      {brl != null && <p className="text-green-600 font-medium mt-0.5">{fmtBRL(brl)}</p>}
    </div>
  );
};

export default function DonutChart({ data, nameKey = "name", valueKey = "value", title, colors }) {
  const COLORS = colors || DEFAULT_COLORS;
  const [selectedIdx, setSelectedIdx] = useState(null);

  const mapped = data.map((d) => ({
    name: d[nameKey],
    value: d[valueKey],
    value_brl: d.value_brl ?? null,
  }));

  const total = mapped.reduce((s, d) => s + (d.value || 0), 0);
  const sel = selectedIdx !== null ? mapped[selectedIdx] : null;

  const handleClick = (_, index) => setSelectedIdx((p) => (p === index ? null : index));

  return (
    <div className="card">
      {title && <p className="text-sm font-semibold text-gray-700 mb-4">{title}</p>}
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={mapped}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
            onClick={handleClick}
            style={{ cursor: "pointer" }}
          >
            {mapped.map((_, i) => (
              <Cell
                key={i}
                fill={COLORS[i % COLORS.length]}
                opacity={selectedIdx === null || selectedIdx === i ? 1 : 0.3}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            formatter={(value) => (
              <span style={{ fontSize: 12, color: "#6b7280" }}>{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {sel && (
        <div className="mt-4 pt-4" style={{ borderTop: "1px solid #f3f4f6" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: COLORS[selectedIdx % COLORS.length] }}
              />
              <span className="text-sm font-semibold text-gray-800">{sel.name}</span>
            </div>
            <button
              onClick={() => setSelectedIdx(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1 transition-colors"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3" style={{ background: "#f8fafc" }}>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Valor em USD</p>
              <p className="text-lg font-bold text-gray-800 mt-1">{fmtUSD(sel.value)}</p>
            </div>
            {sel.value_brl != null && (
              <div className="rounded-lg p-3" style={{ background: "#f8fafc" }}>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Valor em BRL</p>
                <p className="text-lg font-bold text-gray-800 mt-1">{fmtBRL(sel.value_brl)}</p>
              </div>
            )}
          </div>
          {total > 0 && (
            <p className="text-xs text-gray-400 mt-2 text-right">
              {((sel.value / total) * 100).toFixed(1)}% do total
            </p>
          )}
        </div>
      )}
    </div>
  );
}
