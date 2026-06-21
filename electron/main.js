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
const modManager = require('./ipc/modManager');
const pluginManager = require('./ipc/pluginManager');
const multiplayer = require('./ipc/multiplayer');
const presets = require('./ipc/presets');
const analyzer = require('./ipc/analyzer');
const updater = require('./ipc/updater');
const recipeStore = require('./ipc/recipeStore');
const configEditor = require('./ipc/configEditor');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;

// Broadcast an event to the renderer over a single 'unifia:event' channel,
// tagged with a name the preload script demultiplexes into onX callbacks.
function emit(name, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('unifia:event', { name, payload });
  }
}


function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0f0f0f',
    // Textless mark for the window/taskbar icon (the in-app sidebar keeps the
    // full wordmark).
    icon: path.join(__dirname, '..', 'unifia_logo_notext.png'),
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
  handle('unifia:updateGamePath', (gameId, newPath) => gameScanner.updateGamePath(gameId, newPath));
  handle('unifia:renameGame', (gameId, displayName) => gameScanner.renameGame(gameId, displayName));

  // --- Launch / patch ---
  handle('unifia:launchGame', async (gameId, opts) => {
    const res = await launcher.launchGame(gameId, opts || {});
    // Get out of the way once the game is on its way up. Only on success — a
    // failed launch throws before this and keeps the window up to show the error.
    mainWindow?.minimize();
    return res;
  });
  handle('unifia:killGame', (gameId) => launcher.killGame(gameId));
  handle('unifia:isGameRunning', (gameId) => launcher.isRunning(gameId));
  handle('unifia:patchGame', (gameId, config) => patcher.patchGame(gameId, config || {}));
  handle('unifia:getNetProfile', (gameId) => {
    const game = (store.get('games') || []).find((g) => g.id === gameId);
    if (!game) throw new Error(`Unknown game: ${gameId}`);
    return profiles.matchProfile(game);
  });

  // --- Thunderstore mods ---
  handle('unifia:fetchModList', (gameId, opts) => modManager.fetchModList(gameId, opts || {}));
  handle('unifia:getInstalledMods', (gameId) => modManager.getInstalledMods(gameId));
  handle('unifia:validateInstalledMods', (gameId) => modManager.validateInstalledMods(gameId));
  handle('unifia:gameHasBepInEx', (gameId) => modManager.gameHasBepInEx(gameId));
  handle('unifia:installMod', (gameId, fullName, version) =>
    modManager.installMod(gameId, fullName, version, (p) => emit('download-progress', { mod: true, ...p }))
  );
  handle('unifia:uninstallMod', (gameId, fullName) => modManager.uninstallMod(gameId, fullName));
  handle('unifia:restoreArchivedMod', (gameId, fullName) => modManager.restoreArchivedMod(gameId, fullName));
  handle('unifia:listArchivedMods', (gameId) => modManager.listArchivedMods(gameId));
  handle('unifia:setModEnabled', (gameId, fullName, enabled) =>
    modManager.setModEnabled(gameId, fullName, enabled)
  );
  handle('unifia:checkModUpdates', (gameId) => modManager.checkModUpdates(gameId));
  handle('unifia:getModDependents', (gameId, fullName) => modManager.getModDependents(gameId, fullName));
  handle('unifia:getModConflicts', (gameId, fullName) => modManager.getModConflicts(gameId, fullName));
  handle('unifia:getModLoadOrder', (gameId) => modManager.getModLoadOrder(gameId));
  handle('unifia:setModLoadOrder', (gameId, ordered) => modManager.setModLoadOrder(gameId, ordered));
  handle('unifia:fetchDiscoverGames', (opts) => modManager.getDiscoverGames(opts || {}));
  handle('unifia:fetchModListForCommunity', (community, opts) =>
    modManager.fetchModListForCommunity(community, opts || {})
  );
  handle('unifia:setGameCommunity', (gameId, community) =>
    modManager.setGameCommunity(gameId, community)
  );
  handle('unifia:listCommunities', (opts) => modManager.listCommunities(opts || {}));

  // --- Cache Management ---
  handle('unifia:validateCache', () => modManager.validateCache());
  handle('unifia:getCacheStats', () => modManager.getCacheStats());
  handle('unifia:getCacheRecord', (fullName, version) => modManager.getCacheRecord(fullName, version));
  handle('unifia:listCachedVersions', (fullName) => modManager.listCachedVersions(fullName));
  handle('unifia:migratePresetsToCache', async () => {
    return new Promise((resolve) => {
      modManager.migratePresetsToCache((progress) => {
        emit('cache-migration-progress', progress);
      }).then(resolve);
    });
  });
  handle('unifia:deployModsWithValidation', (gameId, installPath) =>
    modManager.deployModsWithValidation(gameId, installPath)
  );

  handle('unifia:openExternal', (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });

  // --- Config editor ---
  handle('unifia:listConfigs', (gameId) => configEditor.listConfigs(gameId));
  handle('unifia:readConfig', (gameId, filename) => configEditor.readConfig(gameId, filename));
  handle('unifia:writeConfig', (gameId, filename, contents) => configEditor.writeConfig(gameId, filename, contents));
  handle('unifia:inferConfigFile', (gameId, fullName) => configEditor.inferConfigFile(gameId, fullName));

  // --- Unifia connector plugin (per-game) ---
  handle('unifia:getPluginStatus', (gameId) => pluginManager.getPluginStatus(gameId));
  handle('unifia:installPlugin', (gameId) => pluginManager.installPlugin(gameId));
  handle('unifia:uninstallPlugin', (gameId) => pluginManager.uninstallPlugin(gameId));

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

  // --- Multiplayer (share-code) ---
  handle('unifia:buildInvite', (gameId, opts) => multiplayer.buildInvite(gameId, opts || {}));
  handle('unifia:parseInvite', (code) => multiplayer.parseInvite(code));
  handle('unifia:applyInvite', (gameId, code) => multiplayer.applyInvite(gameId, code));
  handle('unifia:getConnectorPlayers', (gameId) => multiplayer.getConnectorPlayers(gameId));
  handle('unifia:saveGameProfile', (gameId, patch) => multiplayer.saveProfile(gameId, patch || {}));

  // --- Mod presets ---
  handle('unifia:listPresets', (gameId) => presets.list(gameId));
  handle('unifia:createPreset', (gameId, name, fromActive) => presets.create(gameId, name, fromActive));
  handle('unifia:renamePreset', (gameId, id, name) => presets.rename(gameId, id, name));
  handle('unifia:deletePreset', (gameId, id) => presets.remove(gameId, id));
  handle('unifia:updatePreset', (gameId, id) => presets.updateFromActive(gameId, id));
  handle('unifia:switchPreset', (gameId, id) =>
    presets.switchTo(gameId, id, (p) => emit('download-progress', { mod: true, ...p }))
  );
  handle('unifia:exportPreset', (gameId, id) => presets.exportPreset(gameId, id));
  handle('unifia:importPreset', (gameId, code, name) =>
    presets.importPreset(gameId, code, name, (p) => emit('download-progress', { mod: true, ...p }))
  );

  // --- Netcode analyzer ---
  handle('unifia:analyzeGame', (gameId) => analyzer.analyzeGame(gameId));

  // --- Auto-update ---
  handle('unifia:installUpdate', () => updater.installUpdate());

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

  handle('unifia:refreshRecipes', () => recipeStore.refreshRecipes({ force: true }));
  handle('unifia:getRecipeStatus', () => recipeStore.recipeStatus());
  handle('unifia:getRecipeFor', (gameId) => {
    const game = (store.get('games') || []).find((g) => g.id === gameId);
    return game ? recipeStore.recipeMetaFor(game) : null;
  });
}

app.whenReady().then(() => {
  ensureLayout();
  registerIpc();
  createWindow();
  updater.initUpdater(emit);
  recipeStore.refreshRecipes().catch(() => { /* non-fatal: cache/bundled stays active */ });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
