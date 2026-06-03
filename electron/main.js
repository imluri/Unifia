const path = require('path');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');

const { store } = require('./store');
const { ensureLayout, getDataDir } = require('./paths');
const gameScanner = require('./ipc/gameScanner');
const launcher = require('./ipc/launcher');
const patcher = require('./ipc/patcher');
const moduleManager = require('./ipc/moduleManager');
const artManager = require('./ipc/artManager');
const profiles = require('./ipc/profiles');
const upnp = require('./ipc/upnp');
const { createNetwork } = require('./ipc/network');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;

// Broadcast an event to the renderer over a single 'unifia:event' channel,
// tagged with a name the preload script demultiplexes into onX callbacks.
function emit(name, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('unifia:event', { name, payload });
  }
}

const network = createNetwork(emit);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    show: false,
    // Frameless: we draw our own title bar (see TitleBar.jsx). The window is
    // still resizable from its edges on Windows/Linux.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Keep the renderer's maximize/restore button in sync with OS-driven changes.
  mainWindow.on('maximize', () => emit('window-maximized', true));
  mainWindow.on('unmaximize', () => emit('window-maximized', false));

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Open external links (e.g. GitHub) in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Wrap a handler so thrown errors become a structured { error } result instead
// of an unhandled rejection in the renderer.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function registerIpc() {
  // --- Native file/folder pickers ---
  handle('unifia:pickExecutable', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select game executable',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [
              { name: 'Executables', extensions: ['exe'] },
              { name: 'All files', extensions: ['*'] },
            ]
          : [{ name: 'All files', extensions: ['*'] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const filePath = res.filePaths[0];
    // The parent folder name is usually the game's name — offer it as a default.
    return { path: filePath, suggestedName: path.basename(path.dirname(filePath)) };
  });
  handle('unifia:pickDirectory', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return { path: res.filePaths[0] };
  });

  // --- Games ---
  handle('unifia:scanGames', () => gameScanner.scanGames());
  handle('unifia:scanSteamGames', () => gameScanner.scanSteamGames());
  handle('unifia:getSteamLibraries', () => gameScanner.getSteamLibraries());
  handle('unifia:addManualGame', (game) => gameScanner.addManualGame(game));
  handle('unifia:removeGame', (gameId) => gameScanner.removeGame(gameId));

  // --- Launch / patch ---
  handle('unifia:launchGame', (gameId, opts) => launcher.launchGame(gameId, opts || {}));
  handle('unifia:killGame', (gameId) => launcher.killGame(gameId));
  handle('unifia:isGameRunning', (gameId) => launcher.isRunning(gameId));
  handle('unifia:patchGame', (gameId, config) => patcher.patchGame(gameId, config || {}));
  handle('unifia:getNetProfile', (gameId) => {
    const game = (store.get('games') || []).find((g) => g.id === gameId);
    if (!game) throw new Error(`Unknown game: ${gameId}`);
    return profiles.matchProfile(game);
  });

  // --- Modules ---
  handle('unifia:listModuleSources', () => moduleManager.listModuleSources());
  handle('unifia:fetchModuleVersions', (moduleName, opts) =>
    moduleManager.fetchModuleVersions(moduleName, opts || {})
  );
  handle('unifia:installModule', (moduleName, version, downloadUrl) =>
    moduleManager.installModule(moduleName, version, downloadUrl, (progress) =>
      emit('download-progress', { moduleName, version, ...progress })
    )
  );
  handle('unifia:uninstallModule', (moduleName, version) =>
    moduleManager.uninstallModule(moduleName, version)
  );
  handle('unifia:getInstalledModules', () => moduleManager.getInstalledModules());
  handle('unifia:setActiveModule', (gameId, moduleName, version) =>
    moduleManager.setActiveModule(gameId, moduleName, version)
  );

  // --- Game art (SteamGridDB / Steam CDN) ---
  handle('unifia:fetchGameArt', (gameId, gameName, steamAppId) =>
    artManager.fetchGameArt(gameId, gameName, steamAppId)
  );
  handle('unifia:clearArtCache', (gameId) => artManager.clearArtCache(gameId));
  handle('unifia:testSteamGridKey', (key) => artManager.testKey(key));

  // --- Network / lobby ---
  handle('unifia:getLocalIP', () => network.getLocalIP());
  handle('unifia:hostSession', (gameId, port) => network.hostSession(gameId, port));
  handle('unifia:joinSession', (gameId, ip, port) => network.joinSession(gameId, ip, port));
  handle('unifia:stopSession', () => network.stopSession());
  handle('unifia:getPlayers', () => network.getPlayers());

  // --- Window controls (custom frameless title bar) ---
  handle('unifia:windowMinimize', () => {
    mainWindow?.minimize();
    return true;
  });
  handle('unifia:windowToggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  handle('unifia:windowClose', () => {
    mainWindow?.close();
    return true;
  });
  handle('unifia:windowIsMaximized', () => !!mainWindow?.isMaximized());

  // --- Settings / store ---
  handle('unifia:getSettings', () => store.get('settings'));
  handle('unifia:saveSettings', (settings) => {
    store.set('settings', { ...store.get('settings'), ...settings });
    return store.get('settings');
  });
  handle('unifia:getGameProfiles', () => store.get('gameProfiles'));
  handle('unifia:getDataDir', () => getDataDir());
}

app.whenReady().then(() => {
  ensureLayout();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  network.stopSession();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  network.stopSession();
  upnp.shutdown();
});
