import { useEffect, useState } from "react";
import { getImportLogs, getImportStats, deleteImport } from "../api/client";
import { Activity, CheckCircle, AlertTriangle, XCircle, RefreshCw, ChevronDown, ChevronRight, Clock, FileText, Zap, Trash2 } from "lucide-react";

const STATUS_CONFIG = {
  success: { label: "Sucesso",  bg: "#dcfce7", color: "#16a34a", icon: CheckCircle },
  partial: { label: "Parcial",  bg: "#fef9c3", color: "#ca8a04", icon: AlertTriangle },
  error:   { label: "Erro",     bg: "#fee2e2", color: "#dc2626", icon: XCircle },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.error;
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${color}18` }}>
        <Icon size={20} style={{ color }} />
      </div>
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-gray-800">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function LogRow({ log, onDelete, deleting }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = log.error_message || log.stack_trace;
  const dt = log.created_at ? new Date(log.created_at) : null;
  const dateStr = dt
    ? dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "—";

  return (
    <>
      <tr
        className={`border-b border-gray-50 transition-colors ${hasDetail ? "cursor-pointer hover:bg-gray-50" : ""}`}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{dateStr}</td>
        <td className="px-4 py-3 text-xs text-gray-700 max-w-[160px] truncate font-mono" title={log.filename}>
          {log.filename}
        </td>
        <td className="px-4 py-3 text-xs text-gray-600">{log.parser_name?.replace("Parser", "") || "—"}</td>
        <td className="px-4 py-3 text-xs text-gray-600">{log.institution_name || "—"}</td>
        <td className="px-4 py-3"><StatusBadge status={log.status} /></td>
        <td className="px-4 py-3 text-xs text-center text-gray-700">
          {log.records_inserted > 0 && <span className="text-green-600 font-medium">+{log.records_inserted}</span>}
          {log.records_updated  > 0 && <span className="text-blue-500 ml-1">~{log.records_updated}</span>}
          {log.records_failed   > 0 && <span className="text-red-500 ml-1">✕{log.records_failed}</span>}
          {log.records_inserted === 0 && log.records_updated === 0 && log.records_failed === 0 && "—"}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500 text-right">
          {log.processing_time_ms != null ? `${log.processing_time_ms} ms` : "—"}
        </td>
        <td className="px-4 py-3 text-gray-300">
          {hasDetail && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        </td>
        <td className="px-2 py-3 text-right">
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(log); }}
            disabled={deleting}
            className="p-1.5 rounded-lg hover:bg-red-50 text-red-300 hover:text-red-500 transition-colors disabled:opacity-40"
            title="Excluir importação (remove os dados deste arquivo nesta data)"
          >
            <Trash2 size={13} />
          </button>
        </td>
      </tr>
      {expanded && hasDetail && (
        <tr className="bg-red-50 border-b border-red-100">
          <td colSpan={9} className="px-6 py-4">
            {log.error_message && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-red-700 mb-1">Mensagem de erro</p>
                <p className="text-xs text-red-800 font-mono whitespace-pre-wrap bg-red-100 rounded-lg px-3 py-2">
                  {log.error_message}
                </p>
              </div>
            )}
            {log.stack_trace && (
              <div>
                <p className="text-xs font-semibold text-red-700 mb-1">Stack trace</p>
                <pre className="text-[11px] text-red-900 bg-red-100 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                  {log.stack_trace}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function Logs() {
  const [logs,     setLogs]     = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([getImportLogs(50), getImportStats()])
      .then(([lr, sr]) => { setLogs(lr.data); setStats(sr.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (log) => {
    const msg = log.snapshot_date
      ? `Excluir a importação "${log.filename}" (posição de ${log.snapshot_date})?\n\n` +
        `Todas as posições importadas deste arquivo nesta data serão removidas. ` +
        `Ativos manuais NÃO são afetados. Um backup do banco é criado automaticamente antes.`
      : `Excluir este registro de log ("${log.filename}")?\n\nEsta importação não criou dados — apenas o registro será removido.`;
    if (!window.confirm(msg)) return;
    setDeleting(true);
    try {
      const r = await deleteImport(log.id);
      if (log.snapshot_date) {
        const extra = r.data.assets_deleted > 0 ? `, ${r.data.assets_deleted} ativo(s) removido(s)` : "";
        window.alert(`Importação excluída: ${r.data.snapshots_deleted} posição(ões)${extra}.`);
      }
      load();
    } catch (err) {
      window.alert(err?.response?.data?.detail || "Erro ao excluir a importação.");
    } finally {
      setDeleting(false);
    }
  };

  const successRate = stats ? Math.round(stats.success_rate * 100) : 0;
  const lastError = logs.find((l) => l.status !== "success");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 py-4 flex items-center justify-between"
        style={{ background: "#f5f6fa", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div>
          <h2 className="text-xl font-bold text-gray-800">Logs de Importação</h2>
          <p className="text-gray-400 text-sm">Histórico de arquivos processados</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard icon={FileText} label="Total importações" value={stats.total} color="#6366f1" />
          <StatCard
            icon={Zap}
            label="Taxa de sucesso"
            value={`${successRate}%`}
            sub={`${stats.success} sucessos`}
            color={successRate >= 80 ? "#16a34a" : successRate >= 50 ? "#ca8a04" : "#dc2626"}
          />
          <StatCard
            icon={AlertTriangle}
            label="Erros recentes"
            value={stats.recent_errors}
            sub="últimos 7 dias"
            color={stats.recent_errors > 0 ? "#dc2626" : "#6b7280"}
          />
          <StatCard
            icon={Clock}
            label="Última importação"
            value={stats.last_import_status ? STATUS_CONFIG[stats.last_import_status]?.label || "—" : "—"}
            sub={stats.last_import_at ? new Date(stats.last_import_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nenhuma"}
            color={stats.last_import_status === "success" ? "#16a34a" : stats.last_import_status ? "#dc2626" : "#6b7280"}
          />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16">
            <Activity size={40} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-400">Nenhuma importação registrada ainda.</p>
            <p className="text-gray-300 text-sm mt-1">Os logs aparecem aqui após o primeiro upload.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  {["Data/Hora", "Arquivo", "Parser", "Instituição", "Status", "Registros", "Tempo", "", " "].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <LogRow key={log.id} log={log} onDelete={handleDelete} deleting={deleting} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {logs.length > 0 && (
        <p className="text-xs text-gray-300 text-center">
          Mostrando os {logs.length} registros mais recentes. Clique em uma linha com erro para ver detalhes.
        </p>
      )}
    </div>
  );
}
