const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { store } = require('../store');
const { logsDir } = require('../paths');
const { parseVDF } = require('../utils/vdfParser');
const { detectEngine } = require('../utils/engineDetector');

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
    const engineInfo = detectEngine(gameDir);
    results.push({
      id: `${store_}:${entry.name}`,
      name: entry.name,
      version: detectVersion(gameDir),
      executablePath,
      store: store_,
      installPath: gameDir,
      engine: engineInfo.engine,
      engineName: engineInfo.engineName,
      unityBackend: engineInfo.backend,
    });
  }
  return results;
}

/* ====================================================================== *
 * Steam library detection + ACF manifest parsing.
 * Reads local files only — no Steam API calls. All failures degrade to an
 * empty/partial result and are logged rather than thrown.
 * ====================================================================== */

// Append a line to the scanner log; never throws (logging must not break a scan).
function logScanError(context, err) {
  try {
    fs.appendFileSync(
      path.join(logsDir(), 'scanner.log'),
      `[${new Date().toISOString()}] ${context}: ${err && err.message ? err.message : err}\n`
    );
  } catch {
    /* logging is best-effort */
  }
}

// Normalize Windows backslash paths to forward slashes so they compose cleanly
// with the rest of the app (which uses forward slashes everywhere).
function toPosix(p) {
  return String(p).replace(/\\/g, '/');
}

// Locate the Steam install root for the current OS. Returns null if not found.
function findSteamPath() {
  if (process.platform === 'win32') {
    // Preferred source: HKCU\Software\Valve\Steam → InstallPath.
    try {
      const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v InstallPath', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const m = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (m) {
        const p = m[1].trim();
        if (fs.existsSync(p)) return toPosix(p);
      }
    } catch {
      /* registry unavailable — fall back to well-known paths */
    }
    for (const p of ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam']) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const p = path.join(os.homedir(), 'Library/Application Support/Steam');
    return fs.existsSync(p) ? toPosix(p) : null;
  }

  // Linux
  for (const rel of ['.steam/steam', '.local/share/Steam']) {
    const p = path.join(os.homedir(), rel);
    if (fs.existsSync(p)) return toPosix(p);
  }
  return null;
}

// Pull library folder paths out of a parsed libraryfolders.vdf, tolerating both
// the modern (numbered → { path }) and legacy (numbered → path string) layouts.
function extractLibraryPaths(parsed) {
  const root = parsed.libraryfolders || parsed.LibraryFolders || {};
  const paths = [];
  for (const [key, value] of Object.entries(root)) {
    if (typeof value === 'string') {
      if (/^\d+$/.test(key)) paths.push(value); // legacy: index -> path
    } else if (value && typeof value === 'object' && value.path) {
      paths.push(value.path); // modern: index -> { path, ... }
    }
  }
  return paths;
}

// Return all Steam library roots (each containing a steamapps/ subfolder). The
// base install always counts as a library. Missing/invalid entries are skipped.
function getSteamLibraries() {
  const steamPath = findSteamPath();
  if (!steamPath) return [];

  const candidates = [steamPath];
  const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  try {
    if (fs.existsSync(vdfPath)) {
      const parsed = parseVDF(fs.readFileSync(vdfPath, 'utf8'));
      candidates.push(...extractLibraryPaths(parsed));
    }
  } catch (err) {
    logScanError('libraryfolders.vdf', err);
  }

  const libraries = [];
  for (const raw of candidates) {
    const lib = toPosix(raw);
    if (libraries.includes(lib)) continue;
    if (fs.existsSync(path.join(lib, 'steamapps'))) libraries.push(lib);
  }
  return libraries;
}

// StateFlags values that mean "fully installed" (safe to launch). Partially
// downloaded / update-pending states are skipped.
const INSTALLED_STATE_FLAGS = new Set(['4', '1026', '1030']);

// Executables that are never the game itself (helpers, redists, crash handlers).
const EXEC_EXCLUDE = [
  'unitycrashhandler64.exe',
  'unitycrashhandler32.exe',
  'unityplayer.exe',
  'dxwebsetup.exe',
  'vcredist_x64.exe',
  'vcredist_x86.exe',
  'vc_redist.x64.exe',
  'directx',
  'cleanup',
  'setup',
  'install',
  'uninstall',
  'redist',
  'support',
  'crash',
];

// Directories we never descend into when hunting for the executable.
const EXEC_SKIP_DIRS = new Set([
  '_commonredist',
  'directx',
  'redist',
  'dotnet',
  'vcredist',
  'monobleedingedge',
]);

function isExcludedExe(name) {
  const lower = name.toLowerCase();
  return EXEC_EXCLUDE.some((bad) => lower.includes(bad));
}

// Collect candidate executables under a folder (bounded depth for performance).
function collectExecutables(dir, depth, acc) {
  if (depth < 0) return acc;
  for (const entry of safeReadDir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXEC_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      collectExecutables(full, depth - 1, acc);
    } else if (entry.isFile()) {
      const isExe =
        process.platform === 'win32'
          ? entry.name.toLowerCase().endsWith('.exe')
          : isUnixExecutable(full, entry.name);
      if (isExe && !isExcludedExe(entry.name)) acc.push(full);
    }
  }
  return acc;
}

// On non-Windows, treat extension-less files with the exec bit set as runnable.
function isUnixExecutable(full, name) {
  if (name.includes('.')) return false; // skip .so/.config/etc.
  try {
    return (fs.statSync(full).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// Normalize a string for fuzzy comparison: lowercase, alphanumerics only.
function normalizeName(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Find the main game executable inside installPath. Prefers a name match with
// the game, then falls back to the largest candidate by size. Returns null when
// nothing plausible is found (the caller keeps the game with executablePath:null).
function findGameExecutable(installPath, gameName) {
  const candidates = collectExecutables(installPath, 2, []);
  if (candidates.length === 0) return null;

  const target = normalizeName(gameName);
  // 1. Fuzzy name match against the executable's base name.
  const named = candidates.filter((p) => {
    const base = normalizeName(path.basename(p, path.extname(p)));
    return target && (base.includes(target) || target.includes(base));
  });
  const pool = named.length > 0 ? named : candidates;

  // 2. Among the pool, pick the largest file (the game binary dwarfs helpers).
  let best = null;
  let bestSize = -1;
  for (const p of pool) {
    let size = 0;
    try {
      size = fs.statSync(p).size;
    } catch {
      /* unreadable — treat as size 0 */
    }
    if (size > bestSize) {
      bestSize = size;
      best = p;
    }
  }
  return best ? toPosix(best) : null;
}

// Scan all Steam libraries and return fully-installed games parsed from their
// ACF manifests. Never throws — problems are logged and skipped.
function scanSteamGames() {
  const games = [];
  for (const lib of getSteamLibraries()) {
    const steamapps = path.join(lib, 'steamapps');
    let entries;
    try {
      entries = fs.readdirSync(steamapps);
    } catch (err) {
      logScanError(`readdir ${steamapps}`, err);
      continue; // skip this library, keep going
    }

    for (const file of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(file)) continue;
      const acfPath = path.join(steamapps, file);

      let manifest;
      try {
        manifest = parseVDF(fs.readFileSync(acfPath, 'utf8')).AppState;
      } catch (err) {
        logScanError(file, err);
        continue; // bad manifest — skip just this one
      }
      if (!manifest || !manifest.appid) continue;
      if (!INSTALLED_STATE_FLAGS.has(String(manifest.StateFlags))) continue; // not fully installed
      if (!manifest.installdir) continue;

      const installPath = toPosix(path.join(steamapps, 'common', manifest.installdir));
      const executablePath = fs.existsSync(installPath)
        ? findGameExecutable(installPath, manifest.name)
        : null;
      const engineInfo = detectEngine(installPath);

      games.push({
        id: `steam_${manifest.appid}`,
        name: manifest.name,
        store: 'steam',
        steamAppId: manifest.appid,
        version: null, // populated separately (e.g. from version files at launch)
        buildId: manifest.buildid || null,
        installPath,
        executablePath,
        libraryPath: lib,
        engine: engineInfo.engine,
        engineName: engineInfo.engineName,
        unityBackend: engineInfo.backend, // mono/il2cpp/unknown for Unity, else null
        sizeOnDisk: manifest.SizeOnDisk ? Number(manifest.SizeOnDisk) : null,
        lastUpdated: manifest.LastUpdated ? Number(manifest.LastUpdated) : null,
      });
    }
  }
  return games;
}

// Scan every configured store path plus any user-defined custom roots, merge in
// manually added games, persist the union, and return it.
function scanGames() {
  const settings = store.get('settings') || {};
  const storePaths = settings.storePaths || {};

  const detected = [];

  // Steam is detected authoritatively via its ACF manifests (gives us appid,
  // build id, Unity backend, etc.). GOG/Epic still use folder heuristics.
  try {
    detected.push(...scanSteamGames());
  } catch (err) {
    logScanError('scanSteamGames', err);
  }
  for (const key of ['gog', 'epic']) {
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
  const installPath = path.dirname(executablePath);
  const engineInfo = detectEngine(installPath);
  const game = {
    id,
    name,
    version: version || detectVersion(installPath),
    executablePath,
    store: storeName || 'custom',
    installPath,
    engine: engineInfo.engine,
    engineName: engineInfo.engineName,
    unityBackend: engineInfo.backend,
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

module.exports = {
  scanGames,
  scanSteamGames,
  getSteamLibraries,
  addManualGame,
  removeGame,
  detectVersion,
};
