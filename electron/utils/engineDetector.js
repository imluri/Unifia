const fs = require('fs');
const path = require('path');

// Heuristic game-engine detection from an install folder's file layout. Reads
// local files only and never throws — an undetectable game returns
// engine: 'unknown'. For Unity it also resolves the scripting backend
// (mono / il2cpp), which drives the BepInEx flavour the launcher recommends.

// Directories never worth descending into while sniffing signatures.
const SKIP_DIRS = new Set([
  '_commonredist',
  'redist',
  'directx',
  'dotnet',
  'vcredist',
  '__installer',
]);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readdir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Iterative, depth- and budget-bounded search for an entry matching predicate.
// Returns the matching path or null. The budget caps total entries visited so a
// huge install tree can't stall a scan.
function findMatch(root, predicate, maxDepth, budget = 4000) {
  const stack = [{ dir: root, depth: maxDepth }];
  let visited = 0;
  while (stack.length) {
    const { dir, depth } = stack.pop();
    for (const entry of readdir(dir)) {
      if (visited++ >= budget) return null;
      if (predicate(entry)) return path.join(dir, entry.name);
      if (entry.isDirectory() && depth > 0 && !SKIP_DIRS.has(entry.name.toLowerCase())) {
        stack.push({ dir: path.join(dir, entry.name), depth: depth - 1 });
      }
    }
  }
  return null;
}

// Find the folder that actually holds the Unity game (the one containing a
// *_Data dir or UnityPlayer.dll). Checks the install root first, then one level
// deep to handle repacks that nest the game in a subfolder. Returns null if no
// Unity layout is found.
function findUnityRoot(installPath, top, hasUnityPlayer) {
  if (hasUnityPlayer || top.some((e) => e.isDirectory() && /_Data$/i.test(e.name))) {
    return installPath;
  }
  const nested = findMatch(installPath, (e) => e.isDirectory() && /_Data$/i.test(e.name), 1);
  if (nested) return path.dirname(nested);
  const nestedPlayer = findMatch(installPath, (e) => e.isFile() && e.name === 'UnityPlayer.dll', 1);
  if (nestedPlayer) return path.dirname(nestedPlayer);
  return null;
}

// Resolve Unity's scripting backend given the install path and its *_Data dir.
function detectUnityBackend(installPath, dataDirName) {
  // IL2CPP markers.
  if (exists(path.join(installPath, 'GameAssembly.dll'))) return 'il2cpp';
  if (dataDirName && exists(path.join(installPath, dataDirName, 'il2cpp_data'))) return 'il2cpp';
  // Mono markers.
  if (exists(path.join(installPath, 'MonoBleedingEdge'))) return 'mono';
  if (dataDirName && exists(path.join(installPath, dataDirName, 'Managed'))) return 'mono';
  return 'unknown';
}

// Human-readable engine labels.
const ENGINE_NAMES = {
  unity: 'Unity',
  unreal: 'Unreal Engine',
  godot: 'Godot',
  gamemaker: 'GameMaker',
  source: 'Source',
  rpgmaker: 'RPG Maker',
  renpy: "Ren'Py",
  electron: 'Electron / NW.js',
  java: 'Java',
  unknown: 'Unknown',
};

function result(engine, backend = null) {
  let engineName = ENGINE_NAMES[engine] || 'Unknown';
  if (engine === 'unity' && backend && backend !== 'unknown') {
    engineName = `Unity (${backend === 'il2cpp' ? 'IL2CPP' : 'Mono'})`;
  }
  return { engine, backend, engineName };
}

// Detect the engine powering the game installed at installPath. Returns
// { engine, backend, engineName }. `backend` is only meaningful for Unity.
function detectEngine(installPath) {
  if (!installPath || !exists(installPath)) {
    return { engine: null, backend: null, engineName: null };
  }

  const top = readdir(installPath);
  const lower = top.map((e) => e.name.toLowerCase());
  const has = (name) => lower.includes(name.toLowerCase());
  const someName = (pred) => lower.some(pred);

  // --- Unity (most specific: the *_Data sibling folder + UnityPlayer.dll) ---
  // Pirated repacks frequently bury the real game one folder deep, so if the
  // top level has no Unity markers we look one level down for the *_Data dir
  // and resolve the backend relative to that folder.
  const unityRoot = findUnityRoot(installPath, top, has('UnityPlayer.dll'));
  if (unityRoot) {
    const dataName = readdir(unityRoot).find(
      (e) => e.isDirectory() && /_Data$/i.test(e.name)
    )?.name;
    return result('unity', detectUnityBackend(unityRoot, dataName || null));
  }

  // --- Unreal Engine ---
  if (
    has('Engine') ||
    someName((n) => n.endsWith('-shipping.exe')) ||
    findMatch(installPath, (e) => e.isFile() && /-Win64-Shipping\.exe$/i.test(e.name), 3) ||
    findMatch(installPath, (e) => e.isDirectory() && e.name === 'Paks', 2)
  ) {
    return result('unreal');
  }

  // --- GameMaker (data.win bytecode blob) ---
  if (has('data.win') || findMatch(installPath, (e) => e.isFile() && e.name.toLowerCase() === 'data.win', 1)) {
    return result('gamemaker');
  }

  // --- Godot (.pck pack file, usually beside the exe) ---
  if (someName((n) => n.endsWith('.pck'))) {
    return result('godot');
  }

  // --- RPG Maker (checked before Electron: MV/MZ are Electron-based) ---
  if (
    has('www') ||
    exists(path.join(installPath, 'resources', 'app', 'www')) ||
    someName((n) => /^rgss\d/.test(n) || n.endsWith('.rgssad') || n.endsWith('.rgss3a'))
  ) {
    return result('rpgmaker');
  }

  // --- Ren'Py ---
  if (
    has('renpy') ||
    findMatch(path.join(installPath, 'game'), (e) => e.isFile() && e.name.endsWith('.rpa'), 1)
  ) {
    return result('renpy');
  }

  // --- Source engine ---
  if (
    has('hl2.exe') ||
    someName((n) => n.endsWith('.vpk')) ||
    findMatch(installPath, (e) => e.isFile() && e.name.toLowerCase() === 'gameinfo.txt', 2)
  ) {
    return result('source');
  }

  // --- Electron / NW.js ---
  if (
    exists(path.join(installPath, 'resources', 'app.asar')) ||
    exists(path.join(installPath, 'resources', 'app', 'package.json')) ||
    has('nw.dll') ||
    (has('icudtl.dat') && someName((n) => n.endsWith('.pak')))
  ) {
    return result('electron');
  }

  // --- Java (e.g. Minecraft-likes) ---
  if (someName((n) => n.endsWith('.jar'))) {
    return result('java');
  }

  return result('unknown');
}

module.exports = { detectEngine, detectUnityBackend, ENGINE_NAMES };
