import { useEffect, useState } from "react";
import { getRates, fetchRates, createRate } from "../api/client";
import { RefreshCw, Plus } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const fmtRate = (v) => (v ? `R$ ${v.toFixed(4)}` : "—");

export default function Exchange() {
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [form, setForm] = useState({ date: "", usd_brl: "" });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    getRates()
      .then((r) => setRates(r.data))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleFetch = async () => {
    setFetching(true);
    try {
      await fetchRates(60);
      load();
    } catch (e) {
      alert("Erro ao buscar cotações: " + (e.response?.data?.detail || e.message));
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.date || !form.usd_brl) return;
    setSaving(true);
    try {
      await createRate({ date: form.date, usd_brl: parseFloat(form.usd_brl), source: "manual" });
      setForm({ date: "", usd_brl: "" });
      load();
    } catch (e) {
      alert("Erro: " + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  const chartData = [...rates].reverse().map((r) => ({ date: r.date, rate: r.usd_brl }));

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Câmbio USD/BRL</h2>
          <p className="text-gray-500 text-sm">Taxas usadas para converter patrimônio</p>
        </div>
        <button
          onClick={handleFetch}
          disabled={fetching}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <RefreshCw size={14} className={fetching ? "animate-spin" : ""} />
          {fetching ? "Buscando..." : "Atualizar (60 dias)"}
        </button>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="card">
          <p className="text-sm font-medium text-gray-400 mb-4">Histórico USD/BRL</p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="date" tick={{ fill: "#9ca3af", fontSize: 11 }} />
              <YAxis
                domain={["auto", "auto"]}
                tickFormatter={(v) => `R$${v.toFixed(2)}`}
                tick={{ fill: "#9ca3af", fontSize: 11 }}
              />
              <Tooltip
                formatter={(v) => [`R$ ${v.toFixed(4)}`, "USD/BRL"]}
                contentStyle={{ background: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                labelStyle={{ color: "#9ca3af" }}
              />
              <Line type="monotone" dataKey="rate" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Manual entry */}
      <div className="card">
        <p className="text-sm font-medium text-gray-300 mb-4 flex items-center gap-2">
          <Plus size={14} />
          Adicionar Taxa Manual
        </p>
        <form onSubmit={handleSave} className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Data</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">USD/BRL</label>
            <input
              type="number"
              step="0.0001"
              min="0"
              value={form.usd_brl}
              onChange={(e) => setForm((f) => ({ ...f, usd_brl: e.target.value }))}
              placeholder="5.2000"
              className="bg-gray-800 border border-gray-700 text-gray-100 text-sm rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
              required
            />
          </div>
          <button type="submit" disabled={saving} className="btn-primary text-sm">
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <p className="text-sm font-medium text-gray-300">Taxas Registradas</p>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 text-xs uppercase">
                <th className="text-left px-4 py-3">Data</th>
                <th className="text-right px-4 py-3">USD/BRL</th>
                <th className="text-right px-4 py-3">Fonte</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rates.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-8 text-gray-500">
                    Nenhuma taxa registrada. Clique em "Atualizar" para buscar.
                  </td>
                </tr>
              ) : (
                rates.slice(0, 60).map((r) => (
                  <tr key={r.id} className="hover:bg-gray-800/50">
                    <td className="px-4 py-2.5 text-gray-300">{r.date}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-white">{fmtRate(r.usd_brl)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`badge ${r.source === "manual" ? "bg-yellow-500/20 text-yellow-300" : "bg-blue-500/20 text-blue-300"}`}>
                        {r.source}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
