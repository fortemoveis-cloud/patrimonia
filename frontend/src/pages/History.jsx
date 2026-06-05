import { useEffect, useState, useMemo } from "react";
import { getHistory, getAssets } from "../api/client";
import AreaChart from "../components/AreaChart";
import { Search } from "lucide-react";

const PERIODS = [
  { label: "7D",   days: 7   },
  { label: "30D",  days: 30  },
  { label: "90D",  days: 90  },
  { label: "6M",   days: 180 },
  { label: "1A",   days: 365 },
  { label: "Tudo", days: 0   },
];

const GROUP_OPTIONS = [
  { value: "institution", label: "Por Instituição" },
  { value: "currency",    label: "Por Moeda"       },
  { value: "asset_type",  label: "Por Tipo"        },
  { value: "asset",       label: "Por Título"      },
];

const TYPE_LABELS = {
  equity: "Renda Variável", fixed_income: "Renda Fixa",
  cash: "Caixa", fund: "Fundos", other: "Outros",
};

const fmtUSD = (v) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v ?? 0);

const fmtBRL = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);

function AssetPicker({ assets, selectedId, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);

  const filtered = useMemo(
    () =>
      assets
        .filter(
          (a) =>
            !query ||
            a.name.toLowerCase().includes(query.toLowerCase()) ||
            (a.institution_name || "").toLowerCase().includes(query.toLowerCase())
        )
        .slice(0, 20),
    [assets, query]
  );

  const selected = selectedId ? assets.find((a) => a.id === selectedId) : null;

  return (
    <div className="relative">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={open ? query : (selected?.name || "")}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setOpen(true); setQuery(""); }}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Buscar título..."
          className="input-base pl-8 w-72"
        />
      </div>
      {open && (
        <div
          className="absolute z-20 top-full mt-1 left-0 w-72 bg-white border border-gray-200 rounded-xl max-h-56 overflow-y-auto"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
        >
          {filtered.length === 0 ? (
            <p className="text-xs text-gray-400 p-3">Nenhum ativo encontrado</p>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                onMouseDown={() => { onSelect(a); setQuery(""); setOpen(false); }}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
              >
                <p className="text-sm text-gray-800 font-medium truncate">{a.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {a.institution_name} · {TYPE_LABELS[a.asset_type] || a.asset_type}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function History() {
  const [groupBy, setGroupBy]             = useState("institution");
  const [days, setDays]                   = useState(0);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [assets, setAssets]               = useState([]);
  const [history, setHistory]             = useState(null);
  const [loading, setLoading]             = useState(true);

  useEffect(() => {
    getAssets().then((r) => setAssets(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    if (groupBy === "asset" && !selectedAsset) {
      setHistory(null);
      setLoading(false);
      return;
    }
    getHistory(
      groupBy === "asset" ? selectedAsset?.id : null,
      groupBy !== "asset" ? groupBy           : null,
      days || null,
    )
      .then((r) => setHistory(r.data))
      .finally(() => setLoading(false));
  }, [groupBy, days, selectedAsset]);

  const points = useMemo(() => {
    if (!history?.dates?.length) return [];
    return history.dates.map((d, i) => ({
      date:         typeof d === "string" ? d : String(d),
      total_usd:    history.total_usd[i]     ?? 0,
      total_brl:    history.total_brl[i]     ?? 0,
      usd_brl_rate: history.usd_brl_rates[i] ?? null,
    }));
  }, [history]);

  // Series rows with human-readable labels
  const seriesRows = useMemo(
    () =>
      (history?.series || []).map((s) => ({
        ...s,
        label: groupBy === "asset_type" ? (TYPE_LABELS[s.name] || s.name) : s.name,
      })),
    [history?.series, groupBy]
  );
  const hasSeries = seriesRows.length > 0;

  const chartTitle =
    groupBy === "asset" && selectedAsset
      ? selectedAsset.name
      : ({ institution: "Por Instituição", currency: "Por Moeda", asset_type: "Por Tipo de Ativo" }[groupBy] ||
          "Patrimônio Total");

  const ACTIVE_PERIOD = "background:#4a148c;color:#fff";
  const IDLE_PERIOD   = "background:transparent;color:#6b7280";
  const ACTIVE_GROUP  = "background:#1a237e;color:#fff";
  const IDLE_GROUP    = "background:transparent;color:#6b7280";

  return (
    <div className="space-y-4">
      {/* ── Sticky header ──────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 -mx-6 px-6 pt-6 pb-4 space-y-3"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-800">Histórico</h2>
          <p className="text-gray-400 text-sm">Evolução patrimonial ao longo do tempo</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Period filter */}
          <div
            className="flex items-center gap-0.5 rounded-lg p-1"
            style={{ background: "#fff", border: "1px solid #e5e7eb" }}
          >
            {PERIODS.map(({ label, days: d }) => (
              <button
                key={label}
                onClick={() => setDays(d)}
                className="text-xs font-medium px-3 py-1.5 rounded-md transition-all"
                style={days === d ? { background: "#4a148c", color: "#fff" } : { background: "transparent", color: "#6b7280" }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Group-by filter */}
          <div
            className="flex items-center gap-0.5 rounded-lg p-1"
            style={{ background: "#fff", border: "1px solid #e5e7eb" }}
          >
            {GROUP_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => { setGroupBy(value); if (value !== "asset") setSelectedAsset(null); }}
                className="text-xs font-medium px-3 py-1.5 rounded-md transition-all"
                style={
                  groupBy === value
                    ? { background: "#1a237e", color: "#fff" }
                    : { background: "transparent", color: "#6b7280" }
                }
              >
                {label}
              </button>
            ))}
          </div>

          {/* Asset picker */}
          {groupBy === "asset" && (
            <>
              <AssetPicker
                assets={assets}
                selectedId={selectedAsset?.id ?? null}
                onSelect={setSelectedAsset}
              />
              {selectedAsset && (
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Limpar
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Chart ──────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : groupBy === "asset" && !selectedAsset ? (
        <div className="card text-center py-16">
          <p className="text-gray-500">Selecione um título para ver sua evolução histórica.</p>
        </div>
      ) : !points.length ? (
        <div className="card text-center py-16">
          <p className="text-gray-500">Nenhum dado histórico no período selecionado.</p>
          <p className="text-gray-400 text-sm mt-2">
            Tente ampliar o período ou importe arquivos de datas diferentes.
          </p>
        </div>
      ) : (
        <AreaChart
          points={points}
          title={chartTitle}
          assetCurrency={history?.asset_currency}
        />
      )}

      {/* ── Table ──────────────────────────────────────────────────── */}
      {points.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-6 py-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
            <p className="text-sm font-semibold text-gray-700">Tabela de Dados</p>
          </div>
          <div className="overflow-x-auto">
            {hasSeries ? (
              /* Breakdown table (Por Instituição / Por Tipo / Por Moeda) */
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs uppercase font-semibold"
                    style={{ borderBottom: "1px solid #f3f4f6", background: "#f8fafc" }}
                  >
                    <th className="text-left px-4 py-3 text-gray-400">Data</th>
                    {seriesRows.map((s) => (
                      <th key={s.name} className="text-right px-4 py-3 text-gray-500">
                        {s.label}
                      </th>
                    ))}
                    <th className="text-right px-4 py-3 text-gray-700">Total (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, i) => {
                    const total = seriesRows.reduce((sum, s) => sum + (s.data[i] ?? 0), 0);
                    return (
                      <tr
                        key={p.date}
                        className={`transition-colors hover:bg-[#eef2ff] ${i % 2 === 0 ? "bg-white" : "bg-[#f8f9fc]"}`}
                        style={{ borderBottom: "1px solid #f9fafb" }}
                      >
                        <td className="px-4 py-2.5 text-gray-600">{p.date}</td>
                        {seriesRows.map((s) => (
                          <td key={s.name} className="px-4 py-2.5 text-right font-mono text-gray-600 text-sm">
                            {fmtUSD(s.data[i] ?? 0)}
                          </td>
                        ))}
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-gray-800">
                          {fmtUSD(total)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              /* USD + BRL + Rate table (Por Título or total) */
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-xs uppercase font-semibold"
                    style={{ borderBottom: "1px solid #f3f4f6", background: "#f8fafc" }}
                  >
                    <th className="text-left px-4 py-3 text-gray-400">Data</th>
                    <th className="text-right px-4 py-3" style={{ color: "#2196f3" }}>USD</th>
                    <th className="text-right px-4 py-3" style={{ color: "#4caf50" }}>BRL</th>
                    <th className="text-right px-4 py-3 text-gray-400">Cotação</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p, i) => (
                    <tr
                      key={p.date}
                      className={`transition-colors hover:bg-[#eef2ff] ${i % 2 === 0 ? "bg-white" : "bg-[#f8f9fc]"}`}
                      style={{ borderBottom: "1px solid #f9fafb" }}
                    >
                      <td className="px-4 py-2.5 text-gray-600">{p.date}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium" style={{ color: "#2196f3" }}>
                        {fmtUSD(p.total_usd)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-medium" style={{ color: "#4caf50" }}>
                        {fmtBRL(p.total_brl)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-gray-400 text-xs">
                        {p.usd_brl_rate != null ? `R$ ${p.usd_brl_rate.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
