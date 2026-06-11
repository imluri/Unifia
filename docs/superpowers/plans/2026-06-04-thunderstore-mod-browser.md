# Thunderstore Mod Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an r2modman-style, Thunderstore-backed per-game mod browser/installer to Unifia, with dependency resolution, enable/disable, update detection, and version picking; mods are staged in `unifia_data` and deployed into the game on launch.

**Architecture:** Main-process modules fetch/cache the Thunderstore community package list and own install/staging/deploy. Pure functions (dependency resolver, deploy-target classifier, cache freshness) are unit-tested with fixtures. The renderer adds a full-screen GameDetail view (Installed | Browse tabs) driven by new IPC.

**Tech Stack:** Electron (CommonJS main), React + Vite + Tailwind (renderer), zustand, electron-store, extract-zip, Node `node:test`.

---

## File Structure

**Create:**
- `electron/ipc/thunderstore.js` — fetch + disk-cache community package list; pure parse/freshness helpers.
- `electron/ipc/thunderstore.test.js` — unit tests for parse + cache freshness.
- `electron/ipc/modResolver.js` — pure dependency resolver + deploy-target classifier.
- `electron/ipc/modResolver.test.js` — unit tests for resolver + classifier.
- `electron/ipc/modManager.js` — install/uninstall/enable/deploy/update-check (I/O).
- `src/pages/GameDetail.jsx` — full-screen per-game view with tabs.
- `src/components/ModBrowseCard.jsx` — browse-list mod card.
- `src/components/InstalledModRow.jsx` — installed-list row.

**Modify:**
- `electron/store.js` — add `gameMods` default.
- `electron/paths.js` — add `modsDir`, `cacheDir` helpers.
- `electron/data/game-profiles.json` — add `thunderstoreCommunity` to default + REPO.
- `electron/ipc/launcher.js` — deploy enabled mods on launch.
- `electron/main.js` — register mod IPC handlers.
- `electron/preload.js` — expose mod methods.
- `src/store/useAppStore.js` — `mods` slice + actions.
- `src/App.jsx` — route to GameDetail when a game is selected.
- `src/pages/Home.jsx` — open GameDetail on card click.

---

## Phase 1 — Thunderstore client + cache

### Task 1: Thunderstore package list with disk cache

**Files:**
- Create: `electron/ipc/thunderstore.js`
- Create: `electron/ipc/thunderstore.test.js`
- Modify: `electron/paths.js`

- [ ] **Step 1: Add path helpers**

In `electron/paths.js`, add these functions and export them alongside the existing exports:

```js
function modsDir(gameId) {
  return gameId ? subdir('mods', gameId) : subdir('mods');
}

function cacheDir() {
  return subdir('cache');
}
```

Add `modsDir` and `cacheDir` to the `module.exports` object.

- [ ] **Step 2: Write failing tests for pure helpers**

Create `electron/ipc/thunderstore.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parsePackages, isCacheFresh } = require('./thunderstore');

test('parsePackages maps the fields the UI needs', () => {
  const raw = [
    {
      name: 'CoolMod',
      full_name: 'Owner-CoolMod',
      owner: 'Owner',
      package_url: 'https://thunderstore.io/c/repo/p/Owner/CoolMod/',
      is_deprecated: false,
      rating_score: 42,
      categories: ['Mods', 'Tweaks'],
      versions: [
        {
          version_number: '1.2.0',
          dependencies: ['BepInEx-BepInExPack-5.4.2100'],
          download_url: 'https://cdn/Owner-CoolMod-1.2.0.zip',
          icon: 'https://gcdn.thunderstore.io/x.png',
          description: 'Does cool things',
          file_size: 1234,
          date_created: '2025-01-01T00:00:00Z',
        },
        { version_number: '1.1.0', dependencies: [], download_url: 'u', icon: 'i', description: 'old', file_size: 1, date_created: '2024-01-01T00:00:00Z' },
      ],
    },
  ];
  const parsed = parsePackages(raw);
  assert.strictEqual(parsed.length, 1);
  const m = parsed[0];
  assert.strictEqual(m.fullName, 'Owner-CoolMod');
  assert.strictEqual(m.owner, 'Owner');
  assert.strictEqual(m.icon, 'https://gcdn.thunderstore.io/x.png');
  assert.strictEqual(m.latest.version_number, '1.2.0');
  assert.strictEqual(m.totalDownloads, 0); // none in fixture
  assert.deepStrictEqual(m.categories, ['Mods', 'Tweaks']);
  assert.strictEqual(m.versions.length, 2);
});

test('isCacheFresh respects the TTL', () => {
  const now = Date.now();
  assert.strictEqual(isCacheFresh({ fetchedAt: now - 1000 }, 60000), true);
  assert.strictEqual(isCacheFresh({ fetchedAt: now - 120000 }, 60000), false);
  assert.strictEqual(isCacheFresh(null, 60000), false);
  assert.strictEqual(isCacheFresh({}, 60000), false);
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `node --test electron/ipc/thunderstore.test.js`
Expected: FAIL — `Cannot find module './thunderstore'`.

- [ ] **Step 4: Implement thunderstore.js**

Create `electron/ipc/thunderstore.js`:

```js
const fs = require('fs');
const path = require('path');
const { httpFetch } = require('../util');
const { cacheDir, ensureDir } = require('../paths');

const TTL_MS = 30 * 60 * 1000; // 30 minutes

// Normalize a raw Thunderstore /api/v1/package/ array into the shape the UI uses.
function parsePackages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const versions = p.versions || [];
    const totalDownloads = versions.reduce((sum, v) => sum + (v.downloads || 0), 0);
    return {
      name: p.name,
      fullName: p.full_name,
      owner: p.owner,
      packageUrl: p.package_url,
      deprecated: !!p.is_deprecated,
      rating: p.rating_score || 0,
      categories: p.categories || [],
      totalDownloads,
      icon: versions[0] ? versions[0].icon : null,
      latest: versions[0] || null,
      versions,
    };
  });
}

function isCacheFresh(entry, ttl = TTL_MS) {
  return !!(entry && entry.fetchedAt && Date.now() - entry.fetchedAt <= ttl);
}

function cacheFile(community) {
  return path.join(cacheDir(), 'thunderstore', `${community}.json`);
}

function readCache(community) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(community), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(community, packages) {
  const file = cacheFile(community);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), packages }), 'utf8');
}

// Fetch a community's package list, using the disk cache unless stale/refresh.
async function fetchModList(community, { refresh = false } = {}) {
  if (!community) return [];
  const cached = readCache(community);
  if (!refresh && isCacheFresh(cached)) return cached.packages;

  const url = `https://thunderstore.io/c/${community}/api/v1/package/`;
  const res = await httpFetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Unifia-Launcher' },
  });
  if (!res.ok) {
    if (cached) return cached.packages; // serve stale on failure
    throw new Error(`Thunderstore ${res.status}: ${res.statusText}`);
  }
  const parsed = parsePackages(await res.json());
  writeCache(community, parsed);
  return parsed;
}

module.exports = { parsePackages, isCacheFresh, fetchModList, cacheFile };
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `node --test electron/ipc/thunderstore.test.js`
Expected: PASS (2 tests). Also run `node --check electron/ipc/thunderstore.js` → no output.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/thunderstore.js electron/ipc/thunderstore.test.js electron/paths.js
git commit -m "feat(mods): Thunderstore package list client with disk cache"
```

---

## Phase 2 — Pure mod logic (resolver + classifier)

### Task 2: Dependency resolver + deploy-target classifier

**Files:**
- Create: `electron/ipc/modResolver.js`
- Create: `electron/ipc/modResolver.test.js`

- [ ] **Step 1: Write failing tests**

Create `electron/ipc/modResolver.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseDependency, resolveInstallSet, deployTarget } = require('./modResolver');

const PKGS = [
  { fullName: 'BepInEx-BepInExPack', versions: [{ version_number: '5.4.2100', dependencies: [] }] },
  { fullName: 'Owner-Lib', versions: [{ version_number: '1.0.0', dependencies: ['BepInEx-BepInExPack-5.4.2100'] }] },
  {
    fullName: 'Owner-CoolMod',
    versions: [
      { version_number: '1.2.0', dependencies: ['BepInEx-BepInExPack-5.4.2100', 'Owner-Lib-1.0.0'] },
    ],
  },
];

test('parseDependency splits full_name and version', () => {
  assert.deepStrictEqual(parseDependency('BepInEx-BepInExPack-5.4.2100'), {
    fullName: 'BepInEx-BepInExPack',
    version: '5.4.2100',
  });
  assert.deepStrictEqual(parseDependency('Owner-Cool-Mod-1.2.0'), {
    fullName: 'Owner-Cool-Mod',
    version: '1.2.0',
  });
});

test('resolveInstallSet returns target + all deps, deduped, deepest first', () => {
  const set = resolveInstallSet(PKGS, 'Owner-CoolMod', '1.2.0', {});
  const names = set.map((s) => s.fullName);
  assert.ok(names.includes('Owner-CoolMod'));
  assert.ok(names.includes('Owner-Lib'));
  assert.ok(names.includes('BepInEx-BepInExPack'));
  // dependencies appear before the dependents that need them
  assert.ok(names.indexOf('BepInEx-BepInExPack') < names.indexOf('Owner-CoolMod'));
  // BepInExPack appears once despite two dependents needing it
  assert.strictEqual(names.filter((n) => n === 'BepInEx-BepInExPack').length, 1);
});

test('resolveInstallSet skips already-installed same version', () => {
  const installed = { 'BepInEx-BepInExPack': { version: '5.4.2100' } };
  const set = resolveInstallSet(PKGS, 'Owner-CoolMod', '1.2.0', installed);
  assert.ok(!set.some((s) => s.fullName === 'BepInEx-BepInExPack'));
});

test('resolveInstallSet tolerates missing dependency', () => {
  const pkgs = [{ fullName: 'A-Mod', versions: [{ version_number: '1.0.0', dependencies: ['Ghost-Gone-9.9.9'] }] }];
  const set = resolveInstallSet(pkgs, 'A-Mod', '1.0.0', {});
  assert.deepStrictEqual(set.map((s) => s.fullName), ['A-Mod']);
});

test('deployTarget routes BepInExPack to root, others to plugins', () => {
  assert.strictEqual(deployTarget('BepInEx-BepInExPack'), 'root');
  assert.strictEqual(deployTarget('denikson-BepInExPack_Valheim'), 'root');
  assert.strictEqual(deployTarget('Owner-CoolMod'), 'plugins');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test electron/ipc/modResolver.test.js`
Expected: FAIL — `Cannot find module './modResolver'`.

- [ ] **Step 3: Implement modResolver.js**

Create `electron/ipc/modResolver.js`:

```js
// Pure mod logic — no I/O — so it is exhaustively unit-testable.

// Split "Owner-Mod-1.2.3" into { fullName: "Owner-Mod", version: "1.2.3" }.
// The version is the trailing dotted-number segment; everything before is the name.
function parseDependency(dep) {
  const m = /^(.*)-(\d+\.\d+\.\d+(?:\.\d+)?)$/.exec(dep);
  if (!m) return { fullName: dep, version: null };
  return { fullName: m[1], version: m[2] };
}

function findVersion(pkg, version) {
  if (!pkg) return null;
  const versions = pkg.versions || [];
  return versions.find((v) => v.version_number === version) || versions[0] || null;
}

// Build the flat install set for a target mod: the mod plus every dependency,
// de-duped, with dependencies ordered before the dependents that need them.
// `installed` maps fullName -> { version }; same-version entries are skipped.
function resolveInstallSet(packages, fullName, version, installed = {}) {
  const byName = new Map(packages.map((p) => [p.fullName, p]));
  const result = [];
  const seen = new Set();

  function visit(name, ver) {
    if (seen.has(name)) return;
    seen.add(name);

    const pkg = byName.get(name);
    if (!pkg) return; // missing/removed dependency — tolerate
    const v = findVersion(pkg, ver);
    if (!v) return;

    // Visit dependencies first so they land earlier in the result.
    for (const dep of v.dependencies || []) {
      const { fullName: depName, version: depVer } = parseDependency(dep);
      visit(depName, depVer);
    }

    const already = installed[name];
    if (already && already.version === v.version_number) return; // already satisfied
    result.push({ fullName: name, version: v.version_number, versionData: v });
  }

  visit(fullName, version);
  return result;
}

// Where a mod's files deploy: BepInExPack variants are the loader (game root);
// everything else is a plugin.
function deployTarget(fullName) {
  return /bepinexpack/i.test(fullName) ? 'root' : 'plugins';
}

module.exports = { parseDependency, resolveInstallSet, findVersion, deployTarget };
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test electron/ipc/modResolver.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/modResolver.js electron/ipc/modResolver.test.js
git commit -m "feat(mods): pure dependency resolver and deploy-target classifier"
```

---

## Phase 3 — modManager (install / uninstall / enable / update)

### Task 3: store + modManager core

**Files:**
- Modify: `electron/store.js`
- Create: `electron/ipc/modManager.js`

- [ ] **Step 1: Add gameMods default to store**

In `electron/store.js`, inside `defaults`, after `artCache: {},` add:

```js
    // gameMods[gameId][fullName] = { version, enabled, isDependency, deployedFiles }
    gameMods: {},
```

- [ ] **Step 2: Implement modManager.js**

Create `electron/ipc/modManager.js`:

```js
const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { store } = require('../store');
const { httpFetch } = require('../util');
const { modsDir, downloadsDir, ensureDir } = require('../paths');
const thunderstore = require('./thunderstore');
const profiles = require('./profiles');
const { resolveInstallSet, deployTarget } = require('./modResolver');

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function communityFor(game) {
  const profile = profiles.matchProfile(game);
  return profile.thunderstoreCommunity || null;
}

function modsState(gameId) {
  const all = store.get('gameMods') || {};
  return all[gameId] || {};
}

function saveModsState(gameId, state) {
  const all = store.get('gameMods') || {};
  all[gameId] = state;
  store.set('gameMods', all);
}

// List recorded mods for a game (installed state, for the Installed tab).
function getInstalledMods(gameId) {
  const state = modsState(gameId);
  return Object.entries(state).map(([fullName, m]) => ({ fullName, ...m }));
}

// Fetch + return the community package list (cached).
async function fetchModList(gameId, opts) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) return { community: null, packages: [] };
  const packages = await thunderstore.fetchModList(community, opts || {});
  return { community, packages };
}

// Download one version zip to a temp file, extract into its staging folder, and
// return the list of top-level relative file paths placed in staging.
async function stageVersion(gameId, fullName, versionData, onProgress) {
  const target = path.join(modsDir(gameId), fullName);
  fs.rmSync(target, { recursive: true, force: true });
  ensureDir(target);

  ensureDir(downloadsDir());
  const zipPath = path.join(downloadsDir(), `${fullName}-${versionData.version_number}.zip`);
  const res = await httpFetch(versionData.download_url, {
    headers: { 'User-Agent': 'Unifia-Launcher' },
  });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}`);

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

// Install a mod + its dependencies into staging, recording state. Returns the
// install set actually staged.
async function installMod(gameId, fullName, version, onProgress) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) throw new Error('This game has no Thunderstore mod source.');

  const packages = await thunderstore.fetchModList(community, {});
  const installed = modsState(gameId);
  const set = resolveInstallSet(packages, fullName, version || undefined, installed);
  if (set.length === 0) return { gameId, installed: [] };

  const state = { ...installed };
  for (const item of set) {
    await stageVersion(gameId, item.fullName, item.versionData, (p) =>
      onProgress && onProgress({ fullName: item.fullName, ...p })
    );
    state[item.fullName] = {
      version: item.version,
      enabled: true,
      isDependency: item.fullName !== fullName && !(installed[item.fullName] && !installed[item.fullName].isDependency),
      deployedFiles: [],
    };
  }
  saveModsState(gameId, state);
  return { gameId, installed: set.map((s) => ({ fullName: s.fullName, version: s.version })) };
}

// Remove a mod from staging + state (does not touch the live game folder; the
// next deploy reconciles it).
function uninstallMod(gameId, fullName) {
  const state = modsState(gameId);
  if (!state[fullName]) return { gameId, fullName, removed: false };
  fs.rmSync(path.join(modsDir(gameId), fullName), { recursive: true, force: true });
  delete state[fullName];
  saveModsState(gameId, state);
  return { gameId, fullName, removed: true };
}

function setModEnabled(gameId, fullName, enabled) {
  const state = modsState(gameId);
  if (!state[fullName]) throw new Error(`Mod not installed: ${fullName}`);
  state[fullName].enabled = !!enabled;
  saveModsState(gameId, state);
  return { gameId, fullName, enabled: !!enabled };
}

// Compare installed versions against latest on Thunderstore; return updatable list.
async function checkModUpdates(gameId) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) return [];
  const packages = await thunderstore.fetchModList(community, {});
  const byName = new Map(packages.map((p) => [p.fullName, p]));
  const updates = [];
  for (const [fullName, m] of Object.entries(modsState(gameId))) {
    const pkg = byName.get(fullName);
    const latest = pkg && pkg.latest ? pkg.latest.version_number : null;
    if (latest && latest !== m.version) updates.push({ fullName, current: m.version, latest });
  }
  return updates;
}

module.exports = {
  fetchModList,
  getInstalledMods,
  installMod,
  uninstallMod,
  setModEnabled,
  checkModUpdates,
  communityFor,
  modsState,
  saveModsState,
};
```

- [ ] **Step 3: Syntax check**

Run: `node --check electron/ipc/modManager.js`
Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add electron/store.js electron/ipc/modManager.js
git commit -m "feat(mods): modManager install/uninstall/enable/update with staging"
```

---

## Phase 4 — Deploy-on-launch

### Task 4: deploy enabled mods into the game on launch

**Files:**
- Create deploy function in: `electron/ipc/modManager.js`
- Modify: `electron/ipc/launcher.js`

- [ ] **Step 1: Add deployMods to modManager.js**

Append to `electron/ipc/modManager.js` before `module.exports`, and add `deployMods` to the exports:

```js
function copyDirInto(src, dest, recordRel, baseDest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirInto(s, d, recordRel, baseDest);
    else {
      fs.copyFileSync(s, d);
      recordRel.push(path.relative(baseDest, d));
    }
  }
}

// Reconcile the game folder against staged mod state: remove previously-deployed
// files, then copy enabled mods in (BepInExPack → root, others → plugins).
// Additive and file-tracked, so it never touches files it didn't place (e.g.
// Unifia.Pun.dll installed by pluginManager).
function deployMods(gameId, installPath) {
  const state = modsState(gameId);
  let changed = false;

  for (const [fullName, m] of Object.entries(state)) {
    // Remove whatever this mod previously deployed.
    for (const rel of m.deployedFiles || []) {
      try { fs.rmSync(path.join(installPath, rel), { force: true }); } catch { /* gone */ }
    }
    m.deployedFiles = [];

    if (!m.enabled) { changed = true; continue; }

    const staging = path.join(modsDir(gameId), fullName);
    if (!fs.existsSync(staging)) { changed = true; continue; }

    const recordRel = [];
    if (deployTarget(fullName) === 'root') {
      // BepInExPack zips wrap their payload in a BepInExPack* folder; deploy its
      // contents to the game root, else deploy the staging root itself.
      const inner = fs.readdirSync(staging, { withFileTypes: true })
        .find((e) => e.isDirectory() && /bepinexpack/i.test(e.name));
      const from = inner ? path.join(staging, inner.name) : staging;
      copyDirInto(from, installPath, recordRel, installPath);
    } else {
      const dest = path.join(installPath, 'BepInEx', 'plugins', fullName);
      copyDirInto(staging, dest, recordRel, installPath);
    }
    m.deployedFiles = recordRel;
    changed = true;
  }

  if (changed) saveModsState(gameId, state);
  return { gameId, deployed: Object.values(state).filter((m) => m.enabled).length };
}
```

- [ ] **Step 2: Call deployMods from the launcher**

In `electron/ipc/launcher.js`, add the require near the top (after the `profiles` require):

```js
const modManager = require('./modManager');
```

Then in `launchGame`, immediately after the existing `const deployed = deployModule(game);` line, add:

```js
  // Deploy enabled Thunderstore mods into the game (staging → game folder).
  try {
    modManager.deployMods(game.id, game.installPath);
  } catch {
    /* a bad mod shouldn't block launch */
  }
```

- [ ] **Step 3: Syntax check**

Run: `node --check electron/ipc/modManager.js` and `node --check electron/ipc/launcher.js`
Expected: no output for both.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/modManager.js electron/ipc/launcher.js
git commit -m "feat(mods): deploy enabled mods into game on launch"
```

---

## Phase 5 — Registry, IPC, preload

### Task 5: community mapping + IPC wiring

**Files:**
- Modify: `electron/data/game-profiles.json`
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Add thunderstoreCommunity to the registry**

In `electron/data/game-profiles.json`, add `"thunderstoreCommunity": ""` to the `default` object, and add `"thunderstoreCommunity": "repo"` to the REPO entry's `profile` object.

- [ ] **Step 2: Register IPC handlers**

In `electron/main.js`, add the require near the other ipc requires:

```js
const modManager = require('./ipc/modManager');
```

Then inside `registerIpc()`, after the `unifia:getNetProfile` handler, add:

```js
  // --- Thunderstore mods ---
  handle('unifia:fetchModList', (gameId, opts) => modManager.fetchModList(gameId, opts || {}));
  handle('unifia:getInstalledMods', (gameId) => modManager.getInstalledMods(gameId));
  handle('unifia:installMod', (gameId, fullName, version) =>
    modManager.installMod(gameId, fullName, version, (p) => emit('download-progress', { mod: true, ...p }))
  );
  handle('unifia:uninstallMod', (gameId, fullName) => modManager.uninstallMod(gameId, fullName));
  handle('unifia:setModEnabled', (gameId, fullName, enabled) =>
    modManager.setModEnabled(gameId, fullName, enabled)
  );
  handle('unifia:checkModUpdates', (gameId) => modManager.checkModUpdates(gameId));
```

- [ ] **Step 3: Expose in preload**

In `electron/preload.js`, after the `getNetProfile` line in the bridge object, add:

```js
  // Thunderstore mods
  fetchModList: (gameId, opts) => invoke('unifia:fetchModList', gameId, opts),
  getInstalledMods: (gameId) => invoke('unifia:getInstalledMods', gameId),
  installMod: (gameId, fullName, version) => invoke('unifia:installMod', gameId, fullName, version),
  uninstallMod: (gameId, fullName) => invoke('unifia:uninstallMod', gameId, fullName),
  setModEnabled: (gameId, fullName, enabled) => invoke('unifia:setModEnabled', gameId, fullName, enabled),
  checkModUpdates: (gameId) => invoke('unifia:checkModUpdates', gameId),
```

- [ ] **Step 4: Syntax check**

Run: `node --check electron/main.js` and `node --check electron/preload.js`
Expected: no output for both.

- [ ] **Step 5: Commit**

```bash
git add electron/data/game-profiles.json electron/main.js electron/preload.js
git commit -m "feat(mods): community mapping + mod IPC wiring"
```

---

## Phase 6 — Renderer store slice

### Task 6: mods slice in useAppStore

**Files:**
- Modify: `src/store/useAppStore.js`

- [ ] **Step 1: Add mod state + actions**

In `src/store/useAppStore.js`, add to the initial state object (near `art: {}`):

```js
  // Mods (per open game detail view)
  modList: [], // browse list for the active community
  modCommunity: null,
  installedMods: [], // [{ fullName, version, enabled, isDependency }]
  modUpdates: [], // [{ fullName, current, latest }]
  modsLoading: false,
  modProgress: {}, // fullName -> { percent }
```

Add these actions inside the store (near `fetchArt`):

```js
  async loadMods(gameId, { refresh = false } = {}) {
    set({ modsLoading: true });
    try {
      const [{ community, packages }, installed] = await Promise.all([
        api.fetchModList(gameId, { refresh }),
        api.getInstalledMods(gameId),
      ]);
      set({ modList: packages, modCommunity: community, installedMods: installed });
      api.checkModUpdates(gameId).then((u) => set({ modUpdates: u })).catch(() => {});
    } finally {
      set({ modsLoading: false });
    }
  },
  async installMod(gameId, fullName, version) {
    await api.installMod(gameId, fullName, version);
    set({ installedMods: await api.getInstalledMods(gameId) });
  },
  async uninstallMod(gameId, fullName) {
    await api.uninstallMod(gameId, fullName);
    set({ installedMods: await api.getInstalledMods(gameId) });
  },
  async setModEnabled(gameId, fullName, enabled) {
    await api.setModEnabled(gameId, fullName, enabled);
    set({ installedMods: await api.getInstalledMods(gameId) });
  },
```

In the existing `wireEvents()` `onDownloadProgress` handler, after the existing module-progress logic, add (it already receives `{mod:true,...}` for mods):

```js
      if (p.mod && p.fullName) {
        set((s) => ({ modProgress: { ...s.modProgress, [p.fullName]: p } }));
      }
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/store/useAppStore.js
git commit -m "feat(mods): renderer store slice for mod browsing"
```

---

## Phase 7 — Mod components (leaf, built before the view that imports them)

### Task 7a: ModBrowseCard with install + version picker

**Files:**
- Create: `src/components/ModBrowseCard.jsx`

- [ ] **Step 1: Implement ModBrowseCard.jsx**

Create `src/components/ModBrowseCard.jsx`:

```jsx
import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore.js';

function fmtCount(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n || 0);
}

export default function ModBrowseCard({ game, mod }) {
  const installMod = useAppStore((s) => s.installMod);
  const installed = useAppStore((s) => s.installedMods.find((m) => m.fullName === mod.fullName));
  const progress = useAppStore((s) => s.modProgress[mod.fullName]);

  const [version, setVersion] = useState(mod.latest ? mod.latest.version_number : '');
  const [busy, setBusy] = useState(false);
  const [iconOk, setIconOk] = useState(true);

  async function doInstall() {
    setBusy(true);
    try {
      await installMod(game.id, mod.fullName, version);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-3 rounded bg-card p-3 ring-1 ring-border-subtle">
      {iconOk && mod.icon ? (
        <img src={mod.icon} alt="" onError={() => setIconOk(false)} className="h-14 w-14 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded bg-neutral-700" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-neutral-100">{mod.name}</span>
          {mod.deprecated && (
            <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">deprecated</span>
          )}
        </div>
        <div className="text-xs text-neutral-500">
          by {mod.owner} · ▲ {mod.rating} · {fmtCount(mod.totalDownloads)} downloads
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-neutral-400">
          {mod.latest ? mod.latest.description : ''}
        </p>

        <div className="mt-2 flex items-center gap-2">
          <select
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="rounded bg-neutral-800 px-2 py-1 text-xs"
          >
            {mod.versions.map((v) => (
              <option key={v.version_number} value={v.version_number}>
                {v.version_number}
              </option>
            ))}
          </select>
          <button
            onClick={doInstall}
            disabled={busy}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
          >
            {installed ? 'Reinstall' : busy ? 'Installing…' : 'Install'}
          </button>
          {progress && busy && <span className="text-[11px] text-neutral-500">{progress.percent}%</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: `✓ built` (the component isn't imported yet, so Vite simply doesn't bundle it; build stays green).

- [ ] **Step 3: Commit**

```bash
git add src/components/ModBrowseCard.jsx
git commit -m "feat(mods): ModBrowseCard with version picker + install"
```

### Task 7b: InstalledModRow

**Files:**
- Create: `src/components/InstalledModRow.jsx`

- [ ] **Step 1: Implement InstalledModRow.jsx**

Create `src/components/InstalledModRow.jsx`:

```jsx
import React from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function InstalledModRow({ game, mod }) {
  const setModEnabled = useAppStore((s) => s.setModEnabled);
  const uninstallMod = useAppStore((s) => s.uninstallMod);
  const installMod = useAppStore((s) => s.installMod);
  const update = useAppStore((s) => s.modUpdates.find((u) => u.fullName === mod.fullName));

  return (
    <div className="flex items-center gap-3 rounded bg-card px-3 py-2 ring-1 ring-border-subtle">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={mod.enabled}
          onChange={(e) => setModEnabled(game.id, mod.fullName, e.target.checked)}
        />
      </label>
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm text-neutral-100">{mod.fullName}</span>
        <span className="ml-2 text-xs text-neutral-500">v{mod.version}</span>
        {mod.isDependency && <span className="ml-2 text-[10px] text-neutral-600">(dependency)</span>}
      </div>
      {update && (
        <button
          onClick={() => installMod(game.id, mod.fullName, update.latest)}
          className="rounded bg-green-900/60 px-2 py-1 text-xs text-green-300 hover:bg-green-900/80"
        >
          Update → {update.latest}
        </button>
      )}
      <button
        onClick={() => uninstallMod(game.id, mod.fullName)}
        title="Uninstall"
        className="flex items-center rounded bg-neutral-800 px-2 py-1 text-neutral-400 hover:bg-red-900/60 hover:text-red-300"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/InstalledModRow.jsx
git commit -m "feat(mods): InstalledModRow with toggle, update, uninstall"
```

---

## Phase 8 — GameDetail view + routing

### Task 8: GameDetail shell + navigation

**Files:**
- Create: `src/pages/GameDetail.jsx`
- Modify: `src/App.jsx`
- Modify: `src/pages/Home.jsx`
- Modify: `src/components/GameCard.jsx`

- [ ] **Step 1: Create GameDetail.jsx shell**

Create `src/pages/GameDetail.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ModBrowseCard from '../components/ModBrowseCard.jsx';
import InstalledModRow from '../components/InstalledModRow.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function GameDetail({ game, onBack }) {
  const loadMods = useAppStore((s) => s.loadMods);
  const modsLoading = useAppStore((s) => s.modsLoading);
  const modCommunity = useAppStore((s) => s.modCommunity);
  const modList = useAppStore((s) => s.modList);
  const installedMods = useAppStore((s) => s.installedMods);

  const [tab, setTab] = useState('installed');

  useEffect(() => {
    if (game) loadMods(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  if (!game) return null;

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <Icon name="x" size={14} /> Back to library
      </button>

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-100">{game.name}</h1>
        <p className="text-sm text-neutral-500">
          {modCommunity ? `Thunderstore: ${modCommunity}` : 'No mod source for this game'}
        </p>
      </div>

      {!modCommunity ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          This game isn&apos;t mapped to a Thunderstore community, so there are no mods to browse.
        </div>
      ) : (
        <>
          <div className="mb-5 inline-flex rounded-lg bg-neutral-800 p-1">
            {['installed', 'browse'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-4 py-1.5 text-sm font-medium capitalize transition ${
                  tab === t ? 'bg-accent text-accent-contrast' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {modsLoading && <p className="text-sm text-neutral-500">Loading mods…</p>}

          {tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              {installedMods.length === 0 ? (
                <p className="text-sm text-neutral-500">No mods installed yet. Switch to Browse.</p>
              ) : (
                installedMods.map((m) => <InstalledModRow key={m.fullName} game={game} mod={m} />)
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {modList.map((m) => (
                <ModBrowseCard key={m.fullName} game={game} mod={m} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add routing in App.jsx**

In `src/App.jsx`, import GameDetail at the top:

```jsx
import GameDetail from './pages/GameDetail.jsx';
```

In `MainLayout`, add state and a handler near the existing `const [page, setPage] = useState('home');`:

```jsx
  const [detailGame, setDetailGame] = useState(null);
```

In `renderPage()`, add a branch at the very top of the function body (before the switch):

```jsx
    if (detailGame) {
      return <GameDetail game={detailGame} onBack={() => setDetailGame(null)} />;
    }
```

Change the Home render line in the switch to pass the opener:

```jsx
        return <Home goToModules={() => setPage('modules')} onOpenGame={setDetailGame} />;
```

Also clear the detail view when a nav item is clicked: in the sidebar `onClick={() => setPage(item.id)}`, change to:

```jsx
                    onClick={() => { setDetailGame(null); setPage(item.id); }}
```

- [ ] **Step 3: Open GameDetail from Home cards**

In `src/pages/Home.jsx`, accept the new prop: change `export default function Home({ goToModules }) {` to:

```jsx
export default function Home({ goToModules, onOpenGame }) {
```

On the `GameCard`, add an `onOpen` prop in the map (alongside the existing props):

```jsx
              onOpen={() => onOpenGame(game)}
```

In `src/components/GameCard.jsx`, add `onOpen` to the destructured props (e.g. `export default function GameCard({ game, profile, onLaunch, onRemove, onConfigure, onOpen, index = 0, view = 'list' }) {`). Then turn the game-name heading into a button in **both** layouts.

List view — replace:

```jsx
            <h3 className="truncate text-sm font-semibold text-neutral-100" title={game.name}>
              {game.name}
            </h3>
```

with:

```jsx
            <button onClick={onOpen} className="truncate text-left text-sm font-semibold text-neutral-100 hover:text-accent" title={game.name}>
              {game.name}
            </button>
```

Grid view — replace:

```jsx
            <h3 className="truncate text-base font-semibold text-neutral-100" title={game.name}>
              {game.name}
            </h3>
```

with:

```jsx
            <button onClick={onOpen} className="truncate text-left text-base font-semibold text-neutral-100 hover:text-accent" title={game.name}>
              {game.name}
            </button>
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: `✓ built` (ModBrowseCard and InstalledModRow already exist from Phase 7).

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameDetail.jsx src/App.jsx src/pages/Home.jsx src/components/GameCard.jsx
git commit -m "feat(mods): GameDetail view + open-from-library routing"
```

---

## Phase 9 — Browse search, sort & category filter

### Task 9: Browse filtering + finalize

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Add search + sort + category filter to the Browse tab**

In `src/pages/GameDetail.jsx`, add state near the existing `useState('installed')`:

```jsx
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('downloads');
  const [category, setCategory] = useState('');
```

Add a derived list and category set just before the `return`:

```jsx
  const categories = Array.from(new Set(modList.flatMap((m) => m.categories))).sort();
  const browse = modList
    .filter((m) => !query || `${m.name} ${m.owner} ${m.latest?.description || ''}`.toLowerCase().includes(query.toLowerCase()))
    .filter((m) => !category || m.categories.includes(category))
    .sort((a, b) =>
      sort === 'rating' ? b.rating - a.rating
      : sort === 'name' ? a.name.localeCompare(b.name)
      : b.totalDownloads - a.totalDownloads
    );
```

Replace the `tab === 'browse'` grid (`modList.map(...)`) block with a search bar + the filtered grid:

```jsx
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search mods…"
                  className="flex-1 rounded bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="downloads">Most downloaded</option>
                  <option value="rating">Top rated</option>
                  <option value="name">Name</option>
                </select>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {browse.map((m) => (
                  <ModBrowseCard key={m.fullName} game={game} mod={m} />
                ))}
              </div>
            </div>
```

- [ ] **Step 2: Add line-clamp utility (Tailwind)**

`line-clamp-2` is built into Tailwind 3.3+. Confirm the build picks it up (no config change needed). If the description doesn't clamp, it is cosmetic only — do not block on it.

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: `✓ built` (the full feature now compiles).

- [ ] **Step 4: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(mods): browse search/sort/category filter"
```

---

## Final verification

- [ ] **Run all unit tests**

Run: `node --test electron/ipc/thunderstore.test.js electron/ipc/modResolver.test.js`
Expected: all PASS (7 tests across the two files).

- [ ] **Full build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Manual smoke (in `npm run dev`)**
  - Open REPO → GameDetail shows "Thunderstore: repo".
  - Browse tab lists mods with icons; search/sort/category work.
  - Install a mod → its dependencies install too; Installed tab shows them (deps flagged).
  - Toggle disable, Launch, confirm the disabled mod's files are absent from `BepInEx/plugins`; enable + Launch, confirm present.
  - If an update exists, the Update badge installs the latest.

---

## Notes for the implementer

- The app uses CommonJS in `electron/` and ESM/JSX in `src/`. Match the file you're editing.
- IPC handlers are wrapped by the existing `handle()` helper returning `{ok,data}`; the preload `invoke()` unwraps it. Don't add your own try/catch envelope.
- TLS quirk on this machine: if a download fails cert validation, that's environmental — see the project memory; not a code bug.
- Deploy is **additive and file-tracked** — never wipe `BepInEx/plugins` wholesale (it would delete `Unifia.Pun.dll`).
