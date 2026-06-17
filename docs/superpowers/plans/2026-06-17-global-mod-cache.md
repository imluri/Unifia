# Global Mod Cache + Copy-Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download each mod `fullName@version` once into a shared cache and deploy enabled mods into the game by copying from it, so presets/imports never re-download.

**Architecture:** A global cache `cacheDir()/mods/<fullName>/<version>/` replaces per-preset staging. `stageVersion` downloads into the cache (skipping cache hits); `deployMods` copies from the cache into `BepInEx/plugins`. Uninstall/restore become record-only (files persist in cache). A one-time migration moves existing staging into the cache.

**Tech Stack:** Node (electron main), `node:test`. Pure helpers are unit-tested; fs/network shells are build + manually verified (per the codebase convention).

**Reference:** Spec at `docs/superpowers/specs/2026-06-17-global-mod-cache-design.md`.

---

### Task 1: `modCacheDir` path helper

**Files:**
- Modify: `electron/paths.js`
- Test: `electron/utils/pathsCache.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `electron/utils/pathsCache.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { modCacheDir, cacheDir } = require('../paths');

test('modCacheDir nests fullName + version under cache/mods', () => {
  const p = modCacheDir('Owner-Mod', '1.2.3');
  // Lives under cacheDir()/mods/<fullName>/<version>
  assert.ok(p.startsWith(cacheDir()), 'under cacheDir');
  assert.ok(p.replace(/\\/g, '/').endsWith('cache/mods/Owner-Mod/1.2.3'), p);
});

test('modCacheDir sanitizes unsafe segments', () => {
  const p = modCacheDir('Owner-Mod', '1.0/../x').replace(/\\/g, '/');
  assert.ok(!p.includes('..'), 'no path traversal: ' + p);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test electron/utils/pathsCache.test.js`
Expected: FAIL — `modCacheDir is not a function`.

- [ ] **Step 3: Add `modCacheDir`**

In `electron/paths.js`, after `cacheDir()` (line ~59), add the function and export it. `safeSegment` already exists in this file (used by `modsDir`):

```js
// Global, version-keyed mod cache: a downloaded mod version lives here once and
// is copied into each game's BepInEx/plugins on deploy. Shared across presets+games.
function modCacheDir(fullName, version) {
  return subdir('cache', 'mods', safeSegment(fullName), safeSegment(String(version || '')));
}
```

Add `modCacheDir,` to the `module.exports` object.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test electron/utils/pathsCache.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/paths.js electron/utils/pathsCache.test.js
git commit -m "feat(paths): modCacheDir for the global version-keyed mod cache"
```

End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 2: Download into the cache (skip cache hits)

**Files:**
- Modify: `electron/ipc/modManager.js` (`stageVersion`, add `isCached`)

- [ ] **Step 1: Add `isCached` + require `modCacheDir`**

In `electron/ipc/modManager.js`, change the paths require (line 6) to include `modCacheDir`:

```js
const { modsDir, modCacheDir, downloadsDir, ensureDir } = require('../paths');
```

Add this helper just above `stageVersion` (line ~110):

```js
// A cache target counts as present only if it exists AND is non-empty (an empty
// dir from an interrupted extract is treated as a miss so we re-download).
function isCached(dir) {
  try { return fs.existsSync(dir) && fs.readdirSync(dir).length > 0; }
  catch { return false; }
}
```

- [ ] **Step 2: Rewrite `stageVersion` to use the cache**

Replace the body of `stageVersion` (currently lines ~111-148). It now targets the global cache and returns early on a hit:

```js
// Download one version zip and extract it into the global cache (once per
// fullName@version). A cache hit short-circuits — no network.
async function stageVersion(gameId, fullName, versionData, onProgress) {
  const target = modCacheDir(fullName, versionData.version_number);
  if (isCached(target)) {
    if (onProgress) onProgress({ percent: 100, bytesReceived: 0, totalBytes: 0, cached: true });
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  ensureDir(target);

  ensureDir(downloadsDir());
  const zipPath = path.join(downloadsDir(), `${fullName}-${versionData.version_number}.zip`);
  const res = await httpFetch(versionData.download_url, {
    headers: { 'User-Agent': 'Unifia-Launcher' },
  });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}: ${res.statusText}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    out.on('error', reject);
    const reader = res.body.getReader();
    const pump = () =>
      reader.read().then(({ done, value }) => {
        if (done) return out.end(() => resolve());
        received += value.length;
        out.write(Buffer.from(value));
        if (onProgress) {
          onProgress({
            percent: total ? Math.round((received / total) * 100) : 0,
            bytesReceived: received,
            totalBytes: total,
          });
        }
        return pump();
      }).catch((err) => { out.destroy(); reject(err); });
    pump();
  });

  await extract(zipPath, { dir: target });
  try { fs.unlinkSync(zipPath); } catch { /* temp cleanup */ }
}
```

(`gameId` is now unused by `stageVersion` but kept in the signature so callers are unchanged.)

- [ ] **Step 3: Verify it loads without a syntax error**

Run: `node -e "require('./electron/ipc/modManager.js'); console.log('loads ok')"`
Expected: prints `loads ok` (electron-store initializes outside Electron in this repo; no SyntaxError).

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/modManager.js
git commit -m "feat(mods): download mod versions into the global cache (skip hits)"
```

---

### Task 3: Deploy + validate from the cache

**Files:**
- Modify: `electron/ipc/modManager.js` (`deployMods` source, `validateInstalledMods`)

- [ ] **Step 1: Point `deployMods` at the cache**

In `deployMods` (line ~301), replace the staging source line:

```js
    const staging = path.join(presetDir(gameId), fullName);
```

with the cache path keyed by the mod's recorded version:

```js
    const staging = modCacheDir(fullName, m.version);
```

Everything else in `deployMods` is unchanged (the `BepInExPack → root` vs `plugins/<fullName>` branch, `deployedFiles` tracking).

- [ ] **Step 2: Point `validateInstalledMods` at the cache**

In `validateInstalledMods` (line ~58-60), replace:

```js
  for (const [fullName] of Object.entries(state)) {
    const staging = path.join(presetDir(gameId), fullName);
    if (!fs.existsSync(staging)) {
```

with a cache check keyed by version:

```js
  for (const [fullName, m] of Object.entries(state)) {
    const staging = modCacheDir(fullName, m.version);
    if (!isCached(staging)) {
```

- [ ] **Step 3: Verify it loads**

Run: `node -e "require('./electron/ipc/modManager.js'); console.log('loads ok')"`
Expected: prints `loads ok`.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/modManager.js
git commit -m "feat(mods): deploy + validate from the global cache"
```

---

### Task 4: Archive as records (keep ArchivedModsSection working)

**Files:**
- Modify: `electron/ipc/modManager.js` (`uninstallMod`, `restoreArchivedMod`, `listArchivedMods`, drop `archiveDir`)

- [ ] **Step 1: Replace the three archive functions**

In `electron/ipc/modManager.js`, replace `archiveDir`, `uninstallMod`, `restoreArchivedMod`, and `listArchivedMods` (lines ~181-243) with record-based versions backed by a `gameArchivedMods` store key. Files are never moved/deleted — the cache holds them.

```js
// Archived mods are recorded per game+preset (files persist in the global cache).
// Shape: gameArchivedMods[gameId][presetId][fullName] = { version, isDependency }.
function archivedAll() { return store.get('gameArchivedMods') || {}; }
function saveArchived(all) { store.set('gameArchivedMods', all); }

// Remove a mod from the active preset's state and record it as archived. The
// cache keeps the files, so restore (or re-add) is a cache hit. Deploy reconciles
// the live game folder (undeploys the removed mod's files on next deploy).
function uninstallMod(gameId, fullName) {
  const state = { ...modsState(gameId) };
  if (!state[fullName]) return { gameId, fullName, removed: false };

  const presetId = presetStore.getActiveId(gameId);
  const all = archivedAll();
  all[gameId] = all[gameId] || {};
  all[gameId][presetId] = all[gameId][presetId] || {};
  all[gameId][presetId][fullName] = {
    version: state[fullName].version,
    isDependency: !!state[fullName].isDependency,
  };
  saveArchived(all);

  delete state[fullName];
  saveModsState(gameId, state);
  return { gameId, fullName, removed: true };
}

// Restore an archived mod into the active preset (cache hit on next deploy).
function restoreArchivedMod(gameId, fullName) {
  const presetId = presetStore.getActiveId(gameId);
  const all = archivedAll();
  const rec = all[gameId] && all[gameId][presetId] && all[gameId][presetId][fullName];
  if (!rec) throw new Error(`Archived mod not found: ${fullName}`);

  const state = { ...modsState(gameId) };
  state[fullName] = {
    version: rec.version,
    enabled: true,
    isDependency: !!rec.isDependency,
    deployedFiles: [],
  };
  saveModsState(gameId, state);

  delete all[gameId][presetId][fullName];
  saveArchived(all);
  return { gameId, fullName, restored: true };
}

// List archived mods for the active preset (for ArchivedModsSection).
function listArchivedMods(gameId) {
  const presetId = presetStore.getActiveId(gameId);
  const all = archivedAll();
  const m = (all[gameId] && all[gameId][presetId]) || {};
  return Object.entries(m).map(([fullName, r]) => ({ fullName, version: r.version }));
}
```

- [ ] **Step 2: Verify it loads + the module exports are intact**

Run: `node -e "const m=require('./electron/ipc/modManager.js'); console.log('uninstall:', typeof m.uninstallMod, '| restore:', typeof m.restoreArchivedMod, '| list:', typeof m.listArchivedMods)"`
Expected: all three print `function`. (If any were exported by name in `module.exports`, they still resolve.)

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/modManager.js
git commit -m "feat(mods): archive as records (files stay in cache; restore = cache hit)"
```

---

### Task 5: One-time staging → cache migration

**Files:**
- Create: `electron/ipc/modCacheMigrate.js`
- Test: `electron/ipc/modCacheMigrate.test.js`
- Modify: `electron/main.js` (run on startup)

- [ ] **Step 1: Write the failing test (pure migration mapping)**

Create `electron/ipc/modCacheMigrate.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { planMoves } = require('./modCacheMigrate');

test('planMoves maps each recorded mod to a fullName@version cache move', () => {
  const presets = {
    'custom:REPO': {
      presets: [
        { id: 'p1', mods: { 'Owner-A': { version: '1.0.0' }, 'Owner-B': { version: '2.0.0' } } },
        { id: 'p2', mods: { 'Owner-A': { version: '1.0.0' } } },
      ],
    },
  };
  const moves = planMoves(presets);
  // 3 records, but Owner-A@1.0.0 appears twice → still one move target per (game,preset) source.
  assert.deepStrictEqual(moves, [
    { gameId: 'custom:REPO', presetId: 'p1', fullName: 'Owner-A', version: '1.0.0' },
    { gameId: 'custom:REPO', presetId: 'p1', fullName: 'Owner-B', version: '2.0.0' },
    { gameId: 'custom:REPO', presetId: 'p2', fullName: 'Owner-A', version: '1.0.0' },
  ]);
});

test('planMoves skips records without a version', () => {
  const moves = planMoves({ g: { presets: [{ id: 'p', mods: { X: {} } }] } });
  assert.deepStrictEqual(moves, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test electron/ipc/modCacheMigrate.test.js`
Expected: FAIL — `Cannot find module './modCacheMigrate'`.

- [ ] **Step 3: Implement the migration**

Create `electron/ipc/modCacheMigrate.js`:

```js
const fs = require('fs');
const path = require('path');
const { store } = require('../store');
const { modsDir, modCacheDir, ensureDir } = require('../paths');

// Pure: which (gameId, presetId, fullName, version) staging folders should move
// into the cache. One entry per recorded mod that has a version.
function planMoves(presets) {
  const moves = [];
  for (const [gameId, entry] of Object.entries(presets || {})) {
    for (const preset of (entry && entry.presets) || []) {
      for (const [fullName, m] of Object.entries((preset && preset.mods) || {})) {
        if (m && m.version) moves.push({ gameId, presetId: preset.id, fullName, version: m.version });
      }
    }
  }
  return moves;
}

// One-time: move existing per-preset staging mods into the global cache, keyed by
// fullName@version. Guarded by settings.modCacheMigrated. Best-effort per mod.
function migrateModCache() {
  const settings = store.get('settings') || {};
  if (settings.modCacheMigrated) return;

  for (const mv of planMoves(store.get('gamePresets') || {})) {
    const cacheTarget = modCacheDir(mv.fullName, mv.version);
    const stagingSrc = path.join(modsDir(mv.gameId, mv.presetId), mv.fullName);
    try {
      if (fs.existsSync(stagingSrc) && (!fs.existsSync(cacheTarget) || fs.readdirSync(cacheTarget).length === 0)) {
        fs.rmSync(cacheTarget, { recursive: true, force: true });
        ensureDir(path.dirname(cacheTarget));
        fs.renameSync(stagingSrc, cacheTarget);
      }
    } catch { /* locked/in-use — lazy re-cache on next install/deploy handles it */ }
  }

  store.set('settings', { ...settings, modCacheMigrated: true });
}

module.exports = { planMoves, migrateModCache };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test electron/ipc/modCacheMigrate.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the migration on startup**

In `electron/main.js`, add the require near the other ipc requires (after `const gameScanner = require('./ipc/gameScanner');`):

```js
const { migrateModCache } = require('./ipc/modCacheMigrate');
```

Inside `app.whenReady().then(() => { ... })`, after `ensureLayout();`, add:

```js
  try { migrateModCache(); } catch (e) { console.error('[modCacheMigrate]', e && e.message); }
```

- [ ] **Step 6: Verify main loads + commit**

Run: `node -e "require('./electron/ipc/modCacheMigrate.js'); console.log('ok')"`
Expected: prints `ok`.

```bash
git add electron/ipc/modCacheMigrate.js electron/ipc/modCacheMigrate.test.js electron/main.js
git commit -m "feat(mods): one-time staging->cache migration on startup"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `node --test electron/ipc/*.test.js electron/utils/*.test.js src/lib/*.test.js src/lib/*.test.mjs`
Expected: PASS — all green, including `pathsCache.test.js` (2) and `modCacheMigrate.test.js` (2); no regressions in presetStore/presetLogic/modSync.

- [ ] **Step 2: Renderer build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 3: Main-process load smoke**

Run: `node -e "require('./electron/ipc/modManager.js'); require('./electron/ipc/modCacheMigrate.js'); require('./electron/paths.js'); console.log('main modules load')"`
Expected: prints `main modules load`.

- [ ] **Step 4: Manual end-to-end (document results)**

`npm run dev`, then for a Thunderstore game:
- Install mod X into preset A → it downloads once; confirm `…/unifia_data/cache/mods/<X>/<ver>/` exists.
- Create preset B, add mod X → **no second download** (instant; cache hit).
- Switch A↔B and launch → `BepInEx/plugins/` contains exactly the active preset's enabled mods.
- Disable X → after launch it's gone from `plugins/`, still in the cache; re-enable → instant.
- Uninstall X → appears under Archived; Restore → back in the preset with no download.
- Existing install: confirm previously-staged mods still deploy (migration moved them; no re-download).
