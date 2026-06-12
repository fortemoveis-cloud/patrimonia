import { useEffect, useState, useCallback } from "react";
import { FileText, RefreshCw, Download, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from "lucide-react";
import { getReportList, generateReports, getReport, downloadReportPdf } from "../api/client";

const TYPE_LABELS = {
  equity: "Renda Variável", fixed_income: "Renda Fixa", fund: "Fundos", cash: "Caixa",
};
const CLASS_OPTIONS = [
  { key: "equity",       label: "Renda Variável" },
  { key: "fixed_income", label: "Renda Fixa" },
  { key: "fund",         label: "Fundos" },
  { key: "cash",         label: "Caixa" },
];

const fmtBRL = (v) =>
  v != null ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v) : "—";

const fmtPct = (v) => (v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—");

const fmtDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR");

function TypeBadge({ type }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
      type === "weekly" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
    }`}>
      {type === "weekly" ? "Semanal" : "Mensal"}
    </span>
  );
}

function DetailPanel({ reportId, assetFilter, onClose }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getReport(reportId).then((r) => setData(r.data)).finally(() => setLoading(false));
  }, [reportId]);

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!data) return null;

  const p = data.payload;
  const filtered = assetFilter.length === 4
    ? p.assets
    : p.assets.filter((a) => assetFilter.includes(a.asset_type));

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Patrimônio no período", value: fmtBRL(p.total_brl) },
          { label: "Variação (R$)", value: fmtBRL(p.change_brl), colored: true, raw: p.change_brl },
          { label: "Variação (%)", value: fmtPct(p.change_pct), colored: true, raw: p.change_pct },
        ].map(({ label, value, colored, raw }) => (
          <div key={label} className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-1">{label}</p>
            <p className={`font-bold text-lg ${colored ? (raw >= 0 ? "text-green-600" : "text-red-600") : "text-gray-800"}`}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Allocation by type */}
      {p.by_asset_type?.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">Alocação por Classe</p>
          <div className="space-y-1.5">
            {p.by_asset_type.map((row) => (
              <div key={row.type} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-28 flex-shrink-0">{row.label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2">
                  <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${row.pct}%` }} />
                </div>
                <span className="text-xs text-gray-600 w-16 text-right">{fmtBRL(row.value_brl)}</span>
                <span className="text-xs text-gray-400 w-10 text-right">{row.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assets table */}
      {filtered.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-700 mb-2">Evolução dos Ativos</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2 font-medium">Ativo</th>
                  <th className="text-right pb-2 font-medium">Início</th>
                  <th className="text-right pb-2 font-medium">Fim</th>
                  <th className="text-right pb-2 font-medium">Var.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.asset_id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-1.5 pr-3">
                      <p className="font-medium text-gray-800 truncate max-w-[200px]">{a.asset_name}</p>
                      <p className="text-gray-400">{a.institution} · {TYPE_LABELS[a.asset_type] || a.asset_type}</p>
                    </td>
                    <td className="py-1.5 text-right text-gray-600">{fmtBRL(a.value_start_brl)}</td>
                    <td className="py-1.5 text-right text-gray-800 font-medium">{fmtBRL(a.value_end_brl)}</td>
                    <td className={`py-1.5 text-right font-medium ${(a.change_pct ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {fmtPct(a.change_pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Gainers / Losers */}
      {(p.gainers?.length > 0 || p.losers?.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { title: "Maiores altas", items: p.gainers, color: "text-green-600", Icon: TrendingUp },
            { title: "Maiores baixas", items: p.losers, color: "text-red-600", Icon: TrendingDown },
          ].map(({ title, items, color, Icon }) => (
            <div key={title}>
              <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                <Icon size={12} className={color} />{title}
              </p>
              <div className="space-y-1">
                {items.map((a) => (
                  <div key={a.asset_id} className="flex justify-between text-xs">
                    <span className="text-gray-700 truncate max-w-[120px]">{a.asset_name}</span>
                    <span className={`font-medium ml-2 flex-shrink-0 ${color}`}>{fmtPct(a.change_pct)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PDF export */}
      <div className="flex justify-end">
        <button
          onClick={() => downloadReportPdf(data.id, assetFilter.length < 4 ? assetFilter.join(",") : undefined)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Download size={14} /> Exportar PDF
        </button>
      </div>
    </div>
  );
}

export default function Reports() {
  const [reports, setReports]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [assetFilter, setAssetFilter] = useState(["equity", "fixed_income", "fund", "cash"]);
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    getReportList().then((r) => setReports(r.data.reports)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateReports({ backfill_all: true });
      load();
    } finally {
      setGenerating(false);
    }
  };

  const toggleClass = (key) => {
    setAssetFilter((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  const filtered = reports.filter((r) => typeFilter === "all" || r.type === typeFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-4 md:pt-6 pb-4"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-indigo-50">
              <FileText size={18} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Relatórios</h2>
              <p className="text-gray-400 text-sm">Histórico semanal e mensal do portfólio</p>
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-60"
          >
            <RefreshCw size={14} className={generating ? "animate-spin" : ""} />
            {generating ? "Gerando…" : "Gerar agora"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {[["all", "Todos"], ["weekly", "Semanais"], ["monthly", "Mensais"]].map(([key, label]) => (
            <button key={key} onClick={() => setTypeFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                typeFilter === key ? "bg-white shadow-sm text-gray-800" : "text-gray-500 hover:text-gray-700"
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {CLASS_OPTIONS.map(({ key, label }) => (
            <button key={key} onClick={() => toggleClass(key)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                assetFilter.includes(key)
                  ? "bg-indigo-600 border-indigo-600 text-white"
                  : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <FileText size={24} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-600 font-medium">Nenhum relatório encontrado</p>
          <p className="text-gray-400 text-sm mt-1">Clique em "Gerar agora" para criar os relatórios dos períodos fechados.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const isExpanded = expandedId === r.id;
            const chgPositive = (r.change_pct ?? 0) >= 0;
            return (
              <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <button
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <div className="flex-shrink-0">
                    <TypeBadge type={r.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 text-sm">
                      {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{r.asset_count} ativos</p>
                  </div>
                  <div className="text-right flex-shrink-0 mr-3">
                    <p className="font-bold text-gray-800">{fmtBRL(r.total_brl)}</p>
                    <p className={`text-xs font-medium mt-0.5 ${chgPositive ? "text-green-600" : "text-red-600"}`}>
                      {fmtPct(r.change_pct)}
                    </p>
                  </div>
                  {isExpanded ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />}
                </button>
                {isExpanded && (
                  <div className="px-5 pb-5">
                    <DetailPanel reportId={r.id} assetFilter={assetFilter} onClose={() => setExpandedId(null)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
