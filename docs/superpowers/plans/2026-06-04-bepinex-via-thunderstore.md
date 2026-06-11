# BepInEx via Thunderstore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat BepInEx as a Thunderstore package (BepInExPack) deployed through the existing mod path: skip the GitHub BepInEx copy on launch when BepInExPack is staged, add a one-click "Install BepInEx" in GameDetail, and make BepInEx detection recognize a staged BepInExPack.

**Architecture:** A pure predicate `hasBepInExPack(modState)` lives in the already-tested `modResolver.js`; thin store-reading wrappers use it in `modManager` (launcher skip) and `pluginManager` (detection). The GameDetail view gains a banner that installs the community's BepInExPack via the existing `installMod` flow.

**Tech Stack:** Electron (CommonJS main), React + Vite + Tailwind (renderer), zustand, Node `node:test`.

---

## File Structure

**Modify:**
- `electron/ipc/modResolver.js` — add pure `hasBepInExPack(modState)`.
- `electron/ipc/modResolver.test.js` — tests for it.
- `electron/ipc/modManager.js` — add `hasEnabledBepInExPack(gameId)` wrapper + export.
- `electron/ipc/launcher.js` — skip `deployModule` when BepInExPack is staged.
- `electron/ipc/pluginManager.js` — OR detection with staged BepInExPack.
- `src/pages/GameDetail.jsx` — one-click "Install BepInEx" banner.

---

## Task 1: Pure `hasBepInExPack` predicate

**Files:**
- Modify: `electron/ipc/modResolver.js`
- Modify: `electron/ipc/modResolver.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `electron/ipc/modResolver.test.js` (and add `hasBepInExPack` to the existing destructured `require('./modResolver')` import at the top of the file):

```js
test('hasBepInExPack: true only when an enabled BepInExPack entry exists', () => {
  assert.strictEqual(
    hasBepInExPack({ 'BepInEx-BepInExPack': { enabled: true }, 'Owner-Mod': { enabled: true } }),
    true
  );
  assert.strictEqual(hasBepInExPack({ 'denikson-BepInExPack_Valheim': { enabled: true } }), true);
  // disabled BepInExPack does not count
  assert.strictEqual(hasBepInExPack({ 'BepInEx-BepInExPack': { enabled: false } }), false);
  // unrelated mods only
  assert.strictEqual(hasBepInExPack({ 'Owner-Mod': { enabled: true } }), false);
  // empty / missing
  assert.strictEqual(hasBepInExPack({}), false);
  assert.strictEqual(hasBepInExPack(null), false);
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `node --test electron/ipc/modResolver.test.js`
Expected: FAIL — `hasBepInExPack is not a function` (or undefined).

- [ ] **Step 3: Implement the predicate**

In `electron/ipc/modResolver.js`, add this function before the `module.exports` line:

```js
// True when the game's mod state contains an enabled BepInExPack (the loader).
// modState maps fullName -> { enabled, ... }.
function hasBepInExPack(modState) {
  return Object.entries(modState || {}).some(
    ([fullName, m]) => m && m.enabled && /bepinexpack/i.test(fullName)
  );
}
```

Add `hasBepInExPack` to the `module.exports` object (which currently exports `parseDependency, resolveInstallSet, findVersion, deployTarget`).

- [ ] **Step 4: Run the test, verify it passes**

Run: `node --test electron/ipc/modResolver.test.js`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/modResolver.js electron/ipc/modResolver.test.js
git commit -m "feat(mods): pure hasBepInExPack predicate"
```

---

## Task 2: modManager wrapper + launcher skip

**Files:**
- Modify: `electron/ipc/modManager.js`
- Modify: `electron/ipc/launcher.js`

- [ ] **Step 1: Add the wrapper to modManager**

In `electron/ipc/modManager.js`:

1. Update the modResolver import line `const { resolveInstallSet, deployTarget } = require('./modResolver');` to also pull in the predicate:
```js
const { resolveInstallSet, deployTarget, hasBepInExPack } = require('./modResolver');
```
2. Add this function (anywhere among the other functions, e.g. right after `getInstalledMods`):
```js
// Does this game have an enabled BepInExPack staged? (i.e. the Thunderstore mod
// system provides the loader, so the GitHub BepInEx copy should be skipped.)
function hasEnabledBepInExPack(gameId) {
  return hasBepInExPack(modsState(gameId));
}
```
3. Add `hasEnabledBepInExPack` to the `module.exports` object.

- [ ] **Step 2: Skip the GitHub BepInEx deploy in the launcher**

In `electron/ipc/launcher.js`, find the line in `launchGame`:
```js
  const deployed = deployModule(game);
```
Replace it with:
```js
  // If a Thunderstore BepInExPack is staged+enabled, it provides the loader
  // (deployMods copies it to the game root below) — skip the GitHub BepInEx copy
  // so we never install two overlapping loaders.
  const deployed = modManager.hasEnabledBepInExPack(game.id) ? null : deployModule(game);
```
(`modManager` is already required at the top of launcher.js. The existing
`deployMods` call a few lines below stays as-is.)

- [ ] **Step 3: Syntax check**

Run: `node --check electron/ipc/modManager.js` and `node --check electron/ipc/launcher.js`
Expected: no output for both.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/modManager.js electron/ipc/launcher.js
git commit -m "feat(mods): skip GitHub BepInEx deploy when BepInExPack is staged"
```

---

## Task 3: pluginManager detection recognizes staged BepInExPack

**Files:**
- Modify: `electron/ipc/pluginManager.js`

- [ ] **Step 1: OR the detection with the staged check**

In `electron/ipc/pluginManager.js`:

1. Add a require near the top (after the existing requires such as `const { store } = require('../store');`):
```js
const modManager = require('./modManager');
```
(No circular require: `modManager` does not require `pluginManager`.)

2. In `getPluginStatus(gameId)`, change the `bepinexInstalled` line in the returned object from:
```js
    bepinexInstalled: bepinexInstalled(game.installPath),
```
to:
```js
    // BepInEx counts as present if it's on disk OR a BepInExPack is staged
    // (it deploys on launch), so the connector-plugin modal won't falsely nag.
    bepinexInstalled: bepinexInstalled(game.installPath) || modManager.hasEnabledBepInExPack(gameId),
```

- [ ] **Step 2: Syntax check**

Run: `node --check electron/ipc/pluginManager.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/pluginManager.js
git commit -m "feat(mods): plugin status counts staged BepInExPack as installed"
```

---

## Task 4: One-click "Install BepInEx" in GameDetail

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Add the store action + local state**

In `src/pages/GameDetail.jsx`:

1. After the existing `const installedMods = useAppStore((s) => s.installedMods);` line, add:
```jsx
  const installMod = useAppStore((s) => s.installMod);
```
2. With the other `useState` declarations (near `const [tab, setTab] = useState('installed');`), add:
```jsx
  const [bepBusy, setBepBusy] = useState(false);
```

- [ ] **Step 2: Add derived BepInEx state + install handler**

Just before the component's `return` statement (next to the existing `categories`/`browse` consts), add:
```jsx
  const hasBepInEx = installedMods.some((m) => /bepinexpack/i.test(m.fullName));
  const bepPkg = modList.find((m) => /bepinexpack/i.test(m.fullName));
  async function installBepInEx() {
    if (!bepPkg) return;
    setBepBusy(true);
    try {
      await installMod(game.id, bepPkg.fullName);
    } finally {
      setBepBusy(false);
    }
  }
```

- [ ] **Step 3: Render the banner**

Inside the `modCommunity` branch (the `<>...</>` fragment that holds the tabs), add this banner as the FIRST child, immediately before the tab toggle `<div className="mb-5 inline-flex rounded-lg bg-neutral-800 p-1">`. The `!modsLoading` guard avoids briefly flashing "not available" before the list finishes loading (`modsLoading` is already read in this component):
```jsx
          {!modsLoading && !hasBepInEx && (
            <div className="mb-4 rounded border border-yellow-900/40 bg-yellow-900/15 px-4 py-3 text-sm">
              {bepPkg ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-yellow-300">
                    BepInEx isn&apos;t installed for this game yet — mods need it to load.
                  </span>
                  <button
                    onClick={installBepInEx}
                    disabled={bepBusy}
                    className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
                  >
                    {bepBusy ? 'Installing…' : 'Install BepInEx'}
                  </button>
                </div>
              ) : (
                <span className="text-neutral-400">
                  BepInEx isn&apos;t available in this Thunderstore community.
                </span>
              )}
            </div>
          )}
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(mods): one-click Install BepInEx in GameDetail"
```

---

## Final verification

- [ ] **Unit tests**

Run: `node --test electron/ipc/modResolver.test.js electron/ipc/thunderstore.test.js`
Expected: all PASS (the modResolver file now has 6 tests).

- [ ] **Full build + syntax**

Run: `npm run build` (expect `✓ built`) and
`node --check electron/ipc/modManager.js electron/ipc/launcher.js electron/ipc/pluginManager.js` (no output).

- [ ] **Manual smoke (in `npm run dev`)**
  - Open a Thunderstore-mapped game (REPO) → GameDetail shows the yellow "BepInEx isn't installed" banner with an **Install BepInEx** button.
  - Click it → BepInExPack installs (Installed tab shows it). Banner disappears.
  - Open the game's connector-plugin modal → it no longer nags that BepInEx is missing.
  - Launch → confirm a single BepInEx loader in the game folder (no GitHub-module overlay alongside the BepInExPack one).

---

## Notes for the implementer

- `electron/` is CommonJS; `src/` is ESM/JSX. Match the file you edit.
- The predicate is intentionally pure and lives in `modResolver.js` so it's unit-testable without the Electron runtime; the store-reading wrappers (`modManager`, `pluginManager`) are thin.
- Do NOT remove or change the GitHub BepInEx Modules flow — it remains the loader source for games with no staged BepInExPack (e.g. non-Thunderstore games).
