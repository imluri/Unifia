# Mod Hub Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Thunderstore mod browsing into a pluggable "mod hub provider" abstraction so a game's mods aggregate from multiple hub REST APIs, each tagged with its hub, with hub filter + sort in the Browse tab. Thunderstore is the first provider; install stays Thunderstore-only.

**Architecture:** A pure `aggregateMods(providers, profile, opts)` flattens + hub-tags mods from every provider that maps the game (returning `{ packages, hubs }`). Providers live in `electron/ipc/modHubs/`; `modManager.fetchModList` calls the aggregator. The renderer store tracks `modHubs` (array) and the UI gains hub tag/filter/sort.

**Tech Stack:** Electron (CommonJS main), React + Vite + Tailwind (renderer), zustand, Node `node:test`.

---

## File Structure

**Create:**
- `electron/ipc/modHubs/aggregate.js` — pure `aggregateMods` (the new logic).
- `electron/ipc/modHubs/aggregate.test.js` — unit tests.
- `electron/ipc/modHubs/thunderstore.js` — Thunderstore provider (wraps existing client).
- `electron/ipc/modHubs/index.js` — `getProviders()` registry.

**Modify:**
- `electron/ipc/modManager.js` — `fetchModList` uses the aggregator.
- `electron/main.js` + `electron/preload.js` — `openExternal` IPC.
- `src/store/useAppStore.js` — `modHubs` slice; `loadMods` destructure.
- `src/components/ModBrowseCard.jsx` — hub tag + `canInstall` gating.
- `src/pages/GameDetail.jsx` — empty state, hub filter, hub sort, card key.

---

## Task 1: Pure `aggregateMods`

**Files:**
- Create: `electron/ipc/modHubs/aggregate.js`
- Create: `electron/ipc/modHubs/aggregate.test.js`

- [ ] **Step 1: Write the failing tests**

Create `electron/ipc/modHubs/aggregate.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateMods } = require('./aggregate');

const A = {
  id: 'a', label: 'Hub A', canInstall: true,
  gameRef: () => 'aref',
  fetchMods: async () => [{ fullName: 'X-Mod', name: 'Mod', packageUrl: 'http://a/x' }],
};
const Bnull = {
  id: 'b', label: 'Hub B', canInstall: false,
  gameRef: () => null,
  fetchMods: async () => [{ fullName: 'Y-Mod', name: 'Y' }],
};
const Cthrow = {
  id: 'c', label: 'Hub C', canInstall: false,
  gameRef: () => 'cref',
  fetchMods: async () => { throw new Error('hub down'); },
};

test('aggregateMods merges + hub-tags mods from providers with a ref', async () => {
  const { packages, hubs } = await aggregateMods([A, Bnull, Cthrow], {});
  // hubs = providers with a non-null gameRef (A and C), not B
  assert.deepStrictEqual(hubs.map((h) => h.id).sort(), ['a', 'c']);
  assert.deepStrictEqual(hubs.find((h) => h.id === 'a'), { id: 'a', label: 'Hub A' });
  // only A produced mods (B has no ref, C threw)
  assert.strictEqual(packages.length, 1);
  const m = packages[0];
  assert.strictEqual(m.hub, 'a');
  assert.strictEqual(m.hubLabel, 'Hub A');
  assert.strictEqual(m.canInstall, true);
  assert.strictEqual(m.id, 'a:X-Mod');
  assert.strictEqual(m.pageUrl, 'http://a/x');
  assert.strictEqual(m.fullName, 'X-Mod'); // original fields preserved
});

test('aggregateMods returns empty result for no providers', async () => {
  assert.deepStrictEqual(await aggregateMods([], {}), { packages: [], hubs: [] });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test electron/ipc/modHubs/aggregate.test.js`
Expected: FAIL — `Cannot find module './aggregate'`.

- [ ] **Step 3: Implement the aggregator**

Create `electron/ipc/modHubs/aggregate.js`:

```js
// Pure aggregation across mod hub providers. For each provider that maps the
// game (non-null gameRef), fetch its mods and decorate them with hub metadata.
// A provider that throws is skipped (its mods omitted) but still counts as a hub
// that maps the game. Returns { packages, hubs }.
async function aggregateMods(providers, profile, opts) {
  const hubs = [];
  const packages = [];

  for (const provider of providers || []) {
    const ref = provider.gameRef(profile);
    if (!ref) continue;
    hubs.push({ id: provider.id, label: provider.label });

    let mods = [];
    try {
      mods = await provider.fetchMods(ref, opts || {});
    } catch {
      mods = []; // hub unreachable right now — keep the others
    }

    for (const m of mods || []) {
      packages.push({
        ...m,
        hub: provider.id,
        hubLabel: provider.label,
        canInstall: !!provider.canInstall,
        id: `${provider.id}:${m.fullName}`,
        pageUrl: m.pageUrl || m.packageUrl || null,
      });
    }
  }

  return { packages, hubs };
}

module.exports = { aggregateMods };
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test electron/ipc/modHubs/aggregate.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/modHubs/aggregate.js electron/ipc/modHubs/aggregate.test.js
git commit -m "feat(mods): pure aggregateMods across hub providers"
```

---

## Task 2: Thunderstore provider + registry

**Files:**
- Create: `electron/ipc/modHubs/thunderstore.js`
- Create: `electron/ipc/modHubs/index.js`

- [ ] **Step 1: Create the Thunderstore provider**

Create `electron/ipc/modHubs/thunderstore.js`:

```js
const client = require('../thunderstore');

// Thunderstore mod hub provider. Wraps the existing thunderstore.js REST client.
module.exports = {
  id: 'thunderstore',
  label: 'Thunderstore',
  canInstall: true,
  gameRef(profile) {
    return (profile && profile.thunderstoreCommunity) || null;
  },
  async fetchMods(ref, opts) {
    return client.fetchModList(ref, opts || {});
  },
};
```

- [ ] **Step 2: Create the registry**

Create `electron/ipc/modHubs/index.js`:

```js
const thunderstore = require('./thunderstore');

// All registered mod hub providers. Add a hub by dropping its module here.
function getProviders() {
  return [thunderstore];
}

module.exports = { getProviders };
```

- [ ] **Step 3: Syntax check**

Run: `node --check electron/ipc/modHubs/thunderstore.js` and `node --check electron/ipc/modHubs/index.js`
Expected: no output for both.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/modHubs/thunderstore.js electron/ipc/modHubs/index.js
git commit -m "feat(mods): Thunderstore provider + hub registry"
```

---

## Task 3: Rewire modManager.fetchModList

**Files:**
- Modify: `electron/ipc/modManager.js`

- [ ] **Step 1: Add imports**

In `electron/ipc/modManager.js`, after the existing `const { resolveInstallSet, deployTarget, hasBepInExPack } = require('./modResolver');` line, add:

```js
const { aggregateMods } = require('./modHubs/aggregate');
const { getProviders } = require('./modHubs');
```

- [ ] **Step 2: Replace fetchModList**

In `electron/ipc/modManager.js`, replace the entire existing `fetchModList` function:

```js
// Fetch + return the community package list (cached).
async function fetchModList(gameId, opts) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) return { community: null, packages: [] };
  const packages = await thunderstore.fetchModList(community, opts || {});
  return { community, packages };
}
```

with:

```js
// Aggregate this game's mods across all registered hub providers. Returns
// { packages, hubs } — each mod carries its hub tag.
async function fetchModList(gameId, opts) {
  const game = findGame(gameId);
  const profile = profiles.matchProfile(game);
  return aggregateMods(getProviders(), profile, opts || {});
}
```

(Leave `communityFor`, `installMod`, and the rest unchanged — the Thunderstore
install path still uses `communityFor` + `thunderstore.fetchModList`.)

- [ ] **Step 3: Syntax check**

Run: `node --check electron/ipc/modManager.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/modManager.js
git commit -m "feat(mods): fetchModList aggregates across hub providers"
```

---

## Task 4: Store slice (modHubs)

**Files:**
- Modify: `src/store/useAppStore.js`

- [ ] **Step 1: Rename the state field**

In `src/store/useAppStore.js`, replace the line:
```js
  modCommunity: null,
```
with:
```js
  modHubs: [], // [{ id, label }] hubs that map the open game
```

- [ ] **Step 2: Update loadMods**

In `src/store/useAppStore.js`, in the `loadMods` action, replace:
```js
      const [{ community, packages }, installed] = await Promise.all([
        api.fetchModList(gameId, { refresh }),
        api.getInstalledMods(gameId),
      ]);
      set({ modList: packages, modCommunity: community, installedMods: installed });
```
with:
```js
      const [{ hubs, packages }, installed] = await Promise.all([
        api.fetchModList(gameId, { refresh }),
        api.getInstalledMods(gameId),
      ]);
      set({ modList: packages, modHubs: hubs, installedMods: installed });
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/store/useAppStore.js
git commit -m "feat(mods): store tracks modHubs instead of modCommunity"
```

---

## Task 5: openExternal IPC

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: Add the handler**

In `electron/main.js`, inside `registerIpc()`, after the `unifia:checkModUpdates` handler, add (`shell` is already imported at the top of main.js):

```js
  handle('unifia:openExternal', (url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });
```

- [ ] **Step 2: Expose in preload**

In `electron/preload.js`, after the `checkModUpdates` line in the bridge object, add:

```js
  openExternal: (url) => invoke('unifia:openExternal', url),
```

- [ ] **Step 3: Syntax check**

Run: `node --check electron/main.js` and `node --check electron/preload.js`
Expected: no output for both.

- [ ] **Step 4: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat(mods): openExternal IPC for hub mod pages"
```

---

## Task 6: ModBrowseCard hub tag + install gating

**Files:**
- Modify: `src/components/ModBrowseCard.jsx`

- [ ] **Step 1: Add the hub tag next to the author line**

In `src/components/ModBrowseCard.jsx`, find the author/stats line:
```jsx
        <div className="text-xs text-neutral-500">
          by {mod.owner} · ▲ {mod.rating} · {fmtCount(mod.totalDownloads)} downloads
        </div>
```
and add a hub tag immediately ABOVE it (so the name row gains a hub chip). Replace the name `<div className="flex items-center gap-2">...</div>` block's closing by inserting the chip after the deprecated badge. Concretely, change:
```jsx
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-neutral-100">{mod.name}</span>
          {mod.deprecated && (
            <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">deprecated</span>
          )}
        </div>
```
to:
```jsx
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-neutral-100">{mod.name}</span>
          <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 ring-1 ring-border-default">
            {mod.hubLabel}
          </span>
          {mod.deprecated && (
            <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">deprecated</span>
          )}
        </div>
```

- [ ] **Step 2: Gate the install control on `canInstall`**

In `src/components/ModBrowseCard.jsx`, find the install control block (the `<select>` version picker + Install `<button>` inside `<div className="mt-2 flex items-center gap-2">`). Wrap it so non-installable hubs show a "View on <hub>" button instead. Replace the whole `<div className="mt-2 flex items-center gap-2">...</div>` block with:

```jsx
        <div className="mt-2 flex items-center gap-2">
          {mod.canInstall ? (
            <>
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
            </>
          ) : (
            <button
              onClick={() => mod.pageUrl && window.unifia.openExternal(mod.pageUrl)}
              disabled={!mod.pageUrl}
              className="rounded bg-neutral-700 px-3 py-1 text-xs text-neutral-100 transition hover:bg-surface-hover disabled:opacity-50"
            >
              View on {mod.hubLabel}
            </button>
          )}
        </div>
```

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ModBrowseCard.jsx
git commit -m "feat(mods): ModBrowseCard hub tag + install gating"
```

---

## Task 7: GameDetail empty state + hub filter/sort

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Swap modCommunity → modHubs + add hub filter state**

In `src/pages/GameDetail.jsx`:

1. Replace the selector line `const modCommunity = useAppStore((s) => s.modCommunity);` with:
```jsx
  const modHubs = useAppStore((s) => s.modHubs);
```
2. Add a hub-filter state near the other `useState` (e.g. after `const [category, setCategory] = useState('');`):
```jsx
  const [hub, setHub] = useState('');
```

- [ ] **Step 2: Add hub to the derived browse list**

In `src/pages/GameDetail.jsx`, the derived `browse` const currently is:
```jsx
  const browse = modList
    .filter((m) => !query || `${m.name} ${m.owner} ${m.latest?.description || ''}`.toLowerCase().includes(query.toLowerCase()))
    .filter((m) => !category || m.categories.includes(category))
    .sort((a, b) =>
      sort === 'rating' ? b.rating - a.rating
      : sort === 'name' ? a.name.localeCompare(b.name)
      : b.totalDownloads - a.totalDownloads
    );
```
Replace it with (adds a hub filter and a 'hub' sort case):
```jsx
  const browse = modList
    .filter((m) => !query || `${m.name} ${m.owner} ${m.latest?.description || ''}`.toLowerCase().includes(query.toLowerCase()))
    .filter((m) => !category || m.categories.includes(category))
    .filter((m) => !hub || m.hub === hub)
    .sort((a, b) =>
      sort === 'rating' ? b.rating - a.rating
      : sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'hub' ? a.hubLabel.localeCompare(b.hubLabel)
      : b.totalDownloads - a.totalDownloads
    );
```

- [ ] **Step 3: Update the header + empty-state condition**

In `src/pages/GameDetail.jsx`, replace the header subtitle line:
```jsx
          {modCommunity ? `Thunderstore: ${modCommunity}` : 'No mod source for this game'}
```
with:
```jsx
          {modHubs.length ? `Mods from: ${modHubs.map((h) => h.label).join(', ')}` : 'No mod source for this game'}
```
Then replace the empty-state branch condition `) : !modCommunity ? (` with:
```jsx
      ) : modHubs.length === 0 ? (
```

- [ ] **Step 4: Add the Hub sort option + Hub filter dropdown, and use `m.id` as the card key**

In `src/pages/GameDetail.jsx`, find the sort `<select>`:
```jsx
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="downloads">Most downloaded</option>
                  <option value="rating">Top rated</option>
                  <option value="name">Name</option>
                </select>
```
Replace it with (adds a Hub sort option + a Hub filter select right after it):
```jsx
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="downloads">Most downloaded</option>
                  <option value="rating">Top rated</option>
                  <option value="name">Name</option>
                  <option value="hub">Hub</option>
                </select>
                <select value={hub} onChange={(e) => setHub(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="">All hubs</option>
                  {modHubs.map((h) => (
                    <option key={h.id} value={h.id}>{h.label}</option>
                  ))}
                </select>
```

Then find the browse grid map:
```jsx
                {browse.map((m) => (
                  <ModBrowseCard key={m.fullName} game={game} mod={m} />
                ))}
```
and change the key to the composite id:
```jsx
                {browse.map((m) => (
                  <ModBrowseCard key={m.id} game={game} mod={m} />
                ))}
```

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(mods): GameDetail hub tag/filter/sort + modHubs empty state"
```

---

## Final verification

- [ ] **Unit tests**

Run: `node --test electron/ipc/modHubs/aggregate.test.js electron/ipc/modResolver.test.js electron/ipc/thunderstore.test.js`
Expected: all PASS.

- [ ] **Full build + syntax**

Run: `npm run build` (expect `✓ built`) and
`node --check electron/ipc/modManager.js electron/main.js electron/preload.js` (no output).

- [ ] **Manual smoke (`npm run dev`)**
  - Open REPO → GameDetail header reads "Mods from: Thunderstore"; Browse cards each show a "Thunderstore" hub chip.
  - The Hub filter lists "All hubs / Thunderstore"; selecting Thunderstore keeps the list; "Hub" appears in the sort dropdown.
  - Install / uninstall / enable / update still work exactly as before.
  - A game with no `thunderstoreCommunity` → "No mod source for this game".

---

## Notes for the implementer

- `electron/` is CommonJS; `src/` is ESM/JSX. Match the file you edit.
- Tasks 3 and 4 are a pair: after Task 3 the IPC returns `{ packages, hubs }`, and Task 4 updates the store to read it. The renderer is runtime-consistent again after Task 4 (each task still passes `node --check` / `npm run build`).
- Do NOT touch the install/stage/deploy path — `installMod`/`uninstallMod`/`setModEnabled`/`checkModUpdates`/`deployMods` stay Thunderstore `fullName`-keyed. Only browsing/aggregation changes.
- `require('./modHubs')` resolves to `electron/ipc/modHubs/index.js`.
