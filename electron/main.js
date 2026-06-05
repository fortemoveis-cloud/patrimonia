'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const { spawn } = require('child_process');

// ── Single-instance lock ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

// ── Paths ─────────────────────────────────────────────────────────────────────
const APP_DATA_DIR    = path.join(app.getPath('appData'), 'PatrimonIA');
const ENV_FILE        = path.join(APP_DATA_DIR, '.env');
const DB_FILE         = path.join(APP_DATA_DIR, 'patrimonia.db');
const SETUP_DONE_FILE = path.join(APP_DATA_DIR, 'setup-complete.json');

const IS_PACKAGED = app.isPackaged;

const FRONTEND_DIR = IS_PACKAGED
  ? path.join(process.resourcesPath, 'frontend')
  : path.join(__dirname, '..', 'frontend', 'dist');

const BACKEND_EXE = IS_PACKAGED
  ? path.join(process.resourcesPath, 'backend', 'patrimonia-backend.exe')
  : path.join(__dirname, '..', 'backend', 'dist', 'patrimonia-backend.exe');

const SERVER_ENV_FILE = IS_PACKAGED
  ? path.join(process.resourcesPath, 'server.env')
  : path.join(__dirname, '..', 'backend', 'server.env');

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow    = null;
let backendProcess = null;

// ── Ensure AppData directory ──────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
  }
}

// ── Server env (API keys bundled with the service) ────────────────────────────
function readServerEnv() {
  if (!fs.existsSync(SERVER_ENV_FILE)) return {};
  const vars = {};
  for (const line of fs.readFileSync(SERVER_ENV_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    vars[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return vars;
}

// ── Backend process management ────────────────────────────────────────────────
function startBackend() {
  if (!fs.existsSync(BACKEND_EXE)) {
    console.warn(`[electron] Backend não encontrado: ${BACKEND_EXE}`);
    console.warn('[electron] Em modo dev, inicie o backend manualmente: cd backend && uvicorn main:app --port 8000');
    return;
  }

  const env = {
    ...process.env,
    ...readServerEnv(),
    PATRIMONIA_DATA_DIR:     APP_DATA_DIR,
    PATRIMONIA_ENV_FILE:     ENV_FILE,
    PATRIMONIA_DB_FILE:      DB_FILE,
    PATRIMONIA_FRONTEND_DIR: FRONTEND_DIR,
  };

  backendProcess = spawn(BACKEND_EXE, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: false,
  });

  backendProcess.stdout.on('data', d =>
    process.stdout.write(`[backend] ${d.toString()}`));
  backendProcess.stderr.on('data', d =>
    process.stderr.write(`[backend] ${d.toString()}`));
  backendProcess.on('close', code =>
    console.log(`[backend] processo encerrado com código ${code}`));
  backendProcess.on('error', err =>
    console.error('[backend] erro ao iniciar:', err.message));
}

function stopBackend() {
  if (!backendProcess) return;
  try {
    backendProcess.kill('SIGTERM');
    setTimeout(() => {
      if (backendProcess && !backendProcess.killed) {
        backendProcess.kill('SIGKILL');
      }
    }, 3000);
  } catch { /* ignore */ }
  backendProcess = null;
}

async function waitForBackend(maxSeconds = 60) {
  const deadline = Date.now() + maxSeconds * 1000;
  while (Date.now() < deadline) {
    const ok = await new Promise(resolve => {
      const req = http.get('http://localhost:8000/health', { timeout: 1500 }, res => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.on('error',   () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

// ── Window creation ───────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:    1280,
    height:   800,
    minWidth: 900,
    minHeight: 600,
    title:    'PatrimonIA',
    show:     false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
  });

  // Remove menu bar in production
  if (IS_PACKAGED) mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', () => { mainWindow = null; });

  return mainWindow;
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

async function completeSetup() {
  ensureDataDir();
  fs.writeFileSync(SETUP_DONE_FILE, JSON.stringify({
    version:     '1.0.0',
    completedAt: new Date().toISOString(),
  }), 'utf8');
  if (mainWindow) mainWindow.loadURL('http://localhost:8000');
  return { ok: true };
}

ipcMain.handle('save-setup', () => completeSetup());
ipcMain.handle('skip-setup',  () => completeSetup());

ipcMain.handle('check-update', async () => {
  if (!IS_PACKAGED) return { updateAvailable: false };
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result) return { updateAvailable: false };
    const current = app.getVersion();
    const remote  = result.updateInfo.version;
    return { updateAvailable: remote !== current, version: remote, currentVersion: current };
  } catch {
    return { updateAvailable: false };
  }
});

ipcMain.handle('install-update', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
});

// ── Auto-updater ──────────────────────────────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload         = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info:  m => console.log('[updater]', m),
    warn:  m => console.warn('[updater]', m),
    error: m => console.error('[updater]', m),
    debug: () => {},
  };

  autoUpdater.on('update-available', info => {
    console.log(`[updater] Nova versão disponível: ${info.version}`);
  });

  autoUpdater.on('download-progress', ({ percent }) => {
    if (mainWindow) mainWindow.setProgressBar(percent / 100);
  });

  autoUpdater.on('update-downloaded', info => {
    if (mainWindow) mainWindow.setProgressBar(-1);
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type:      'info',
      title:     'Atualização pronta — PatrimonIA',
      message:   `Versão ${info.version} baixada.`,
      detail:    'Seus dados ficam intactos.\nReinicie para aplicar agora ou continue usando — a atualização será aplicada no próximo fechamento.',
      buttons:   ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId:  1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  autoUpdater.on('error', err => {
    if (mainWindow) mainWindow.setProgressBar(-1);
    console.error('[updater] Erro:', err.message);
  });
}

setupAutoUpdater();

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  ensureDataDir();

  const win = createMainWindow();

  // Show loading screen immediately
  win.loadFile(path.join(__dirname, 'loading.html'));
  win.once('ready-to-show', () => win.show());

  // Start backend (skip if dev mode and exe doesn't exist)
  startBackend();

  // Wait for backend (up to 60s)
  const backendReady = await waitForBackend(60);

  if (!backendReady) {
    dialog.showErrorBox(
      'PatrimonIA — Erro de inicialização',
      'O servidor interno não respondeu em 60 segundos.\n\n' +
      'Causas comuns:\n' +
      '  • Porta 8000 já em uso por outro programa\n' +
      '  • Antivírus bloqueando o executável\n\n' +
      'Feche outros aplicativos que usem a porta 8000 e tente novamente.'
    );
    app.quit();
    return;
  }

  // Check first-run
  const isFirstRun = !fs.existsSync(SETUP_DONE_FILE);
  if (isFirstRun) {
    win.loadFile(path.join(__dirname, 'first-run.html'));
  } else {
    win.loadURL('http://localhost:8000');
  }

  // Check for updates 10 s after launch — only in packaged builds
  if (IS_PACKAGED) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10000);
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
