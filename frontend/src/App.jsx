import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";
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

function App() {
  const [ready, setReady] = useState(false);
  return (
    <>
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
            <Route path="/chat"      element={<Chat />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </>
  );
}

export default App;
