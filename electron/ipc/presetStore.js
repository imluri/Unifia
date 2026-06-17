const fs = require('fs');
const path = require('path');
const { store } = require('../store');
const { modsDir } = require('../paths');
const L = require('./presetLogic');

let _seq = 0;
function genId() {
  _seq += 1;
  return `p_${Date.now().toString(36)}_${_seq}`;
}

function readAll() {
  return store.get('gamePresets') || {};
}

function writeEntry(gameId, entry) {
  const all = readAll();
  all[gameId] = entry;
  store.set('gamePresets', all);
  return entry;
}

// Move any pre-presets staged mod folders (mods/<gameId>/<mod>) into the new
// Default preset folder (mods/<gameId>/<presetId>/<mod>) so existing installs
// still deploy after the migration. Best-effort, runs once with the migration.
function migrateStagingFolder(gameId, presetId) {
  try {
    const oldDir = modsDir(gameId); // mods/<gameId>
    const newDir = modsDir(gameId, presetId); // mods/<gameId>/<presetId>
    if (!fs.existsSync(oldDir)) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const entry of fs.readdirSync(oldDir, { withFileTypes: true })) {
      // Skip the new preset folder itself; only move the old mod folders.
      if (!entry.isDirectory() || entry.name === presetId) continue;
      try {
        fs.renameSync(path.join(oldDir, entry.name), path.join(newDir, entry.name));
      } catch { /* locked/in-use — leave it, deploy will reinstall */ }
    }
  } catch { /* best-effort migration */ }
}

// Resolve the game's preset entry, migrating the legacy gameMods map on first
// access (idempotent — only when no entry exists yet).
function getEntry(gameId) {
  const all = readAll();
  if (all[gameId]) return all[gameId];
  const legacy = (store.get('gameMods') || {})[gameId] || {};
  const entry = L.migrate(legacy, genId);
  migrateStagingFolder(gameId, entry.activeId);
  return writeEntry(gameId, entry);
}

function getActiveId(gameId) {
  return L.activePreset(getEntry(gameId)).id;
}

// --- The seam modManager consumes ---
function activeMods(gameId) {
  return L.activePreset(getEntry(gameId)).mods || {};
}
function setActiveMods(gameId, mods) {
  return writeEntry(gameId, L.withActiveMods(getEntry(gameId), mods));
}

// --- Preset CRUD (store-backed) ---
function list(gameId) {
  const e = getEntry(gameId);
  return {
    activeId: e.activeId,
    presets: e.presets.map((p) => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt, modCount: Object.keys(p.mods || {}).length,
    })),
  };
}
function create(gameId, name, fromActive) {
  const e = getEntry(gameId);
  const mods = fromActive ? JSON.parse(JSON.stringify(L.activePreset(e).mods || {})) : {};
  const next = L.addPreset(e, name, mods, genId);
  writeEntry(gameId, next);
  return next.presets[next.presets.length - 1].id;
}
function rename(gameId, id, name) {
  return writeEntry(gameId, L.renamePreset(getEntry(gameId), id, name));
}
function remove(gameId, id) {
  return writeEntry(gameId, L.removePreset(getEntry(gameId), id, genId));
}
function setActive(gameId, id) {
  return writeEntry(gameId, L.setActive(getEntry(gameId), id));
}
function updateFromActive(gameId, id) {
  const e = getEntry(gameId);
  return writeEntry(gameId, L.snapshot(e, e.activeId, id));
}
function presetMods(gameId, id) {
  const p = getEntry(gameId).presets.find((x) => x.id === id);
  return p ? p.mods || {} : {};
}
function activeName(gameId) {
  const p = L.activePreset(getEntry(gameId));
  return p ? p.name : '';
}

// Remove the active preset's deployed files from the game folder (staging
// untouched) so activating a different preset doesn't leave the old set behind.
// Shared by every preset-activation path (switch, import, apply-invite).
function undeployActive(gameId, installPath) {
  const mods = activeMods(gameId);
  for (const m of Object.values(mods)) {
    for (const rel of m.deployedFiles || []) {
      try { fs.rmSync(path.join(installPath, rel), { force: true }); } catch { /* gone */ }
    }
    m.deployedFiles = [];
  }
  setActiveMods(gameId, mods);
}

module.exports = {
  genId, getEntry, getActiveId, activeMods, setActiveMods,
  list, create, rename, remove, setActive, updateFromActive, presetMods, activeName,
  undeployActive,
};
