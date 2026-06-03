const { contextBridge, ipcRenderer } = require('electron');

// Every IPC handler in main.js returns { ok, data } or { ok:false, error }.
// unwrap turns that into a resolved value or a thrown Error so the renderer can
// use plain async/await + try/catch.
async function invoke(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok) return res.data;
  throw new Error((res && res.error) || `IPC ${channel} failed`);
}

// Main pushes all events on one channel tagged with a name. We fan them out to
// per-event subscriber sets so the React side gets clean onX(callback) APIs.
const listeners = {
  'player-joined': new Set(),
  'player-left': new Set(),
  'version-mismatch': new Set(),
  'download-progress': new Set(),
  'window-maximized': new Set(),
};

ipcRenderer.on('unifia:event', (_e, { name, payload }) => {
  const set = listeners[name];
  if (set) for (const cb of set) cb(payload);
});

function subscribe(name, cb) {
  listeners[name].add(cb);
  // Return an unsubscribe function for React effect cleanup.
  return () => listeners[name].delete(cb);
}

contextBridge.exposeInMainWorld('unifia', {
  // Native pickers
  pickExecutable: () => invoke('unifia:pickExecutable'),
  pickDirectory: () => invoke('unifia:pickDirectory'),

  // Games
  scanGames: () => invoke('unifia:scanGames'),
  scanSteamGames: () => invoke('unifia:scanSteamGames'),
  getSteamLibraries: () => invoke('unifia:getSteamLibraries'),
  addManualGame: (game) => invoke('unifia:addManualGame', game),
  removeGame: (gameId) => invoke('unifia:removeGame', gameId),

  // Launch / patch
  launchGame: (gameId, opts) => invoke('unifia:launchGame', gameId, opts),
  killGame: (gameId) => invoke('unifia:killGame', gameId),
  isGameRunning: (gameId) => invoke('unifia:isGameRunning', gameId),
  patchGame: (gameId, config) => invoke('unifia:patchGame', gameId, config),
  getNetProfile: (gameId) => invoke('unifia:getNetProfile', gameId),

  // Modules
  listModuleSources: () => invoke('unifia:listModuleSources'),
  fetchModuleVersions: (moduleName, opts) => invoke('unifia:fetchModuleVersions', moduleName, opts),
  installModule: (moduleName, version, downloadUrl) =>
    invoke('unifia:installModule', moduleName, version, downloadUrl),
  uninstallModule: (moduleName, version) => invoke('unifia:uninstallModule', moduleName, version),
  getInstalledModules: () => invoke('unifia:getInstalledModules'),
  setActiveModule: (gameId, moduleName, version) =>
    invoke('unifia:setActiveModule', gameId, moduleName, version),

  // Game art
  fetchGameArt: (gameId, gameName, steamAppId) =>
    invoke('unifia:fetchGameArt', gameId, gameName, steamAppId),
  clearArtCache: (gameId) => invoke('unifia:clearArtCache', gameId),
  testSteamGridKey: (key) => invoke('unifia:testSteamGridKey', key),

  // Network / lobby
  getLocalIP: () => invoke('unifia:getLocalIP'),
  hostSession: (gameId, port) => invoke('unifia:hostSession', gameId, port),
  joinSession: (gameId, ip, port) => invoke('unifia:joinSession', gameId, ip, port),
  stopSession: () => invoke('unifia:stopSession'),
  getPlayers: () => invoke('unifia:getPlayers'),

  // Window controls for the custom frameless title bar
  window: {
    minimize: () => invoke('unifia:windowMinimize'),
    toggleMaximize: () => invoke('unifia:windowToggleMaximize'),
    close: () => invoke('unifia:windowClose'),
    isMaximized: () => invoke('unifia:windowIsMaximized'),
    onMaximizeChange: (cb) => subscribe('window-maximized', cb),
  },

  // Settings
  getSettings: () => invoke('unifia:getSettings'),
  saveSettings: (settings) => invoke('unifia:saveSettings', settings),
  getGameProfiles: () => invoke('unifia:getGameProfiles'),
  getDataDir: () => invoke('unifia:getDataDir'),

  // Event subscriptions (return unsubscribe fns)
  onPlayerJoined: (cb) => subscribe('player-joined', cb),
  onPlayerLeft: (cb) => subscribe('player-left', cb),
  onVersionMismatch: (cb) => subscribe('version-mismatch', cb),
  onDownloadProgress: (cb) => subscribe('download-progress', cb),
});
