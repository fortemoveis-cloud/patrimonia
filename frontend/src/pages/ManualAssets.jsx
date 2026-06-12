import { useEffect, useState } from "react";
import { getManualAssets, createManualAsset, updateManualAssetValue, getManualAssetHistory, archiveManualAsset } from "../api/client";
import { PenLine, Plus, X, ChevronDown, ChevronUp, Trash2, RefreshCw } from "lucide-react";

const ASSET_TYPES = [
  { value: "fixed_income", label: "Renda Fixa" },
  { value: "equity",       label: "Renda Variável" },
  { value: "fund",         label: "Fundo" },
  { value: "cash",         label: "Caixa / Conta" },
  { value: "other",        label: "Outro" },
];

const fmtBRL = (v, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v ?? 0);

const EMPTY_FORM = {
  name: "", asset_type: "other", currency: "BRL",
  institution_name: "", quantity: "", current_value: "", notes: "", owner: "",
};

function FormField({ label, children }) {
  return (
    <div>
      <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300";

export default function ManualAssets() {
  const [assets, setAssets]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [expanded, setExpanded]   = useState({});   // asset_id → history[]
  const [updatingId, setUpdatingId] = useState(null);
  const [updateForm, setUpdateForm] = useState({ value: "", date: "" });

  const refresh = () => {
    setLoading(true);
    getManualAssets().then((r) => setAssets(r.data)).finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createManualAsset({
        ...form,
        quantity:      form.quantity      !== "" ? parseFloat(form.quantity)      : null,
        current_value: parseFloat(form.current_value),
        institution_name: form.institution_name || null,
        notes:         form.notes         || null,
        owner:         form.owner         || null,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateValue = async (asset) => {
    if (!updateForm.value) return;
    setSaving(true);
    try {
      await updateManualAssetValue(asset.id, {
        value: parseFloat(updateForm.value),
        date:  updateForm.date || undefined,
      });
      setUpdatingId(null);
      setUpdateForm({ value: "", date: "" });
      refresh();
      // refresh history if expanded
      if (expanded[asset.id]) {
        getManualAssetHistory(asset.id).then((r) =>
          setExpanded((prev) => ({ ...prev, [asset.id]: r.data }))
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleHistory = async (id) => {
    if (expanded[id] !== undefined) {
      setExpanded((prev) => { const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    const r = await getManualAssetHistory(id);
    setExpanded((prev) => ({ ...prev, [id]: r.data }));
  };

  const handleArchive = async (id) => {
    if (!window.confirm("Arquivar este ativo?")) return;
    await archiveManualAsset(id);
    refresh();
  };

  const typeLabel = (v) => ASSET_TYPES.find((t) => t.value === v)?.label ?? v;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PenLine size={22} className="text-indigo-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Ativos Manuais</h1>
            <p className="text-sm text-gray-500">Cadastre e atualize ativos não importados automaticamente</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: "#4f46e5" }}
        >
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? "Cancelar" : "Novo ativo"}
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
          <p className="font-semibold text-gray-800 text-sm">Novo ativo manual</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Nome *">
              <input className={inputCls} value={form.name} onChange={set("name")} required placeholder="Ex: Tesouro Direto IPCA+" />
            </FormField>
            <FormField label="Categoria">
              <select className={inputCls} value={form.asset_type} onChange={set("asset_type")}>
                {ASSET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </FormField>
            <FormField label="Valor atual *">
              <input className={inputCls} type="number" step="0.01" min="0.01" value={form.current_value}
                onChange={set("current_value")} required placeholder="0,00" />
            </FormField>
            <FormField label="Moeda">
              <select className={inputCls} value={form.currency} onChange={set("currency")}>
                <option value="BRL">BRL — Real</option>
                <option value="USD">USD — Dólar</option>
              </select>
            </FormField>
            <FormField label="Instituição (opcional)">
              <input className={inputCls} value={form.institution_name} onChange={set("institution_name")} placeholder="Ex: Tesouro Nacional" />
            </FormField>
            <FormField label="Quantidade (opcional)">
              <input className={inputCls} type="number" step="any" value={form.quantity} onChange={set("quantity")} placeholder="Ex: 10" />
            </FormField>
            <FormField label="Titular (opcional)">
              <input className={inputCls} value={form.owner} onChange={set("owner")} placeholder="Ex: Vanessa" />
            </FormField>
            <FormField label="Observações (opcional)">
              <input className={inputCls} value={form.notes} onChange={set("notes")} placeholder="Notas livres" />
            </FormField>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowForm(false)}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 border border-gray-200 hover:bg-gray-50">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "#4f46e5" }}>
              {saving ? "Salvando…" : "Cadastrar"}
            </button>
          </div>
        </form>
      )}

      {/* Asset list */}
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-8">Carregando…</p>
      ) : assets.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
          <PenLine size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">Nenhum ativo manual cadastrado.</p>
          <p className="text-xs text-gray-400 mt-1">Clique em "Novo ativo" para começar.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Categoria</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Instituição</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Valor atual</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Atualizado em</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <>
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                    <td className="px-4 py-3 text-gray-500">{typeLabel(a.asset_type)}</td>
                    <td className="px-4 py-3 text-gray-500">{a.institution_name || "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {a.current_value != null ? fmtBRL(a.current_value, a.currency) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 text-xs">{a.last_updated || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => { setUpdatingId(updatingId === a.id ? null : a.id); setUpdateForm({ value: "", date: "" }); }}
                          title="Atualizar valor"
                          className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500 transition-colors"
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          onClick={() => toggleHistory(a.id)}
                          title="Histórico"
                          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                        >
                          {expanded[a.id] !== undefined ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                        <button
                          onClick={() => handleArchive(a.id)}
                          title="Arquivar"
                          className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Inline update form */}
                  {updatingId === a.id && (
                    <tr key={`upd-${a.id}`} className="bg-indigo-50 border-b border-indigo-100">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="flex items-center gap-3 flex-wrap">
                          <p className="text-xs font-medium text-indigo-700">Novo valor para <strong>{a.name}</strong>:</p>
                          <input
                            type="number" step="0.01" min="0.01"
                            placeholder="Valor (R$)"
                            value={updateForm.value}
                            onChange={(e) => setUpdateForm((f) => ({ ...f, value: e.target.value }))}
                            className="border border-indigo-200 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <input
                            type="date"
                            value={updateForm.date}
                            onChange={(e) => setUpdateForm((f) => ({ ...f, date: e.target.value }))}
                            className="border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                          />
                          <button
                            onClick={() => handleUpdateValue(a)}
                            disabled={saving || !updateForm.value}
                            className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                            style={{ background: "#4f46e5" }}
                          >
                            {saving ? "…" : "Salvar"}
                          </button>
                          <button onClick={() => setUpdatingId(null)} className="text-xs text-gray-400 hover:text-gray-600">
                            Cancelar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {/* Expanded history */}
                  {expanded[a.id] !== undefined && (
                    <tr key={`hist-${a.id}`} className="bg-gray-50 border-b border-gray-100">
                      <td colSpan={6} className="px-6 py-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Histórico de valores</p>
                        {expanded[a.id].length === 0 ? (
                          <p className="text-xs text-gray-400">Sem histórico registrado.</p>
                        ) : (
                          <div className="flex flex-wrap gap-3">
                            {expanded[a.id].map((h) => (
                              <div key={h.date} className="bg-white rounded-lg px-3 py-2 text-xs border border-gray-100 shadow-sm">
                                <p className="text-gray-400">{h.date}</p>
                                <p className="font-semibold text-gray-800">{fmtBRL(h.value, a.currency)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
