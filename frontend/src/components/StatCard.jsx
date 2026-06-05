const ICON_STYLE = {
  blue:   { bg: "#eff6ff", color: "#2563eb" },
  green:  { bg: "#f0fdf4", color: "#16a34a" },
  yellow: { bg: "#fff7ed", color: "#ea580c" },
  red:    { bg: "#fef2f2", color: "#dc2626" },
  purple: { bg: "#faf5ff", color: "#9333ea" },
};

const VALUE_COLOR = {
  blue:   "text-blue-600",
  green:  "text-green-600",
  yellow: "text-orange-600",
  red:    "text-red-600",
  purple: "text-purple-600",
};

const SUB_COLOR = {
  blue:  "text-blue-500",
  green: "text-green-500",
  red:   "text-red-500",
};

export default function StatCard({ title, value, sub, subColor, color = "blue", trend, icon: Icon }) {
  const ic = ICON_STYLE[color] || ICON_STYLE.blue;
  const subCls = subColor ? (SUB_COLOR[subColor] || "text-gray-400") : "text-gray-400";
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-2 font-medium">{title}</p>
          <p className={`text-2xl font-bold leading-tight ${VALUE_COLOR[color] || VALUE_COLOR.blue}`}>
            {value}
          </p>
          {sub && <p className={`text-xs mt-1 font-medium ${subCls}`}>{sub}</p>}
          {trend !== undefined && (
            <p className={`text-xs mt-1.5 font-semibold ${trend >= 0 ? "text-green-600" : "text-red-500"}`}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend).toFixed(2)}%
            </p>
          )}
        </div>
        {Icon && (
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: ic.bg }}
          >
            <Icon size={18} style={{ color: ic.color }} />
          </div>
        )}
      </div>
    </div>
  );
}
