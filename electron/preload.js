'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC APIs to the renderer (first-run page and main app)
contextBridge.exposeInMainWorld('electronAPI', {
  // First-run setup
  saveSetup:    (data)     => ipcRenderer.invoke('save-setup', data),
  skipSetup:    ()         => ipcRenderer.invoke('skip-setup'),

  // Version / updates
  checkUpdate:   ()        => ipcRenderer.invoke('check-update'),
  installUpdate: ()        => ipcRenderer.invoke('install-update'),

  // App info
  getVersion:   ()         => ipcRenderer.invoke('get-version'),
  openExternal: (url)      => ipcRenderer.invoke('open-external', url),

  // File save dialog
  saveXlsx: (base64, filename) => ipcRenderer.invoke('save-xlsx', base64, filename),

  // Update event listeners (push events from main → renderer)
  onUpdateAvailable:  (cb) => ipcRenderer.on('update-available',  (_e, info) => cb(info)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, pct)  => cb(pct)),
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available');
    ipcRenderer.removeAllListeners('update-downloaded');
    ipcRenderer.removeAllListeners('download-progress');
  },

  isElectron: true,
});
