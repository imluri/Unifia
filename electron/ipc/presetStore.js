const { store } = require('../store');
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

// Resolve the game's preset entry, migrating the legacy gameMods map on first
// access (idempotent — only when no entry exists yet).
function getEntry(gameId) {
  const all = readAll();
  if (all[gameId]) return all[gameId];
  const legacy = (store.get('gameMods') || {})[gameId] || {};
  return writeEntry(gameId, L.migrate(legacy, genId));
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
  return writeEntry(gameId, L.removePreset(getEntry(gameId), id));
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

module.exports = {
  genId, getEntry, getActiveId, activeMods, setActiveMods,
  list, create, rename, remove, setActive, updateFromActive, presetMods,
};
