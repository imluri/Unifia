const fs = require('fs');
const path = require('path');
const { store } = require('../store');

// A tiny, dependency-free heuristic scanner. It walks each store's common
// install directory one level deep, treats each subfolder as a candidate game,
// and tries to find an executable and a version string. This is intentionally
// conservative — manual add covers anything the heuristics miss.

const STORE_DEFAULTS = {
  steam: 'C:/Program Files (x86)/Steam/steamapps/common',
  gog: 'C:/GOG Games',
  epic: 'C:/Program Files/Epic Games',
};

// Files that commonly carry a human-readable version, checked in order.
const VERSION_FILES = ['version.txt', 'VERSION', 'build.txt'];

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Look for a version hint inside a game folder. We avoid heavy PE parsing and
// instead read a known version file if present, falling back to "unknown".
function detectVersion(gameDir) {
  for (const file of VERSION_FILES) {
    const p = path.join(gameDir, file);
    try {
      if (fs.existsSync(p)) {
        const txt = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0];
        if (txt) return txt.slice(0, 64);
      }
    } catch {
      /* ignore unreadable version file */
    }
  }
  // Unity games ship a *_Data/StreamingAssets folder; the app version often
  // lives in *_Data/app.info (second line). Try the first matching _Data dir.
  const dataDir = safeReadDir(gameDir).find(
    (e) => e.isDirectory() && e.name.endsWith('_Data')
  );
  if (dataDir) {
    const appInfo = path.join(gameDir, dataDir.name, 'app.info');
    try {
      if (fs.existsSync(appInfo)) {
        const lines = fs.readFileSync(appInfo, 'utf8').split(/\r?\n/);
        if (lines[1]) return lines[1].trim().slice(0, 64);
      }
    } catch {
      /* ignore */
    }
  }
  return 'unknown';
}

// Pick the most likely game executable in a folder: the first top-level .exe
// that is not an obvious helper (crash handler, installer, redist).
function detectExecutable(gameDir) {
  const skip = /(unitycrashhandler|crashpad|vcredist|directx|dxsetup|unins|setup|launcher_helper)/i;
  const exes = safeReadDir(gameDir)
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
    .map((e) => e.name)
    .filter((name) => !skip.test(name));
  if (exes.length === 0) return null;
  return path.join(gameDir, exes[0]);
}

function scanStore(store_, basePath) {
  const results = [];
  for (const entry of safeReadDir(basePath)) {
    if (!entry.isDirectory()) continue;
    const gameDir = path.join(basePath, entry.name);
    const executablePath = detectExecutable(gameDir);
    if (!executablePath) continue; // no runnable target — skip
    results.push({
      id: `${store_}:${entry.name}`,
      name: entry.name,
      version: detectVersion(gameDir),
      executablePath,
      store: store_,
      installPath: gameDir,
    });
  }
  return results;
}

// Scan every configured store path plus any user-defined custom roots, merge in
// manually added games, persist the union, and return it.
function scanGames() {
  const settings = store.get('settings') || {};
  const storePaths = settings.storePaths || {};

  const detected = [];
  for (const key of ['steam', 'gog', 'epic']) {
    const base = storePaths[key] || STORE_DEFAULTS[key];
    detected.push(...scanStore(key, base));
  }
  for (const customPath of storePaths.custom || []) {
    detected.push(...scanStore('custom', customPath));
  }

  // Preserve manually added games (those carry manual: true) and let a fresh
  // scan overwrite auto-detected entries with the same id.
  const existing = store.get('games') || [];
  const manual = existing.filter((g) => g.manual);
  const byId = new Map();
  for (const g of detected) byId.set(g.id, g);
  for (const g of manual) byId.set(g.id, g); // manual entries win on conflict

  const merged = Array.from(byId.values());
  store.set('games', merged);
  return merged;
}

// Add a game by hand. Used by the "Manual add game" button on Home.
function addManualGame({ name, executablePath, version, store: storeName }) {
  if (!name || !executablePath) {
    throw new Error('Manual game requires at least a name and executable path');
  }
  const games = store.get('games') || [];
  const id = `${storeName || 'custom'}:${name}`;
  const game = {
    id,
    name,
    version: version || detectVersion(path.dirname(executablePath)),
    executablePath,
    store: storeName || 'custom',
    installPath: path.dirname(executablePath),
    manual: true,
  };
  const filtered = games.filter((g) => g.id !== id);
  filtered.push(game);
  store.set('games', filtered);
  return game;
}

function removeGame(gameId) {
  const games = store.get('games') || [];
  store.set('games', games.filter((g) => g.id !== gameId));
  return { gameId, removed: true };
}

module.exports = { scanGames, addManualGame, removeGame, detectVersion };
