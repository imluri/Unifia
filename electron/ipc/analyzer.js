const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');
const { store } = require('../store');
const { mapReportToProfile } = require('./profileMap');

const EXE = 'UnifiaAnalyzer.exe';

// Locate the bundled analyzer exe (packaged) or the dev build output.
function resolveAnalyzerExe() {
  const candidates = [
    path.join(process.resourcesPath || '', 'analyzer', EXE),
    path.join(app.getAppPath(), 'resources', 'analyzer', EXE),
    path.join(__dirname, '..', '..', 'tools', 'UnifiaAnalyzer', 'bin', 'Release', 'net9.0', EXE),
    path.join(__dirname, '..', '..', 'tools', 'UnifiaAnalyzer', 'bin', 'Release', 'net9.0', 'win-x64', 'publish', EXE),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

// Find <game>/*_Data/Managed/Assembly-CSharp.dll under the install folder.
function findManagedAssembly(installPath) {
  try {
    for (const entry of fs.readdirSync(installPath, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('_Data')) {
        const dll = path.join(installPath, entry.name, 'Managed', 'Assembly-CSharp.dll');
        if (fs.existsSync(dll)) return dll;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function runExe(exe, dll) {
  return new Promise((resolve) => {
    execFile(exe, [dll], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ netcode: 'unknown', feasibility: 'unknown', error: err ? err.message : 'analyzer produced no JSON' });
      }
    });
  });
}

// Persist the analyzer-derived profile fields into the game's profile so
// matchProfile/writeProfileConfig emit them for the connector.
function saveProfileFromReport(gameId, report) {
  const mapped = mapReportToProfile(report);
  const all = store.get('gameProfiles') || {};
  all[gameId] = { ...(all[gameId] || {}), analysis: mapped };
  store.set('gameProfiles', all);
  return mapped;
}

function cacheReport(gameId, report) {
  store.set('gameAnalysis', { ...(store.get('gameAnalysis') || {}), [gameId]: report });
  return report;
}

// Analyze a game's networking. IL2CPP games have no managed assembly.
async function analyzeGame(gameId) {
  const game = findGame(gameId);
  if (game.unityBackend === 'il2cpp') {
    return cacheReport(gameId, { netcode: 'unknown', feasibility: 'unsupported', reason: 'IL2CPP — no managed assembly' });
  }
  const exe = resolveAnalyzerExe();
  if (!exe) throw new Error('Analyzer not built — run dotnet build in tools/UnifiaAnalyzer.');
  const dll = findManagedAssembly(game.installPath);
  if (!dll) {
    return cacheReport(gameId, { netcode: 'unknown', feasibility: 'unknown', reason: 'No Assembly-CSharp.dll found' });
  }
  const report = await runExe(exe, dll);
  cacheReport(gameId, report);
  if (!report.error) saveProfileFromReport(gameId, report);
  return report;
}

module.exports = { analyzeGame, resolveAnalyzerExe, findManagedAssembly };
