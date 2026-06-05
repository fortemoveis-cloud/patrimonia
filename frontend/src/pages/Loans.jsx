import { useEffect, useState } from "react";
import { getLoanSummary, createLoan, updateLoan, archiveLoan } from "../api/client";
import StatCard from "../components/StatCard";
import { CreditCard, Plus, X, Check, Trash2 } from "lucide-react";

const INSTITUTIONS = ["Regions Bank", "XP Investimentos", "Banco Inter"];

const fmtMoney = (v, currency = "USD") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v ?? 0);

const fmtUSD = (v) => fmtMoney(v, "USD");
const fmtBRL = (v) => fmtMoney(v, "BRL");

const EMPTY_FORM = {
  description: "",
  institution_name: "Regions Bank",
  currency: "USD",
  outstanding_balance: "",
  interest_rate: "",
  maturity_date: "",
  loan_number: "",
};

function FormField({ label, children }) {
  return (
    <div>
      <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wide">{label}</p>
      {children}
    </div>
  );
}

export default function Loans() {
  const [summary, setSummary]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [editingId, setEditingId]     = useState(null);
  const [editBalance, setEditBalance] = useState("");

  const refresh = () => {
    setLoading(true);
    getLoanSummary()
      .then((r) => setSummary(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createLoan({
        ...form,
        outstanding_balance: form.outstanding_balance !== "" ? parseFloat(form.outstanding_balance) : null,
        interest_rate:       form.interest_rate       !== "" ? parseFloat(form.interest_rate) / 100 : null,
        maturity_date:       form.maturity_date       || null,
        loan_number:         form.loan_number         || null,
        institution_name:    form.institution_name    || null,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateBalance = async (loan) => {
    if (editBalance === "") return;
    setSaving(true);
    try {
      await updateLoan(loan.id, {
        description:         loan.description,
        institution_name:    loan.institution_name,
        currency:            loan.currency,
        outstanding_balance: parseFloat(editBalance),
        interest_rate:       loan.interest_rate,
        maturity_date:       loan.maturity_date,
      });
      setEditingId(null);
      setEditBalance("");
      refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id) => {
    if (!window.confirm("Arquivar este empréstimo?")) return;
    await archiveLoan(id);
    refresh();
  };

  const loans = summary?.loans ?? [];

  return (
    <div className="space-y-6">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 -mx-6 px-6 pt-6 pb-4 flex items-center justify-between"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-800">Empréstimos</h2>
          <p className="text-gray-400 text-sm">Passivos e obrigações financeiras</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); if (showForm) setForm(EMPTY_FORM); }}
          className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all"
          style={{ background: showForm ? "#f1f5f9" : "#4a148c", color: showForm ? "#64748b" : "#fff" }}
        >
          {showForm ? <X size={14} /> : <Plus size={14} />}
          {showForm ? "Cancelar" : "Novo Empréstimo"}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Devido (USD)" value={fmtUSD(summary?.total_usd ?? 0)} color="red"    icon={CreditCard} />
        <StatCard title="Total Devido (BRL)" value={fmtBRL(summary?.total_brl ?? 0)} color="red"    icon={CreditCard} />
        <StatCard
          title="Empréstimos Ativos"
          value={String(summary?.active_count ?? 0)}
          sub="posições em aberto"
          color="yellow"
          icon={CreditCard}
        />
      </div>

      {/* Add form */}
      {showForm && (
        <div className="card">
          <p className="text-sm font-semibold text-gray-700 mb-5">Cadastrar Empréstimo</p>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FormField label="Descrição">
              <input
                required
                value={form.description}
                onChange={set("description")}
                placeholder="ex: Empréstimo Imobiliário"
                className="input-base w-full"
              />
            </FormField>

            <FormField label="Instituição">
              <select value={form.institution_name} onChange={set("institution_name")} className="input-base w-full">
                {INSTITUTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                <option value="">Outro</option>
              </select>
            </FormField>

            <FormField label="Moeda">
              <select value={form.currency} onChange={set("currency")} className="input-base w-full">
                <option value="USD">USD — Dólar</option>
                <option value="BRL">BRL — Real</option>
              </select>
            </FormField>

            <FormField label="Saldo Devedor Atual">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.outstanding_balance}
                onChange={set("outstanding_balance")}
                placeholder="0.00"
                className="input-base w-full"
              />
            </FormField>

            <FormField label="Taxa de Juros (% a.a.)">
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.interest_rate}
                onChange={set("interest_rate")}
                placeholder="ex: 8.5"
                className="input-base w-full"
              />
            </FormField>

            <FormField label="Vencimento">
              <input
                type="date"
                value={form.maturity_date}
                onChange={set("maturity_date")}
                className="input-base w-full"
              />
            </FormField>

            <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button type="button" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }} className="btn-secondary text-sm">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="text-sm px-5 py-2 rounded-lg font-medium text-white disabled:opacity-50 transition-all"
                style={{ background: "#4a148c" }}
              >
                {saving ? "Salvando…" : "Salvar Empréstimo"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : loans.length === 0 ? (
        <div className="card text-center py-16">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "#fef2f2" }}>
            <CreditCard size={24} style={{ color: "#dc2626" }} />
          </div>
          <p className="text-gray-500 font-medium">Nenhum empréstimo cadastrado.</p>
          <p className="text-gray-400 text-sm mt-1">Clique em "Novo Empréstimo" para adicionar.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "2px solid #e5e7eb" }}>
                  {["Descrição", "Instituição", "Moeda", "Saldo Devedor", "Taxa a.a.", "Vencimento", ""].map((h) => (
                    <th
                      key={h}
                      className={`px-4 py-3 text-xs uppercase tracking-wide font-semibold text-gray-500 ${
                        h === "Saldo Devedor" || h === "Taxa a.a." || h === "Vencimento" ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loans.map((loan, idx) => (
                  <tr
                    key={loan.id}
                    className={`transition-colors hover:bg-[#eef2ff] ${idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fc]"}`}
                    style={{ borderBottom: "1px solid #f9fafb" }}
                  >
                    <td className="px-4 py-3 font-bold" style={{ color: "#1a1a2e" }}>{loan.description}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: "#4a4a6a" }}>{loan.institution_name || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold" style={{ color: "#4a4a6a" }}>{loan.currency}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: "#c0392b" }}>
                      {editingId === loan.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editBalance}
                          onChange={(e) => setEditBalance(e.target.value)}
                          className="input-base text-right w-40 text-sm"
                          autoFocus
                        />
                      ) : (
                        fmtMoney(loan.outstanding_balance, loan.currency)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm" style={{ color: "#4a4a6a" }}>
                      {loan.interest_rate != null ? `${(loan.interest_rate * 100).toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: "#4a4a6a" }}>
                      {loan.maturity_date || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {editingId === loan.id ? (
                          <>
                            <button
                              onClick={() => handleUpdateBalance(loan)}
                              disabled={saving}
                              className="p-1.5 rounded-lg hover:bg-green-50 transition-colors"
                              style={{ color: "#16a34a" }}
                              title="Confirmar"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => { setEditingId(null); setEditBalance(""); }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                              title="Cancelar"
                            >
                              <X size={14} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => { setEditingId(loan.id); setEditBalance(String(loan.outstanding_balance ?? "")); }}
                              className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-purple-50 transition-colors"
                              style={{ color: "#4a148c" }}
                            >
                              Editar
                            </button>
                            <button
                              onClick={() => handleArchive(loan.id)}
                              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              style={{ color: "#dc2626" }}
                              title="Arquivar"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
