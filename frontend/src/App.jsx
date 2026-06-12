import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState, useEffect } from "react";
import SplashScreen from "./components/SplashScreen";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import Portfolio from "./pages/Portfolio";
import History from "./pages/History";
import Exchange from "./pages/Exchange";
import AssetDetail from "./pages/AssetDetail";
import Loans from "./pages/Loans";
import Properties from "./pages/Properties";
import Alerts from "./pages/Alerts";
import Logs from "./pages/Logs";
import Chat from "./pages/Chat";
import ManualAssets from "./pages/ManualAssets";
import Settings from "./pages/Settings";
import Reports from "./pages/Reports";

function UpdateBanner() {
  const [update, setUpdate] = useState(null); // null | {phase:'available'|'downloading'|'ready', version, pct}

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onUpdateAvailable) return;

    api.onUpdateAvailable(({ version }) =>
      setUpdate({ phase: "downloading", version, pct: 0 })
    );
    api.onDownloadProgress((pct) =>
      setUpdate((prev) => prev ? { ...prev, pct } : prev)
    );
    api.onUpdateDownloaded(({ version }) =>
      setUpdate({ phase: "ready", version, pct: 100 })
    );

    return () => api.removeUpdateListeners?.();
  }, []);

  if (!update) return null;

  const { phase, version, pct } = update;
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center gap-3 px-4 py-2 text-sm text-white shadow-lg"
      style={{ background: phase === "ready" ? "#16a34a" : "#4f46e5" }}
    >
      <span className="flex-1">
        {phase === "downloading" && `⬇ Baixando PatrimonIA v${version}… ${pct}%`}
        {phase === "ready"       && `✅ v${version} pronta para instalar`}
      </span>
      {phase === "ready" && (
        <button
          onClick={() => window.electronAPI.installUpdate()}
          className="px-3 py-1 bg-white text-green-700 rounded-md text-xs font-semibold hover:bg-green-50"
        >
          Reiniciar e instalar
        </button>
      )}
      <button
        onClick={() => setUpdate(null)}
        className="ml-1 opacity-70 hover:opacity-100 text-base leading-none"
        aria-label="Fechar"
      >
        ✕
      </button>
    </div>
  );
}

function App() {
  const [ready, setReady] = useState(false);
  return (
    <>
      <UpdateBanner />
      {!ready && <SplashScreen onDone={() => setReady(true)} />}
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/history" element={<History />} />
            <Route path="/properties" element={<Properties />} />
            <Route path="/alerts"     element={<Alerts />} />
            <Route path="/loans" element={<Loans />} />
            <Route path="/exchange" element={<Exchange />} />
            <Route path="/asset/:id" element={<AssetDetail />} />
            <Route path="/logs"      element={<Logs />} />
            <Route path="/chat"         element={<Chat />} />
            <Route path="/manual-assets" element={<ManualAssets />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="/reports"       element={<Reports />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </>
  );
}

export default App;
