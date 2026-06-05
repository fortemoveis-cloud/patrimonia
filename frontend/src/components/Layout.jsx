import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Upload, Briefcase, TrendingUp, DollarSign,
  CreditCard, Home, Bell, Menu, X, Download, HardDrive, Activity, Bot,
} from "lucide-react";
import { getMaturityAlerts, getImportStats, createBackup, listBackups, downloadSqlite, downloadJson } from "../api/client";
import FloatingChat from "./FloatingChat";

const NAV = [
  { to: "/",           label: "Dashboard",   icon: LayoutDashboard },
  { to: "/upload",     label: "Importar",    icon: Upload },
  { to: "/portfolio",  label: "Carteira",    icon: Briefcase },
  { to: "/history",    label: "Histórico",   icon: TrendingUp },
  { to: "/properties", label: "Imóveis",     icon: Home },
  { to: "/loans",      label: "Empréstimos", icon: CreditCard },
  { to: "/exchange",   label: "Câmbio",      icon: DollarSign },
  { to: "/logs",       label: "Logs",        icon: Activity },
  { to: "/chat",       label: "Assistente",  icon: Bot },
];

// ── PatrimonIA brand colors ───────────────────────────────────────────────────
const C = {
  bgTop:      "#0F1547",
  bgBottom:   "#1a237e",
  circle:     "#1E2D8A",
  accent:     "#A78BFA",
  accentDark: "#7C3AED",
  subtitle:   "#6D79D6",
  hover:      "#1E2D8A",
  muted:      "rgba(255,255,255,0.52)",
  mutedFaint: "rgba(255,255,255,0.22)",
};

const SIDEBAR_BG = { background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)` };

/* Chart icon used in the sidebar logo */
function LogoIcon({ size = 32 }) {
  const r   = size / 2;
  const pad = size * 0.23;
  const pts = [
    [pad,             size - pad * 0.55],
    [size * 0.38,     size * 0.50],
    [size * 0.55,     size * 0.63],
    [size - pad,      pad * 0.88],
  ].map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const ex = size - pad, ey = pad * 0.88;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <circle cx={r} cy={r} r={r} fill={C.circle}/>
      <polyline points={pts} stroke={C.accent} strokeWidth={size * 0.065}
                strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={ex} cy={ey} r={size * 0.09} fill={C.accentDark}/>
    </svg>
  );
}

// ── Backup panel ──────────────────────────────────────────────────────────────
function BackupPanel({ onClose }) {
  const [backups, setBackups]   = useState([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listBackups().then((r) => setBackups(r.data)).catch(() => {});
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      await createBackup();
      const r = await listBackups();
      setBackups(r.data);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
          <p className="font-semibold text-gray-800 flex items-center gap-2">
            <HardDrive size={16} /> Backup
          </p>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <button onClick={downloadSqlite} className="text-xs py-2 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex flex-col items-center gap-1">
              <Download size={14} className="text-blue-600"/><span>SQLite</span>
            </button>
            <button onClick={downloadJson} className="text-xs py-2 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex flex-col items-center gap-1">
              <Download size={14} className="text-green-600"/><span>JSON</span>
            </button>
            <button onClick={handleCreate} disabled={creating} className="text-xs py-2 px-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors flex flex-col items-center gap-1 disabled:opacity-50">
              <HardDrive size={14} className="text-purple-600"/><span>{creating ? "…" : "Salvar"}</span>
            </button>
          </div>
          {backups.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Backups locais</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {backups.map((b) => (
                  <div key={b.filename} className="flex justify-between text-xs text-gray-600 py-1 border-b border-gray-50">
                    <span className="truncate">{b.filename}</span>
                    <span className="text-gray-400 ml-2 flex-shrink-0">{b.size_kb} KB</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar content ───────────────────────────────────────────────────────────
function SidebarContent({ onClose, alertCount, importErrorCount, onBackup, onAlerts }) {
  const [hovered, setHovered] = useState(null);

  const navStyle = (isActive, to) => ({
    background: isActive
      ? `rgba(167,139,250,0.13)`
      : hovered === to ? C.hover : "transparent",
    color: isActive ? C.accent : hovered === to ? "rgba(255,255,255,0.9)" : C.muted,
    borderLeft: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
  });

  return (
    <>
      {/* Logo header */}
      <div
        className="px-5 py-5 flex items-center justify-between"
        style={{ borderBottom: `1px solid rgba(255,255,255,0.09)` }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <LogoIcon size={34} />
          <div className="min-w-0">
            <h1
              style={{
                fontFamily:    "Georgia, 'Times New Roman', serif",
                fontSize:      15,
                fontWeight:    700,
                lineHeight:    1.1,
                margin:        0,
                letterSpacing: "-0.2px",
              }}
            >
              <span style={{ color: "#fff" }}>Patrimon</span>
              <span style={{ color: C.accent }}>IA</span>
            </h1>
            <p
              style={{
                margin:        "3px 0 0",
                fontSize:      9.5,
                letterSpacing: "0.7px",
                textTransform: "uppercase",
                color:         C.subtitle,
                whiteSpace:    "nowrap",
              }}
            >
              Gestão Inteligente
            </p>
          </div>
        </div>
        <button className="md:hidden" style={{ color: C.muted }} onClick={onClose}>
          <X size={17} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2.5 overflow-y-auto" style={{ gap: 1, display: "flex", flexDirection: "column" }}>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            onClick={onClose}
            onMouseEnter={() => setHovered(to)}
            onMouseLeave={() => setHovered(null)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
            style={({ isActive }) => navStyle(isActive, to)}
          >
            <div className="relative flex-shrink-0">
              <Icon size={15} />
              {to === "/upload" && importErrorCount > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center"
                  style={{ background: "#dc2626", color: "#fff" }}
                >
                  {importErrorCount > 9 ? "9+" : importErrorCount}
                </span>
              )}
            </div>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom: Alerts + Backup */}
      <div
        className="px-2.5 py-2 space-y-0.5"
        style={{ borderTop: `1px solid rgba(255,255,255,0.07)` }}
      >
        <button
          onClick={onAlerts}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
          style={{ color: alertCount.critical > 0 ? "#fca5a5" : C.muted }}
          onMouseEnter={(e) => e.currentTarget.style.background = C.hover}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <div className="relative flex-shrink-0">
            <Bell size={15} />
            {alertCount.total > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
                style={{ background: alertCount.critical > 0 ? "#dc2626" : "#f59e0b", color: "#fff" }}
              >
                {alertCount.total > 9 ? "9+" : alertCount.total}
              </span>
            )}
          </div>
          Alertas
        </button>

        <button
          onClick={onBackup}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150"
          style={{ color: C.muted }}
          onMouseEnter={(e) => e.currentTarget.style.background = C.hover}
          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
        >
          <HardDrive size={15} />
          Backup
        </button>

        {/* Footer */}
        <div className="px-3 pt-3 pb-1" style={{ borderTop: `1px solid rgba(255,255,255,0.06)` }}>
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.30)", margin: 0 }}>
            <span style={{ fontFamily: "Georgia, serif" }}>
              Patrimon<span style={{ color: "#7C5AAA" }}>IA</span>
            </span>
            {" "}v1.0
          </p>
          <p style={{ fontSize: 10, color: C.mutedFaint, margin: "2px 0 0" }}>
            © 2026 PatrimonIA
          </p>
        </div>
      </div>
    </>
  );
}

// ── Main layout ───────────────────────────────────────────────────────────────
export default function Layout({ children }) {
  const [mobileOpen, setMobileOpen]       = useState(false);
  const [alertCount, setAlertCount]       = useState({ critical: 0, warning: 0, total: 0 });
  const [importErrorCount, setImportErrorCount] = useState(0);
  const [showBackup, setShowBackup]       = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();

  useEffect(() => {
    getMaturityAlerts()
      .then((r) => setAlertCount({ critical: r.data.critical, warning: r.data.warning, total: r.data.count }))
      .catch(() => {});
    getImportStats()
      .then((r) => setImportErrorCount(r.data.recent_errors || 0))
      .catch(() => {});
  }, []);

  const handleAlerts = () => { navigate("/alerts"); setMobileOpen(false); };

  return (
    <div className="flex min-h-screen">
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed left-0 top-0 h-screen w-56 flex flex-col z-40 transition-transform duration-300
          ${mobileOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
        style={SIDEBAR_BG}
      >
        <SidebarContent
          onClose={() => setMobileOpen(false)}
          alertCount={alertCount}
          importErrorCount={importErrorCount}
          onBackup={() => setShowBackup(true)}
          onAlerts={handleAlerts}
        />
      </aside>

      {/* Main */}
      <div className="md:ml-56 flex-1 flex flex-col min-h-screen" style={{ background: "#f5f6fa" }}>
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} className="p-2 rounded-lg hover:bg-gray-100" style={{ color: C.bgTop }}>
            <Menu size={20} />
          </button>
          <span style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: 16 }}>
            <span style={{ color: C.bgTop }}>Patrimon</span>
            <span style={{ color: C.accentDark }}>IA</span>
          </span>
          <button onClick={handleAlerts} className="relative p-2 rounded-lg hover:bg-gray-100 text-gray-600">
            <Bell size={18} />
            {alertCount.total > 0 && (
              <span
                className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center"
                style={{ background: alertCount.critical > 0 ? "#dc2626" : "#f59e0b", color: "#fff" }}
              >
                {alertCount.total > 9 ? "9+" : alertCount.total}
              </span>
            )}
          </button>
        </div>

        <main className="flex-1">
          <div className="p-4 md:p-6 max-w-7xl mx-auto">{children}</div>
        </main>
      </div>

      {showBackup && <BackupPanel onClose={() => setShowBackup(false)} />}

      {/* Floating AI assistant — hidden on the full Chat page */}
      {location.pathname !== "/chat" && <FloatingChat />}
    </div>
  );
}
