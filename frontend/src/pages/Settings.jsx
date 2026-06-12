import { useEffect, useState, useCallback } from "react";
import { Settings2, Eye, EyeOff, GripVertical, Check, X } from "lucide-react";
import { getImportSources, updateImportSource, reorderImportSources, getAppSettings, updateAppSetting } from "../api/client";

const inputCls =
  "border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 w-full";

function LabelCell({ source, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(source.custom_label ?? "");

  const commit = async () => {
    await onSave(source.id, { custom_label: value || null });
    setEditing(false);
  };

  const cancel = () => {
    setValue(source.custom_label ?? "");
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          className={inputCls}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={source.default_label}
          autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
        />
        <button onClick={commit} className="p-1 text-green-600 hover:text-green-700"><Check size={14} /></button>
        <button onClick={cancel} className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-left w-full hover:bg-indigo-50 rounded px-2 py-0.5 transition-colors group"
      title="Clique para editar"
    >
      {source.custom_label
        ? <span className="text-gray-900 font-medium">{source.custom_label}</span>
        : <span className="text-gray-400 italic">{source.default_label}</span>
      }
      <span className="text-indigo-400 text-xs ml-1 opacity-0 group-hover:opacity-100">editar</span>
    </button>
  );
}

function VisibleToggle({ source, onToggle }) {
  return (
    <button
      onClick={() => onToggle(source.id, !source.visible)}
      title={source.visible ? "Ocultar no dashboard" : "Mostrar no dashboard"}
      className={`p-1.5 rounded-lg transition-colors ${
        source.visible
          ? "text-green-600 hover:bg-green-50"
          : "text-gray-300 hover:bg-gray-100"
      }`}
    >
      {source.visible ? <Eye size={16} /> : <EyeOff size={16} />}
    </button>
  );
}

const CLASS_OPTIONS = [
  { key: "equity",       label: "Renda Variável" },
  { key: "fixed_income", label: "Renda Fixa" },
  { key: "fund",         label: "Fundos" },
  { key: "cash",         label: "Caixa" },
];

export default function Settings() {
  const [sources, setSources]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [dragId, setDragId]         = useState(null);
  const [saving, setSaving]         = useState(false);
  const [appSettings, setAppSettings] = useState({});

  const refresh = useCallback(() => {
    setLoading(true);
    getImportSources()
      .then((r) => setSources(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    getAppSettings().then((r) => setAppSettings(r.data)).catch(() => {});
  }, []);

  const handleAppSetting = async (key, value) => {
    setSaving(true);
    try {
      await updateAppSetting(key, String(value));
      setAppSettings((prev) => ({ ...prev, [key]: String(value) }));
    } finally {
      setSaving(false);
    }
  };

  const toggleClass = (key) => {
    const current = (appSettings.alert_monitored_classes ?? "equity,fixed_income,fund,cash")
      .split(",").filter(Boolean);
    const next = current.includes(key) ? current.filter((c) => c !== key) : [...current, key];
    handleAppSetting("alert_monitored_classes", next.join(","));
  };

  const handleSave = async (id, payload) => {
    setSaving(true);
    try {
      await updateImportSource(id, payload);
      setSources((prev) =>
        prev.map((s) => s.id === id ? { ...s, ...payload, label: payload.custom_label ?? s.default_label } : s)
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (id, visible) => {
    await handleSave(id, { visible });
  };

  // ── Drag-to-reorder ──────────────────────────────────────────────────────────
  const handleDragStart = (e, id) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e, id) => {
    e.preventDefault();
    if (dragId === null || dragId === id) return;
    setSources((prev) => {
      const from = prev.findIndex((s) => s.id === dragId);
      const to   = prev.findIndex((s) => s.id === id);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleDrop = async () => {
    setDragId(null);
    const orderedIds = sources.map((s) => s.id);
    await reorderImportSources(orderedIds);
  };

  // Group by institution_name for display
  const grouped = sources.reduce((acc, s) => {
    const g = s.institution_name;
    if (!acc[g]) acc[g] = [];
    acc[g].push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Settings2 size={22} className="text-indigo-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Configurações</h1>
          <p className="text-sm text-gray-500">Personalize como cada fonte aparece no dashboard</p>
        </div>
        {saving && <span className="text-xs text-indigo-500 ml-auto">Salvando…</span>}
      </div>

      {/* Institutions & Accounts section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">Instituições e Contas</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Clique no nome para editar • arraste <GripVertical size={11} className="inline" /> para reordenar •{" "}
            <Eye size={11} className="inline" /> para mostrar/ocultar no gráfico do dashboard
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400 text-center py-10">Carregando…</p>
        ) : sources.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">
            Nenhuma fonte encontrada. Importe um extrato primeiro.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {Object.entries(grouped).map(([instName, rows]) => (
              <div key={instName}>
                <div className="px-5 py-2 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{instName}</p>
                </div>
                {rows.map((src) => (
                  <div
                    key={src.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, src.id)}
                    onDragOver={(e) => handleDragOver(e, src.id)}
                    onDrop={handleDrop}
                    className={`flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors ${
                      dragId === src.id ? "opacity-50" : ""
                    }`}
                  >
                    {/* Drag handle */}
                    <GripVertical size={14} className="text-gray-300 cursor-grab flex-shrink-0" />

                    {/* Account badge */}
                    <div className="w-28 flex-shrink-0">
                      {src.account_number ? (
                        <span className="text-xs bg-gray-100 text-gray-500 rounded px-2 py-0.5 font-mono">
                          {src.account_number}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 italic">— sem conta</span>
                      )}
                    </div>

                    {/* Label editor */}
                    <div className="flex-1 min-w-0">
                      <LabelCell source={src} onSave={handleSave} />
                      {src.custom_label && (
                        <p className="text-xs text-gray-400 mt-0.5 pl-2">
                          padrão: {src.default_label}
                        </p>
                      )}
                    </div>

                    {/* Visible toggle */}
                    <VisibleToggle source={src} onToggle={handleToggle} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 text-center">
        Fontes ocultas continuam contando no patrimônio total — apenas somem do gráfico de distribuição por instituição.
      </p>

      {/* ── Alertas ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800 text-sm">Alertas</h2>
          <p className="text-xs text-gray-500 mt-0.5">Parâmetros para detecção de quedas e vencimentos</p>
        </div>
        <div className="p-5 space-y-5">
          {/* Threshold */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-700">Queda mínima para alerta</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" max="100" step="0.5"
                value={appSettings.alert_drop_threshold_pct ?? "10"}
                onChange={(e) => handleAppSetting("alert_drop_threshold_pct", e.target.value)}
                className={inputCls + " w-20 text-right"}
              />
              <span className="text-sm text-gray-400">%</span>
            </div>
          </div>

          {/* Maturity window */}
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-700">Janela de alerta de vencimento</label>
            <div className="flex items-center gap-2">
              <input
                type="number" min="1" max="365" step="1"
                value={appSettings.alert_maturity_days ?? "90"}
                onChange={(e) => handleAppSetting("alert_maturity_days", e.target.value)}
                className={inputCls + " w-20 text-right"}
              />
              <span className="text-sm text-gray-400">dias</span>
            </div>
          </div>

          {/* Monitored classes */}
          <div>
            <p className="text-sm text-gray-700 mb-2">Classes monitoradas por quedas</p>
            <div className="grid grid-cols-2 gap-2">
              {CLASS_OPTIONS.map(({ key, label }) => {
                const current = (appSettings.alert_monitored_classes ?? "equity,fixed_income,fund,cash")
                  .split(",").filter(Boolean);
                return (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={current.includes(key)}
                      onChange={() => toggleClass(key)}
                      className="accent-indigo-600"
                    />
                    {label}
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
