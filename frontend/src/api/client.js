import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:8000",
  timeout: 30000,
});

export const uploadFile = (file, onProgress) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/upload/", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => onProgress && onProgress(Math.round((e.loaded * 100) / e.total)),
  });
};

export const getSummary = (date) =>
  api.get("/portfolio/summary", { params: date ? { snapshot_date: date } : {} });

export const getHistory = (assetId = null, groupBy = null, days = null) =>
  api.get("/portfolio/history", {
    params: {
      ...(assetId  ? { asset_id:  assetId  } : {}),
      ...(groupBy  ? { group_by:  groupBy  } : {}),
      ...(days     ? { days                } : {}),
    },
  });

export const getSnapshots = (params) =>
  api.get("/portfolio/snapshots", { params });

export const getDates = () => api.get("/portfolio/dates");

export const getAssets = () => api.get("/portfolio/assets");

export const getAsset = (id) => api.get(`/portfolio/assets/${id}`);

export const getRates = () => api.get("/exchange/rates");
export const fetchRates = (days = 60) => api.post("/exchange/fetch", null, { params: { days } });
export const createRate = (payload) => api.post("/exchange/rates", payload);
export const getLatestRate = () => api.get("/exchange/latest");

export const getLoanSummary = () => api.get("/loans/summary");
export const getLoans = () => api.get("/loans/");
export const createLoan = (payload) => api.post("/loans/", payload);
export const updateLoan = (id, payload) => api.put(`/loans/${id}`, payload);
export const archiveLoan = (id) => api.delete(`/loans/${id}`);

export const getPropertySummary = () => api.get("/properties/summary");
export const createProperty = (payload) => api.post("/properties/", payload);
export const updateProperty = (id, payload) => api.put(`/properties/${id}`, payload);
export const archiveProperty = (id) => api.delete(`/properties/${id}`);
export const addPropertyValuation = (id, payload) => api.post(`/properties/${id}/valuations`, payload);
export const getPropertyValuations = (id) => api.get(`/properties/${id}/valuations`);
export const updateZillowEstimate = (id) => api.post(`/properties/${id}/zillow`);
export const saveZillowManual = (id, valueUsd) =>
  api.post(`/properties/${id}/zillow/manual`, { value_usd: valueUsd });
export const uploadPropertyPhoto = (id, file) => {
  const form = new FormData();
  form.append("file", file);
  return api.post(`/properties/${id}/photos`, form, { headers: { "Content-Type": "multipart/form-data" } });
};
export const deletePropertyPhoto = (id, photoId) => api.delete(`/properties/${id}/photos/${photoId}`);
export const exportPropertiesXlsx = () =>
  api.get("/properties/export/xlsx", { responseType: "blob" });
export const getPriceRefs = () => api.get("/properties/price-refs");
export const upsertPriceRef = (payload) => api.post("/properties/price-refs", payload);
export const deletePriceRef = (id) => api.delete(`/properties/price-refs/${id}`);
export const getPropertyAlerts = () => api.get("/alerts/properties");

export const getMaturityAlerts = () => api.get("/alerts/maturity");
export const updateAssetNotes = (id, notes) => api.put(`/portfolio/assets/${id}/notes`, { notes });
export const updateExpectedIncome = (id, monthly_dividends_expected) =>
  api.put(`/portfolio/assets/${id}/expected-income`, { monthly_dividends_expected });
export const updateAssetPurchaseDate = (id, purchase_date) =>
  api.put(`/portfolio/assets/${id}/purchase-date`, { purchase_date });
export const getDividends = (assetId) => api.get("/portfolio/dividends", { params: { asset_id: assetId } });
export const getDividendsSummary = () => api.get("/portfolio/dividends/summary");
export const createDividend = (payload) => api.post("/portfolio/dividends", payload);
export const deleteDividend = (id) => api.delete(`/portfolio/dividends/${id}`);
export const getRiskAnalysis = (snapshotDate) => api.get("/portfolio/risk", { params: snapshotDate ? { snapshot_date: snapshotDate } : {} });
export const getProjections = () => api.get("/portfolio/projections");
export const getCdiComparison = (snapshotDate) => api.get("/portfolio/cdi-comparison", { params: snapshotDate ? { snapshot_date: snapshotDate } : {} });
export const downloadPdf = (snapshotDate) => {
  const params = snapshotDate ? `?snapshot_date=${snapshotDate}` : "";
  window.open(`http://localhost:8000/reports/pdf${params}`, "_blank");
};
export const sendChatMessage = (message, conversation_history = []) =>
  api.post("/chat/message", { message, conversation_history });
export const getChatUsage = () => api.get("/chat/usage");

export const getImportLogs  = (limit = 50) => api.get("/logs/imports", { params: { limit } });
export const getImportStats = () => api.get("/logs/imports/stats");

export const getManualAssets       = ()           => api.get("/manual-assets/");
export const createManualAsset     = (payload)    => api.post("/manual-assets/", payload);
export const updateManualAssetValue = (id, payload) => api.post(`/manual-assets/${id}/update-value`, payload);
export const getManualAssetHistory  = (id)        => api.get(`/manual-assets/${id}/history`);
export const archiveManualAsset     = (id)        => api.delete(`/manual-assets/${id}`);

export const getImportSources    = ()              => api.get("/settings/sources");
export const updateImportSource  = (id, payload)  => api.patch(`/settings/sources/${id}`, payload);
export const reorderImportSources = (orderedIds)  => api.post("/settings/sources/reorder", { ordered_ids: orderedIds });

export const getAppSettings      = ()             => api.get("/settings/app");
export const updateAppSetting    = (key, value)   => api.put(`/settings/app/${key}`, { value });

export const getDropAlerts       = (params)       => api.get("/alerts/drops", { params });

export const getReportList       = ()             => api.get("/reports/list");
export const generateReports     = (payload)      => api.post("/reports/generate", payload);
export const getReport           = (id)           => api.get(`/reports/${id}`);
export const downloadReportPdf   = (id, assetTypes) => {
  const qs = assetTypes ? `?asset_types=${encodeURIComponent(assetTypes)}` : "";
  window.open(`http://localhost:8000/reports/${id}/pdf${qs}`, "_blank");
};

export const downloadSqlite = () => window.open("http://localhost:8000/backup/sqlite", "_blank");
export const downloadJson   = () => window.open("http://localhost:8000/backup/json",   "_blank");
export const createBackup   = () => api.post("/backup/create");
export const listBackups    = () => api.get("/backup/list");

export default api;
