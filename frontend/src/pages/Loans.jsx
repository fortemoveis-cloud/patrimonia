import { useEffect, useState } from "react";
import {
  getLoanSummary, createLoan, archiveLoan,
  getLoanEvents, createLoanPayment, payoffLoan, setLoanBalance, deleteLoanEvent,
} from "../api/client";
import StatCard from "../components/StatCard";
import { CreditCard, Plus, X, Trash2, ChevronDown, ChevronUp, Banknote, CheckCircle2 } from "lucide-react";

const INSTITUTIONS = ["Regions Bank", "XP Investimentos", "Banco Inter"];

const fmtMoney = (v, currency = "USD") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(v ?? 0);

const fmtUSD = (v) => fmtMoney(v, "USD");
const fmtBRL = (v) => fmtMoney(v, "BRL");
const fmtDate = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const todayISO = () => new Date().toISOString().slice(0, 10);

const EVENT_LABELS = {
  balance_set: "Ajuste de saldo",
  payment:     "Pagamento",
  payoff:      "Quitação",
};

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
  const [error, setError]       = useState(null);

  // Histórico expandido: loanId → events[]
  const [expanded, setExpanded] = useState({});
  // Lançamento inline: { loanId, mode: 'payment' | 'balance' } | null
  const [entry, setEntry]       = useState(null);
  const [entryForm, setEntryForm] = useState({ amount: "", date: todayISO(), notes: "" });

  const refresh = () => {
    setLoading(true);
    getLoanSummary()
      .then((r) => setSummary(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const apiError = (err, fallback) =>
    setError(err?.response?.data?.detail || fallback);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
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
    } catch (err) {
      apiError(err, "Erro ao salvar empréstimo.");
    } finally {
      setSaving(false);
    }
  };

  const loadEvents = async (loanId) => {
    const r = await getLoanEvents(loanId);
    setExpanded((prev) => ({ ...prev, [loanId]: r.data }));
  };

  const toggleHistory = async (loanId) => {
    if (expanded[loanId] !== undefined) {
      setExpanded((prev) => { const n = { ...prev }; delete n[loanId]; return n; });
      return;
    }
    await loadEvents(loanId);
  };

  const afterEvent = async (loanId) => {
    setEntry(null);
    setEntryForm({ amount: "", date: todayISO(), notes: "" });
    refresh();
    if (expanded[loanId] !== undefined) await loadEvents(loanId);
  };

  const handleSaveEntry = async (loan) => {
    if (entryForm.amount === "" || !entryForm.date) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        amount: parseFloat(entryForm.amount),
        date:   entryForm.date,
        notes:  entryForm.notes || null,
      };
      if (entry.mode === "payment") await createLoanPayment(loan.id, payload);
      else                          await setLoanBalance(loan.id, payload);
      await afterEvent(loan.id);
    } catch (err) {
      apiError(err, "Erro ao registrar o lançamento.");
    } finally {
      setSaving(false);
    }
  };

  const handlePayoff = async (loan) => {
    if (!window.confirm(`Quitar "${loan.description}"? O saldo devedor será zerado (o histórico fica registrado).`)) return;
    setSaving(true);
    setError(null);
    try {
      await payoffLoan(loan.id, { date: todayISO(), notes: null });
      await afterEvent(loan.id);
    } catch (err) {
      apiError(err, "Erro ao quitar o empréstimo.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (loanId, ev) => {
    if (!window.confirm(`Remover o lançamento "${EVENT_LABELS[ev.event_type]}" de ${fmtDate(ev.event_date)}? O saldo será recalculado.`)) return;
    setError(null);
    try {
      await deleteLoanEvent(loanId, ev.id);
      refresh();
      await loadEvents(loanId);
    } catch (err) {
      apiError(err, "Erro ao remover o lançamento.");
    }
  };

  const handleArchive = async (id) => {
    if (!window.confirm("Arquivar este empréstimo?")) return;
    await archiveLoan(id);
    refresh();
  };

  const openEntry = (loanId, mode) => {
    setEntry({ loanId, mode });
    setEntryForm({ amount: "", date: todayISO(), notes: "" });
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

      {error && (
        <div className="rounded-xl px-4 py-3 flex items-center justify-between text-sm font-medium text-red-700"
          style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={14} /></button>
        </div>
      )}

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
                  <LoanRows
                    key={loan.id}
                    loan={loan}
                    idx={idx}
                    saving={saving}
                    events={expanded[loan.id]}
                    entry={entry?.loanId === loan.id ? entry : null}
                    entryForm={entryForm}
                    setEntryForm={setEntryForm}
                    onToggleHistory={() => toggleHistory(loan.id)}
                    onOpenEntry={(mode) => openEntry(loan.id, mode)}
                    onCancelEntry={() => setEntry(null)}
                    onSaveEntry={() => handleSaveEntry(loan)}
                    onPayoff={() => handlePayoff(loan)}
                    onDeleteEvent={(ev) => handleDeleteEvent(loan.id, ev)}
                    onArchive={() => handleArchive(loan.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function LoanRows({
  loan, idx, saving, events, entry, entryForm, setEntryForm,
  onToggleHistory, onOpenEntry, onCancelEntry, onSaveEntry,
  onPayoff, onDeleteEvent, onArchive,
}) {
  const isPaidOff = loan.paid_off || loan.outstanding_balance === 0;
  const isExpanded = events !== undefined;

  return (
    <>
      <tr
        className={`transition-colors hover:bg-[#eef2ff] ${idx % 2 === 0 ? "bg-white" : "bg-[#f8f9fc]"}`}
        style={{ borderBottom: "1px solid #f9fafb" }}
      >
        <td className="px-4 py-3 font-bold" style={{ color: "#1a1a2e" }}>
          <span className="flex items-center gap-2">
            {loan.description}
            {isPaidOff && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: "#dcfce7", color: "#15803d" }}>
                <CheckCircle2 size={10} /> Quitado
              </span>
            )}
          </span>
        </td>
        <td className="px-4 py-3 text-sm" style={{ color: "#4a4a6a" }}>{loan.institution_name || "—"}</td>
        <td className="px-4 py-3 font-mono text-xs font-semibold" style={{ color: "#4a4a6a" }}>{loan.currency}</td>
        <td className="px-4 py-3 text-right font-mono font-semibold" style={{ color: isPaidOff ? "#16a34a" : "#c0392b" }}>
          {fmtMoney(loan.outstanding_balance, loan.currency)}
        </td>
        <td className="px-4 py-3 text-right font-mono text-sm" style={{ color: "#4a4a6a" }}>
          {loan.interest_rate != null ? `${(loan.interest_rate * 100).toFixed(2)}%` : "—"}
        </td>
        <td className="px-4 py-3 text-right text-xs" style={{ color: "#4a4a6a" }}>
          {loan.maturity_date || "—"}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1 flex-wrap">
            {!isPaidOff && (
              <button
                onClick={() => onOpenEntry("payment")}
                className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-green-50 transition-colors flex items-center gap-1"
                style={{ color: "#15803d" }}
                title="Registrar pagamento (abate o saldo)"
              >
                <Banknote size={12} /> Pagamento
              </button>
            )}
            {!isPaidOff && (
              <button
                onClick={onPayoff}
                disabled={saving}
                className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-green-50 transition-colors"
                style={{ color: "#15803d" }}
                title="Quitar (zera o saldo devedor)"
              >
                Quitar
              </button>
            )}
            <button
              onClick={() => onOpenEntry("balance")}
              className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-purple-50 transition-colors"
              style={{ color: "#4a148c" }}
              title="Definir o saldo devedor nesta data"
            >
              Ajustar Saldo
            </button>
            <button
              onClick={onToggleHistory}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              title="Histórico de lançamentos"
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              onClick={onArchive}
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
              style={{ color: "#dc2626" }}
              title="Arquivar"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>

      {/* Lançamento inline (pagamento ou ajuste de saldo) */}
      {entry && (
        <tr style={{ background: entry.mode === "payment" ? "#f0fdf4" : "#faf5ff" }}>
          <td colSpan={7} className="px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs font-semibold" style={{ color: entry.mode === "payment" ? "#15803d" : "#4a148c" }}>
                {entry.mode === "payment"
                  ? <>Registrar pagamento de <strong>{loan.description}</strong>:</>
                  : <>Novo saldo devedor de <strong>{loan.description}</strong>:</>}
              </p>
              <input
                type="number" step="0.01" min={entry.mode === "payment" ? "0.01" : "0"}
                placeholder={`Valor (${loan.currency})`}
                value={entryForm.amount}
                onChange={(e) => setEntryForm((f) => ({ ...f, amount: e.target.value }))}
                className="input-base text-sm w-40"
                autoFocus
              />
              <input
                type="date"
                value={entryForm.date}
                max={todayISO()}
                onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))}
                className="input-base text-sm"
              />
              <input
                type="text"
                placeholder="Observação (opcional)"
                value={entryForm.notes}
                onChange={(e) => setEntryForm((f) => ({ ...f, notes: e.target.value }))}
                className="input-base text-sm w-56"
              />
              <button
                onClick={onSaveEntry}
                disabled={saving || entryForm.amount === "" || !entryForm.date}
                className="text-sm px-4 py-1.5 rounded-lg font-medium text-white disabled:opacity-50"
                style={{ background: entry.mode === "payment" ? "#15803d" : "#4a148c" }}
              >
                {saving ? "…" : "Salvar"}
              </button>
              <button onClick={onCancelEntry} className="text-xs text-gray-400 hover:text-gray-600">
                Cancelar
              </button>
            </div>
          </td>
        </tr>
      )}

      {/* Histórico expandido */}
      {isExpanded && (
        <tr style={{ background: "#f8fafc", borderBottom: "1px solid #f3f4f6" }}>
          <td colSpan={7} className="px-6 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Histórico de lançamentos
            </p>
            {events.length === 0 ? (
              <p className="text-xs text-gray-400">Sem lançamentos registrados.</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase text-gray-400 font-semibold border-b border-gray-200">
                    <th className="text-left pb-1 pr-3">Data</th>
                    <th className="text-left pb-1 pr-3">Tipo</th>
                    <th className="text-right pb-1 pr-3">Valor</th>
                    <th className="text-right pb-1 pr-3">Saldo Resultante</th>
                    <th className="text-left pb-1 pl-3">Obs.</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id} className="border-b border-gray-100 hover:bg-white">
                      <td className="py-1.5 pr-3 text-gray-600">{fmtDate(ev.event_date)}</td>
                      <td className="py-1.5 pr-3">
                        <span
                          className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                          style={ev.event_type === "payment"
                            ? { background: "#dcfce7", color: "#15803d" }
                            : ev.event_type === "payoff"
                              ? { background: "#dbeafe", color: "#1d4ed8" }
                              : { background: "#f3e8ff", color: "#7e22ce" }}
                        >
                          {EVENT_LABELS[ev.event_type] || ev.event_type}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono font-semibold"
                        style={{ color: ev.event_type === "payment" ? "#15803d" : "#4a4a6a" }}>
                        {ev.amount != null
                          ? `${ev.event_type === "payment" ? "−" : ""}${fmtMoney(ev.amount, loan.currency)}`
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono font-semibold" style={{ color: "#1a1a2e" }}>
                        {fmtMoney(ev.resulting_balance, loan.currency)}
                      </td>
                      <td className="py-1.5 pl-3 text-gray-400 truncate max-w-[180px]">{ev.notes || "—"}</td>
                      <td className="py-1.5 pl-1 text-right">
                        <button
                          onClick={() => onDeleteEvent(ev)}
                          className="p-0.5 rounded hover:bg-red-50 text-red-300 hover:text-red-500 transition-colors"
                          title="Remover lançamento (recalcula o saldo)"
                        >
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
