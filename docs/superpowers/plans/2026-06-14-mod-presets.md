# Mod Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-game isolated mod presets (r2modman-style): save/switch/rename/delete named loadouts in isolated folders, import/export as codes (reusing the invite codec), with the multiplayer invite riding on presets.

**Architecture:** Pure `presetLogic.js` transforms preset entry objects; `presetStore.js` wraps it with electron-store I/O + the "Default" migration; `modManager` reads/writes the **active preset** through three existing seam functions (`modsState`/`saveModsState`/`modsDir`); `presets.js` adds high-level ops (switch=verify+install, import/export). UI is a presets bar atop the Installed tab.

**Tech Stack:** Electron (CommonJS main), React + zustand (renderer). Verify: `node --test` (pure), `node --check` (main), `npm run build` (renderer).

**Spec:** `docs/superpowers/specs/2026-06-14-mod-presets-design.md`

---

## File Structure

- **Create** `electron/ipc/presetLogic.js` (+ `.test.js`) — pure transforms on `{ activeId, presets }`.
- **Create** `electron/ipc/presetStore.js` — store I/O wrapper + migration + id generation.
- **Modify** `electron/paths.js` — `modsDir(gameId, presetId)`.
- **Modify** `electron/ipc/modManager.js` — seam funcs use the active preset; internal `presetDir`.
- **Create** `electron/ipc/presets.js` — high-level ops (switch/create/rename/delete/update/export/import).
- **Modify** `electron/main.js`, `electron/preload.js` — presets IPC + preload.
- **Modify** `electron/ipc/multiplayer.js` — invite sources/creates the active preset.
- **Modify** `src/store/useAppStore.js` — presets slice + actions.
- **Create** `src/components/PresetBar.jsx` — the Installed-tab presets bar.
- **Modify** `src/pages/GameDetail.jsx` — render `PresetBar` atop the Installed tab.

---

### Task 1: Pure preset logic

**Files:**
- Create: `electron/ipc/presetLogic.js`
- Test: `electron/ipc/presetLogic.test.js`

- [ ] **Step 1: Write the failing test**

`electron/ipc/presetLogic.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('./presetLogic');

const modsA = { 'Owner-A': { version: '1.0.0', enabled: true, isDependency: false, deployedFiles: [] } };

test('migrate wraps a gameMods map into a Default active preset', () => {
  const entry = L.migrate(modsA, () => 'p_1');
  assert.strictEqual(entry.activeId, 'p_1');
  assert.strictEqual(entry.presets.length, 1);
  assert.strictEqual(entry.presets[0].name, 'Default');
  assert.deepStrictEqual(entry.presets[0].mods, modsA);
});

test('activePreset returns the active entry', () => {
  const entry = L.migrate(modsA, () => 'p_1');
  assert.strictEqual(L.activePreset(entry).id, 'p_1');
});

test('withActiveMods replaces the active preset mods', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  const mods2 = { 'Owner-B': { version: '2.0.0', enabled: true, isDependency: false, deployedFiles: [] } };
  entry = L.withActiveMods(entry, mods2);
  assert.deepStrictEqual(L.activePreset(entry).mods, mods2);
});

test('addPreset / setActive / removePreset', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  entry = L.addPreset(entry, 'Modded', {}, () => 'p_2');
  assert.strictEqual(entry.presets.length, 2);
  entry = L.setActive(entry, 'p_2');
  assert.strictEqual(entry.activeId, 'p_2');
  entry = L.removePreset(entry, 'p_1');
  assert.strictEqual(entry.presets.length, 1);
  assert.strictEqual(entry.activeId, 'p_2'); // unaffected
});

test('removePreset of the active falls back to the first remaining', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  entry = L.addPreset(entry, 'B', {}, () => 'p_2');
  entry = L.setActive(entry, 'p_2');
  entry = L.removePreset(entry, 'p_2');
  assert.strictEqual(entry.activeId, 'p_1');
});

test('removePreset refuses the last preset', () => {
  const entry = L.migrate(modsA, () => 'p_1');
  assert.throws(() => L.removePreset(entry, 'p_1'), /last preset/i);
});

test('renamePreset and snapshot', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  entry = L.addPreset(entry, 'B', {}, () => 'p_2');
  entry = L.renamePreset(entry, 'p_2', 'Renamed');
  assert.strictEqual(entry.presets.find((p) => p.id === 'p_2').name, 'Renamed');
  entry = L.snapshot(entry, 'p_1', 'p_2'); // copy p_1's mods into p_2
  assert.deepStrictEqual(entry.presets.find((p) => p.id === 'p_2').mods, modsA);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/ipc/presetLogic.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`electron/ipc/presetLogic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test electron/ipc/presetLogic.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/presetLogic.js electron/ipc/presetLogic.test.js
git commit -m "feat(presets): pure preset entry logic + migration"
```

---

### Task 2: Preset store wrapper

**Files:**
- Create: `electron/ipc/presetStore.js`

Wraps `presetLogic` with electron-store I/O. On first access for a game it migrates the legacy
`gameMods[gameId]` into a Default preset. Exposes the seam `modManager` needs.

- [ ] **Step 1: Implement**

`electron/ipc/presetStore.js`:

```js
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
```

- [ ] **Step 2: Syntax check**

Run: `node --check electron/ipc/presetStore.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/presetStore.js
git commit -m "feat(presets): store wrapper + Default migration"
```

---

### Task 3: paths.modsDir gains a presetId

**Files:**
- Modify: `electron/paths.js`

- [ ] **Step 1: Edit**

In `electron/paths.js`, replace:

```js
function modsDir(gameId) {
  return gameId ? subdir('mods', safeSegment(gameId)) : subdir('mods');
}
```

with:

```js
function modsDir(gameId, presetId) {
  if (!gameId) return subdir('mods');
  return presetId
    ? subdir('mods', safeSegment(gameId), safeSegment(presetId))
    : subdir('mods', safeSegment(gameId));
}
```

- [ ] **Step 2: Verify**

Run: `node --check electron/paths.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add electron/paths.js
git commit -m "feat(presets): per-preset mods staging path"
```

---

### Task 4: Preset-scope modManager's seam

**Files:**
- Modify: `electron/ipc/modManager.js`

Make the three seam points read/write the active preset. Everything else
(`stageVersion`/`installMod`/`uninstallMod`/`setModEnabled`/`deployMods`/`getInstalledMods`) then
operates on the active preset automatically.

- [ ] **Step 1: Require presetStore + add presetDir**

After `const { filterDiscover } = require('./modHubs/discover');` add:

```js
const presetStore = require('./presetStore');
```

Add a helper near `modsState` (the active preset's staging folder):

```js
// Active-preset staging folder for a game.
function presetDir(gameId) {
  return modsDir(gameId, presetStore.getActiveId(gameId));
}
```

- [ ] **Step 2: Repoint modsState/saveModsState to the active preset**

Replace:

```js
function modsState(gameId) {
  const all = store.get('gameMods') || {};
  return all[gameId] || {};
}

function saveModsState(gameId, state) {
  const all = store.get('gameMods') || {};
  all[gameId] = state;
  store.set('gameMods', all);
}
```

with:

```js
function modsState(gameId) {
  return presetStore.activeMods(gameId);
}

function saveModsState(gameId, state) {
  presetStore.setActiveMods(gameId, state);
}
```

- [ ] **Step 3: Use presetDir for staging paths**

Replace the three `modsDir(gameId)` uses inside mod operations:
- In `stageVersion`: `const target = path.join(modsDir(gameId), fullName);` → `path.join(presetDir(gameId), fullName);`
- In `uninstallMod`: `fs.rmSync(path.join(modsDir(gameId), fullName), …)` → `path.join(presetDir(gameId), fullName)`
- In `deployMods`: `const staging = path.join(modsDir(gameId), fullName);` → `path.join(presetDir(gameId), fullName);`

(Leave the `modsDir` import; it's still used by `presetDir`.)

- [ ] **Step 4: Verify existing behavior still works**

Run: `node --check electron/ipc/modManager.js && node --test electron/ipc/modResolver.test.js`
Expected: OK + modResolver tests pass (pure, unaffected). Then `npm run build` → `✓ built` (renderer unaffected). Manual sanity: installing a mod now writes under `mods/<gameId>/<presetId>/` and `getInstalledMods` reads the active preset.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/modManager.js
git commit -m "feat(presets): scope modManager staging/state to the active preset"
```

---

### Task 5: High-level preset ops

**Files:**
- Create: `electron/ipc/presets.js`

Switch (undeploy outgoing → set active → verify+install), plus create/rename/delete/update and
export/import via the invite codec.

- [ ] **Step 1: Implement**

`electron/ipc/presets.js`:

```js
const fs = require('fs');
const path = require('path');
const { store } = require('../store');
const { modsDir } = require('../paths');
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
  presetStore.create(gameId, name, !!fromActive);
  return presetStore.list(gameId);
}

function rename(gameId, id, name) {
  presetStore.rename(gameId, id, name);
  return presetStore.list(gameId);
}

function remove(gameId, id) {
  presetStore.remove(gameId, id);
  return presetStore.list(gameId);
}

function updateFromActive(gameId, id) {
  presetStore.updateFromActive(gameId, id);
  return presetStore.list(gameId);
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
```

- [ ] **Step 2: Syntax check**

Run: `node --check electron/ipc/presets.js`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/presets.js
git commit -m "feat(presets): switch (verify+install), import/export, CRUD ops"
```

---

### Task 6: Presets IPC + preload

**Files:**
- Modify: `electron/main.js`, `electron/preload.js`

- [ ] **Step 1: main.js — require + handlers**

After `const multiplayer = require('./ipc/multiplayer');` add:

```js
const presets = require('./ipc/presets');
```

After the multiplayer handlers add:

```js
  handle('unifia:listPresets', (gameId) => presets.list(gameId));
  handle('unifia:createPreset', (gameId, name, fromActive) => presets.create(gameId, name, fromActive));
  handle('unifia:renamePreset', (gameId, id, name) => presets.rename(gameId, id, name));
  handle('unifia:deletePreset', (gameId, id) => presets.remove(gameId, id));
  handle('unifia:updatePreset', (gameId, id) => presets.updateFromActive(gameId, id));
  handle('unifia:switchPreset', (gameId, id) =>
    presets.switchTo(gameId, id, (p) => emit('download-progress', { mod: true, ...p }))
  );
  handle('unifia:exportPreset', (gameId, id) => presets.exportPreset(gameId, id));
  handle('unifia:importPreset', (gameId, code, name) =>
    presets.importPreset(gameId, code, name, (p) => emit('download-progress', { mod: true, ...p }))
  );
```

- [ ] **Step 2: preload.js — methods**

After the multiplayer preload block add:

```js
  // Mod presets
  listPresets: (gameId) => invoke('unifia:listPresets', gameId),
  createPreset: (gameId, name, fromActive) => invoke('unifia:createPreset', gameId, name, fromActive),
  renamePreset: (gameId, id, name) => invoke('unifia:renamePreset', gameId, id, name),
  deletePreset: (gameId, id) => invoke('unifia:deletePreset', gameId, id),
  updatePreset: (gameId, id) => invoke('unifia:updatePreset', gameId, id),
  switchPreset: (gameId, id) => invoke('unifia:switchPreset', gameId, id),
  exportPreset: (gameId, id) => invoke('unifia:exportPreset', gameId, id),
  importPreset: (gameId, code, name) => invoke('unifia:importPreset', gameId, code, name),
```

- [ ] **Step 3: Verify**

Run: `node --check electron/main.js && node --check electron/preload.js`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat(presets): IPC + preload"
```

---

### Task 7: Invite rides on presets

**Files:**
- Modify: `electron/ipc/multiplayer.js`

`buildInvite` already reads enabled mods (now the active preset's, via modManager — no change
needed). `applyInvite` must ALSO create a preset from the invite's mods + switch to it, then sync.

- [ ] **Step 1: Require presets**

In `electron/ipc/multiplayer.js`, after `const { parseStatus } = require('./connectorStatus');` add:

```js
const presets = require('./presets');
```

- [ ] **Step 2: applyInvite creates + switches a preset**

Replace the body of `applyInvite` (the `diff` computation + return) with one that imports a preset:

```js
async function applyInvite(gameId, code) {
  const game = findGame(gameId);
  const d = decodeInvite(code);
  const community = modManager.communityFor(game);
  if (d.community && community && d.community !== community) {
    throw new Error(`This code is for ${d.community}, not this game.`);
  }
  saveProfile(gameId, {
    photonAppId: d.appId,
    netConfig: {
      connectionMode: 'cloud-region',
      appId: d.appId,
      roomCode: d.room,
      version: d.version,
    },
  });
  // The invite's mod set becomes a preset we switch to (verify+install happens
  // in the renderer's review-then-sync, so don't auto-install here — just stage
  // the preset and return the diff).
  presets.create(gameId, `${d.name || 'Friend'} ${d.room}`, false);
  const list = presets.list(gameId);
  const newId = list.presets[list.presets.length - 1].id;
  // Record the wanted mods into the new (now-active) preset without installing,
  // so the diff is computed against it; renderer sync installs.
  return applyInviteFinish(gameId, newId, d, game);
}

function applyInviteFinish(gameId, presetId, d, game) {
  const presetStore = require('./presetStore');
  presetStore.setActive(gameId, presetId);
  const diff = diffMods(modManager.getInstalledMods(gameId), d.mods);
  return { descriptor: d, diff, hostVersion: d.version, localVersion: String(game.version || ''), presetId };
}
```

Mark `applyInvite` `async` and keep `parseInvite`/`buildInvite`/`getConnectorPlayers` unchanged.
(The renderer's existing Sync loop installs `diff.toInstall`/`toUpdate` into the now-active preset.)

- [ ] **Step 3: Verify**

Run: `node --check electron/ipc/multiplayer.js`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/multiplayer.js
git commit -m "feat(presets): multiplayer invite creates + switches a preset"
```

---

### Task 8: Store presets slice

**Files:**
- Modify: `src/store/useAppStore.js`

- [ ] **Step 1: Add state + actions**

After the multiplayer actions (`refreshConnectorPlayers`), add:

```js

  // --- Mod presets ---
  presets: {}, // gameId -> { activeId, presets: [{ id, name, updatedAt, modCount }] }
  async loadPresets(gameId) {
    const data = await api.listPresets(gameId);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
    return data;
  },
  async createPreset(gameId, name, fromActive) {
    const data = await api.createPreset(gameId, name, fromActive);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
    return data;
  },
  async renamePreset(gameId, id, name) {
    const data = await api.renamePreset(gameId, id, name);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
  },
  async deletePreset(gameId, id) {
    const data = await api.deletePreset(gameId, id);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
  },
  async updatePreset(gameId, id) {
    const data = await api.updatePreset(gameId, id);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
  },
  async switchPreset(gameId, id, game) {
    const res = await api.switchPreset(gameId, id);
    set((s) => ({ presets: { ...s.presets, [gameId]: res.list } }));
    if (game) await get().loadMods(game); // refresh installed list for the new active preset
    return res;
  },
  async exportPreset(gameId, id) {
    return api.exportPreset(gameId, id);
  },
  async importPreset(gameId, code, name, game) {
    const res = await api.importPreset(gameId, code, name);
    set((s) => ({ presets: { ...s.presets, [gameId]: res.list } }));
    if (game) await get().loadMods(game);
    return res;
  },
```

- [ ] **Step 2: Refresh presets in loadMods**

In `loadMods`, in the installed-game branch (after `if (!notInstalled) get().refreshConnector(game.id);`), add:

```js
      if (!notInstalled) get().loadPresets(game.id);
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/store/useAppStore.js
git commit -m "feat(presets): store presets slice + actions"
```

---

### Task 9: PresetBar UI in the Installed tab

**Files:**
- Create: `src/components/PresetBar.jsx`
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Create PresetBar**

`src/components/PresetBar.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function PresetBar({ game }) {
  const data = useAppStore((s) => s.presets[game.id]);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const createPreset = useAppStore((s) => s.createPreset);
  const renamePreset = useAppStore((s) => s.renamePreset);
  const deletePreset = useAppStore((s) => s.deletePreset);
  const updatePreset = useAppStore((s) => s.updatePreset);
  const switchPreset = useAppStore((s) => s.switchPreset);
  const exportPreset = useAppStore((s) => s.exportPreset);
  const importPreset = useAppStore((s) => s.importPreset);

  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  // Inline naming (Electron disables window.prompt): mode is 'new' | 'rename' | null.
  const [nameMode, setNameMode] = useState(null);
  const [nameVal, setNameVal] = useState('');

  useEffect(() => {
    if (!data) loadPresets(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  if (!data) return null;
  const active = data.presets.find((p) => p.id === data.activeId);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openName(mode) {
    setNameMode(mode);
    setNameVal(mode === 'rename' && active ? active.name : '');
  }

  async function submitName() {
    const name = nameVal.trim();
    if (!name) return;
    if (nameMode === 'new') await createPreset(game.id, name, true); // snapshot current
    else if (nameMode === 'rename') await renamePreset(game.id, data.activeId, name);
    setNameMode(null);
    setNameVal('');
  }

  return (
    <div className="mb-3 rounded border border-border-default bg-neutral-900/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Preset</span>
        <select
          value={data.activeId}
          disabled={busy}
          onChange={(e) => run(() => switchPreset(game.id, e.target.value, game))}
          className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        >
          {data.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.modCount})</option>
          ))}
        </select>

        <button onClick={() => openName('new')} disabled={busy} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          New
        </button>
        <button onClick={() => run(() => updatePreset(game.id, data.activeId))} disabled={busy}
          title="Save the current mods into this preset"
          className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Save
        </button>
        <button onClick={() => openName('rename')} disabled={busy} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Rename
        </button>
        <button onClick={() => run(async () => {
          if (data.presets.length <= 1) throw new Error('Cannot delete the last preset');
          if (window.confirm(`Delete preset "${active ? active.name : ''}"?`)) await deletePreset(game.id, data.activeId);
        })} disabled={busy} className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-red-900/60 disabled:opacity-50">
          Delete
        </button>

        <span className="mx-1 h-4 w-px bg-border-default" />

        <button onClick={() => run(async () => {
          const c = await exportPreset(game.id, data.activeId);
          await navigator.clipboard.writeText(c);
        })} disabled={busy} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Copy code
        </button>
        <button onClick={() => setImporting((v) => !v)} disabled={busy}
          className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Import code
        </button>
      </div>

      {nameMode && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run(submitName)}
            placeholder={nameMode === 'new' ? 'New preset name…' : 'Rename preset…'}
            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
          />
          <button onClick={() => run(submitName)} disabled={busy || !nameVal.trim()}
            className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast disabled:opacity-50">
            {nameMode === 'new' ? 'Create' : 'Save'}
          </button>
          <button onClick={() => setNameMode(null)} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover">
            Cancel
          </button>
        </div>
      )}

      {importing && (
        <div className="mt-2 flex items-center gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="paste preset code…"
            className="flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-accent" />
          <button onClick={() => run(async () => {
            await importPreset(game.id, code.trim(), undefined, game);
            setCode(''); setImporting(false);
          })} disabled={busy || !code.trim()}
            className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast disabled:opacity-50">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      )}

      {busy && <p className="mt-1 text-xs text-neutral-500"><Icon name="refresh-cw" size={11} className="inline animate-spin" /> Working…</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Render it atop the Installed tab**

In `src/pages/GameDetail.jsx`, add the import after `import MultiplayerTab from './MultiplayerTab.jsx';`:

```jsx
import PresetBar from '../components/PresetBar.jsx';
```

Then in the Installed-tab body, render `PresetBar` above the pinned connector row. Find:

```jsx
          {tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              {/* Pinned, read-only: the Unifia connector is a system component,
```

Insert `<PresetBar game={game} />` right after the opening `<div className="flex flex-col gap-2">`:

```jsx
          {tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              <PresetBar game={game} />
              {/* Pinned, read-only: the Unifia connector is a system component,
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/PresetBar.jsx src/pages/GameDetail.jsx
git commit -m "feat(presets): preset bar in the Installed tab"
```

---

## Notes for the implementer

- The whole point of the seam (Task 4) is that `installMod`/`uninstallMod`/`setModEnabled`/
  `deployMods`/`getInstalledMods` need **no changes** — they call `modsState`/`saveModsState`/
  `presetDir`, which now resolve the active preset.
- `switchPreset`/`importPreset` install via the existing `installMod` (download progress emits on the
  same `download-progress` channel the UI already listens to).
- The migration runs lazily in `presetStore.getEntry` the first time any preset/mod op touches a
  game — never clobbers an existing `gamePresets[gameId]`. Old `gameMods` is read once and left in
  place (harmless).
- `deployMods` clears each mod's previously-deployed files via `deployedFiles`; `switchTo` additionally
  clears the **outgoing** preset's deployed files before activating the new one (cross-preset cleanup).
- After all tasks: final whole-feature review, then finish the branch (merge to main + push) per the
  standing workflow.
```
