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
  'download-progress': new Set(),
  'window-maximized': new Set(),
  'update-available': new Set(),
  'update-downloaded': new Set(),
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
  updateGamePath: (gameId, newPath) => invoke('unifia:updateGamePath', gameId, newPath),
  renameGame: (gameId, displayName) => invoke('unifia:renameGame', gameId, displayName),

  // Launch / patch
  launchGame: (gameId, opts) => invoke('unifia:launchGame', gameId, opts),
  killGame: (gameId) => invoke('unifia:killGame', gameId),
  isGameRunning: (gameId) => invoke('unifia:isGameRunning', gameId),
  patchGame: (gameId, config) => invoke('unifia:patchGame', gameId, config),
  getNetProfile: (gameId) => invoke('unifia:getNetProfile', gameId),

  // Thunderstore mods
  fetchModList: (gameId, opts) => invoke('unifia:fetchModList', gameId, opts),
  getInstalledMods: (gameId) => invoke('unifia:getInstalledMods', gameId),
  gameHasBepInEx: (gameId) => invoke('unifia:gameHasBepInEx', gameId),

  // Multiplayer (share-code)
  buildInvite: (gameId, opts) => invoke('unifia:buildInvite', gameId, opts),
  parseInvite: (code) => invoke('unifia:parseInvite', code),
  applyInvite: (gameId, code) => invoke('unifia:applyInvite', gameId, code),
  getConnectorPlayers: (gameId) => invoke('unifia:getConnectorPlayers', gameId),
  saveGameProfile: (gameId, patch) => invoke('unifia:saveGameProfile', gameId, patch),

  // Mod presets
  listPresets: (gameId) => invoke('unifia:listPresets', gameId),
  createPreset: (gameId, name, fromActive) => invoke('unifia:createPreset', gameId, name, fromActive),
  renamePreset: (gameId, id, name) => invoke('unifia:renamePreset', gameId, id, name),
  deletePreset: (gameId, id) => invoke('unifia:deletePreset', gameId, id),
  updatePreset: (gameId, id) => invoke('unifia:updatePreset', gameId, id),
  switchPreset: (gameId, id) => invoke('unifia:switchPreset', gameId, id),
  exportPreset: (gameId, id) => invoke('unifia:exportPreset', gameId, id),
  importPreset: (gameId, code, name) => invoke('unifia:importPreset', gameId, code, name),

  // Netcode analyzer
  analyzeGame: (gameId) => invoke('unifia:analyzeGame', gameId),

  // Auto-update
  installUpdate: () => invoke('unifia:installUpdate'),
  onUpdateAvailable: (cb) => subscribe('update-available', cb),
  onUpdateDownloaded: (cb) => subscribe('update-downloaded', cb),
  installMod: (gameId, fullName, version) => invoke('unifia:installMod', gameId, fullName, version),
  uninstallMod: (gameId, fullName) => invoke('unifia:uninstallMod', gameId, fullName),
  setModEnabled: (gameId, fullName, enabled) => invoke('unifia:setModEnabled', gameId, fullName, enabled),
  checkModUpdates: (gameId) => invoke('unifia:checkModUpdates', gameId),
  fetchDiscoverGames: (opts) => invoke('unifia:fetchDiscoverGames', opts),
  fetchModListForCommunity: (community, opts) =>
    invoke('unifia:fetchModListForCommunity', community, opts),
  openExternal: (url) => invoke('unifia:openExternal', url),

  // Unifia connector plugin (per-game)
  getPluginStatus: (gameId) => invoke('unifia:getPluginStatus', gameId),
  installPlugin: (gameId) => invoke('unifia:installPlugin', gameId),
  uninstallPlugin: (gameId) => invoke('unifia:uninstallPlugin', gameId),

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
  refreshRecipes: () => invoke('unifia:refreshRecipes'),
  getRecipeStatus: () => invoke('unifia:getRecipeStatus'),
  getRecipeFor: (gameId) => invoke('unifia:getRecipeFor', gameId),

  // Event subscriptions (return unsubscribe fns)
  onDownloadProgress: (cb) => subscribe('download-progress', cb),
});
