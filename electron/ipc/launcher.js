const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { store } = require('../store');
const { moduleDir } = require('../paths');
const patcher = require('./patcher');

// Tracks the currently spawned game process so we can detect "already running"
// and kill on request. Keyed by gameId.
const runningProcesses = new Map();

// Recursively copy a directory tree. Used to drop BepInEx loader files into a
// game install. Existing files are overwritten so re-launching refreshes them.
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

// Copy the active BepInEx module for a game into its install directory. Returns
// the version copied, or null when the game has no active module.
function deployModule(game) {
  const profiles = store.get('gameProfiles') || {};
  const profile = profiles[game.id];
  if (!profile || !profile.activeModule || !profile.moduleVersion) {
    return null; // no module linked to this game
  }

  const source = moduleDir(profile.activeModule, profile.moduleVersion);
  if (!fs.existsSync(source)) {
    throw new Error(
      `Active module ${profile.activeModule} ${profile.moduleVersion} is not installed on disk`
    );
  }
  copyDir(source, game.installPath);
  return { module: profile.activeModule, version: profile.moduleVersion };
}

function isRunning(gameId) {
  const proc = runningProcesses.get(gameId);
  return !!proc && proc.exitCode === null && !proc.killed;
}

// Launch a game. Deploys the active module first (if any), then spawns the
// executable detached so closing Unifia doesn't kill the game.
function launchGame(gameId, { args = [] } = {}) {
  const games = store.get('games') || [];
  const game = games.find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);

  if (isRunning(gameId)) {
    return { gameId, alreadyRunning: true };
  }
  if (!fs.existsSync(game.executablePath)) {
    throw new Error(`Executable not found: ${game.executablePath}`);
  }

  const deployed = deployModule(game);

  // If the lobby brokered a room, write unifia_net.cfg so the in-game mod joins
  // the host's self-hosted Photon server and shared room. Non-fatal on failure
  // (the game still launches; it just won't auto-join the unifia room).
  const profile = (store.get('gameProfiles') || {})[game.id];
  if (profile && profile.netConfig) {
    try {
      patcher.writeNetConfig(game.installPath, {
        ...profile.netConfig,
        username: store.get('settings.username') || 'Player',
      });
    } catch {
      /* mod will fall back to its defaults */
    }
  }

  const child = spawn(game.executablePath, args, {
    cwd: game.installPath,
    detached: true,
    stdio: 'ignore',
  });
  child.on('exit', () => runningProcesses.delete(gameId));
  child.unref();
  runningProcesses.set(gameId, child);

  return { gameId, pid: child.pid, deployedModule: deployed };
}

function killGame(gameId) {
  const proc = runningProcesses.get(gameId);
  if (!proc) return { gameId, killed: false, reason: 'not running' };
  try {
    // On Windows a detached process may have children; kill the tree.
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
    } else {
      process.kill(-proc.pid);
    }
  } catch {
    proc.kill();
  }
  runningProcesses.delete(gameId);
  return { gameId, killed: true };
}

module.exports = { launchGame, killGame, isRunning, deployModule };
