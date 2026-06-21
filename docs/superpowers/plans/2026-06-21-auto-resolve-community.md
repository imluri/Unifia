# Auto-resolve Thunderstore Community Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mods load for any Thunderstore game (not just REPO) by auto-resolving a game's community from its name, with a manual picker fallback.

**Architecture:** A new pure-ish `communityResolver` slugifies a game's name (`"Lethal Company"` → `"lethal-company"`), validates the slug against the cached Thunderstore community list, and persists the match to `gameProfiles[gameId].thunderstoreCommunity`. `matchProfile` overlays that per-game value so all sync callers see it. `fetchModList` triggers resolution on first load; a GameDetail picker (backed by a new `setGameCommunity`/`listCommunities` IPC) handles mismatches.

**Tech Stack:** Electron (CommonJS main in `electron/`), React + zustand renderer in `src/`, `electron-store`, `node:test` for unit tests.

## Global Constraints

- Tests use `node:test` + `node:assert`. Pure tests run via `node --test <file>`.
- Renderer↔main only via `electron/preload.js` `window.unifia` bridge + `electron/main.js` `handle(...)`.
- Per-game settings live in `store.get('gameProfiles')[gameId]` (same bag the invite modal writes `photonAppId` to). Add only the field `thunderstoreCommunity`.
- Community match is **exact** on the Thunderstore community `identifier`. Never query an unvalidated slug.
- REPO must keep its recipe community `"repo"` — the resolver must no-op when a community already resolves.
- Empty-string community to `setGameCommunity` clears the override (revert to auto/registry).

---

### Task 1: communityResolver (slugify + pickCommunity + resolveCommunity)

**Files:**
- Create: `electron/ipc/communityResolver.js`
- Test: `electron/ipc/communityResolver.test.js`

**Interfaces:**
- Consumes: `profiles.matchProfile(game)` → `{ thunderstoreCommunity, ... }`; `thunderstore.fetchCommunities()` → `Promise<[{identifier, name}]>`; `store.get/set('gameProfiles')`.
- Produces:
  - `slugify(name: string) => string`
  - `pickCommunity(slug: string, communities: [{identifier, name}]) => string | null`
  - `resolveCommunity(game: {id, name, ...}) => Promise<string | null>` (persists to `gameProfiles[game.id].thunderstoreCommunity` on a match)

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/communityResolver.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { slugify, pickCommunity } = require('./communityResolver');

test('slugify lowercases and hyphenates spaces', () => {
  assert.strictEqual(slugify('Lethal Company'), 'lethal-company');
  assert.strictEqual(slugify('Content Warning'), 'content-warning');
});

test('slugify collapses non-alphanumeric runs and trims hyphens', () => {
  assert.strictEqual(slugify('  R.E.P.O.  '), 'r-e-p-o');
  assert.strictEqual(slugify('REPO'), 'repo');
  assert.strictEqual(slugify("Buckshot Roulette!!!"), 'buckshot-roulette');
  assert.strictEqual(slugify(''), '');
});

test('pickCommunity returns the identifier when the slug matches', () => {
  const list = [{ identifier: 'lethal-company', name: 'Lethal Company' }, { identifier: 'repo', name: 'REPO' }];
  assert.strictEqual(pickCommunity('lethal-company', list), 'lethal-company');
});

test('pickCommunity returns null when the slug is absent or list empty', () => {
  assert.strictEqual(pickCommunity('not-a-game', [{ identifier: 'repo', name: 'REPO' }]), null);
  assert.strictEqual(pickCommunity('repo', []), null);
  assert.strictEqual(pickCommunity('', [{ identifier: 'repo', name: 'REPO' }]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/ipc/communityResolver.test.js`
Expected: FAIL — `Cannot find module './communityResolver'`.

- [ ] **Step 3: Write the implementation**

Create `electron/ipc/communityResolver.js`:

```js
const { store } = require('../store');
const profiles = require('./profiles');
const thunderstore = require('./thunderstore');

// Thunderstore community identifiers are slugified game names. Lowercase, then
// collapse every run of non-alphanumeric characters into a single hyphen and
// trim leading/trailing hyphens. "Lethal Company" -> "lethal-company".
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Exact-match a slug against the fetched community list. Returns the matching
// identifier or null. Pure — the list is passed in (no network here).
function pickCommunity(slug, communities) {
  if (!slug) return null;
  const hit = (communities || []).find((c) => c && c.identifier === slug);
  return hit ? hit.identifier : null;
}

// Resolve a game's Thunderstore community once and persist it. No-op when the
// game already resolves a community (registry/recipe/prior resolution), so REPO
// and registered games are never touched. Network failure degrades to null.
async function resolveCommunity(game) {
  const existing = profiles.matchProfile(game).thunderstoreCommunity;
  if (existing) return existing;

  const slug = slugify(game && game.name);
  if (!slug) return null;

  let communities;
  try {
    communities = await thunderstore.fetchCommunities();
  } catch {
    return null;
  }

  const id = pickCommunity(slug, communities);
  if (!id) return null;

  const gp = store.get('gameProfiles') || {};
  const entry = { ...(gp[game.id] || {}), thunderstoreCommunity: id };
  store.set('gameProfiles', { ...gp, [game.id]: entry });
  return id;
}

module.exports = { slugify, pickCommunity, resolveCommunity };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test electron/ipc/communityResolver.test.js`
Expected: PASS — 4 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/communityResolver.js electron/ipc/communityResolver.test.js
git commit -m "feat: communityResolver — slugify + validated community match"
```

---

### Task 2: Per-game community overlay in matchProfile

**Files:**
- Modify: `electron/ipc/profiles.js:52-73` (`matchProfile`), `:79-95` (add `applyCommunityOverride` after `applyAppIdOverride`), `:97` (exports)
- Test: `electron/ipc/profiles.test.js` (append)

**Interfaces:**
- Consumes: `store.get('gameProfiles')[game.id].thunderstoreCommunity` (set by Task 1 / Task 3).
- Produces:
  - `applyCommunityOverride(profile: object, gameStored: object) => object` (exported)
  - `matchProfile(game)` now overlays the per-game community as the final precedence layer.

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/profiles.test.js`:

```js
const { applyCommunityOverride } = require('./profiles');

test('applyCommunityOverride overlays a per-game community when set', () => {
  const out = applyCommunityOverride({ thunderstoreCommunity: 'repo', region: 'eu' }, { thunderstoreCommunity: 'lethal-company' });
  assert.strictEqual(out.thunderstoreCommunity, 'lethal-company');
  assert.strictEqual(out.region, 'eu');
});

test('applyCommunityOverride leaves the profile untouched when no per-game value', () => {
  assert.strictEqual(applyCommunityOverride({ thunderstoreCommunity: 'repo' }, {}).thunderstoreCommunity, 'repo');
  assert.strictEqual(applyCommunityOverride({ thunderstoreCommunity: 'repo' }, undefined).thunderstoreCommunity, 'repo');
  assert.strictEqual(applyCommunityOverride({ thunderstoreCommunity: 'repo' }, { thunderstoreCommunity: '  ' }).thunderstoreCommunity, 'repo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/ipc/profiles.test.js`
Expected: FAIL — `applyCommunityOverride is not a function` (it's `undefined`).

- [ ] **Step 3: Refactor matchProfile to a single return and add the overlay**

In `electron/ipc/profiles.js`, replace the whole `matchProfile` function (lines 52-73) with:

```js
function matchProfile(game) {
  const reg = loadRegistry();
  const base = reg.default || {};
  const analyzerOverride = storedOverride(game);
  const recipeProfile = recipeStore.recipeFor(game) || {};

  let entryProfile = {};
  for (const entry of reg.games || []) {
    const m = entry.match || {};
    if (m.steamAppId && game.steamAppId && String(game.steamAppId) === String(m.steamAppId)) {
      entryProfile = entry.profile; break;
    }
    if (m.namePattern && game.name) {
      const re = safeRegex(m.namePattern);
      if (re && re.test(game.name)) { entryProfile = entry.profile; break; }
    }
  }

  const merged = resolveProfile({ base, entryProfile, analyzerOverride, recipeProfile });
  const gameStored = (store.get('gameProfiles') || {})[game.id];
  return applyCommunityOverride(merged, gameStored);
}
```

Add `applyCommunityOverride` immediately after `applyAppIdOverride` (after line 95):

```js
// Overlay the per-game Thunderstore community (auto-resolved or user-picked,
// stored in gameProfiles[id].thunderstoreCommunity) as the final precedence
// layer, so unregistered games get a source and users can correct a mismatch.
function applyCommunityOverride(profile, gameStored) {
  const c = (((gameStored || {}).thunderstoreCommunity) || '').trim();
  if (!c) return profile;
  return { ...profile, thunderstoreCommunity: c };
}
```

Update the exports line (97):

```js
module.exports = { matchProfile, resolveProfile, applyAppIdOverride, applyCommunityOverride, loadRegistry };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test electron/ipc/profiles.test.js`
Expected: PASS — all tests (existing 8 + 2 new) pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/profiles.js electron/ipc/profiles.test.js
git commit -m "feat: matchProfile overlays per-game Thunderstore community"
```

---

### Task 3: modManager — trigger resolution + setGameCommunity + listCommunities

**Files:**
- Modify: `electron/ipc/modManager.js` (require `communityResolver`; `fetchModList` ~line 88; add `setGameCommunity` + `listCommunities`; `module.exports` ~line 731)
- Test: `electron/ipc/modManager.exports.test.js` (append)

**Interfaces:**
- Consumes: `communityResolver.resolveCommunity(game)` (Task 1); existing `communityFor(game)`, `findGame`, `profiles.matchProfile`, `thunderstore.fetchCommunities`, `store`.
- Produces (all exported):
  - `fetchModList(gameId, opts)` resolves the community first when none is set.
  - `setGameCommunity(gameId, community) => { gameId, community }` — writes/clears `gameProfiles[gameId].thunderstoreCommunity`.
  - `listCommunities(opts) => Promise<[{identifier, name}]>` — full unfiltered community list.

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/modManager.exports.test.js` (before the final `console.log('✔ Export verification complete');`):

```js
const newFunctions = ['setGameCommunity', 'listCommunities'];
for (const fn of newFunctions) {
  if (typeof modManager[fn] === 'function') {
    console.log(`✔ ${fn} is exported`);
  } else {
    console.log(`✗ ${fn} is NOT exported`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node electron/ipc/modManager.exports.test.js`
Expected: FAIL — prints `✗ setGameCommunity is NOT exported` and exits non-zero.

- [ ] **Step 3: Implement**

In `electron/ipc/modManager.js`, after the existing requires (after line 14 `const presetStore = require('./presetStore');`), add:

```js
const communityResolver = require('./communityResolver');
```

Replace `fetchModList` (lines 88-92) with:

```js
async function fetchModList(gameId, opts) {
  const game = findGame(gameId);
  // Unregistered games (e.g. a fresh Steam import) have no community yet —
  // resolve+persist it from the game name before aggregating. Non-fatal.
  if (!communityFor(game)) {
    try { await communityResolver.resolveCommunity(game); } catch { /* no source */ }
  }
  const profile = profiles.matchProfile(game);
  return aggregateMods(getProviders(), profile, opts || {});
}
```

Immediately after `fetchModListForCommunity` (after line 108), add:

```js
// Manual override: set (or clear, with an empty string) the per-game
// Thunderstore community when auto-resolution is wrong or finds nothing.
function setGameCommunity(gameId, community) {
  const gp = store.get('gameProfiles') || {};
  const entry = { ...(gp[gameId] || {}) };
  const c = (community || '').trim();
  if (c) entry.thunderstoreCommunity = c;
  else delete entry.thunderstoreCommunity;
  store.set('gameProfiles', { ...gp, [gameId]: entry });
  return { gameId, community: c || null };
}

// Full Thunderstore community list (unfiltered) for the manual picker.
async function listCommunities(opts) {
  return thunderstore.fetchCommunities(opts || {});
}
```

In `module.exports` (around line 731, next to `getDiscoverGames, fetchModListForCommunity`), add:

```js
  setGameCommunity,
  listCommunities,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node electron/ipc/modManager.exports.test.js`
Expected: PASS — prints `✔ setGameCommunity is exported`, `✔ listCommunities is exported`, exits 0.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/modManager.js electron/ipc/modManager.exports.test.js
git commit -m "feat: modManager resolves community on load + setGameCommunity/listCommunities"
```

---

### Task 4: IPC handlers + preload bridges

**Files:**
- Modify: `electron/main.js:160-163` (after the `fetchModListForCommunity` handler)
- Modify: `electron/preload.js:93-95` (after the `fetchModListForCommunity` bridge)

**Interfaces:**
- Consumes: `modManager.setGameCommunity` / `modManager.listCommunities` (Task 3).
- Produces: `window.unifia.setGameCommunity(gameId, community) => Promise<{gameId, community}>` and `window.unifia.listCommunities(opts) => Promise<[{identifier, name}]>` (Task 5 consumes these).

- [ ] **Step 1: Add the IPC handlers**

In `electron/main.js`, after line 163 (the closing `);` of the `fetchModListForCommunity` handler), add:

```js
  handle('unifia:setGameCommunity', (gameId, community) =>
    modManager.setGameCommunity(gameId, community)
  );
  handle('unifia:listCommunities', (opts) => modManager.listCommunities(opts || {}));
```

- [ ] **Step 2: Add the preload bridges**

In `electron/preload.js`, after line 95 (the `fetchModListForCommunity` bridge), add:

```js
  setGameCommunity: (gameId, community) => invoke('unifia:setGameCommunity', gameId, community),
  listCommunities: (opts) => invoke('unifia:listCommunities', opts),
```

- [ ] **Step 3: Verify the app boots and the bridges are wired**

Run: `npm run build`
Expected: Vite build completes with no errors (renderer compiles; the preload/main changes are plain JS and load at runtime).

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat: IPC + preload bridges for setGameCommunity and listCommunities"
```

---

### Task 5: GameDetail community picker + store action

**Files:**
- Modify: `src/store/useAppStore.js` (add `setGameCommunity` action near `loadMods`, ~line 358)
- Modify: `src/pages/GameDetail.jsx` (state + picker UI in the no-source branch, lines 261-264; wire the store action ~line 36)

**Interfaces:**
- Consumes: `api.setGameCommunity`, `api.listCommunities` (Task 4); existing `loadMods(game)` store action.
- Produces: `useAppStore().setGameCommunity(game, community)` action; a picker rendered in GameDetail's `modHubs.length === 0` branch.

- [ ] **Step 1: Add the store action**

In `src/store/useAppStore.js`, immediately after the `loadMods` action's closing `},` (after line 358), add:

```js
  // Set (or clear) a game's Thunderstore community manually, then reload its
  // mods so the new source takes effect.
  async setGameCommunity(game, community) {
    await api.setGameCommunity(game.id, community);
    await get().loadMods(game, { refresh: true });
  },
```

- [ ] **Step 2: Add picker state + handler in GameDetail**

In `src/pages/GameDetail.jsx`, after line 36 (`const updateAllMods = ...`), add the store action and existing reload access:

```js
  const setGameCommunityAction = useAppStore((s) => s.setGameCommunity);
```

After line 53 (`const [installedFilter, ...]`), add picker state:

```js
  const [communities, setCommunities] = useState([]);
  const [communityQuery, setCommunityQuery] = useState('');
  const [settingCommunity, setSettingCommunity] = useState(false);
```

After the `getRecipeFor` effect (after line 69), add an effect that loads the community list only when there's no source to pick from:

```js
  useEffect(() => {
    if (modHubs.length !== 0 || modsLoading) return;
    let active = true;
    window.unifia.listCommunities().then((list) => { if (active) setCommunities(list || []); }).catch(() => {});
    return () => { active = false; };
  }, [modHubs.length, modsLoading]);
```

- [ ] **Step 3: Render the picker in the no-source branch**

In `src/pages/GameDetail.jsx`, replace the `modHubs.length === 0` block (lines 261-264):

```jsx
      ) : modHubs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          This game has no supported mod source, so there&apos;s nothing to browse.
        </div>
      ) : (
```

with:

```jsx
      ) : modHubs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center">
          <p className="text-neutral-500">
            Unifia couldn&apos;t match this game to a Thunderstore community automatically.
            Pick one to load its mods:
          </p>
          <input
            type="text"
            value={communityQuery}
            onChange={(e) => setCommunityQuery(e.target.value)}
            placeholder="Search communities…"
            className="mt-4 w-full max-w-sm rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500"
          />
          <div className="mx-auto mt-3 max-h-60 max-w-sm overflow-y-auto text-left">
            {communities
              .filter((c) => !communityQuery
                || `${c.name} ${c.identifier}`.toLowerCase().includes(communityQuery.toLowerCase()))
              .slice(0, 50)
              .map((c) => (
                <button
                  key={c.identifier}
                  disabled={settingCommunity}
                  onClick={async () => {
                    setSettingCommunity(true);
                    try { await setGameCommunityAction(liveGame, c.identifier); }
                    finally { setSettingCommunity(false); }
                  }}
                  className="flex w-full items-center justify-between rounded px-3 py-2 text-sm text-neutral-200 hover:bg-surface-hover disabled:opacity-50"
                >
                  <span>{c.name}</span>
                  <span className="text-xs text-neutral-500">{c.identifier}</span>
                </button>
              ))}
          </div>
        </div>
      ) : (
```

- [ ] **Step 4: Verify the renderer builds**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev` (or the user's normal launch). Then:
1. Open **Lethal Company** → the mod list loads; close and reopen — it stays resolved (persisted as `gameProfiles.<id>.thunderstoreCommunity = "lethal-company"`).
2. Open **REPO** → still loads its `repo` community (regression check — resolver did not run).
3. For a game whose name doesn't slugify to its community → the picker appears; selecting a community loads its mods.

Expected: all three behave as described.

- [ ] **Step 6: Commit**

```bash
git add src/store/useAppStore.js src/pages/GameDetail.jsx
git commit -m "feat: GameDetail community picker for manual/fallback resolution"
```

---

## Notes for the implementer

- Do **not** add a `test` script or new test runner; the repo runs `node:test` files individually with `node --test <file>` and the two `*.exports.test.js` / console-style files with `node <file>`.
- `electron/ipc/modManager.cache.test.js` already fails in plain node (it needs Electron's `app.getPath`). That is pre-existing and out of scope — don't try to fix it here.
- Keep all new per-game writes confined to the `thunderstoreCommunity` field of `gameProfiles[gameId]`; never overwrite the whole entry (merge with `{ ...existing }`).
