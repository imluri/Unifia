# Crossplay Recipe Distribution Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch maintainer-curated per-game "crossplay recipes" from a GitHub `recipes/` folder and merge them over the bundled profile registry, so a game's connector config can be tuned without shipping a new Unifia build.

**Architecture:** Network work is decoupled from the synchronous `matchProfile`. Pure logic (validate/match/version-gate/merge) lives in unit-tested modules (`recipes.js`, `profiles.resolveProfile`); an impure shell (`recipeStore.js`) does `httpFetch` + disk cache with serve-stale + bundled fallback, mirroring `thunderstore.js`. `matchProfile` reads only the already-cached recipe, so launch never blocks and offline works.

**Tech Stack:** Electron (CommonJS main), `node:test` + `node:assert` (run via `node --test <file>`), React + zustand renderer. Shared helpers: `httpFetch` (`electron/util.js`), `cacheDir`/`ensureDir` (`electron/paths.js`).

**Reference:** Spec at `docs/superpowers/specs/2026-06-16-crossplay-recipes-design.md`.

**Precedence (later wins):** `default → bundled entry → analyzer override → remote recipe → (user override: future)`.

**Vocabulary allowlist:** `game`(string), `netcode`(string), `hookStrategy`(string), `autoDelaySeconds`(number), `supportsNativeLobby`(bool), `connectHookType`(string), `connectHookMethod`(string), `region`(string), `connectionMode`(string), `module`(string), `thunderstoreCommunity`(string).

---

### Task 1: Pure recipe logic (validate / match / version-gate)

**Files:**
- Create: `electron/ipc/recipes.js`
- Test: `electron/ipc/recipes.test.js`

This module requires NOTHING from electron/fs/network — it stays pure so the test runs in plain node. The app version is passed in as a parameter.

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/recipes.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('./recipes');

test('versionGte compares dotted numeric versions', () => {
  assert.strictEqual(R.versionGte('0.1.1', '0.1.0'), true);
  assert.strictEqual(R.versionGte('0.1.0', '0.1.0'), true);
  assert.strictEqual(R.versionGte('0.1.0', '0.2.0'), false);
  assert.strictEqual(R.versionGte('1.0.0', '0.9.9'), true);
});

test('validateRecipe keeps allowlisted fields and drops the rest', () => {
  const raw = {
    schemaVersion: 1, id: 'repo',
    profile: { game: 'REPO', region: 'eu', evilField: 'x', autoDelaySeconds: 3 },
  };
  const out = R.validateRecipe(raw, '0.1.1');
  assert.strictEqual(out.id, 'repo');
  assert.deepStrictEqual(out.profile, { game: 'REPO', region: 'eu', autoDelaySeconds: 3 });
  assert.strictEqual('evilField' in out.profile, false);
});

test('validateRecipe type-checks fields (wrong types dropped)', () => {
  const raw = { schemaVersion: 1, id: 'x', profile: { region: 5, supportsNativeLobby: 'yes', autoDelaySeconds: 'no' } };
  const out = R.validateRecipe(raw, '0.1.1');
  assert.deepStrictEqual(out.profile, {}); // all wrong types dropped
});

test('validateRecipe rejects wrong schemaVersion or missing id/profile', () => {
  assert.strictEqual(R.validateRecipe({ schemaVersion: 2, id: 'x', profile: {} }, '0.1.1'), null);
  assert.strictEqual(R.validateRecipe({ schemaVersion: 1, profile: {} }, '0.1.1'), null);
  assert.strictEqual(R.validateRecipe({ schemaVersion: 1, id: 'x' }, '0.1.1'), null);
  assert.strictEqual(R.validateRecipe(null, '0.1.1'), null);
});

test('validateRecipe applies the minUnifiaVersion gate', () => {
  const raw = { schemaVersion: 1, id: 'x', minUnifiaVersion: '0.2.0', profile: { region: 'eu' } };
  assert.strictEqual(R.validateRecipe(raw, '0.1.1'), null); // app too old → ignored
  assert.ok(R.validateRecipe({ ...raw, minUnifiaVersion: '0.1.0' }, '0.1.1')); // app new enough → kept
});

test('validateIndex keeps well-formed entries and drops malformed ones', () => {
  const raw = { schemaVersion: 1, recipes: [
    { id: 'repo', match: { namePattern: 'REPO' }, file: 'repo.json', version: 3 },
    { id: 'bad' }, // no match/file → dropped
    { match: { steamAppId: 1 }, file: 'a.json' }, // no id → dropped
  ] };
  const out = R.validateIndex(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'repo');
});

test('validateIndex rejects wrong schemaVersion', () => {
  assert.deepStrictEqual(R.validateIndex({ schemaVersion: 9, recipes: [] }), []);
  assert.deepStrictEqual(R.validateIndex(null), []);
});

test('matchRecipe matches by steamAppId first, then namePattern', () => {
  const recipes = [
    { id: 'repo', match: { namePattern: '\\bREPO\\b' }, profile: { region: 'eu' } },
    { id: 'foo', match: { steamAppId: '123' }, profile: { region: 'us' } },
  ];
  assert.strictEqual(R.matchRecipe(recipes, { steamAppId: '123', name: 'Foo' }).id, 'foo');
  assert.strictEqual(R.matchRecipe(recipes, { name: 'REPO' }).id, 'repo');
  assert.strictEqual(R.matchRecipe(recipes, { name: 'Other' }), null);
});

test('matchRecipe tolerates a non-compiling namePattern', () => {
  const recipes = [{ id: 'x', match: { namePattern: '[' }, profile: {} }];
  assert.strictEqual(R.matchRecipe(recipes, { name: 'anything' }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test electron/ipc/recipes.test.js`
Expected: FAIL — `Cannot find module './recipes'`.

- [ ] **Step 3: Write the implementation**

Create `electron/ipc/recipes.js`:

```js
// Pure logic for crossplay recipes: validation against a constrained vocabulary,
// game matching, and version gating. NO electron/fs/network requires here — the
// impure fetch/cache shell lives in recipeStore.js. Mirrors the presetLogic.js
// (pure) / presetStore.js (impure) split. See the crossplay-recipes spec.

const SCHEMA_VERSION = 1;

// Allowed recipe profile fields and their expected JS typeof. Anything else in a
// recipe's `profile` is dropped — this is the safety boundary (recipes are pure
// data over a fixed vocabulary; widening it is a deliberate layer-B change).
const FIELD_TYPES = {
  game: 'string',
  netcode: 'string',
  hookStrategy: 'string',
  autoDelaySeconds: 'number',
  supportsNativeLobby: 'boolean',
  connectHookType: 'string',
  connectHookMethod: 'string',
  region: 'string',
  connectionMode: 'string',
  module: 'string',
  thunderstoreCommunity: 'string',
};

// Compare dotted numeric versions: is `a` >= `b`? Non-numeric parts treated as 0.
function versionGte(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true; // equal
}

function safeRegex(pattern) {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

// Keep only allowlisted, correctly-typed fields from a raw profile object.
function sanitizeProfile(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, type] of Object.entries(FIELD_TYPES)) {
    if (key in raw && typeof raw[key] === type) out[key] = raw[key];
  }
  return out;
}

// Validate one recipe object against the vocabulary + version gate.
// Returns { id, match, profile } or null if it must be ignored.
function validateRecipe(raw, appVersion) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (!raw.profile || typeof raw.profile !== 'object') return null;
  if (raw.minUnifiaVersion && !versionGte(appVersion, raw.minUnifiaVersion)) return null;
  return {
    id: raw.id,
    match: raw.match && typeof raw.match === 'object' ? raw.match : {},
    profile: sanitizeProfile(raw.profile),
  };
}

// Validate the index manifest. Returns an array of well-formed entries
// (others dropped). Does not fetch the recipe files themselves.
function validateIndex(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA_VERSION) return [];
  if (!Array.isArray(raw.recipes)) return [];
  return raw.recipes.filter(
    (e) =>
      e && typeof e.id === 'string' && e.id &&
      typeof e.file === 'string' && e.file &&
      e.match && typeof e.match === 'object',
  );
}

// Find the recipe whose match fits the game: steamAppId first, then namePattern.
function matchRecipe(recipes, game) {
  if (!Array.isArray(recipes)) return null;
  for (const r of recipes) {
    const m = r.match || {};
    if (m.steamAppId && game.steamAppId && String(game.steamAppId) === String(m.steamAppId)) {
      return r;
    }
  }
  for (const r of recipes) {
    const m = r.match || {};
    if (m.namePattern && game.name) {
      const re = safeRegex(m.namePattern);
      if (re && re.test(game.name)) return r;
    }
  }
  return null;
}

module.exports = { SCHEMA_VERSION, FIELD_TYPES, versionGte, safeRegex, sanitizeProfile, validateRecipe, validateIndex, matchRecipe };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test electron/ipc/recipes.test.js`
Expected: PASS — 9 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/recipes.js electron/ipc/recipes.test.js
git commit -m "feat(recipes): pure validate/match/version-gate logic"
```

End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 2: Bundled recipe data files (offline fallback)

**Files:**
- Create: `electron/data/recipes/index.json`
- Create: `electron/data/recipes/repo.json`
- Modify (extend test): `electron/ipc/recipes.test.js`

The bundled copy ships in the build (`package.json` build.files already includes `electron/**/*`) so a fresh install with no network still has recipes. The REPO recipe is a no-op mirror of today's bundled `game-profiles.json` REPO entry.

- [ ] **Step 1: Create the index manifest**

Create `electron/data/recipes/index.json`:

```json
{
  "schemaVersion": 1,
  "recipes": [
    {
      "id": "repo",
      "match": { "namePattern": "^R\\.?E\\.?P\\.?O\\.?$|\\bREPO\\b" },
      "file": "repo.json",
      "version": 1,
      "minUnifiaVersion": "0.1.0"
    }
  ]
}
```

- [ ] **Step 2: Create the REPO recipe**

Create `electron/data/recipes/repo.json`:

```json
{
  "schemaVersion": 1,
  "id": "repo",
  "notes": "Mirror of the bundled REPO profile; exercises the pipeline with no behavior change.",
  "profile": {
    "game": "REPO",
    "netcode": "pun2",
    "hookStrategy": "manual",
    "autoDelaySeconds": 3,
    "supportsNativeLobby": false,
    "connectionMode": "cloud-region",
    "region": "eu",
    "module": "bepinex_mono",
    "thunderstoreCommunity": "repo"
  }
}
```

- [ ] **Step 3: Add a failing test that the bundled files validate**

Append to `electron/ipc/recipes.test.js`:

```js
const fs = require('node:fs');
const path = require('node:path');

test('bundled index.json passes validateIndex', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'recipes', 'index.json'), 'utf8'));
  const entries = R.validateIndex(raw);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].id, 'repo');
  assert.strictEqual(entries[0].file, 'repo.json');
});

test('bundled repo.json passes validateRecipe and keeps its fields', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'recipes', 'repo.json'), 'utf8'));
  const out = R.validateRecipe(raw, '0.1.1');
  assert.ok(out);
  assert.strictEqual(out.profile.game, 'REPO');
  assert.strictEqual(out.profile.thunderstoreCommunity, 'repo');
  assert.strictEqual(out.profile.region, 'eu');
});
```

- [ ] **Step 4: Run to verify the new tests pass**

Run: `node --test electron/ipc/recipes.test.js`
Expected: PASS — 11 tests, 0 fail (9 from Task 1 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add electron/data/recipes/index.json electron/data/recipes/repo.json electron/ipc/recipes.test.js
git commit -m "feat(recipes): bundled REPO recipe + offline fallback data"
```

---

### Task 3: Impure fetch/cache shell (recipeStore.js)

**Files:**
- Create: `electron/ipc/recipeStore.js`

This is the network/fs shell, modeled on `thunderstore.js` (httpFetch + disk cache + serve-stale). It is NOT unit-tested (it touches network + `cacheDir()` which needs the Electron app); all testable logic already lives in `recipes.js`. Verify by build + a require smoke test.

- [ ] **Step 1: Write the implementation**

Create `electron/ipc/recipeStore.js`:

```js
const fs = require('fs');
const path = require('path');
const { httpFetch } = require('../util');
const { cacheDir, ensureDir } = require('../paths');
const { store } = require('../store');
const R = require('./recipes');

// App version drives the recipe minUnifiaVersion gate. package.json is the build
// version (electron-builder uses it), so it matches app.getVersion() and is
// requirable in plain node too.
const APP_VERSION = require('../../package.json').version;

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/imluri/Unifia/main/recipes/';
const BUNDLED_DIR = path.join(__dirname, '..', 'data', 'recipes');

// Validated, in-memory recipe list + status. Loaded lazily from disk cache, with
// the bundled folder as the fallback. refreshRecipes() updates both.
let memo = null;

function sourceBase() {
  const override = store.get('settings.recipeSource');
  if (typeof override === 'string' && /^https:\/\//i.test(override)) {
    return override.endsWith('/') ? override : override + '/';
  }
  return DEFAULT_SOURCE;
}

function cacheFile() {
  return path.join(cacheDir(), 'recipes', 'recipes.json');
}

// Read the persisted cache: { fetchedAt, source, recipes:[{id,match,profile,version}] }.
function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    const file = cacheFile();
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* non-fatal: cache write failure; next refresh retries */
  }
}

// Validate the bundled folder into the same shape as a fetched payload.
function loadBundled() {
  try {
    const index = R.validateIndex(JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, 'index.json'), 'utf8')));
    const recipes = [];
    for (const entry of index) {
      const raw = JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, entry.file), 'utf8'));
      const valid = R.validateRecipe(raw, APP_VERSION);
      if (valid) recipes.push({ ...valid, version: entry.version || 0 });
    }
    return { fetchedAt: 0, source: 'bundled', recipes };
  } catch {
    return { fetchedAt: 0, source: 'bundled', recipes: [] };
  }
}

// Resolve the active payload: in-memory memo → disk cache → bundled.
function active() {
  if (memo) return memo;
  memo = readCache() || loadBundled();
  return memo;
}

// Fetch the index + each recipe file, validate, persist. Never throws; on any
// failure the existing cache/bundled stays active. Returns a status object.
async function refreshRecipes({ force = false } = {}) {
  const base = sourceBase();
  try {
    const idxRes = await httpFetch(base + 'index.json', { headers: { 'User-Agent': 'Unifia-Launcher' } });
    if (!idxRes.ok) throw new Error(`index ${idxRes.status}`);
    const index = R.validateIndex(await idxRes.json());
    const recipes = [];
    for (const entry of index) {
      try {
        const res = await httpFetch(base + entry.file, { headers: { 'User-Agent': 'Unifia-Launcher' } });
        if (!res.ok) continue;
        const valid = R.validateRecipe(await res.json(), APP_VERSION);
        if (valid) recipes.push({ ...valid, version: entry.version || 0 });
      } catch {
        /* skip this recipe; others still load */
      }
    }
    const payload = { fetchedAt: Date.now(), source: base, recipes };
    writeCache(payload);
    memo = payload;
    return recipeStatus();
  } catch (err) {
    // Offline / TLS quirk / bad index: keep whatever is active.
    active();
    return { ...recipeStatus(), error: String(err && err.message || err) };
  }
}

// Sync: the validated profile fields for a game's matching recipe, or null.
function recipeFor(game) {
  const r = R.matchRecipe(active().recipes, game || {});
  return r ? r.profile : null;
}

// Sync: the matched recipe's id + version for a game (for UI labels), or null.
function recipeMetaFor(game) {
  const r = R.matchRecipe(active().recipes, game || {});
  return r ? { id: r.id, version: r.version || 0 } : null;
}

function recipeStatus() {
  const a = active();
  return { count: a.recipes.length, fetchedAt: a.fetchedAt, source: a.source };
}

module.exports = { refreshRecipes, recipeFor, recipeMetaFor, recipeStatus };
```

- [ ] **Step 2: Verify it loads without a syntax error**

Run: `node -e "require('./electron/ipc/recipeStore.js'); console.log('loads ok')"`
Expected: prints `loads ok`. (electron-store initializes outside Electron in this repo; if you instead see an Electron/electron-store runtime message but NO `SyntaxError`, that is acceptable. A `SyntaxError` must be fixed.)

- [ ] **Step 3: Verify the renderer build is unaffected**

Run: `npm run build`
Expected: Vite build completes (this file is main-process only; build should be unchanged and green).

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/recipeStore.js
git commit -m "feat(recipes): fetch/cache shell with serve-stale + bundled fallback"
```

---

### Task 4: Merge recipes into matchProfile

**Files:**
- Modify: `electron/ipc/profiles.js`
- Test: `electron/ipc/profiles.test.js` (create)

Add a pure `resolveProfile` (testable) for the precedence merge, and wire `matchProfile` to pull the recipe via `recipeStore.recipeFor`.

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/profiles.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveProfile } = require('./profiles');

test('resolveProfile applies precedence: base < entry < analyzer < recipe', () => {
  const out = resolveProfile({
    base: { region: 'eu', netcode: 'pun2', module: 'bepinex_mono' },
    entryProfile: { region: 'us' },
    analyzerOverride: { netcode: 'pun1' },
    recipeProfile: { region: 'asia' },
  });
  assert.strictEqual(out.region, 'asia'); // recipe beats entry
  assert.strictEqual(out.netcode, 'pun1'); // analyzer kept (recipe omitted it)
  assert.strictEqual(out.module, 'bepinex_mono'); // base kept
});

test('resolveProfile: recipe overrides analyzer on the same field', () => {
  const out = resolveProfile({
    base: {},
    entryProfile: {},
    analyzerOverride: { hookStrategy: 'auto-on-load' },
    recipeProfile: { hookStrategy: 'reconnect-on-load' },
  });
  assert.strictEqual(out.hookStrategy, 'reconnect-on-load');
});

test('resolveProfile with no recipe equals base<entry<analyzer (today behavior)', () => {
  const out = resolveProfile({
    base: { region: 'eu' },
    entryProfile: { game: 'X' },
    analyzerOverride: { netcode: 'pun2' },
    recipeProfile: {},
  });
  assert.deepStrictEqual(out, { region: 'eu', game: 'X', netcode: 'pun2' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test electron/ipc/profiles.test.js`
Expected: FAIL — `resolveProfile is not a function` (or undefined).

- [ ] **Step 3: Add `resolveProfile` and wire `matchProfile`**

In `electron/ipc/profiles.js`, add the require near the top (after `const { store } = require('../store');`):

```js
const recipeStore = require('./recipeStore');
```

Add this pure function just above `matchProfile`:

```js
// Pure precedence merge (later wins): base < entry < analyzer < recipe.
function resolveProfile({ base = {}, entryProfile = {}, analyzerOverride = {}, recipeProfile = {} }) {
  return { ...base, ...entryProfile, ...analyzerOverride, ...recipeProfile };
}
```

Replace the body of `matchProfile` with the recipe-aware version (keeps the same matching, adds the recipe layer):

```js
function matchProfile(game) {
  const reg = loadRegistry();
  const base = reg.default || {};
  const analyzerOverride = storedOverride(game);
  const recipeProfile = recipeStore.recipeFor(game) || {};

  for (const entry of reg.games || []) {
    const m = entry.match || {};
    if (m.steamAppId && game.steamAppId && String(game.steamAppId) === String(m.steamAppId)) {
      return resolveProfile({ base, entryProfile: entry.profile, analyzerOverride, recipeProfile });
    }
    if (m.namePattern && game.name) {
      const re = safeRegex(m.namePattern);
      if (re && re.test(game.name)) {
        return resolveProfile({ base, entryProfile: entry.profile, analyzerOverride, recipeProfile });
      }
    }
  }

  // No explicit entry — derive sensible defaults from the engine backend so the
  // mod at least picks the right module flavour.
  const module = game.unityBackend === 'il2cpp' ? 'bepinex_il2cpp' : 'bepinex_mono';
  return resolveProfile({ base, entryProfile: { game: game.name, module }, analyzerOverride, recipeProfile });
}
```

Update the exports line to include `resolveProfile`:

```js
module.exports = { matchProfile, resolveProfile, loadRegistry };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test electron/ipc/profiles.test.js`
Expected: PASS — 3 tests, 0 fail.

- [ ] **Step 5: Confirm no regression in the broader suite**

Run: `node --test electron/ipc/recipes.test.js electron/ipc/profileMap.test.js`
Expected: PASS (recipes 11, profileMap unchanged).

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/profiles.js electron/ipc/profiles.test.js
git commit -m "feat(recipes): merge recipes into matchProfile (recipe > analyzer)"
```

---

### Task 5: IPC, preload, store, and startup refresh

**Files:**
- Modify: `electron/main.js` (handlers in `registerIpc`; startup call in `app.whenReady`)
- Modify: `electron/preload.js`
- Modify: `src/store/useAppStore.js`

- [ ] **Step 1: Require recipeStore in main and register handlers**

In `electron/main.js`, add to the require block near the top (after `const gameScanner = require('./ipc/gameScanner');`):

```js
const recipeStore = require('./ipc/recipeStore');
```

In `registerIpc()`, after the `unifia:getDataDir` handler (the last handler, ~line 240), add:

```js
  handle('unifia:refreshRecipes', () => recipeStore.refreshRecipes({ force: true }));
  handle('unifia:getRecipeStatus', () => recipeStore.recipeStatus());
  handle('unifia:getRecipeFor', (gameId) => {
    const game = (store.get('games') || []).find((g) => g.id === gameId);
    return game ? recipeStore.recipeMetaFor(game) : null;
  });
```

- [ ] **Step 2: Fire a non-blocking refresh on startup**

In `electron/main.js`, inside `app.whenReady().then(() => { ... })`, after `updater.initUpdater(emit);`, add:

```js
  recipeStore.refreshRecipes().catch(() => { /* non-fatal: cache/bundled stays active */ });
```

- [ ] **Step 3: Expose the bridge methods in preload**

In `electron/preload.js`, after the `getDataDir` line (~line 124), add:

```js
  refreshRecipes: () => invoke('unifia:refreshRecipes'),
  getRecipeStatus: () => invoke('unifia:getRecipeStatus'),
  getRecipeFor: (gameId) => invoke('unifia:getRecipeFor', gameId),
```

- [ ] **Step 4: Add store state + actions**

In `src/store/useAppStore.js`, add `recipeStatus: null,` to the initial state object (near `toasts: [],`). Then add these actions alongside the others (e.g. after the `renameGame` action):

```js
  async refreshRecipes() {
    const status = await api.refreshRecipes();
    set({ recipeStatus: status });
    return status;
  },
  async loadRecipeStatus() {
    try {
      const status = await api.getRecipeStatus();
      set({ recipeStatus: status });
    } catch {
      /* leave null */
    }
  },
```

Note: `api` is the existing alias for `window.unifia` used throughout this store — match how other actions reference it (e.g. `api.getSettings`). If the store calls `window.unifia` directly instead of an `api` alias, use that convention instead.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 6: Smoke-test main wiring loads**

Run: `node -e "require('./electron/main.js')" 2>&1 | head -5 || true`
Expected: It will likely exit due to Electron app APIs, but there must be NO `SyntaxError` referencing your edits. (If the only output is Electron runtime noise, that's fine.)

- [ ] **Step 7: Commit**

```bash
git add electron/main.js electron/preload.js src/store/useAppStore.js
git commit -m "feat(recipes): IPC + preload + store + startup refresh"
```

---

### Task 6: Settings — Refresh recipes button + status

**Files:**
- Modify: `src/pages/Settings.jsx`

- [ ] **Step 1: Read the file to find a section pattern**

Read `src/pages/Settings.jsx` fully. Note how existing setting sections are structured (headings, cards, buttons — e.g. the SteamGridDB key block around lines 121-150) and the `useAppStore` selectors at the top (~lines 93-96). You will add a "Crossplay recipes" section following the same visual pattern.

- [ ] **Step 2: Wire the store selectors**

Near the existing `useAppStore` selectors at the top of the `Settings` component, add:

```jsx
  const recipeStatus = useAppStore((s) => s.recipeStatus);
  const refreshRecipes = useAppStore((s) => s.refreshRecipes);
  const loadRecipeStatus = useAppStore((s) => s.loadRecipeStatus);
```

Add an effect to load status on mount (place with other hooks; ensure `useEffect` is imported — it is used elsewhere in the file or import it):

```jsx
  useEffect(() => { loadRecipeStatus(); }, [loadRecipeStatus]);
```

- [ ] **Step 3: Add local busy state for the button**

With the other `useState` hooks in the component, add:

```jsx
  const [refreshingRecipes, setRefreshingRecipes] = useState(false);
```

- [ ] **Step 4: Add the section markup**

Inside the Settings page JSX, after an existing section (match the surrounding section wrapper markup you saw in Step 1 — use the same outer `className`), add a "Crossplay recipes" block. Use this content, adapting the wrapper classes to match the file's other sections:

```jsx
      <section className="mb-6 rounded-lg border border-border-subtle bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-neutral-100">Crossplay recipes</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Per-game connector configs fetched from GitHub so they can be updated without an app update.
        </p>
        <div className="flex items-center gap-3">
          <button
            disabled={refreshingRecipes}
            onClick={async () => {
              setRefreshingRecipes(true);
              try { await refreshRecipes(); } finally { setRefreshingRecipes(false); }
            }}
            className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover disabled:opacity-50"
          >
            {refreshingRecipes ? 'Refreshing…' : 'Refresh recipes'}
          </button>
          <span className="text-xs text-neutral-500">
            {recipeStatus
              ? `${recipeStatus.count} recipe${recipeStatus.count === 1 ? '' : 's'}` +
                (recipeStatus.fetchedAt ? ` · updated ${new Date(recipeStatus.fetchedAt).toLocaleString()}` : ' · bundled')
              : 'Not loaded'}
          </span>
        </div>
      </section>
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings.jsx
git commit -m "feat(ui): Crossplay recipes refresh + status in Settings"
```

---

### Task 7: GameDetail — "recipe applied" indicator

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Add state + load the recipe meta on mount**

In `src/pages/GameDetail.jsx`, with the other `useState` hooks, add:

```jsx
  const [recipeMeta, setRecipeMeta] = useState(null);
```

With the other effects, add one that loads the recipe meta for this game (uses the preload bridge directly, like other one-off calls in the file):

```jsx
  useEffect(() => {
    let active = true;
    window.unifia.getRecipeFor(game.id).then((m) => { if (active) setRecipeMeta(m); }).catch(() => {});
    return () => { active = false; };
  }, [game.id]);
```

- [ ] **Step 2: Render the indicator in the header**

In the header area (near the `<p>` "Mods from…" line that follows the `<h1>`), add a conditional indicator:

```jsx
        {recipeMeta && (
          <p className="mt-0.5 text-xs text-accent">
            Crossplay recipe: {recipeMeta.id} v{recipeMeta.version} ✓
          </p>
        )}
```

Place it so it reads as part of the header block (after the title row, alongside/under the existing "Mods from…" paragraph). Do not disturb the rename UI added previously.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(ui): show applied crossplay recipe in GameDetail"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run all new + existing unit tests**

Run: `node --test electron/ipc/*.test.js electron/ipc/modHubs/*.test.js electron/utils/*.test.js src/lib/*.test.js src/lib/*.test.mjs`
Expected: PASS — all green, including `recipes.test.js` (11) and `profiles.test.js` (3); no regressions.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 3: Main-process require smoke test**

Run: `node -e "require('./electron/ipc/recipeStore.js'); require('./electron/ipc/profiles.js'); console.log('main modules load')"`
Expected: prints `main modules load` (no SyntaxError).

- [ ] **Step 4: Manual smoke test (document results, do not automate)**

`npm run dev`, then:
- Settings shows "Crossplay recipes" with a count (≥1) and "bundled" or a timestamp; click **Refresh recipes** — count/timestamp updates (or stays, with no crash, if offline/TLS-blocked).
- Open the REPO game → header shows "Crossplay recipe: repo v1 ✓".
- Set `settings.recipeSource` (via the store/config) to a test branch raw URL, edit that branch's `recipes/repo.json` (`region: "us"`), Refresh, relaunch REPO → `BepInEx/config/unifia_profile.json` shows `region` = `us` (confirms remote override reaches the connector).

- [ ] **Step 5: No commit unless the manual test surfaced a fix**

If a manual issue appears, return to the relevant task; otherwise this task completes with no commit.
