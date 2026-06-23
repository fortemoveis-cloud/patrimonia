import { useEffect, useRef, useState } from "react";
import {
  getPropertySummary, createProperty, updateProperty, archiveProperty,
  addPropertyValuation, getPropertyValuations,
  uploadPropertyPhoto, deletePropertyPhoto,
  getPriceRefs, upsertPriceRef, deletePriceRef,
  getPropertyAlerts, updateZillowEstimate, saveZillowManual,
  exportPropertiesXlsx,
  getRentalIncome, upsertRentalIncome, deleteRentalIncome,
} from "../api/client";
import {
  Home, Plus, X, TrendingUp, Clock, Trash2, Camera, MapPin,
  ChevronDown, ChevronUp, AlertTriangle, RefreshCw, Building2,
  DollarSign, Percent, BarChart2, Globe, Flag, ExternalLink,
  LayoutGrid, List, FileDown, Banknote,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTip, ResponsiveContainer,
} from "recharts";

// ── Config ────────────────────────────────────────────────────────────────────

const TYPES = [
  { value: "residencial", label: "Residencial", bg: "#eff6ff", color: "#2563eb" },
  { value: "comercial",   label: "Comercial",   bg: "#fff7ed", color: "#ea580c" },
  { value: "terreno",     label: "Terreno",     bg: "#f0fdf4", color: "#16a34a" },
  { value: "outro",       label: "Outro",       bg: "#fdf4ff", color: "#9333ea" },
];
const TYPE_MAP = Object.fromEntries(TYPES.map((t) => [t.value, t]));

const COUNTRIES = [
  { value: "Brasil",          label: "Brasil",          flag: "🇧🇷" },
  { value: "Estados Unidos",  label: "Estados Unidos",  flag: "🇺🇸" },
];

const EMPTY_FORM = {
  description: "", address: "", property_type: "residencial",
  area_m2: "", cidade: "", bairro: "", matricula: "",
  purchase_date: "",
  purchase_price_brl: "", purchase_price_usd: "",
  current_value_brl: "", current_value_usd: "",
  country: "Brasil", currency: "BRL",
  zillow_url: "",
  iptu_anual: "", condominio_mensal: "", aluguel_mensal: "",
};

const API_BASE = "http://localhost:8000";

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtBRL = (v) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);
const fmtUSD = (v) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v ?? 0);
const fmtPct = (v, suffix = "%") => (v != null ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}${suffix}` : "—");
const fmtDate = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const fmt0 = (v) => v != null ? new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v) : "—";

// ── Sub-components ─────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  const t = TYPE_MAP[type] || TYPE_MAP.outro;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: t.bg, color: t.color }}>
      {t.label}
    </span>
  );
}

function ValuationBadge({ source }) {
  if (source === "rentcast_avm" || source === "rentcast") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" }}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Rentcast
      </span>
    );
  }
  if (source === "zillow" || source === "attom_avm") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
        style={{ background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" }}>
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
        Zillow
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}>
      Manual
    </span>
  );
}

function FormField({ label, children, span }) {
  return (
    <div className={span ? `sm:col-span-${span}` : ""}>
      <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div className="sm:col-span-2 lg:col-span-3 pb-1 border-b border-gray-100 mt-2">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{children}</p>
    </div>
  );
}

function MetricChip({ label, value, color = "#6b7280", bg = "#f9fafb", title }) {
  return (
    <div className="flex flex-col items-center rounded-lg px-2 py-1.5" style={{ background: bg }} title={title}>
      <span className="text-[10px] text-gray-400 uppercase tracking-wide leading-none mb-0.5">{label}</span>
      <span className="text-sm font-bold" style={{ color }}>{value}</span>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 sticky top-0 bg-white z-10"
          style={{ borderBottom: "1px solid #f3f4f6" }}>
          <p className="font-semibold text-gray-800 text-sm">{title}</p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X size={16} /></button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function HistoryChart({ valuations, currency }) {
  if (!valuations?.length) return null;
  const isUSD = currency === "USD";
  const data = valuations.map((v) => ({
    date: v.valuation_date,
    value: isUSD ? (v.current_value_usd ?? v.current_value_brl) : v.current_value_brl,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(v) => isUSD ? `$${(v / 1000).toFixed(0)}k` : `R$${(v / 1000).toFixed(0)}k`}
          tick={{ fill: "#9ca3af", fontSize: 10 }} axisLine={false} tickLine={false} width={52}
        />
        <RechartsTip
          formatter={(v) => [isUSD ? fmtUSD(v) : fmtBRL(v), "Valor"]}
          contentStyle={{ borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 12 }}
        />
        <Line type="monotone" dataKey="value" stroke="#9333ea" strokeWidth={2.5}
          dot={{ r: 3, fill: "#9333ea" }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Property Card ─────────────────────────────────────────────────────────────

function PropertyCard({ prop, onEdit, onUpdateVal, onHistory, onArchive, onPhoto, onZillow, onZillowManual, onRental }) {
  const [zillowLoading, setZillowLoading] = useState(false);
  const [zillowError,   setZillowError]   = useState(null);
  const [showManual,    setShowManual]    = useState(false);
  const [manualValue,   setManualValue]   = useState("");
  const [manualSaving,  setManualSaving]  = useState(false);
  const fileRef = useRef(null);
  const gainOk  = (prop.gain_brl ?? 0) >= 0;
  const photo   = prop.photos?.[0];
  const isUSA   = prop.country === "Estados Unidos";

  const handleZillow = async () => {
    setZillowLoading(true);
    setZillowError(null);
    setShowManual(false);
    try {
      const result = await onZillow(prop.id);
      if (result?.manual_fallback) {
        const hasAutoValue = prop.valuation_source === "rentcast_avm"
          || prop.valuation_source === "zillow"
          || prop.valuation_source === "attom_avm";
        if (!hasAutoValue) setShowManual(true);
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || "Erro ao consultar API";
      setZillowError(msg);
      setTimeout(() => setZillowError(null), 6000);
    } finally {
      setZillowLoading(false);
    }
  };

  const handleManualSave = async () => {
    const val = parseFloat(manualValue);
    if (!val || val <= 0) return;
    setManualSaving(true);
    try {
      await onZillowManual(prop.id, val);
      setShowManual(false);
      setManualValue("");
    } catch {
      setZillowError("Erro ao salvar valor manual");
      setTimeout(() => setZillowError(null), 5000);
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col">
      {/* Photo / Placeholder */}
      <div className="relative h-36 flex-shrink-0" style={{ background: "#f8f9fc" }}>
        {photo ? (
          <img src={`${API_BASE}${photo.url}`} alt={prop.description}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Building2 size={40} className="text-gray-200" />
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1 flex-wrap">
          <TypeBadge type={prop.property_type} />
          {isUSA && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: "#eff6ff", color: "#1d4ed8" }}>
              🇺🇸 EUA
            </span>
          )}
        </div>
        {prop.stale_valuation && (
          <div className="absolute top-2 right-2">
            <span className="flex items-center gap-1 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
              <AlertTriangle size={9} /> Valor desatualizado
            </span>
          </div>
        )}
        <button
          className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center shadow text-gray-500 hover:text-purple-600 transition-colors"
          onClick={() => fileRef.current?.click()}
          title="Adicionar foto"
        >
          <Camera size={13} />
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) onPhoto(prop.id, e.target.files[0]); e.target.value = ""; }} />
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col gap-3">
        {/* Title + location */}
        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-gray-800 text-sm leading-tight">{prop.description}</p>
            <ValuationBadge source={prop.valuation_source} />
          </div>
          {(prop.cidade || prop.bairro) && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <MapPin size={10} />
              {[prop.bairro, prop.cidade].filter(Boolean).join(", ")}
            </p>
          )}
          {prop.area_m2 && (
            <p className="text-xs text-gray-400 mt-0.5">{prop.area_m2.toLocaleString("pt-BR")} m²</p>
          )}
        </div>

        {/* Current value — USD first for US properties */}
        <div>
          {isUSA ? (
            <>
              <p className="text-2xl font-bold" style={{ color: "#1d4ed8" }}>{fmtUSD(prop.current_value_usd)}</p>
              <p className="text-sm text-gray-500 mt-0.5">{fmtBRL(prop.current_value_brl)}</p>
            </>
          ) : (
            <p className="text-2xl font-bold" style={{ color: "#9333ea" }}>{fmtBRL(prop.current_value_brl)}</p>
          )}
          {prop.estimated_value_brl && Math.abs(prop.estimated_value_brl - prop.current_value_brl) > 1000 && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Estimado: {fmtBRL(prop.estimated_value_brl)} (referência preço/m²)
            </p>
          )}
          {isUSA && prop.zillow_zestimate_usd && (
            <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
              {prop.zillow_zestimate_source === "rentcast_avm" ? "Rentcast AVM" : "Zestimate"}: {fmtUSD(prop.zillow_zestimate_usd)}
              {prop.zillow_zestimate_date && <span>· {fmtDate(prop.zillow_zestimate_date)}</span>}
              {prop.zillow_url && (
                <a href={prop.zillow_url} target="_blank" rel="noopener noreferrer"
                  className="ml-1 text-blue-400 hover:text-blue-600 transition-colors"
                  title="Ver no Zillow"
                  onClick={(e) => e.stopPropagation()}>
                  <ExternalLink size={10} />
                </a>
              )}
            </p>
          )}
          {isUSA && !prop.zillow_zestimate_usd && prop.zillow_url && (
            <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
              <Globe size={10} className="text-blue-400" />
              <a href={prop.zillow_url} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-600 transition-colors"
                onClick={(e) => e.stopPropagation()}>
                Ver no Zillow
              </a>
              <span>· clique em "Zillow" para buscar Zestimate</span>
            </p>
          )}
          <p className="text-xs mt-0.5" style={{ color: gainOk ? "#16a34a" : "#dc2626" }}>
            {gainOk ? "+" : ""}{fmtBRL(prop.gain_brl)}
            {prop.gain_pct != null && ` (${prop.gain_pct >= 0 ? "+" : ""}${prop.gain_pct.toFixed(1)}%)`}
            {prop.purchase_date && <span className="text-gray-400"> desde {fmtDate(prop.purchase_date)}</span>}
          </p>
        </div>

        {/* Zillow error */}
        {zillowError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {zillowError}
          </div>
        )}

        {/* Manual Zestimate fallback */}
        {showManual && (
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-3 space-y-2">
            <p className="text-xs text-blue-700 font-medium">
              Nenhuma API disponível. Consulte o Zestimate no Zillow e insira manualmente:
            </p>
            {prop.zillow_url && (
              <a
                href={prop.zillow_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink size={11} /> Abrir no Zillow
              </a>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 shrink-0">Zestimate USD:</span>
              <input
                type="number"
                placeholder="ex: 425000"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                className="border border-blue-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:border-blue-500"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={(e) => { e.stopPropagation(); handleManualSave(); }}
                disabled={manualSaving || !manualValue}
                className="px-2.5 py-1 rounded text-xs font-medium text-white disabled:opacity-50"
                style={{ background: "#2563eb" }}
              >
                {manualSaving ? "…" : "Salvar"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowManual(false); setManualValue(""); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-1"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-1.5">
          <MetricChip label="Ret. anual" value={prop.annual_return_pct != null ? `${prop.annual_return_pct >= 0 ? "+" : ""}${prop.annual_return_pct.toFixed(1)}%` : "—"}
            color={prop.annual_return_pct != null ? (prop.annual_return_pct >= 6 ? "#16a34a" : "#ca8a04") : "#9ca3af"}
            bg="#f0fdf4" title="Retorno anual composto (CAGR) desde a compra" />
          <MetricChip label="vs CDI" value={prop.vs_cdi_pp != null ? fmtPct(prop.vs_cdi_pp, " pp") : "—"}
            color={prop.vs_cdi_pp != null ? (prop.vs_cdi_pp >= 0 ? "#16a34a" : "#dc2626") : "#9ca3af"}
            bg={prop.vs_cdi_pp != null && prop.vs_cdi_pp >= 0 ? "#f0fdf4" : "#fef2f2"}
            title={`CDI acumulado: ${prop.cdi_period_pct != null ? prop.cdi_period_pct.toFixed(1) + "%" : "n/d"}`} />
          {prop.cap_rate != null && (
            <MetricChip label="Cap rate" value={`${prop.cap_rate.toFixed(1)}%`}
              color="#7c3aed" bg="#faf5ff" title="Aluguel anual / Valor atual × 100" />
          )}
          {prop.net_yield != null && (
            <MetricChip label="Yield líq." value={`${prop.net_yield.toFixed(1)}%`}
              color="#0369a1" bg="#eff6ff" title="(Aluguel - Custos) / Valor atual × 100" />
          )}
          {prop.custo_anual > 0 && (
            <MetricChip label="Custos/ano" value={`R$${fmt0(prop.custo_anual)}`}
              color="#9ca3af" bg="#f9fafb" title="IPTU + Condomínio anual" />
          )}
          {prop.aluguel_mensal > 0 && (
            <MetricChip label="Aluguel/mês" value={`R$${fmt0(prop.aluguel_mensal)}`}
              color="#059669" bg="#ecfdf5" />
          )}
          {prop.rental_months_recorded > 0 && prop.rental_last_12m > 0 && (
            <MetricChip label="Renda 12m"
              value={prop.currency === "USD" ? fmtUSD(prop.rental_last_12m) : fmtBRL(prop.rental_last_12m)}
              color="#059669" bg="#ecfdf5" title="Renda de locação recebida nos últimos 12 meses" />
          )}
          {prop.rental_yield_on_purchase_pct != null && (
            <MetricChip label="Yield compra"
              value={`${prop.rental_yield_on_purchase_pct.toFixed(1)}% a.a.`}
              color="#0369a1" bg="#eff6ff" title="Renda 12m / Preço de compra × 100" />
          )}
          {prop.rental_yield_on_current_pct != null && (
            <MetricChip label="Yield locação"
              value={`${prop.rental_yield_on_current_pct.toFixed(1)}% a.a.`}
              color="#7c3aed" bg="#faf5ff" title="Renda 12m / Valor atual × 100" />
          )}
        </div>

        <div className="flex-1" />

        {/* Action buttons */}
        <div className="flex items-center gap-1 pt-2 border-t border-gray-50 flex-wrap">
          <button onClick={() => onEdit(prop)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-purple-50 transition-colors flex items-center gap-1"
            style={{ color: "#9333ea" }}>
            Editar
          </button>
          <button onClick={() => onUpdateVal(prop)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1 text-blue-600">
            <TrendingUp size={12} /> Valor
          </button>
          <button onClick={() => onHistory(prop)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors flex items-center gap-1 text-gray-500">
            <Clock size={12} /> Histórico
          </button>
          <button onClick={() => onRental(prop)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors flex items-center gap-1"
            style={{ color: "#059669" }}
            title="Lançar renda de locação">
            <Banknote size={12} /> Renda
          </button>
          {isUSA && (
            <button
              onClick={handleZillow}
              disabled={zillowLoading}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
              style={{ background: zillowLoading ? "#f3f4f6" : "#dcfce7", color: "#15803d" }}
              title="Atualizar valor via Rentcast AVM"
            >
              {zillowLoading ? (
                <span className="w-3 h-3 border border-green-600 border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <Globe size={12} />
              )}
              {zillowLoading ? "…" : "Rentcast"}
            </button>
          )}
          <button onClick={() => onArchive(prop.id)}
            className="ml-auto p-1.5 rounded-lg hover:bg-red-50 transition-colors text-red-400">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Property Form Modal ───────────────────────────────────────────────────────

function PropertyFormModal({ editingProp, onClose, onSaved }) {
  const [form, setForm] = useState(
    editingProp
      ? {
          description:        editingProp.description,
          address:            editingProp.address || "",
          property_type:      editingProp.property_type,
          area_m2:            editingProp.area_m2 != null ? String(editingProp.area_m2) : "",
          cidade:             editingProp.cidade || "",
          bairro:             editingProp.bairro || "",
          matricula:          editingProp.matricula || "",
          purchase_date:      editingProp.purchase_date || "",
          purchase_price_brl: editingProp.purchase_price_brl != null ? String(editingProp.purchase_price_brl) : "",
          purchase_price_usd: editingProp.purchase_price_usd != null ? String(editingProp.purchase_price_usd) : "",
          current_value_brl:  "",
          current_value_usd:  "",
          country:            editingProp.country || "Brasil",
          currency:           editingProp.currency || "BRL",
          zillow_url:         editingProp.zillow_url || "",
          iptu_anual:         editingProp.iptu_anual != null ? String(editingProp.iptu_anual) : "",
          condominio_mensal:  editingProp.condominio_mensal != null ? String(editingProp.condominio_mensal) : "",
          aluguel_mensal:     editingProp.aluguel_mensal != null ? String(editingProp.aluguel_mensal) : "",
        }
      : EMPTY_FORM
  );
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const num = (k) => (form[k] !== "" ? parseFloat(form[k]) : null);

  const isUSA = form.country === "Estados Unidos";

  // Auto-set currency when country changes
  const setCountry = (val) => {
    setForm((f) => ({
      ...f,
      country: val,
      currency: val === "Estados Unidos" ? "USD" : "BRL",
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      description:        form.description,
      address:            form.address || null,
      property_type:      form.property_type,
      area_m2:            num("area_m2"),
      cidade:             form.cidade || null,
      bairro:             form.bairro || null,
      matricula:          form.matricula || null,
      purchase_date:      form.purchase_date || null,
      purchase_price_brl: isUSA ? null : num("purchase_price_brl"),
      purchase_price_usd: isUSA ? num("purchase_price_usd") : null,
      current_value_brl:  isUSA ? null : num("current_value_brl"),
      current_value_usd:  isUSA ? num("current_value_usd") : null,
      country:            form.country,
      currency:           form.currency,
      zillow_url:         form.zillow_url || null,
      iptu_anual:         num("iptu_anual"),
      condominio_mensal:  num("condominio_mensal"),
      aluguel_mensal:     num("aluguel_mensal"),
    };
    try {
      if (editingProp) {
        await updateProperty(editingProp.id, payload);
      } else {
        await createProperty(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "input-base w-full";

  return (
    <Modal title={editingProp ? `Editar: ${editingProp.description}` : "Cadastrar Imóvel"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SectionTitle>Identificação</SectionTitle>

        <FormField label="Descrição / Apelido" span="2">
          <input required value={form.description} onChange={set("description")}
            placeholder='ex: "Apto Miami Beach"' className={inputCls} />
        </FormField>
        <FormField label="Tipo">
          <select value={form.property_type} onChange={set("property_type")} className={inputCls}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </FormField>

        {/* Country + Currency */}
        <FormField label="País">
          <select value={form.country} onChange={(e) => setCountry(e.target.value)} className={inputCls}>
            {COUNTRIES.map((c) => (
              <option key={c.value} value={c.value}>{c.flag} {c.label}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Moeda">
          <select value={form.currency} onChange={set("currency")} className={inputCls}>
            <option value="BRL">BRL — Real Brasileiro</option>
            <option value="USD">USD — Dólar Americano</option>
          </select>
        </FormField>

        {isUSA && (
          <div className="lg:col-span-1 flex items-end">
            <div className="rounded-lg px-3 py-2 w-full text-xs"
              style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
              🇺🇸 Imóvel nos EUA — valores em USD serão convertidos pela cotação do dia
            </div>
          </div>
        )}

        <FormField label="Endereço completo" span="2">
          <input value={form.address} onChange={set("address")}
            placeholder={isUSA ? "123 Ocean Drive, Miami Beach, FL 33139" : "Rua, número, complemento"}
            className={inputCls} />
        </FormField>
        <FormField label={isUSA ? "ZIP / Bairro" : "Matrícula cartório"}>
          <input value={form.matricula} onChange={set("matricula")}
            placeholder={isUSA ? "33139" : "123.456"} className={inputCls} />
        </FormField>

        {isUSA && (
          <FormField label="URL do Zillow (para Zestimate)" span="3">
            <input value={form.zillow_url} onChange={set("zillow_url")}
              placeholder="https://www.zillow.com/homedetails/123-ocean-dr-miami-beach-fl-33139/12345678_zpid/"
              className={inputCls} />
            <p className="text-[11px] text-gray-400 mt-1">
              Cole a URL da página do imóvel no Zillow. Usada pelo botão "Zillow" para buscar o Zestimate automaticamente.
            </p>
          </FormField>
        )}

        <FormField label={isUSA ? "Cidade (EUA)" : "Cidade"}>
          <input value={form.cidade} onChange={set("cidade")}
            placeholder={isUSA ? "Miami Beach" : "Recife"} className={inputCls} />
        </FormField>
        <FormField label={isUSA ? "Estado" : "Bairro"}>
          <input value={form.bairro} onChange={set("bairro")}
            placeholder={isUSA ? "FL" : "Boa Viagem"} className={inputCls} />
        </FormField>
        <FormField label="Área (m²)">
          <input type="number" step="0.01" min="0" value={form.area_m2} onChange={set("area_m2")}
            placeholder="120" className={inputCls} />
        </FormField>

        <SectionTitle>Financeiro</SectionTitle>

        <FormField label="Data de Compra">
          <input type="date" value={form.purchase_date} onChange={set("purchase_date")} className={inputCls} />
        </FormField>

        {isUSA ? (
          <>
            <FormField label="Valor de Compra (USD)">
              <input type="number" step="0.01" min="0" value={form.purchase_price_usd}
                onChange={set("purchase_price_usd")} placeholder="350000" className={inputCls} />
            </FormField>
            {!editingProp && (
              <FormField label="Valor Atual (USD) — se diferente">
                <input type="number" step="0.01" min="0" value={form.current_value_usd}
                  onChange={set("current_value_usd")} placeholder="420000" className={inputCls} />
              </FormField>
            )}
          </>
        ) : (
          <>
            <FormField label="Valor de Compra (R$)">
              <input type="number" step="0.01" min="0" value={form.purchase_price_brl}
                onChange={set("purchase_price_brl")} placeholder="800000" className={inputCls} />
            </FormField>
            {!editingProp && (
              <FormField label="Valor Atual (R$) — se diferente">
                <input type="number" step="0.01" min="0" value={form.current_value_brl}
                  onChange={set("current_value_brl")} placeholder="980000" className={inputCls} />
              </FormField>
            )}
          </>
        )}

        <SectionTitle>Renda e Custos</SectionTitle>

        <FormField label={`Aluguel recebido/mês (${isUSA ? "USD" : "R$"})`}>
          <input type="number" step="0.01" min="0" value={form.aluguel_mensal}
            onChange={set("aluguel_mensal")} placeholder={isUSA ? "2500" : "4500"} className={inputCls} />
        </FormField>
        <FormField label={`IPTU / Property Tax anual (${isUSA ? "USD" : "R$"})`}>
          <input type="number" step="0.01" min="0" value={form.iptu_anual}
            onChange={set("iptu_anual")} placeholder={isUSA ? "5000" : "3600"} className={inputCls} />
        </FormField>
        <FormField label={`Condomínio / HOA mensal (${isUSA ? "USD" : "R$"})`}>
          <input type="number" step="0.01" min="0" value={form.condominio_mensal}
            onChange={set("condominio_mensal")} placeholder={isUSA ? "800" : "800"} className={inputCls} />
        </FormField>

        <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-3 pt-3 border-t border-gray-100 mt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancelar</button>
          <button type="submit" disabled={saving}
            className="text-sm px-5 py-2 rounded-lg font-medium text-white disabled:opacity-50 transition-all"
            style={{ background: "#4a148c" }}>
            {saving ? "Salvando…" : editingProp ? "Salvar Alterações" : "Cadastrar Imóvel"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Rental Income Panel ───────────────────────────────────────────────────────

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function RentalIncomePanel({ propertyId, currency, purchasePrice, currentValue }) {
  const isUSD = currency === "USD";
  const fmt   = (v) => isUSD ? fmtUSD(v) : fmtBRL(v);
  const currentYear = new Date().getFullYear();

  const [records,    setRecords]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [activeYear, setActiveYear] = useState(currentYear);
  const [cellValues, setCellValues] = useState({});
  const [saving,     setSaving]     = useState({});

  useEffect(() => {
    setLoading(true);
    getRentalIncome(propertyId)
      .then((r) => {
        const data = r.data;
        setRecords(data);
        const map = {};
        data.forEach((rec) => { map[`${rec.year}-${rec.month}`] = String(rec.amount); });
        setCellValues(map);
      })
      .finally(() => setLoading(false));
  }, [propertyId]);

  const years = (() => {
    const minY = records.length > 0 ? Math.min(...records.map((r) => r.year)) : currentYear;
    const ys = [];
    for (let y = Math.min(minY, currentYear - 1); y <= currentYear + 1; y++) ys.push(y);
    return ys;
  })();

  const handleBlur = async (year, month) => {
    const key      = `${year}-${month}`;
    const val      = (cellValues[key] ?? "").trim();
    const existing = records.find((r) => r.year === year && r.month === month);

    if (val === "") {
      if (existing) {
        setSaving((s) => ({ ...s, [key]: true }));
        try {
          await deleteRentalIncome(propertyId, year, month);
          setRecords((prev) => prev.filter((r) => !(r.year === year && r.month === month)));
          setCellValues((prev) => { const n = { ...prev }; delete n[key]; return n; });
        } finally { setSaving((s) => ({ ...s, [key]: false })); }
      }
      return;
    }

    const amount = parseFloat(val);
    if (isNaN(amount) || amount < 0) {
      setCellValues((prev) => ({ ...prev, [key]: existing ? String(existing.amount) : "" }));
      return;
    }
    if (existing && Math.abs(existing.amount - amount) < 0.001) return;

    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const r = await upsertRentalIncome(propertyId, { year, month, amount, currency: currency || "BRL", notes: null });
      const saved = r.data;
      setRecords((prev) => [...prev.filter((r) => !(r.year === year && r.month === month)), saved]);
      setCellValues((prev) => ({ ...prev, [key]: String(saved.amount) }));
    } finally { setSaving((s) => ({ ...s, [key]: false })); }
  };

  // Summary calculations
  const totalAll    = records.reduce((s, r) => s + r.amount, 0);
  const monthsCount = records.length;
  const avgMonthly  = monthsCount > 0 ? totalAll / monthsCount : 0;
  const today       = new Date();
  const last12m     = records
    .filter((r) => { const ago = (today.getFullYear() - r.year) * 12 + (today.getMonth() + 1 - r.month); return ago >= 0 && ago < 12; })
    .reduce((s, r) => s + r.amount, 0);
  const yearTotal   = records.filter((r) => r.year === activeYear).reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4">
      {/* Year tabs */}
      <div className="flex gap-1 flex-wrap border-b border-gray-100 pb-3">
        {years.map((y) => (
          <button key={y} onClick={() => setActiveYear(y)}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
              activeYear === y ? "text-white" : "text-gray-500 hover:bg-gray-100"
            }`}
            style={activeYear === y ? { background: "#9333ea" } : {}}>
            {y}
          </button>
        ))}
      </div>

      {/* Month grid */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left pb-2 text-xs text-gray-400 font-semibold uppercase tracking-wide w-16">Mês</th>
                <th className="text-right pb-2 text-xs text-gray-400 font-semibold uppercase tracking-wide pr-2">
                  Valor líquido recebido ({isUSD ? "USD" : "R$"})
                </th>
                <th className="w-5" />
              </tr>
            </thead>
            <tbody>
              {MONTHS_PT.map((m, i) => {
                const month      = i + 1;
                const key        = `${activeYear}-${month}`;
                const isSaving   = saving[key];
                const val        = cellValues[key] ?? "";
                const hasRecord  = records.some((r) => r.year === activeYear && r.month === month);

                return (
                  <tr key={month} className={`border-b border-gray-50 transition-colors ${hasRecord ? "bg-emerald-50/40" : "hover:bg-gray-50/60"}`}>
                    <td className="py-1.5 pr-3 text-gray-600 font-medium text-sm">{m}</td>
                    <td className="py-1.5 text-right pr-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={val}
                        onChange={(e) => setCellValues((prev) => ({ ...prev, [key]: e.target.value }))}
                        onBlur={() => handleBlur(activeYear, month)}
                        placeholder="—"
                        className="text-right border border-transparent rounded px-2 py-0.5 w-36 text-sm font-mono hover:border-gray-200 focus:border-purple-400 focus:outline-none transition-colors bg-transparent"
                        style={hasRecord ? { color: "#059669", fontWeight: 600 } : { color: "#9ca3af" }}
                      />
                    </td>
                    <td className="py-1.5 pl-1 w-5">
                      {isSaving && (
                        <span className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin inline-block" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200">
                <td className="pt-2 text-xs text-gray-400 font-semibold uppercase">Total {activeYear}</td>
                <td className="pt-2 text-right font-bold text-sm pr-2" style={{ color: "#9333ea" }}>
                  {yearTotal > 0 ? fmt(yearTotal) : "—"}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Summary section */}
      {!loading && monthsCount > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Resumo geral</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <MetricChip label="Total recebido" value={fmt(totalAll)} color="#059669" bg="#ecfdf5"
              title="Soma de toda a renda registrada" />
            <MetricChip label="Média/mês" value={fmt(avgMonthly)} color="#059669" bg="#ecfdf5"
              title={`Baseado em ${monthsCount} meses registrados`} />
            {last12m > 0 && (
              <MetricChip label="Renda 12m" value={fmt(last12m)} color="#0369a1" bg="#eff6ff"
                title="Soma dos últimos 12 meses" />
            )}
            {purchasePrice > 0 && last12m > 0 && (
              <MetricChip label="Yield s/ compra" value={`${(last12m / purchasePrice * 100).toFixed(1)}% a.a.`}
                color="#0369a1" bg="#eff6ff" title="Renda 12m / Preço de compra × 100" />
            )}
            {currentValue > 0 && last12m > 0 && (
              <MetricChip label="Yield s/ valor" value={`${(last12m / currentValue * 100).toFixed(1)}% a.a.`}
                color="#7c3aed" bg="#faf5ff" title="Renda 12m / Valor atual × 100" />
            )}
            <MetricChip label="Meses lançados" value={`${monthsCount}`} color="#6b7280" bg="#f9fafb" />
          </div>
        </div>
      )}

      {!loading && monthsCount === 0 && (
        <p className="text-center text-gray-400 text-sm py-4">
          Nenhum lançamento registrado. Digite um valor em qualquer mês e pressione Tab ou clique fora para salvar.
        </p>
      )}
    </div>
  );
}

// ── Price Reference Panel ─────────────────────────────────────────────────────

function PriceRefPanel() {
  const [refs,    setRefs]    = useState([]);
  const [form,    setForm]    = useState({ cidade: "", bairro: "", preco_m2: "" });
  const [saving,  setSaving]  = useState(false);
  const [open,    setOpen]    = useState(false);

  const load = () => getPriceRefs().then((r) => setRefs(r.data)).catch(() => {});

  useEffect(() => { if (open) load(); }, [open]);

  const handleSave = async () => {
    if (!form.cidade || !form.preco_m2) return;
    setSaving(true);
    try {
      await upsertPriceRef({ cidade: form.cidade, bairro: form.bairro || null, preco_m2: parseFloat(form.preco_m2) });
      setForm({ cidade: "", bairro: "", preco_m2: "" });
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    await deletePriceRef(id);
    load();
  };

  return (
    <div className="card p-0 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <BarChart2 size={15} className="text-purple-500" />
          Referência de Preço/m² (alternativa FipeZAP)
        </span>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-50">
          <p className="text-xs text-gray-400 mt-3">
            Cadastre o preço médio de venda por m² da sua cidade/bairro para estimar o valor dos imóveis automaticamente.
            Use portais como ZAP Imóveis, OLX ou a FipeZAP para obter referências atualizadas.
          </p>

          <div className="flex gap-2 flex-wrap">
            {[
              { key: "cidade",   ph: "Cidade", w: "w-28" },
              { key: "bairro",   ph: "Bairro (opc.)", w: "w-28" },
              { key: "preco_m2", ph: "R$/m²", w: "w-24", type: "number" },
            ].map(({ key, ph, w, type }) => (
              <input
                key={key}
                type={type || "text"}
                placeholder={ph}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                className={`input-base ${w}`}
              />
            ))}
            <button
              onClick={handleSave}
              disabled={saving || !form.cidade || !form.preco_m2}
              className="text-sm px-3 py-1.5 rounded-lg font-medium text-white disabled:opacity-40"
              style={{ background: "#4a148c" }}
            >
              {saving ? "…" : "Salvar"}
            </button>
          </div>

          {refs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase text-gray-400 font-semibold border-b border-gray-100">
                    <th className="text-left pb-2 pr-4">Cidade</th>
                    <th className="text-left pb-2 pr-4">Bairro</th>
                    <th className="text-right pb-2 pr-4">R$/m²</th>
                    <th className="text-left pb-2 text-gray-300">Fonte</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {refs.map((r) => (
                    <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-4 font-medium text-gray-700">{r.cidade}</td>
                      <td className="py-2 pr-4 text-gray-500">{r.bairro || "—"}</td>
                      <td className="py-2 pr-4 text-right font-mono font-semibold text-purple-600">
                        {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.preco_m2)}
                      </td>
                      <td className="py-2 pr-2 text-gray-400 text-xs">{r.source}</td>
                      <td className="py-2">
                        <button onClick={() => handleDelete(r.id)}
                          className="p-1 rounded hover:bg-red-50 text-red-400"><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Property List View ────────────────────────────────────────────────────────

function PropertyListRow({ prop, onEdit, onUpdateVal, onHistory, onArchive, onZillow, onRental }) {
  const [zillowLoading, setZillowLoading] = useState(false);
  const isUSA  = prop.country === "Estados Unidos";
  const gainOk = (prop.gain_brl ?? 0) >= 0;

  const handleZillow = async () => {
    setZillowLoading(true);
    try { await onZillow(prop.id); } catch {} finally { setZillowLoading(false); }
  };

  return (
    <tr className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
      {/* Imóvel */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {isUSA && <span className="text-sm flex-shrink-0">🇺🇸</span>}
          <div>
            <p className="font-semibold text-gray-800 text-sm leading-tight">{prop.description}</p>
            {(prop.address || prop.cidade) && (
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <MapPin size={9} />
                {prop.address || [prop.bairro, prop.cidade].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>
      </td>
      {/* Tipo */}
      <td className="px-4 py-3">
        <TypeBadge type={prop.property_type} />
      </td>
      {/* Valor atual */}
      <td className="px-4 py-3 text-right">
        {isUSA ? (
          <>
            <p className="font-bold text-sm" style={{ color: "#1d4ed8" }}>{fmtUSD(prop.current_value_usd)}</p>
            <p className="text-xs text-gray-400">{fmtBRL(prop.current_value_brl)}</p>
          </>
        ) : (
          <p className="font-bold text-sm" style={{ color: "#9333ea" }}>{fmtBRL(prop.current_value_brl)}</p>
        )}
      </td>
      {/* Fonte */}
      <td className="px-4 py-3 text-center">
        <div className="flex flex-col items-center gap-1">
          <ValuationBadge source={prop.valuation_source} />
          {prop.stale_valuation && (
            <AlertTriangle size={11} className="text-amber-500" title="Valor desatualizado (>6 meses)" />
          )}
        </div>
      </td>
      {/* Última avaliação */}
      <td className="px-4 py-3 text-center text-xs text-gray-500">
        {fmtDate(prop.last_valuation_date)}
      </td>
      {/* Variação */}
      <td className="px-4 py-3 text-right">
        <p className="text-sm font-semibold" style={{ color: gainOk ? "#16a34a" : "#dc2626" }}>
          {prop.gain_pct != null ? `${prop.gain_pct >= 0 ? "+" : ""}${prop.gain_pct.toFixed(1)}%` : "—"}
        </p>
        <p className="text-xs text-gray-400">
          {prop.gain_brl != null ? `${gainOk ? "+" : ""}${fmtBRL(prop.gain_brl)}` : "—"}
        </p>
      </td>
      {/* Ações */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 justify-end flex-nowrap">
          <button onClick={() => onEdit(prop)}
            className="text-xs px-2 py-1 rounded hover:bg-purple-50 transition-colors font-medium"
            style={{ color: "#9333ea" }}>
            Editar
          </button>
          <button onClick={() => onUpdateVal(prop)}
            className="text-xs px-2 py-1 rounded hover:bg-blue-50 text-blue-600 transition-colors flex items-center gap-0.5">
            <TrendingUp size={11} /> Valor
          </button>
          <button onClick={() => onHistory(prop)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-500 transition-colors">
            <Clock size={12} />
          </button>
          <button onClick={() => onRental(prop)}
            className="p-1.5 rounded hover:bg-emerald-50 transition-colors"
            style={{ color: "#059669" }}
            title="Renda de locação">
            <Banknote size={12} />
          </button>
          {isUSA && (
            <button onClick={handleZillow} disabled={zillowLoading}
              className="p-1.5 rounded transition-colors flex items-center disabled:opacity-50"
              style={{ background: "#dcfce7", color: "#15803d" }}
              title="Atualizar via Rentcast">
              {zillowLoading
                ? <span className="w-3 h-3 border border-green-600 border-t-transparent rounded-full animate-spin" />
                : <Globe size={12} />}
            </button>
          )}
          <button onClick={() => onArchive(prop.id)}
            className="p-1.5 rounded hover:bg-red-50 text-red-400 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function PropertyListView({ properties, onEdit, onUpdateVal, onHistory, onArchive, onZillow, onRental }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100" style={{ background: "#f9fafb" }}>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Imóvel</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Tipo</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Valor Atual</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Fonte</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Últ. Avaliação</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Variação</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {properties.map((prop) => (
              <PropertyListRow
                key={prop.id}
                prop={prop}
                onEdit={onEdit}
                onUpdateVal={onUpdateVal}
                onHistory={onHistory}
                onArchive={onArchive}
                onZillow={onZillow}
                onRental={onRental}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Properties() {
  const [summary,     setSummary]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [propAlerts,  setPropAlerts]  = useState([]);
  const [showForm,    setShowForm]    = useState(false);
  const [editingProp, setEditingProp] = useState(null);
  const [valModal,    setValModal]    = useState(null);
  const [valInput,    setValInput]    = useState({ value: "", notes: "" });
  const [histModal,   setHistModal]   = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [viewMode,    setViewMode]    = useState(() => localStorage.getItem("properties_view_mode") || "cards");
  const [exporting,   setExporting]   = useState(false);
  const [rentalModal, setRentalModal] = useState(null);

  const refresh = () => {
    setLoading(true);
    Promise.all([
      getPropertySummary(),
      getPropertyAlerts().catch(() => ({ data: { items: [] } })),
    ]).then(([sr, ar]) => {
      setSummary(sr.data);
      setPropAlerts(ar.data.items || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const handleFormSaved = () => {
    setShowForm(false);
    setEditingProp(null);
    refresh();
  };

  const handleArchive = async (id) => {
    if (!window.confirm("Arquivar este imóvel?")) return;
    await archiveProperty(id);
    refresh();
  };

  const handleValSave = async () => {
    if (!valInput.value || !valModal) return;
    setSaving(true);
    const isUSA = valModal.currency === "USD";
    try {
      const payload = {
        valuation_date: new Date().toISOString().slice(0, 10),
        valuation_source: "manual",
        notes: valInput.notes || null,
      };
      if (isUSA) {
        payload.current_value_usd = parseFloat(valInput.value);
      } else {
        payload.current_value_brl = parseFloat(valInput.value);
      }
      await addPropertyValuation(valModal.id, payload);
      setValModal(null);
      setValInput({ value: "", notes: "" });
      refresh();
    } finally { setSaving(false); }
  };

  const handleHistory = async (prop) => {
    const r = await getPropertyValuations(prop.id);
    setHistModal({ property: prop, valuations: r.data });
  };

  const handlePhoto = async (propId, file) => {
    await uploadPropertyPhoto(propId, file);
    refresh();
  };

  const handleZillow = async (propId) => {
    const res = await updateZillowEstimate(propId);
    if (!res.data?.manual_fallback) refresh();
    return res.data;
  };

  const handleZillowManual = async (propId, valueUsd) => {
    await saveZillowManual(propId, valueUsd);
    refresh();
  };

  const handleRental = (prop) => setRentalModal(prop);

  const handleToggleView = (mode) => {
    setViewMode(mode);
    localStorage.setItem("properties_view_mode", mode);
  };

  const handleExportXlsx = async () => {
    setExporting(true);
    try {
      const res = await exportPropertiesXlsx();
      const blob = res.data;
      const today = new Date().toISOString().slice(0, 10);
      const filename = `imoveis_${today}.xlsx`;

      if (window.electronAPI?.saveXlsx) {
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        bytes.forEach((b) => { binary += String.fromCharCode(b); });
        await window.electronAPI.saveXlsx(btoa(binary), filename);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Erro ao exportar imóveis:", err);
    } finally {
      setExporting(false);
    }
  };

  const properties  = summary?.properties ?? [];
  const staleCount  = propAlerts.filter((a) => a.type === "stale_valuation").length;
  const belowCdiCount = propAlerts.filter((a) => a.type === "below_cdi").length;
  const hasUSA      = (summary?.count_usa ?? 0) > 0;
  const hasBrasil   = (summary?.count_brasil ?? 0) > 0;

  // Valuation modal: is USD property?
  const valIsUSA = valModal?.currency === "USD";

  return (
    <div className="space-y-6">

      {/* Header */}
      <div
        className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-4 flex items-center justify-between"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-800">Imóveis</h2>
          <p className="text-gray-400 text-sm">Patrimônio imobiliário</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Cards / Lista toggle */}
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => handleToggleView("cards")}
              className={`p-2 transition-colors ${viewMode === "cards" ? "bg-purple-100 text-purple-700" : "text-gray-400 hover:text-gray-600"}`}
              title="Cards"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              onClick={() => handleToggleView("list")}
              className={`p-2 transition-colors ${viewMode === "list" ? "bg-purple-100 text-purple-700" : "text-gray-400 hover:text-gray-600"}`}
              title="Lista"
            >
              <List size={15} />
            </button>
          </div>
          {/* Export */}
          <button
            onClick={handleExportXlsx}
            disabled={exporting || properties.length === 0}
            className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 disabled:opacity-40"
            title="Exportar para Excel"
          >
            {exporting
              ? <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
              : <FileDown size={13} />}
            {exporting ? "…" : "Excel"}
          </button>
          <button onClick={refresh} className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => { setEditingProp(null); setShowForm(true); }}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg text-white transition-all"
            style={{ background: "#4a148c" }}
          >
            <Plus size={14} /> Novo Imóvel
          </button>
        </div>
      </div>

      {/* Property alerts banner */}
      {propAlerts.length > 0 && (
        <div className="rounded-xl px-4 py-3 flex items-start gap-3"
          style={{ background: "#fffbeb", border: "1px solid #fde68a" }}>
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-700">
            {staleCount > 0 && <p>{staleCount} imóvel(is) com valor não atualizado há mais de 6 meses.</p>}
            {belowCdiCount > 0 && <p>{belowCdiCount} imóvel(is) com valorização abaixo do CDI acumulado.</p>}
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#9333ea18" }}>
            <Home size={20} style={{ color: "#9333ea" }} />
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total (BRL)</p>
            <p className="text-xl font-bold text-gray-800">{fmtBRL(summary?.total_brl ?? 0)}</p>
          </div>
        </div>

        {hasUSA && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "#1d4ed818" }}>
              <Globe size={20} style={{ color: "#1d4ed8" }} />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Total EUA (USD)</p>
              <p className="text-xl font-bold text-gray-800">{fmtUSD(summary?.total_usd_usa ?? 0)}</p>
              {hasBrasil && (
                <p className="text-xs text-gray-400">BR: {fmtBRL(summary?.total_brl_brasil ?? 0)}</p>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#16a34a18" }}>
            <TrendingUp size={20} style={{ color: summary?.total_gain_brl >= 0 ? "#16a34a" : "#dc2626" }} />
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Ganho Total</p>
            <p className="text-xl font-bold text-gray-800">{fmtBRL(Math.abs(summary?.total_gain_brl ?? 0))}</p>
            {summary?.total_brl && summary?.total_gain_brl ? (
              <p className="text-xs text-gray-400">
                {((summary.total_gain_brl / (summary.total_brl - summary.total_gain_brl)) * 100).toFixed(1)}%
              </p>
            ) : null}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#2563eb18" }}>
            <Building2 size={20} style={{ color: "#2563eb" }} />
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Imóveis Ativos</p>
            <p className="text-xl font-bold text-gray-800">{summary?.active_count ?? 0}</p>
            {hasUSA && hasBrasil && (
              <p className="text-xs text-gray-400">
                🇧🇷 {summary.count_brasil} · 🇺🇸 {summary.count_usa}
              </p>
            )}
          </div>
        </div>

        {!hasUSA && (
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: propAlerts.length > 0 ? "#d9770618" : "#16a34a18" }}>
              <AlertTriangle size={20} style={{ color: propAlerts.length > 0 ? "#d97706" : "#16a34a" }} />
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Alertas</p>
              <p className="text-xl font-bold text-gray-800">{propAlerts.length}</p>
              <p className="text-xs text-gray-400">{propAlerts.length > 0 ? "verificar" : "tudo ok"}</p>
            </div>
          </div>
        )}
      </div>

      {/* Country breakdown — only when both countries present */}
      {hasUSA && hasBrasil && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">🇧🇷 Imóveis Brasil</p>
            <p className="text-lg font-bold text-gray-800">{fmtBRL(summary.total_brl_brasil)}</p>
            <p className="text-xs text-gray-400">{summary.count_brasil} imóvel(is)</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">🇺🇸 Imóveis EUA</p>
            <p className="text-lg font-bold" style={{ color: "#1d4ed8" }}>{fmtUSD(summary.total_usd_usa)}</p>
            <p className="text-xs text-gray-400">{fmtBRL(summary.total_brl_usa)} · {summary.count_usa} imóvel(is)</p>
          </div>
        </div>
      )}

      {/* Price reference panel */}
      <PriceRefPanel />

      {/* Property list / cards */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : properties.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-16">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: "#fdf4ff" }}>
            <Home size={24} style={{ color: "#9333ea" }} />
          </div>
          <p className="text-gray-500 font-medium">Nenhum imóvel cadastrado.</p>
          <p className="text-gray-400 text-sm mt-1">Clique em "Novo Imóvel" para começar.</p>
        </div>
      ) : viewMode === "list" ? (
        <PropertyListView
          properties={properties}
          onEdit={(p) => { setEditingProp(p); setShowForm(true); }}
          onUpdateVal={(p) => {
            setValModal(p);
            const initVal = p.currency === "USD"
              ? String(p.current_value_usd ?? "")
              : String(p.current_value_brl ?? "");
            setValInput({ value: initVal, notes: "" });
          }}
          onHistory={handleHistory}
          onArchive={handleArchive}
          onZillow={handleZillow}
          onRental={handleRental}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {properties.map((prop) => (
            <PropertyCard
              key={prop.id}
              prop={prop}
              onEdit={(p) => { setEditingProp(p); setShowForm(true); }}
              onUpdateVal={(p) => {
                setValModal(p);
                const initVal = p.currency === "USD"
                  ? String(p.current_value_usd ?? "")
                  : String(p.current_value_brl ?? "");
                setValInput({ value: initVal, notes: "" });
              }}
              onHistory={handleHistory}
              onArchive={handleArchive}
              onPhoto={handlePhoto}
              onZillow={handleZillow}
              onZillowManual={handleZillowManual}
              onRental={handleRental}
            />
          ))}
        </div>
      )}

      {/* Form modal */}
      {showForm && (
        <PropertyFormModal
          editingProp={editingProp}
          onClose={() => { setShowForm(false); setEditingProp(null); }}
          onSaved={handleFormSaved}
        />
      )}

      {/* Valuation modal */}
      {valModal && (
        <Modal title={`Atualizar Valor — ${valModal.description}`} onClose={() => setValModal(null)}>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wide">
                Valor Atual ({valIsUSA ? "USD" : "R$"}){" "}
                <span className="normal-case text-gray-400">— hoje {new Date().toLocaleDateString("pt-BR")}</span>
              </p>
              <input type="number" step="0.01" min="0" value={valInput.value}
                onChange={(e) => setValInput((v) => ({ ...v, value: e.target.value }))}
                placeholder="0,00" className="input-base w-full text-lg font-semibold" autoFocus />
              {valIsUSA && valInput.value && (
                <p className="text-xs text-gray-400 mt-1">
                  ≈ {fmtBRL(parseFloat(valInput.value) * ((summary?.total_brl || 1) / (summary?.total_usd || 1) || 5))} (estimado pela cotação)
                </p>
              )}
            </div>
            {valModal.estimated_value_brl && !valIsUSA && (
              <div className="rounded-lg bg-purple-50 px-3 py-2 text-sm text-purple-700">
                Estimativa por preço/m²: <strong>{fmtBRL(valModal.estimated_value_brl)}</strong>
                <button className="ml-2 underline text-xs"
                  onClick={() => setValInput((v) => ({ ...v, value: String(valModal.estimated_value_brl) }))}>
                  usar
                </button>
              </div>
            )}
            {valIsUSA && valModal.zillow_zestimate_usd && (
              <div className="rounded-lg px-3 py-2 text-sm"
                style={{ background: "#dcfce7", color: "#15803d" }}>
                Zestimate Zillow: <strong>{fmtUSD(valModal.zillow_zestimate_usd)}</strong>
                {valModal.zillow_zestimate_date && (
                  <span className="text-xs ml-1 opacity-70">({fmtDate(valModal.zillow_zestimate_date)})</span>
                )}
                <button className="ml-2 underline text-xs"
                  onClick={() => setValInput((v) => ({ ...v, value: String(valModal.zillow_zestimate_usd) }))}>
                  usar
                </button>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wide">Fonte / Observação</p>
              <input type="text" value={valInput.notes}
                onChange={(e) => setValInput((v) => ({ ...v, notes: e.target.value }))}
                placeholder='ex: "Avaliação banco", "Zillow"' className="input-base w-full" />
            </div>
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button onClick={() => setValModal(null)} className="btn-secondary text-sm">Cancelar</button>
              <button onClick={handleValSave} disabled={saving || !valInput.value}
                className="text-sm px-5 py-2 rounded-lg font-medium text-white disabled:opacity-50"
                style={{ background: "#9333ea" }}>
                {saving ? "Salvando…" : "Salvar Avaliação"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rental income modal */}
      {rentalModal && (
        <Modal title={`Renda de Locação — ${rentalModal.description}`} onClose={() => setRentalModal(null)} wide>
          <RentalIncomePanel
            propertyId={rentalModal.id}
            currency={rentalModal.currency}
            purchasePrice={
              rentalModal.currency === "USD"
                ? rentalModal.purchase_price_usd
                : rentalModal.purchase_price_brl
            }
            currentValue={
              rentalModal.currency === "USD"
                ? rentalModal.current_value_usd
                : rentalModal.current_value_brl
            }
          />
        </Modal>
      )}

      {/* History modal */}
      {histModal && (
        <Modal title={`Histórico — ${histModal.property.description}`} onClose={() => setHistModal(null)} wide>
          <div className="space-y-4">
            {histModal.valuations.length === 0 ? (
              <p className="text-center text-gray-400 py-8">Nenhuma avaliação registrada ainda.</p>
            ) : (
              <>
                <HistoryChart valuations={histModal.valuations} currency={histModal.property.currency} />
                <div className="overflow-auto" style={{ maxHeight: 200 }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase text-gray-400 font-semibold border-b border-gray-100">
                        <th className="text-left pb-2">Data</th>
                        <th className="text-right pb-2">Valor</th>
                        <th className="text-left pb-2 pl-4">Fonte</th>
                        <th className="text-left pb-2 pl-2">Obs.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...histModal.valuations].reverse().map((v) => {
                        const isUSD = histModal.property.currency === "USD";
                        return (
                          <tr key={v.id} className="border-b border-gray-50">
                            <td className="py-1.5 text-gray-600">{fmtDate(v.valuation_date)}</td>
                            <td className="py-1.5 text-right font-mono font-semibold" style={{ color: "#9333ea" }}>
                              {isUSD && v.current_value_usd
                                ? <>{fmtUSD(v.current_value_usd)} <span className="text-gray-400 text-xs">/ {fmtBRL(v.current_value_brl)}</span></>
                                : fmtBRL(v.current_value_brl)
                              }
                            </td>
                            <td className="py-1.5 pl-4">
                              <ValuationBadge source={v.valuation_source || "manual"} />
                            </td>
                            <td className="py-1.5 pl-2 text-gray-400 text-xs">{v.notes || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
