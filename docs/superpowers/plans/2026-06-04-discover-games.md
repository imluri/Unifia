# Discover Games Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Discover section to Home listing moddable games from Thunderstore's community catalog (not-installed games), each opening the GameDetail view in browse-only mode.

**Architecture:** A cached Thunderstore community-list fetch + a pure `filterDiscover` (catalog minus installed communities → discover-game objects). The store gains a `discoverGames` slice and `loadMods(game)` branches on `game.installed`. Home gets Library | Discover tabs; GameDetail renders browse-only for not-installed games.

**Tech Stack:** Electron (CommonJS main), React + Vite + Tailwind (renderer), zustand, Node `node:test`.

---

## File Structure

**Create:**
- `electron/ipc/modHubs/discover.js` — pure `filterDiscover`.
- `electron/ipc/modHubs/discover.test.js` — tests.
- `src/components/DiscoverCard.jsx` — catalog game tile.

**Modify:**
- `electron/ipc/thunderstore.js` (+ test) — `parseCommunities` + `fetchCommunities`.
- `electron/ipc/modManager.js` — `getDiscoverGames`, `fetchModListForCommunity`.
- `electron/main.js` + `electron/preload.js` — two IPC methods.
- `src/components/ModBrowseCard.jsx` — `readOnly` prop.
- `src/store/useAppStore.js` — discover slice + `loadMods(game)` branch.
- `src/pages/GameDetail.jsx` — `loadMods(game)`, browse-only mode.
- `src/pages/Home.jsx` — Library | Discover tabs + discover grid.

---

## Task 1: Thunderstore community catalog

**Files:**
- Modify: `electron/ipc/thunderstore.js`
- Modify: `electron/ipc/thunderstore.test.js`

- [ ] **Step 1: Write the failing test for `parseCommunities`**

Append to `electron/ipc/thunderstore.test.js` (and add `parseCommunities` to the destructured `require('./thunderstore')` import at the top):

```js
test('parseCommunities maps identifier + name, tolerating missing fields', () => {
  const results = [
    { identifier: 'repo', name: 'REPO' },
    { identifier: 'lethal-company' }, // missing name → falls back to identifier
    { name: 'No Identifier' }, // no identifier → dropped
    null,
  ];
  assert.deepStrictEqual(parseCommunities(results), [
    { identifier: 'repo', name: 'REPO' },
    { identifier: 'lethal-company', name: 'lethal-company' },
  ]);
  assert.deepStrictEqual(parseCommunities(null), []);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test electron/ipc/thunderstore.test.js`
Expected: FAIL — `parseCommunities is not a function`.

- [ ] **Step 3: Implement `parseCommunities` + `fetchCommunities`**

In `electron/ipc/thunderstore.js`, add these functions before `module.exports`, and add `parseCommunities` and `fetchCommunities` to the exports object:

```js
const COMMUNITIES_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Normalize the /api/experimental/community/ results array.
function parseCommunities(results) {
  if (!Array.isArray(results)) return [];
  return results
    .filter((c) => c && c.identifier)
    .map((c) => ({ identifier: c.identifier, name: c.name || c.identifier }));
}

function communitiesCacheFile() {
  return path.join(cacheDir(), 'thunderstore', '_communities.json');
}

function readCommunitiesCache() {
  try {
    return JSON.parse(fs.readFileSync(communitiesCacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCommunitiesCache(communities) {
  try {
    const file = communitiesCacheFile();
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), communities }), 'utf8');
  } catch {
    /* non-fatal cache write */
  }
}

// Fetch the full Thunderstore community list (all pages, bounded), cached.
async function fetchCommunities({ refresh = false } = {}) {
  const cached = readCommunitiesCache();
  if (!refresh && isCacheFresh(cached, COMMUNITIES_TTL)) return cached.communities;

  try {
    let url = 'https://thunderstore.io/api/experimental/community/';
    const all = [];
    for (let page = 0; url && page < 25; page += 1) {
      const res = await httpFetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Unifia-Launcher' },
      });
      if (!res.ok) throw new Error(`Thunderstore ${res.status}: ${res.statusText}`);
      const data = await res.json();
      all.push(...parseCommunities(data.results));
      url = (data.pagination && data.pagination.next_link) || data.next || null;
    }
    writeCommunitiesCache(all);
    return all;
  } catch (err) {
    if (cached) return cached.communities; // serve stale on failure
    throw err;
  }
}
```

(`fs`, `path`, `cacheDir`, `ensureDir`, `httpFetch`, `isCacheFresh` are all already imported/defined in this file.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test electron/ipc/thunderstore.test.js`
Expected: PASS (all tests, including the new one). Also `node --check electron/ipc/thunderstore.js`.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/thunderstore.js electron/ipc/thunderstore.test.js
git commit -m "feat(discover): Thunderstore community catalog fetch + cache"
```

---

## Task 2: Pure `filterDiscover` + modManager discover functions

**Files:**
- Create: `electron/ipc/modHubs/discover.js`
- Create: `electron/ipc/modHubs/discover.test.js`
- Modify: `electron/ipc/modManager.js`

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/modHubs/discover.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { filterDiscover } = require('./discover');

test('filterDiscover drops installed communities and maps the rest', () => {
  const catalog = [
    { identifier: 'repo', name: 'REPO' },
    { identifier: 'lethal-company', name: 'Lethal Company' },
    { identifier: 'valheim', name: 'Valheim' },
  ];
  const result = filterDiscover(catalog, ['repo']);
  assert.deepStrictEqual(result, [
    { id: 'ts:lethal-company', name: 'Lethal Company', community: 'lethal-company', installed: false },
    { id: 'ts:valheim', name: 'Valheim', community: 'valheim', installed: false },
  ]);
});

test('filterDiscover tolerates empty/missing inputs', () => {
  assert.deepStrictEqual(filterDiscover([], []), []);
  assert.deepStrictEqual(filterDiscover(null, null), []);
  // entries without identifier are skipped
  assert.deepStrictEqual(filterDiscover([{ name: 'x' }], []), []);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `node --test electron/ipc/modHubs/discover.test.js`
Expected: FAIL — `Cannot find module './discover'`.

- [ ] **Step 3: Implement `filterDiscover`**

Create `electron/ipc/modHubs/discover.js`:

```js
// Pure: catalog communities minus the ones already installed, mapped to
// lightweight "discover game" objects the UI/GameDetail can consume.
function filterDiscover(catalog, installedCommunities) {
  const installed = new Set(installedCommunities || []);
  return (catalog || [])
    .filter((c) => c && c.identifier && !installed.has(c.identifier))
    .map((c) => ({
      id: `ts:${c.identifier}`,
      name: c.name || c.identifier,
      community: c.identifier,
      installed: false,
    }));
}

module.exports = { filterDiscover };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test electron/ipc/modHubs/discover.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Add modManager functions**

In `electron/ipc/modManager.js`:
1. After the existing `const { getProviders } = require('./modHubs');` line, add:
```js
const { filterDiscover } = require('./modHubs/discover');
```
2. Add these two functions (e.g. right after `fetchModList`):
```js
// Thunderstore catalog games the user does NOT have installed (deduped against
// installed games' mapped communities).
async function getDiscoverGames(opts) {
  const catalog = await thunderstore.fetchCommunities(opts || {});
  const installedCommunities = (store.get('games') || [])
    .map((g) => profiles.matchProfile(g).thunderstoreCommunity)
    .filter(Boolean);
  return filterDiscover(catalog, installedCommunities);
}

// Aggregate mods for a community directly (used for not-installed games that
// aren't in the store).
async function fetchModListForCommunity(community, opts) {
  return aggregateMods(getProviders(), { thunderstoreCommunity: community }, opts || {});
}
```
3. Add `getDiscoverGames` and `fetchModListForCommunity` to the `module.exports` object.

(Confirm `thunderstore` is already required at the top of modManager.js — it is, used by `installMod`. If not, add `const thunderstore = require('./thunderstore');`.)

- [ ] **Step 6: Syntax check + commit**

Run: `node --check electron/ipc/modManager.js` (no output).
```bash
git add electron/ipc/modHubs/discover.js electron/ipc/modHubs/discover.test.js electron/ipc/modManager.js
git commit -m "feat(discover): filterDiscover + modManager catalog/community functions"
```

---

## Task 3: IPC + preload

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Register the handlers**

In `electron/main.js`, inside `registerIpc()`, after the `unifia:checkModUpdates` handler, add:
```js
  handle('unifia:fetchDiscoverGames', (opts) => modManager.getDiscoverGames(opts || {}));
  handle('unifia:fetchModListForCommunity', (community, opts) =>
    modManager.fetchModListForCommunity(community, opts || {})
  );
```

- [ ] **Step 2: Expose in preload**

In `electron/preload.js`, after the `checkModUpdates` line, add:
```js
  fetchDiscoverGames: (opts) => invoke('unifia:fetchDiscoverGames', opts),
  fetchModListForCommunity: (community, opts) =>
    invoke('unifia:fetchModListForCommunity', community, opts),
```

- [ ] **Step 3: Syntax check + commit**

Run: `node --check electron/main.js` and `node --check electron/preload.js` (no output).
```bash
git add electron/main.js electron/preload.js
git commit -m "feat(discover): IPC for discover games + community mod list"
```

---

## Task 4: ModBrowseCard readOnly prop

**Files:**
- Modify: `src/components/ModBrowseCard.jsx`

- [ ] **Step 1: Accept `readOnly` and force "View on hub" when set**

In `src/components/ModBrowseCard.jsx`, change the component signature from:
```jsx
export default function ModBrowseCard({ game, mod }) {
```
to:
```jsx
export default function ModBrowseCard({ game, mod, readOnly = false }) {
```
Then change the install-control conditional from:
```jsx
          {mod.canInstall ? (
```
to:
```jsx
          {mod.canInstall && !readOnly ? (
```
(The existing `: (` "View on {mod.hubLabel}" branch now also covers read-only mode.)

- [ ] **Step 2: Build check + commit**

Run: `npm run build` (expect `✓ built`).
```bash
git add src/components/ModBrowseCard.jsx
git commit -m "feat(discover): ModBrowseCard readOnly mode"
```

---

## Task 5: DiscoverCard component

**Files:**
- Create: `src/components/DiscoverCard.jsx`

- [ ] **Step 1: Implement DiscoverCard**

Create `src/components/DiscoverCard.jsx`:

```jsx
import React from 'react';
import Icon from './Icon.jsx';

// Lightweight tile for a not-installed Thunderstore catalog game. Whole card
// opens the browse-only GameDetail.
export default function DiscoverCard({ game, onOpen }) {
  return (
    <div
      onClick={onOpen}
      className="card-mount flex cursor-pointer items-center gap-3 rounded bg-card px-3 py-2.5 ring-1 ring-border-subtle transition-all duration-150 hover:ring-accent/40"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-700 text-neutral-500">
        <Icon name="package" size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-neutral-100" title={game.name}>
          {game.name}
        </h3>
        <p className="truncate text-xs text-neutral-500">{game.community}</p>
      </div>
      <span className="shrink-0 rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 ring-1 ring-border-default">
        Thunderstore
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Build check + commit**

Run: `npm run build` (expect `✓ built`; not imported yet, so it just isn't bundled).
```bash
git add src/components/DiscoverCard.jsx
git commit -m "feat(discover): DiscoverCard component"
```

---

## Task 6: Store — discover slice + loadMods(game)

**Files:**
- Modify: `src/store/useAppStore.js`

- [ ] **Step 1: Add discover state**

In `src/store/useAppStore.js`, after the `modProgress: {}` state line, add:
```js
  // Discover (Thunderstore catalog of not-installed games)
  discoverGames: [],
  discoverLoading: false,
  discoverError: null,
```

- [ ] **Step 2: Change `loadMods` to take the game object + branch on installed**

Replace the entire existing `loadMods` action:
```js
  async loadMods(gameId, { refresh = false } = {}) {
    set({ modsLoading: true, modError: null });
    try {
      const [{ hubs, packages }, installed] = await Promise.all([
        api.fetchModList(gameId, { refresh }),
        api.getInstalledMods(gameId),
      ]);
      set({ modList: packages, modHubs: hubs, installedMods: installed });
      api.checkModUpdates(gameId).then((u) => set({ modUpdates: u })).catch(() => {});
    } catch (err) {
      set({ modError: err.message || String(err) });
    } finally {
      set({ modsLoading: false });
    }
  },
```
with:
```js
  async loadMods(game, { refresh = false } = {}) {
    set({ modsLoading: true, modError: null });
    try {
      const notInstalled = game.installed === false;
      const listPromise = notInstalled
        ? api.fetchModListForCommunity(game.community, { refresh })
        : api.fetchModList(game.id, { refresh });
      const [{ hubs, packages }, installed] = await Promise.all([
        listPromise,
        api.getInstalledMods(game.id),
      ]);
      set({ modList: packages, modHubs: hubs, installedMods: installed });
      if (notInstalled) {
        set({ modUpdates: [] });
      } else {
        api.checkModUpdates(game.id).then((u) => set({ modUpdates: u })).catch(() => {});
      }
    } catch (err) {
      set({ modError: err.message || String(err) });
    } finally {
      set({ modsLoading: false });
    }
  },
```

- [ ] **Step 3: Add `loadDiscover`**

Add this action near `loadMods`:
```js
  async loadDiscover({ refresh = false } = {}) {
    set({ discoverLoading: true, discoverError: null });
    try {
      const games = await api.fetchDiscoverGames({ refresh });
      set({ discoverGames: games });
    } catch (err) {
      set({ discoverError: err.message || String(err) });
    } finally {
      set({ discoverLoading: false });
    }
  },
```

- [ ] **Step 4: Build check + commit**

Run: `npm run build` (expect `✓ built`). (GameDetail still calls `loadMods(game.id)` — fixed next task; the renderer build still passes.)
```bash
git add src/store/useAppStore.js
git commit -m "feat(discover): store discover slice + loadMods(game) branch"
```

---

## Task 7: GameDetail browse-only mode

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: loadMods(game), default tab, notInstalled flag**

In `src/pages/GameDetail.jsx`:
1. Change the effect call `if (game) loadMods(game.id);` to:
```jsx
    if (game) loadMods(game);
```
2. Change the retry button `onClick={() => loadMods(game.id, { refresh: true })}` to:
```jsx
              onClick={() => loadMods(game, { refresh: true })}
```
3. Change `const [tab, setTab] = useState('installed');` to (optional chaining since this runs before the `if (!game) return null` guard):
```jsx
  const [tab, setTab] = useState(game?.installed === false ? 'browse' : 'installed');
```
4. After `if (!game) return null;`, add:
```jsx
  const notInstalled = game.installed === false;
```

- [ ] **Step 2: Hide the action header + show a not-installed note**

Wrap the header actions row (the `<div className="mb-5 flex items-center gap-2">…Launch…Module…Remove…</div>` block added previously) and its following `{notice && …}` in `{!notInstalled && (…)}`. Concretely, change:
```jsx
      <div className="mb-5 flex items-center gap-2">
        <button
          onClick={handleLaunch}
```
…through the notice block…
```jsx
      {notice && (
        <div className="mb-4 rounded bg-neutral-800 px-4 py-2 text-sm text-neutral-200">{notice}</div>
      )}
```
to be wrapped:
```jsx
      {!notInstalled && (
        <>
          <div className="mb-5 flex items-center gap-2">
            <button
              onClick={handleLaunch}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95"
            >
              Launch
            </button>
            <button
              onClick={() => setModuleOpen(true)}
              className="rounded bg-neutral-700 px-4 py-2 text-sm text-neutral-100 transition hover:bg-surface-hover"
            >
              Module
            </button>
            <button
              onClick={handleRemove}
              title="Remove from library"
              className="ml-auto flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-400 transition hover:bg-red-900/60 hover:text-red-300"
            >
              <Icon name="x" size={15} /> Remove
            </button>
          </div>
          {notice && (
            <div className="mb-4 rounded bg-neutral-800 px-4 py-2 text-sm text-neutral-200">{notice}</div>
          )}
        </>
      )}
      {notInstalled && (
        <div className="mb-5 flex items-center gap-2 rounded border border-yellow-900/40 bg-yellow-900/15 px-4 py-3 text-sm text-yellow-300">
          Not installed — browsing mods only.
          <button
            onClick={() => window.unifia.openExternal(`https://thunderstore.io/c/${game.community}/`)}
            className="ml-auto rounded bg-neutral-700 px-3 py-1.5 text-xs text-neutral-100 hover:bg-surface-hover"
          >
            View on Thunderstore
          </button>
        </div>
      )}
```

- [ ] **Step 3: Suppress the BepInEx banner + pass readOnly to cards**

Change the BepInEx banner condition `{!modsLoading && !hasBepInEx && (` to:
```jsx
          {!modsLoading && !notInstalled && !hasBepInEx && (
```
Change the browse grid card render `<ModBrowseCard key={m.id} game={game} mod={m} />` to:
```jsx
                  <ModBrowseCard key={m.id} game={game} mod={m} readOnly={notInstalled} />
```

- [ ] **Step 4: Build check + commit**

Run: `npm run build` (expect `✓ built`).
```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(discover): GameDetail browse-only mode for not-installed games"
```

---

## Task 8: Home — Library | Discover tabs

**Files:**
- Modify: `src/pages/Home.jsx`

- [ ] **Step 1: Imports + state + discover effect**

In `src/pages/Home.jsx`:
1. Add the import at the top:
```jsx
import DiscoverCard from '../components/DiscoverCard.jsx';
```
2. Add `useEffect` to the React import if not present — the file imports `useMemo, useState`; change it to:
```jsx
import React, { useEffect, useMemo, useState } from 'react';
```
3. Add store selectors near the other `useAppStore` selectors in the component:
```jsx
  const discoverGames = useAppStore((s) => s.discoverGames);
  const discoverLoading = useAppStore((s) => s.discoverLoading);
  const discoverError = useAppStore((s) => s.discoverError);
  const loadDiscover = useAppStore((s) => s.loadDiscover);
```
4. Add local state near the other `useState` calls:
```jsx
  const [section, setSection] = useState('library');
  const [discoverQuery, setDiscoverQuery] = useState('');
```
5. Add an effect (place it after the existing state, before the `return`):
```jsx
  useEffect(() => {
    if (section === 'discover' && discoverGames.length === 0 && !discoverLoading) {
      loadDiscover();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const dq = discoverQuery.trim().toLowerCase();
  const filteredDiscover = dq
    ? discoverGames.filter((g) => g.name.toLowerCase().includes(dq))
    : discoverGames;
```

- [ ] **Step 2: Add the Library | Discover segmented control to the header**

In the header's left `<div>` (the one containing the `<h1>Library</h1>` and the count `<p>`), add a tab control right after the `</p>`. Change:
```jsx
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Library</h1>
          <p className="text-sm text-neutral-500">
            {anyActive
              ? `${filteredGames.length} of ${games.length} games`
              : `${games.length} games detected`}
          </p>
        </div>
```
to:
```jsx
        <div>
          <div className="mb-1 inline-flex rounded-lg bg-neutral-800 p-1">
            {['library', 'discover'].map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`rounded px-3 py-1 text-sm font-medium capitalize transition ${
                  section === s ? 'bg-accent text-accent-contrast' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-sm text-neutral-500">
            {section === 'discover'
              ? `${discoverGames.length} moddable games on Thunderstore`
              : anyActive
                ? `${filteredGames.length} of ${games.length} games`
                : `${games.length} games detected`}
          </p>
        </div>
```

- [ ] **Step 3: Show the library action buttons only in the Library section**

Wrap the header's right-side action group so it only renders in the library section. Change:
```jsx
        <div className="flex gap-2">
          {/* List / grid view toggle */}
```
…the whole group through its closing `</div>` (the one right before the header's closing `</div>`)… by gating it. Wrap that entire `<div className="flex gap-2">…</div>` block in:
```jsx
        {section === 'library' && (
          <div className="flex gap-2">
            {/* List / grid view toggle */}
            … (unchanged contents: view toggle, Rescan, Add game) …
          </div>
        )}
```

- [ ] **Step 4: Gate the existing Library body + add the Discover body**

The existing body — the search/filter bar block and the games container (the `{games.length === 0 ? … : filteredGames.length === 0 ? … : (grid)}` block) — must render only in the library section. Wrap everything from the `{/* Search + filter popup */}` block down to the end of the games-grid conditional `)}` (i.e. everything before `<ManualAddModal`) in:
```jsx
      {section === 'library' && (
        <>
          … (the existing search/filter bar + games container, unchanged) …
        </>
      )}
```
Immediately after that, before `<ManualAddModal`, add the Discover body:
```jsx
      {section === 'discover' && (
        <div>
          <div className="relative mb-4 max-w-sm">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500">
              <Icon name="search" size={15} />
            </span>
            <input
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              placeholder="Search Thunderstore games…"
              className="w-full rounded bg-neutral-800 py-2 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {discoverLoading && <p className="text-sm text-neutral-500">Loading catalog…</p>}
          {discoverError && (
            <div className="rounded-lg border border-red-900/50 bg-red-900/20 p-6 text-center text-sm text-red-300">
              Couldn&apos;t load the catalog: {discoverError}
              <div className="mt-3">
                <button
                  onClick={() => loadDiscover({ refresh: true })}
                  className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          {!discoverLoading && !discoverError && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDiscover.map((g) => (
                <DiscoverCard key={g.id} game={g} onOpen={() => onOpenGame(g)} />
              ))}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 5: Build check + commit**

Run: `npm run build` (expect `✓ built`).
```bash
git add src/pages/Home.jsx
git commit -m "feat(discover): Home Library | Discover tabs + catalog grid"
```

---

## Final verification

- [ ] **Unit tests**

Run: `node --test electron/ipc/thunderstore.test.js electron/ipc/modHubs/discover.test.js electron/ipc/modHubs/aggregate.test.js electron/ipc/modResolver.test.js`
Expected: all PASS.

- [ ] **Full build + syntax**

Run: `npm run build` (expect `✓ built`) and
`node --check electron/ipc/thunderstore.js electron/ipc/modManager.js electron/main.js electron/preload.js` (no output).

- [ ] **Manual smoke (`npm run dev`)**
  - Home: a **Library | Discover** toggle. Library is unchanged (installed games, search/filters/view/rescan/add).
  - Discover: loads the Thunderstore catalog; the search box filters by name; cards show name + "Thunderstore" tag.
  - Click a Discover game → GameDetail opens **browse-only**: a yellow "Not installed — browsing mods only" note + "View on Thunderstore"; no Launch/Module/Remove; mods listed with "View on Thunderstore" (no Install); no BepInEx banner.
  - An installed game mapped to a community (REPO) does **not** appear in Discover.
  - Installed games still open with the full Launch/Module/Remove + installable mods.

---

## Notes for the implementer

- `electron/` is CommonJS; `src/` is ESM/JSX.
- `loadMods` now takes the **game object** (not an id). GameDetail is its only caller; Task 7 updates it. Don't leave a `loadMods(game.id)` behind.
- Do NOT touch the install/stage/deploy path. Discover is browse-only; not-installed games never write `gameMods`.
- `getInstalledMods('ts:<community>')` is safe (reads `gameMods` by key → `[]`); `checkModUpdates` is skipped for not-installed games because it calls `findGame` (which would throw).
