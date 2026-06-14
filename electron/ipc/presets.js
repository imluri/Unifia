const fs = require('fs');
const path = require('path');
const { store } = require('../store');
const presetStore = require('./presetStore');
const modManager = require('./modManager');
const { encodeInvite, decodeInvite } = require('./inviteCode');
const { diffMods } = require('./modSync');

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function list(gameId) {
  return presetStore.list(gameId);
}

function create(gameId, name, fromActive) {
  const id = presetStore.create(gameId, name, !!fromActive);
  presetStore.setActive(gameId, id); // newly created preset becomes active
  return presetStore.list(gameId);
}

function rename(gameId, id, name) {
  presetStore.rename(gameId, id, name);
  return presetStore.list(gameId);
}

function remove(gameId, id) {
  // Drop the deleted preset's isolated staging folder so it doesn't orphan on disk.
  try { fs.rmSync(modsDir(gameId, id), { recursive: true, force: true }); } catch { /* gone */ }
  presetStore.remove(gameId, id);
  return presetStore.list(gameId);
}

function updateFromActive(gameId, id) {
  presetStore.updateFromActive(gameId, id);
  return presetStore.list(gameId);
}

// Remove the active preset's deployed files from the game folder (without
// touching staging) so switching presets doesn't leave the old set behind.
function undeployActive(gameId, installPath) {
  const mods = presetStore.activeMods(gameId);
  for (const m of Object.values(mods)) {
    for (const rel of m.deployedFiles || []) {
      try { fs.rmSync(path.join(installPath, rel), { force: true }); } catch { /* gone */ }
    }
    m.deployedFiles = [];
  }
  presetStore.setActiveMods(gameId, mods);
}

// Install any wanted mods that aren't staged at the right version in the active
// preset. Returns the diff that was acted on.
async function ensureInstalled(gameId, wanted, onProgress) {
  const installed = modManager.getInstalledMods(gameId).map((m) => ({ fullName: m.fullName, version: m.version }));
  const diff = diffMods(installed, wanted);
  for (const m of [...diff.toInstall, ...diff.toUpdate]) {
    await modManager.installMod(gameId, m.fullName, m.to || m.version, onProgress);
  }
  return diff;
}

// Switch active preset: clear the outgoing preset's deployed files from the game
// folder, activate the target, then verify+install its mods so a launch deploys
// the right set. Returns the install diff (what was missing/wrong).
async function switchTo(gameId, id, onProgress) {
  const game = findGame(gameId);

  // 1. Undeploy the currently-active preset so no stale files linger.
  undeployActive(gameId, game.installPath);

  // 2. Activate the target.
  presetStore.setActive(gameId, id);

  // 3. Verify + install the target's recorded mods at their versions.
  const wanted = Object.entries(presetStore.activeMods(gameId)).map(([fullName, m]) => ({
    fullName, version: m.version,
  }));
  const diff = await ensureInstalled(gameId, wanted, onProgress);
  return { list: presetStore.list(gameId), diff };
}

function exportPreset(gameId, id) {
  const game = findGame(gameId);
  const mods = Object.entries(presetStore.presetMods(gameId, id))
    .filter(([, m]) => m.enabled)
    .map(([fullName, m]) => ({ fullName, version: m.version }));
  const community = modManager.communityFor(game) || '';
  return encodeInvite({ community, name: game.name, appId: '', room: '', version: String(game.version || ''), mods });
}

// Create a new preset from a code and switch to it (verify+install).
async function importPreset(gameId, code, name, onProgress) {
  const game = findGame(gameId);
  const d = decodeInvite(code);
  const community = modManager.communityFor(game);
  if (d.community && community && d.community !== community) {
    throw new Error(`This code is for ${d.community}, not this game.`);
  }
  const id = presetStore.create(gameId, name || `Imported ${new Date().toLocaleDateString()}`, false);
  presetStore.setActive(gameId, id);
  const diff = await ensureInstalled(gameId, d.mods, onProgress);
  return { list: presetStore.list(gameId), diff };
}

module.exports = {
  list, create, rename, remove, updateFromActive, switchTo, exportPreset, importPreset, ensureInstalled,
};
