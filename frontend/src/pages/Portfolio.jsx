import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  getSnapshots, getDates, updateAssetNotes, updateExpectedIncome,
  getCdiComparison, downloadPdf,
  getDividends, getDividendsSummary, createDividend, deleteDividend,
  updateAssetPurchaseDate,
} from "../api/client";
import {
  Search, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown,
  Pencil, FileDown, X, Plus, Trash2, TrendingUp, Calendar,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  equity:       "Renda Variável",
  fixed_income: "Renda Fixa",
  cash:         "Caixa",
  fund:         "Fundos",
  other:        "Outros",
};

const TYPE_COLORS = {
  equity:       "bg-blue-100 text-blue-700",
  fixed_income: "bg-green-100 text-green-700",
  cash:         "bg-amber-100 text-amber-700",
  fund:         "bg-purple-100 text-purple-700",
  other:        "bg-gray-100 text-gray-600",
};

const DIV_TYPES = [
  { value: "dividendo",      label: "Dividendo" },
  { value: "jcp",            label: "JCP" },
  { value: "rendimento_fii", label: "Rendimento FII" },
  { value: "amortizacao",    label: "Amortização" },
  { value: "bonificacao",    label: "Bonificação" },
];
const DIV_TYPE_LABELS = Object.fromEntries(DIV_TYPES.map((t) => [t.value, t.label]));

// ── Formatters ─────────────────────────────────────────────────────────────────

const fmt = (v, currency = "USD") => {
  if (v == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
};

const fmtPct = (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
const fmtDate = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };

// ── Sorting ───────────────────────────────────────────────────────────────────

const SORT_GETTERS = {
  name:             (s) => s.asset?.name?.toLowerCase() ?? "",
  institution:      (s) => s.asset?.institution?.name?.toLowerCase() ?? "",
  type:             (s) => (TYPE_LABELS[s.asset?.asset_type] ?? "").toLowerCase(),
  currency:         (s) => s.asset?.currency ?? "",
  cost_basis:       (s) => s.cost_basis ?? null,
  market_value:     (s) => s.market_value ?? null,
  gain:             (s) => (s.market_value != null && s.cost_basis != null) ? s.market_value - s.cost_basis : null,
  estimated_income: (s) => s.estimated_income ?? null,
  maturity_date:    (s) => s.maturity_date ?? null,
  dividends:        (s, divSummary) => divSummary[s.asset_id]?.total ?? null,
  total_return:     (s, divSummary) => {
    const gain = (s.market_value ?? 0) - (s.cost_basis ?? 0);
    const divs = divSummary[s.asset_id]?.total ?? 0;
    return s.cost_basis != null ? gain + divs : null;
  },
};

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <ArrowUpDown size={10} className="inline ml-1 opacity-30" />;
  return sortDir === "asc"
    ? <ArrowUp size={11} className="inline ml-1 text-blue-600" />
    : <ArrowDown size={11} className="inline ml-1 text-blue-600" />;
}

function SortTh({ col, label, align = "left", sortCol, sortDir, onSort, title }) {
  const active = sortCol === col;
  return (
    <th
      onClick={() => onSort(col)}
      title={title}
      className={`px-4 py-3 text-${align} cursor-pointer select-none whitespace-nowrap text-xs uppercase tracking-wide font-semibold transition-colors
        ${active ? "text-blue-600 bg-blue-50/60" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100/60"}`}
    >
      {label}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </th>
  );
}

// ── Dividend Panel (inside expanded row) ──────────────────────────────────────

function DividendPanel({ snap, onDividendChange }) {
  const asset     = snap.asset;
  const assetId   = snap.asset_id;
  const currency  = asset?.currency || "USD";

  const [divs,         setDivs]         = useState(null);
  const [loading,      setLoading]       = useState(false);
  const [showForm,     setShowForm]      = useState(false);
  const [saving,       setSaving]        = useState(false);
  const [expectedEdit, setExpectedEdit]  = useState(false);
  const [expectedVal,  setExpectedVal]   = useState(asset?.monthly_dividends_expected != null ? String(asset.monthly_dividends_expected) : "");
  const [form, setForm] = useState({
    payment_date:   new Date().toISOString().slice(0, 10),
    amount:         "",
    dividend_type:  "dividendo",
    currency,
    notes:          "",
  });

  const loadDivs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getDividends(assetId);
      setDivs(r.data);
    } finally { setLoading(false); }
  }, [assetId]);

  useEffect(() => { loadDivs(); }, [loadDivs]);

  const totalDivs = divs
    ? divs.reduce((acc, d) => acc + (d.currency === currency ? d.amount : d.amount), 0)
    : 0;

  const handleSaveExpected = async () => {
    setSaving(true);
    try {
      await updateExpectedIncome(assetId, expectedVal === "" ? null : parseFloat(expectedVal));
      setExpectedEdit(false);
      onDividendChange();
    } finally { setSaving(false); }
  };

  const handleSaveDiv = async () => {
    if (!form.amount) return;
    setSaving(true);
    try {
      await createDividend({
        asset_id:      assetId,
        payment_date:  form.payment_date,
        amount:        parseFloat(form.amount),
        dividend_type: form.dividend_type,
        currency:      form.currency,
        notes:         form.notes || null,
      });
      setShowForm(false);
      setForm({ payment_date: new Date().toISOString().slice(0, 10), amount: "", dividend_type: "dividendo", currency, notes: "" });
      loadDivs();
      onDividendChange();
    } finally { setSaving(false); }
  };

  const handleDeleteDiv = async (id) => {
    if (!window.confirm("Remover este provento?")) return;
    await deleteDividend(id);
    loadDivs();
    onDividendChange();
  };

  return (
    <div className="mt-4 pt-4" style={{ borderTop: "1px solid #d0e4ff" }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <TrendingUp size={12} className="text-green-600" />
          Proventos Recebidos
          {divs && divs.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">
              {fmt(totalDivs, currency)}
            </span>
          )}
        </p>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg transition-colors"
          style={{ background: "#dcfce7", color: "#15803d" }}
        >
          <Plus size={10} /> Registrar Provento
        </button>
      </div>

      {/* Monthly expected income */}
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs text-gray-400 whitespace-nowrap">Dividendos esperados/mês ({currency}):</p>
        {expectedEdit ? (
          <>
            <input
              type="number" step="0.01" min="0"
              value={expectedVal}
              onChange={(e) => setExpectedVal(e.target.value)}
              className="input-base text-xs py-1 px-2 w-28"
              placeholder="0.00"
              autoFocus
            />
            <button onClick={handleSaveExpected} disabled={saving}
              className="text-xs px-2 py-1 rounded font-medium text-white disabled:opacity-50"
              style={{ background: "#4a148c" }}>
              {saving ? "…" : "Salvar"}
            </button>
            <button onClick={() => setExpectedEdit(false)} className="text-xs text-gray-400 hover:text-gray-600">
              Cancelar
            </button>
          </>
        ) : (
          <>
            <span className="text-xs font-semibold text-gray-700">
              {asset?.monthly_dividends_expected != null
                ? fmt(asset.monthly_dividends_expected, currency)
                : "—"}
            </span>
            <button onClick={() => setExpectedEdit(true)}
              className="text-gray-300 hover:text-gray-500 transition-colors">
              <Pencil size={11} />
            </button>
          </>
        )}
      </div>

      {/* Form to add dividend */}
      {showForm && (
        <div className="rounded-xl p-3 mb-3 space-y-2" style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}>
          <p className="text-xs font-semibold text-green-700 mb-2">Registrar Provento Recebido</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <p className="text-[10px] text-gray-400 uppercase mb-0.5">Data</p>
              <input type="date" value={form.payment_date}
                onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="input-base text-xs py-1 w-full" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase mb-0.5">Valor ({currency})</p>
              <input type="number" step="0.01" min="0" value={form.amount} placeholder="0.00"
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="input-base text-xs py-1 w-full" />
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase mb-0.5">Tipo</p>
              <select value={form.dividend_type}
                onChange={(e) => setForm((f) => ({ ...f, dividend_type: e.target.value }))}
                className="input-base text-xs py-1 w-full">
                {DIV_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[10px] text-gray-400 uppercase mb-0.5">Moeda</p>
              <select value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                className="input-base text-xs py-1 w-full">
                <option value="USD">USD</option>
                <option value="BRL">BRL</option>
              </select>
            </div>
          </div>
          <input type="text" value={form.notes} placeholder="Observação (opcional)"
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="input-base text-xs py-1 w-full" />
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
            <button onClick={handleSaveDiv} disabled={saving || !form.amount}
              className="text-xs px-3 py-1.5 rounded-lg font-medium text-white disabled:opacity-50"
              style={{ background: "#15803d" }}>
              {saving ? "Salvando…" : "Salvar Provento"}
            </button>
          </div>
        </div>
      )}

      {/* Dividend history */}
      {loading ? (
        <div className="w-5 h-5 border border-green-500 border-t-transparent rounded-full animate-spin mx-auto my-2" />
      ) : divs && divs.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase text-gray-400 font-semibold border-b border-gray-100">
                <th className="text-left pb-1 pr-3">Data</th>
                <th className="text-right pb-1 pr-3">Valor</th>
                <th className="text-left pb-1 pr-3">Tipo</th>
                <th className="text-left pb-1">Obs.</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {divs.map((d) => (
                <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1 pr-3 text-gray-600">{fmtDate(d.payment_date)}</td>
                  <td className="py-1 pr-3 text-right font-mono font-semibold text-green-700">
                    {fmt(d.amount, d.currency)}
                  </td>
                  <td className="py-1 pr-3 text-gray-500">{DIV_TYPE_LABELS[d.dividend_type] || d.dividend_type}</td>
                  <td className="py-1 text-gray-400 truncate max-w-[120px]">{d.notes || "—"}</td>
                  <td className="py-1 pl-1">
                    <button onClick={() => handleDeleteDiv(d.id)}
                      className="p-0.5 rounded hover:bg-red-50 text-red-300 hover:text-red-500 transition-colors">
                      <Trash2 size={10} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-gray-400 italic">Nenhum provento registrado ainda.</p>
      )}
    </div>
  );
}

// ── DetailRow (expanded) ───────────────────────────────────────────────────────

function DetailRow({ s, divSummary, onDividendChange }) {
  const navigate = useNavigate();
  const currency = s.asset?.currency || "USD";

  const capGain   = (s.market_value ?? 0) - (s.cost_basis ?? 0);
  const divTotal  = divSummary[s.asset_id]?.total ?? 0;
  const totalRet  = capGain + divTotal;
  const totalPct  = s.cost_basis > 0 ? (totalRet / s.cost_basis) * 100 : null;

  const fields = [
    { label: "Vencimento",       value: s.maturity_date || "—" },
    { label: "Renda Anual Est.", value: fmt(s.estimated_income, currency) },
    { label: "Juros Acumulados", value: fmt(s.accrued_income, currency) },
    { label: "Yield Corrente",   value: fmtPct(s.current_yield) },
    { label: "Unidades",         value: s.units != null ? s.units.toLocaleString("pt-BR") : "—" },
    { label: "Preço",            value: fmt(s.price, currency) },
    { label: "Portfólio",        value: s.portfolio_name || "—" },
  ];

  return (
    <tr>
      <td colSpan={13} style={{ background: "#f0f7ff", borderBottom: "1px solid #e0ecff" }} className="px-4 py-3">
        {/* Basic fields */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {fields.map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm text-gray-700 font-mono mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Total return summary */}
        {s.cost_basis != null && s.market_value != null && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ background: capGain >= 0 ? "#f0fdf4" : "#fef2f2" }}>
              <span className="text-gray-500">Ganho capital:</span>
              <span className="font-semibold font-mono" style={{ color: capGain >= 0 ? "#15803d" : "#dc2626" }}>
                {capGain >= 0 ? "+" : ""}{fmt(capGain, currency)}
              </span>
            </div>
            {divTotal > 0 && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: "#f0fdf4" }}>
                <span className="text-gray-500">Proventos:</span>
                <span className="font-semibold font-mono text-green-700">+{fmt(divTotal, currency)}</span>
              </div>
            )}
            {divTotal > 0 && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"
                style={{ background: totalRet >= 0 ? "#dcfce7" : "#fef2f2", border: `1px solid ${totalRet >= 0 ? "#86efac" : "#fca5a5"}` }}>
                <span className="text-gray-600">Rent. Total:</span>
                <span style={{ color: totalRet >= 0 ? "#15803d" : "#dc2626" }}>
                  {totalRet >= 0 ? "+" : ""}{fmt(totalRet, currency)}
                  {totalPct != null && ` (${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(1)}%)`}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Dividend panel */}
        <DividendPanel snap={s} onDividendChange={onDividendChange} />

        <div className="mt-3 pt-3 flex justify-end" style={{ borderTop: "1px solid #d0e4ff" }}>
          <button
            onClick={() => navigate(`/asset/${s.asset_id}`)}
            className="text-xs text-blue-600 hover:text-blue-700 transition-colors font-medium"
          >
            Ver histórico completo →
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main Portfolio ─────────────────────────────────────────────────────────────

export default function Portfolio() {
  // Query params vindos dos atalhos do dashboard:
  // ?institution=<nome cru> ?type=<asset_type> ?date=<YYYY-MM-DD>
  const [searchParams] = useSearchParams();
  const [snapshots,   setSnapshots]   = useState([]);
  const [dates,       setDates]       = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [search,      setSearch]      = useState(searchParams.get("institution") || "");
  const [typeFilter,  setTypeFilter]  = useState(searchParams.get("type") || "");
  const [loading,     setLoading]     = useState(true);
  const [page,        setPage]        = useState(0);
  const [expandedId,  setExpandedId]  = useState(null);
  const [sortCol,     setSortCol]     = useState(null);
  const [sortDir,     setSortDir]     = useState(null);
  const [divSummary,  setDivSummary]  = useState({});  // {asset_id: {total, last_12m, count, currency}}

  // Notes modal
  const [notesModal,  setNotesModal]  = useState(null);
  const [notesText,   setNotesText]   = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  // CDI comparison
  const [showCdi,    setShowCdi]    = useState(false);
  const [cdiData,    setCdiData]    = useState({});
  const [cdiLoading, setCdiLoading] = useState(false);

  // Purchase date inline edit (for CDI mode)
  const [pdEditId,   setPdEditId]   = useState(null);   // asset_id being edited
  const [pdEditVal,  setPdEditVal]  = useState("");
  const [pdSaving,   setPdSaving]   = useState(false);

  const PER_PAGE = 50;

  const loadDivSummary = useCallback(async () => {
    try {
      const r = await getDividendsSummary();
      setDivSummary(r.data);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    getDates().then((r) => {
      setDates(r.data);
      // ?date= abre a Carteira na data daquela fonte — sem isso, uma
      // instituição importada em data antiga apareceria vazia aqui.
      const paramDate = searchParams.get("date");
      if (paramDate && r.data.includes(paramDate)) setSelected(paramDate);
      else if (r.data.length) setSelected(r.data[0]);
    });
    loadDivSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadDivSummary]);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    getSnapshots({ snapshot_date: selected, limit: 500 })
      .then((r) => setSnapshots(r.data))
      .finally(() => setLoading(false));
    setPage(0);
    setExpandedId(null);
  }, [selected]);

  const handleNotesSave = async () => {
    if (!notesModal) return;
    setNotesSaving(true);
    try {
      await updateAssetNotes(notesModal.asset_id, notesText);
      setNotesModal(null);
      setSnapshots((prev) => prev.map((s) =>
        s.asset_id === notesModal.asset_id ? { ...s, asset: { ...s.asset, notes: notesText } } : s
      ));
    } finally { setNotesSaving(false); }
  };

  const handleToggleCdi = async () => {
    if (showCdi) { setShowCdi(false); return; }
    setCdiLoading(true);
    try {
      const r = await getCdiComparison(selected);
      const map = {};
      r.data.forEach((item) => { map[item.asset_id] = item; });
      setCdiData(map);
      setShowCdi(true);
    } finally { setCdiLoading(false); }
  };

  const refreshCdi = async () => {
    try {
      const r = await getCdiComparison(selected);
      const map = {};
      r.data.forEach((item) => { map[item.asset_id] = item; });
      setCdiData(map);
    } catch { /* non-fatal */ }
  };

  const handleSavePurchaseDate = async (assetId) => {
    if (!pdEditVal) return;
    setPdSaving(true);
    try {
      await updateAssetPurchaseDate(assetId, pdEditVal);
      setPdEditId(null);
      await refreshCdi();
    } finally { setPdSaving(false); }
  };

  const handleSortClick = (col) => {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc"); }
    else if (sortDir === "asc") setSortDir("desc");
    else { setSortCol(null); setSortDir(null); }
    setPage(0);
    setExpandedId(null);
  };

  const filtered = useMemo(() =>
    snapshots.filter((s) => {
      const name = s.asset?.name?.toLowerCase() || "";
      const inst = s.asset?.institution?.name?.toLowerCase() || "";
      const q    = search.toLowerCase();
      if (q && !name.includes(q) && !inst.includes(q)) return false;
      if (typeFilter && s.asset?.asset_type !== typeFilter) return false;
      return true;
    }),
    [snapshots, search, typeFilter]
  );

  const sorted = useMemo(() => {
    if (!sortCol || !sortDir) return filtered;
    const getter = SORT_GETTERS[sortCol];
    if (!getter) return filtered;
    return [...filtered].sort((a, b) => {
      const va = getter(a, divSummary), vb = getter(b, divSummary);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb) : va - vb;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir, divSummary]);

  const paginated = sorted.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  const pages     = Math.ceil(sorted.length / PER_PAGE);
  const toggleExpand = (id) => setExpandedId((p) => (p === id ? null : id));
  const thProps = { sortCol, sortDir, onSort: handleSortClick };

  const totalColSpan = 12 + (showCdi ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 -mx-6 px-6 pt-6 pb-4 space-y-3"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-800">Carteira</h2>
          <p className="text-gray-400 text-sm">Posições detalhadas por ativo</p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          {dates.length > 0 && (
            <select value={selected || ""} onChange={(e) => setSelected(e.target.value)} className="input-base">
              {dates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Buscar ativo ou instituição..."
              className="input-base pl-8 w-64"
            />
          </div>

          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }} className="input-base">
            <option value="">Todos os tipos</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>

          <span className="text-xs text-gray-400 ml-auto font-medium">{sorted.length} ativos</span>
          <button
            onClick={handleToggleCdi}
            disabled={cdiLoading}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-all ${showCdi ? "border-green-500 text-green-700 bg-green-50" : "border-gray-200 text-gray-500 hover:text-gray-700 bg-white"}`}
          >
            {cdiLoading ? "…" : showCdi ? "CDI ON" : "CDI"}
          </button>
          <button onClick={() => downloadPdf(selected)} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
            <FileDown size={12} /> PDF
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                  <th className="w-6 px-2 py-3" />
                  <SortTh col="name"             label="Ativo"            align="left"  {...thProps} />
                  <SortTh col="institution"      label="Instituição"      align="left"  {...thProps} />
                  <SortTh col="type"             label="Tipo"             align="left"  {...thProps} />
                  <SortTh col="currency"         label="Moeda"            align="right" {...thProps} />
                  <SortTh col="cost_basis"       label="Custo"            align="right" {...thProps} />
                  <SortTh col="market_value"     label="Valor Atual"      align="right" {...thProps} />
                  <SortTh col="gain"             label="Ganho/Perda"      align="right" {...thProps} />
                  <SortTh col="dividends"        label="Proventos"        align="right" {...thProps} title="Total de dividendos/JCP/rendimentos recebidos historicamente" />
                  <SortTh col="total_return"     label="Rent. Total"      align="right" {...thProps} title="Ganho de capital + proventos recebidos" />
                  <SortTh col="estimated_income" label="Renda Anual Est." align="right" {...thProps} />
                  <SortTh col="maturity_date"    label="Vencimento"       align="right" {...thProps} />
                  {showCdi && <th className="px-4 py-3 text-right text-xs uppercase tracking-wide font-semibold text-green-700">vs CDI</th>}
                  <th className="w-8 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={totalColSpan} className="text-center py-12 text-gray-400">
                      Nenhum ativo encontrado
                    </td>
                  </tr>
                ) : (
                  paginated.flatMap((s, idx) => {
                    const capGain  = (s.market_value ?? 0) - (s.cost_basis ?? 0);
                    const currency = s.asset?.currency || "USD";
                    const atype    = s.asset?.asset_type || "other";
                    const divData  = divSummary[s.asset_id];
                    const divTotal = divData?.total ?? 0;
                    const totalRet = s.cost_basis != null ? capGain + divTotal : null;
                    const totalPct = totalRet != null && s.cost_basis > 0 ? totalRet / s.cost_basis * 100 : null;
                    const isExpanded = expandedId === s.id;
                    const hasDetail  = s.maturity_date || s.estimated_income != null
                      || s.accrued_income != null || s.current_yield != null
                      || s.units != null || s.price != null || s.portfolio_name || true; // always expandable now

                    const tooltipText = totalRet != null && divTotal > 0
                      ? `Ganho capital: ${capGain >= 0 ? "+" : ""}${fmt(capGain, currency)} | Proventos: +${fmt(divTotal, currency)} | Total: ${totalRet >= 0 ? "+" : ""}${fmt(totalRet, currency)}`
                      : undefined;

                    return [
                      <tr
                        key={s.id}
                        onClick={() => toggleExpand(s.id)}
                        className={`transition-colors cursor-pointer ${
                          isExpanded ? "" : `hover:bg-[#eef2ff] ${idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fc]"}`
                        }`}
                        style={isExpanded ? { background: "#e8edff", borderLeft: "3px solid #4a148c" } : {}}
                      >
                        <td className="px-2 py-3 text-gray-400">
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold truncate max-w-[200px]" style={{ color: "#1a1a2e" }}>{s.asset?.name}</p>
                          {s.asset?.identifier && (
                            <p className="text-xs text-gray-400 font-mono">{s.asset.identifier}</p>
                          )}
                          {s.asset?.notes && (
                            <p className="text-[10px] text-purple-500 truncate max-w-[180px]" title={s.asset.notes}>
                              {s.asset.notes.slice(0, 40)}{s.asset.notes.length > 40 ? "…" : ""}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm" style={{ color: "#4a4a6a" }}>{s.asset?.institution?.name}</td>
                        <td className="px-4 py-3">
                          <span className={`badge ${TYPE_COLORS[atype] || TYPE_COLORS.other}`}>
                            {TYPE_LABELS[atype] || atype}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs font-semibold" style={{ color: "#4a4a6a" }}>{currency}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm" style={{ color: "#2d2d4e" }}>
                          {fmt(s.cost_basis, currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-sm" style={{ color: "#2d2d4e" }}>
                          {fmt(s.market_value, currency)}
                        </td>
                        {/* Ganho/Perda de capital */}
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold"
                          style={{ color: capGain >= 0 ? "#1b7a3e" : "#c0392b" }}>
                          {s.cost_basis != null && s.market_value != null
                            ? `${capGain >= 0 ? "+" : ""}${fmt(capGain, currency)}`
                            : "—"}
                        </td>
                        {/* Proventos */}
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold"
                          style={{ color: divTotal > 0 ? "#15803d" : "#9ca3af" }}>
                          {divTotal > 0 ? `+${fmt(divTotal, divData?.currency || currency)}` : "—"}
                        </td>
                        {/* Rent. Total */}
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold"
                          title={tooltipText}
                          style={{ color: totalRet == null ? "#9ca3af" : (totalRet >= 0 ? "#15803d" : "#c0392b") }}>
                          {totalRet != null ? (
                            <span className="flex flex-col items-end">
                              <span>{totalRet >= 0 ? "+" : ""}{fmt(totalRet, currency)}</span>
                              {totalPct != null && (
                                <span className="text-[10px]" style={{ color: totalPct >= 0 ? "#15803d" : "#c0392b" }}>
                                  {totalPct >= 0 ? "+" : ""}{totalPct.toFixed(1)}%
                                </span>
                              )}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs" style={{ color: "#2d2d4e" }}>
                          {s.estimated_income != null ? fmt(s.estimated_income, currency) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-xs" style={{ color: "#4a4a6a" }}>
                          {s.maturity_date || "—"}
                        </td>
                        {showCdi && (
                          <td className="px-4 py-3 text-right font-mono text-xs font-semibold" onClick={(e) => e.stopPropagation()}>
                            {(() => {
                              const cd = cdiData[s.asset_id];
                              if (s.asset?.currency !== "BRL") return <span className="text-gray-200">—</span>;

                              if (cd && cd.vs_cdi_pct != null) {
                                const ok = cd.vs_cdi_pct >= 100;
                                const tooltip = `Período: ${cd.period_start} → hoje\nCDI acumulado: ${cd.cdi_period_pct?.toFixed(2)}%\nRetorno: ${cd.total_return_pct?.toFixed(2)}%\nDias úteis CDI: ${cd.cdi_days}`;
                                return (
                                  <span title={tooltip} style={{ color: ok ? "#1b7a3e" : "#c0392b", cursor: "help" }}>
                                    {cd.vs_cdi_pct.toFixed(0)}% CDI
                                  </span>
                                );
                              }

                              // needs_purchase_date: show inline date input
                              if (pdEditId === s.asset_id) {
                                return (
                                  <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="date"
                                      value={pdEditVal}
                                      onChange={(e) => setPdEditVal(e.target.value)}
                                      className="text-xs border border-green-400 rounded px-1 py-0.5 w-28"
                                      autoFocus
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") handleSavePurchaseDate(s.asset_id);
                                        if (e.key === "Escape") setPdEditId(null);
                                      }}
                                    />
                                    <button
                                      onClick={() => handleSavePurchaseDate(s.asset_id)}
                                      disabled={pdSaving || !pdEditVal}
                                      className="text-[10px] px-1.5 py-0.5 rounded text-white disabled:opacity-40"
                                      style={{ background: "#15803d" }}
                                    >
                                      {pdSaving ? "…" : "OK"}
                                    </button>
                                    <button onClick={() => setPdEditId(null)} className="text-gray-400 hover:text-gray-600">
                                      <X size={10} />
                                    </button>
                                  </div>
                                );
                              }

                              return (
                                <button
                                  title="Clique para informar a data de aplicação (necessário para calcular vs CDI)"
                                  onClick={() => { setPdEditId(s.asset_id); setPdEditVal(""); }}
                                  className="flex items-center gap-1 text-gray-400 hover:text-green-600 transition-colors ml-auto"
                                >
                                  <Calendar size={11} />
                                  <span className="text-[10px]">data aplic.</span>
                                </button>
                              );
                            })()}
                          </td>
                        )}
                        <td className="px-2 py-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNotesModal({ asset_id: s.asset_id, asset_name: s.asset?.name });
                              setNotesText(s.asset?.notes || "");
                            }}
                            className="p-1 rounded hover:bg-gray-100 transition-colors"
                            title="Notas"
                          >
                            <Pencil size={12} style={{ color: s.asset?.notes ? "#4a148c" : "#d1d5db" }} />
                          </button>
                        </td>
                      </tr>,
                      isExpanded && (
                        <DetailRow
                          key={`detail-${s.id}`}
                          s={s}
                          divSummary={divSummary}
                          onDividendChange={() => loadDivSummary()}
                        />
                      ),
                    ];
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 && (
        <div className="flex gap-2 justify-center">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">Anterior</button>
          <span className="text-sm text-gray-500 py-1.5 px-2">{page + 1} / {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40">Próxima</button>
        </div>
      )}

      {/* Notes modal */}
      {notesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => e.target === e.currentTarget && setNotesModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
              <p className="font-semibold text-gray-800 text-sm flex items-center gap-2">
                <Pencil size={14} style={{ color: "#4a148c" }} />
                Notas — {notesModal.asset_name}
              </p>
              <button onClick={() => setNotesModal(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <textarea
                value={notesText}
                onChange={(e) => setNotesText(e.target.value)}
                rows={5}
                placeholder="Escreva suas observações sobre este ativo..."
                className="input-base w-full resize-none text-sm"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button onClick={() => setNotesModal(null)} className="btn-secondary text-sm">Cancelar</button>
                <button
                  onClick={handleNotesSave}
                  disabled={notesSaving}
                  className="text-sm px-5 py-2 rounded-lg font-medium text-white disabled:opacity-50"
                  style={{ background: "#4a148c" }}
                >
                  {notesSaving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
