const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { store } = require('../store');
const modManager = require('./modManager');

// Manages the Unifia BepInEx connector plugin (Unifia.Pun.dll) per game:
// locating the built DLL, detecting whether it's installed in a game, and
// installing/uninstalling it under <game>/BepInEx/plugins/.

const PLUGIN_FILENAME = 'Unifia.Pun.dll';

// Locate the built plugin DLL. In a packaged app it ships under resources/
// plugins/; in dev it's the C# build output in the repo.
function resolvePluginDll() {
  const candidates = [
    path.join(process.resourcesPath || '', 'plugins', PLUGIN_FILENAME), // packaged
    path.join(app.getAppPath(), 'resources', 'plugins', PLUGIN_FILENAME),
    path.join(app.getAppPath(), 'mod', 'UnifiaPun', 'bin', 'Release', PLUGIN_FILENAME), // dev
    path.join(__dirname, '..', '..', 'mod', 'UnifiaPun', 'bin', 'Release', PLUGIN_FILENAME),
  ];
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

// BepInEx is considered present when its folder + the doorstop loader (or core)
// exist in the game directory.
function bepinexInstalled(installPath) {
  try {
    return (
      fs.existsSync(path.join(installPath, 'BepInEx')) &&
      (fs.existsSync(path.join(installPath, 'winhttp.dll')) ||
        fs.existsSync(path.join(installPath, 'BepInEx', 'core')))
    );
  } catch {
    return false;
  }
}

function pluginPath(installPath) {
  return path.join(installPath, 'BepInEx', 'plugins', PLUGIN_FILENAME);
}

// Report install state for a game so the UI can show/guide.
function getPluginStatus(gameId) {
  const game = findGame(gameId);
  const dll = resolvePluginDll();
  return {
    gameId,
    pluginFile: PLUGIN_FILENAME,
    available: !!dll, // is the built DLL present to install from?
    pluginInstalled: fs.existsSync(pluginPath(game.installPath)),
    // BepInEx counts as present if it's on disk OR a BepInExPack is staged
    // (it deploys on launch), so the connector-plugin modal won't falsely nag.
    bepinexInstalled: bepinexInstalled(game.installPath) || modManager.hasEnabledBepInExPack(gameId),
  };
}

// Copy the plugin into <game>/BepInEx/plugins/, creating the folder if needed.
function installPlugin(gameId) {
  const game = findGame(gameId);
  const src = resolvePluginDll();
  if (!src) {
    throw new Error('Unifia plugin DLL not found — build mod/UnifiaPun (dotnet build -c Release).');
  }
  const dir = path.join(game.installPath, 'BepInEx', 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, PLUGIN_FILENAME));
  return getPluginStatus(gameId);
}

function uninstallPlugin(gameId) {
  const game = findGame(gameId);
  const p = pluginPath(game.installPath);
  try {
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  } catch (err) {
    throw new Error(`Could not remove plugin: ${err.message}`);
  }
  return getPluginStatus(gameId);
}

// Redeploy the plugin if it's installed but out of date vs the built DLL. Keeps
// the in-game connector in sync after a rebuild (dev) or an app update, so a
// stale Unifia.Pun.dll never silently runs old behavior. Non-fatal; returns a
// small status. Does nothing if the plugin isn't installed for this game.
function syncPlugin(gameId) {
  const game = findGame(gameId);
  const dest = pluginPath(game.installPath);
  if (!fs.existsSync(dest)) return { gameId, synced: false, reason: 'not installed' };
  const src = resolvePluginDll();
  if (!src) return { gameId, synced: false, reason: 'no built dll' };
  try {
    if (fs.readFileSync(src).equals(fs.readFileSync(dest))) {
      return { gameId, synced: false, reason: 'up to date' };
    }
    fs.copyFileSync(src, dest);
    return { gameId, synced: true };
  } catch (err) {
    return { gameId, synced: false, reason: err.message };
  }
}

module.exports = { getPluginStatus, installPlugin, uninstallPlugin, resolvePluginDll, syncPlugin };
