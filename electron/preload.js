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
});
