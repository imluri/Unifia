// Pure transforms on a game's preset entry: { activeId, presets: [{ id, name,
// mods, updatedAt }] }. `mods` is the same shape as the old gameMods map. No I/O;
// id generation is injected so this stays deterministic + testable.

function now() {
  return Date.now();
}

// Wrap a legacy gameMods map into a single active "Default" preset.
function migrate(gameMods, genId) {
  const id = genId();
  return {
    activeId: id,
    presets: [{ id, name: 'Default', mods: gameMods || {}, updatedAt: now() }],
  };
}

function activePreset(entry) {
  return (entry.presets || []).find((p) => p.id === entry.activeId) || entry.presets[0] || null;
}

function withActiveMods(entry, mods) {
  return {
    ...entry,
    presets: entry.presets.map((p) =>
      p.id === entry.activeId ? { ...p, mods, updatedAt: now() } : p
    ),
  };
}

function addPreset(entry, name, mods, genId) {
  const id = genId();
  return {
    ...entry,
    presets: [...entry.presets, { id, name: name || 'New preset', mods: mods || {}, updatedAt: now() }],
  };
}

function setActive(entry, id) {
  if (!entry.presets.some((p) => p.id === id)) throw new Error(`Unknown preset: ${id}`);
  return { ...entry, activeId: id };
}

function renamePreset(entry, id, name) {
  return {
    ...entry,
    presets: entry.presets.map((p) => (p.id === id ? { ...p, name, updatedAt: now() } : p)),
  };
}

function removePreset(entry, id) {
  if (entry.presets.length <= 1) throw new Error('Cannot delete the last preset');
  const presets = entry.presets.filter((p) => p.id !== id);
  const activeId = entry.activeId === id ? presets[0].id : entry.activeId;
  return { ...entry, activeId, presets };
}

// Copy fromId's mods into toId (used for "update preset from active").
function snapshot(entry, fromId, toId) {
  const from = entry.presets.find((p) => p.id === fromId);
  if (!from) throw new Error(`Unknown preset: ${fromId}`);
  return {
    ...entry,
    presets: entry.presets.map((p) =>
      p.id === toId ? { ...p, mods: JSON.parse(JSON.stringify(from.mods)), updatedAt: now() } : p
    ),
  };
}

module.exports = {
  migrate, activePreset, withActiveMods, addPreset, setActive, renamePreset, removePreset, snapshot,
};
