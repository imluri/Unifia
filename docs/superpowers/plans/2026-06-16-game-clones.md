# Multiple Game Clones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users keep multiple installs ("clones") of the same game as distinct, independently-managed library entries, with unique ids, an optional nickname, and a clone indicator.

**Architecture:** Manual game ids become immutable random tokens (`m_<hex>`) instead of `store:name`, so same-named installs no longer collide. The array/id logic is extracted into a pure, testable module (`gameLogic.js`) with a thin store wrapper in `gameScanner.js`, mirroring the existing `presetLogic.js` pattern. Clone detection is a pure renderer module (`src/lib/clones.js`). The UI gains a clone badge, a launch note, and an inline rename affordance.

**Tech Stack:** Electron (CommonJS main), `node:test` + `node:assert` for unit tests (run via `node --test <file>`), React + zustand renderer.

**Reference:** Spec at `docs/superpowers/specs/2026-06-16-game-clones-design.md`.

---

### Task 1: Pure game-logic module (unique ids + array ops)

**Files:**
- Create: `electron/ipc/gameLogic.js`
- Test: `electron/ipc/gameLogic.test.js`

- [ ] **Step 1: Write the failing test**

Create `electron/ipc/gameLogic.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('./gameLogic');

test('newManualId formats m_ + hex from random bytes', () => {
  const id = G.newManualId(() => Buffer.from([0x3f, 0x9a, 0x2c, 0x81, 0xd0, 0x44]));
  assert.strictEqual(id, 'm_3f9a2c81d044');
});

test('appendManualGame adds a new entry with a fresh id and manual:true', () => {
  const games = G.appendManualGame([], { name: 'REPO', executablePath: 'C:/a/REPO.exe' }, () => 'm_1');
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].id, 'm_1');
  assert.strictEqual(games[0].manual, true);
});

test('appendManualGame keeps same-name different-path installs as distinct clones', () => {
  let games = G.appendManualGame([], { name: 'REPO', executablePath: 'C:/a/REPO.exe' }, () => 'm_1');
  games = G.appendManualGame(games, { name: 'REPO', executablePath: 'C:/b/REPO.exe' }, () => 'm_2');
  assert.strictEqual(games.length, 2);
  assert.deepStrictEqual(games.map((g) => g.id), ['m_1', 'm_2']);
});

test('appendManualGame re-adding the same executablePath updates in place (keeps id)', () => {
  let games = G.appendManualGame([], { name: 'REPO', executablePath: 'C:/a/REPO.exe', version: '1' }, () => 'm_1');
  games = G.appendManualGame(games, { name: 'REPO', executablePath: 'C:/a/REPO.exe', version: '2' }, () => 'm_2');
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].id, 'm_1');
  assert.strictEqual(games[0].version, '2');
});

test('renameGameIn sets displayName', () => {
  const games = [{ id: 'm_1', name: 'REPO' }];
  const out = G.renameGameIn(games, 'm_1', 'REPO (cracked)');
  assert.strictEqual(out[0].displayName, 'REPO (cracked)');
});

test('renameGameIn with blank input clears displayName', () => {
  const games = [{ id: 'm_1', name: 'REPO', displayName: 'old' }];
  const out = G.renameGameIn(games, 'm_1', '   ');
  assert.strictEqual('displayName' in out[0], false);
});

test('renameGameIn throws on unknown id', () => {
  assert.throws(() => G.renameGameIn([], 'nope', 'x'), /Unknown game: nope/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test electron/ipc/gameLogic.test.js`
Expected: FAIL — `Cannot find module './gameLogic'`.

- [ ] **Step 3: Write the minimal implementation**

Create `electron/ipc/gameLogic.js`:

```js
// Pure logic for the manual-game library: id generation and array operations.
// Kept free of electron-store / fs so it can be unit-tested directly
// (gameScanner.js is the thin store-backed wrapper around these). See the
// game-clones spec: manual ids are immutable random tokens so that two installs
// of the same game ("clones") never collide on a store:name id.

// Generate an immutable id for a manually-added install. Random — not derived
// from name or path — so the id survives Rename and Change-folder, and two
// same-named installs get distinct ids. `randomBytes` is injectable for tests.
function newManualId(randomBytes) {
  return `m_${randomBytes(6).toString('hex')}`;
}

// Add a fully-built manual game record to `games`. If a manual entry with the
// same executablePath already exists, update it in place (re-adding the exact
// same install is idempotent and keeps its id). Otherwise append with a fresh
// id from makeId(). Never overwrites by name, so same-name clones coexist.
function appendManualGame(games, game, makeId) {
  const existing = games.find(
    (g) => g.manual && g.executablePath === game.executablePath,
  );
  if (existing) {
    const updated = { ...existing, ...game, id: existing.id, manual: true };
    return games.map((g) => (g.id === existing.id ? updated : g));
  }
  return [...games, { ...game, id: makeId(), manual: true }];
}

// Set or clear a game's optional display label. Blank/whitespace clears it.
// Throws if the id is absent (mirrors updateGamePath).
function renameGameIn(games, gameId, displayName) {
  const idx = games.findIndex((g) => g.id === gameId);
  if (idx === -1) throw new Error(`Unknown game: ${gameId}`);
  const label = (displayName || '').trim();
  const updated = { ...games[idx] };
  if (label) updated.displayName = label;
  else delete updated.displayName;
  return games.map((g, i) => (i === idx ? updated : g));
}

module.exports = { newManualId, appendManualGame, renameGameIn };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test electron/ipc/gameLogic.test.js`
Expected: PASS — 7 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/gameLogic.js electron/ipc/gameLogic.test.js
git commit -m "feat(games): pure logic for unique manual ids + rename"
```

---

### Task 2: Wire gameScanner to gameLogic and add renameGame

**Files:**
- Modify: `electron/ipc/gameScanner.js:398-423` (rewrite `addManualGame`), add `renameGame`, update `require`s and `module.exports`.

- [ ] **Step 1: Add the requires**

At the top of `electron/ipc/gameScanner.js`, after the existing `const os = require('os');` line, add:

```js
const crypto = require('crypto');
const gameLogic = require('./gameLogic');
```

- [ ] **Step 2: Rewrite `addManualGame` to use unique ids**

Replace the body of `addManualGame` (currently `electron/ipc/gameScanner.js:399-423`) with:

```js
function addManualGame({ name, executablePath, version, store: storeName }) {
  if (!name || !executablePath) {
    throw new Error('Manual game requires at least a name and executable path');
  }
  const games = store.get('games') || [];
  const installPath = path.dirname(executablePath);
  const engineInfo = detectEngine(installPath);
  const game = {
    name,
    version: version || detectVersion(installPath),
    executablePath,
    store: storeName || 'custom',
    installPath,
    engine: engineInfo.engine,
    engineName: engineInfo.engineName,
    unityBackend: engineInfo.backend,
  };
  const next = gameLogic.appendManualGame(games, game, () =>
    gameLogic.newManualId((n) => crypto.randomBytes(n)),
  );
  store.set('games', next);
  // Return the record that was actually stored (matched by executablePath).
  return next.find((g) => g.executablePath === executablePath);
}
```

- [ ] **Step 3: Add `renameGame` after `updateGamePath`**

Immediately after the `updateGamePath` function (ends at `electron/ipc/gameScanner.js:453`), add:

```js
// Set or clear a game's display label (nickname). Used to disambiguate clones.
function renameGame(gameId, displayName) {
  const games = store.get('games') || [];
  const next = gameLogic.renameGameIn(games, gameId, displayName);
  store.set('games', next);
  return next.find((g) => g.id === gameId);
}
```

- [ ] **Step 4: Export `renameGame`**

In the `module.exports` block (currently `electron/ipc/gameScanner.js:455-463`), add `renameGame,` to the list:

```js
module.exports = {
  scanGames,
  scanSteamGames,
  getSteamLibraries,
  addManualGame,
  removeGame,
  updateGamePath,
  renameGame,
  detectVersion,
};
```

- [ ] **Step 5: Verify the existing suite still passes**

Run: `node --test electron/ipc/gameLogic.test.js`
Expected: PASS (the wrapper consumes the same logic; gameScanner has no direct test, so this confirms the logic module is intact).

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/gameScanner.js
git commit -m "feat(games): unique ids for manual adds + renameGame wrapper"
```

---

### Task 3: Expose renameGame through IPC, preload, and the store

**Files:**
- Modify: `electron/main.js:119` (add handler after `updateGamePath`)
- Modify: `electron/preload.js:43` (add `renameGame` after `updateGamePath`)
- Modify: `src/store/useAppStore.js:162` (add `renameGame` action after `updateGamePath`)

- [ ] **Step 1: Register the IPC handler**

In `electron/main.js`, immediately after the `unifia:updateGamePath` handler (line 119), add:

```js
  handle('unifia:renameGame', (gameId, displayName) => gameScanner.renameGame(gameId, displayName));
```

- [ ] **Step 2: Expose it in preload**

In `electron/preload.js`, immediately after the `updateGamePath` line (line 43), add:

```js
  renameGame: (gameId, displayName) => invoke('unifia:renameGame', gameId, displayName),
```

- [ ] **Step 3: Add the store action**

In `src/store/useAppStore.js`, immediately after the `updateGamePath` action (closes at line 162), add:

```js
  async renameGame(gameId, displayName) {
    const updated = await api.renameGame(gameId, displayName);
    set((s) => ({ games: s.games.map((g) => (g.id === gameId ? updated : g)) }));
    return updated;
  },
```

- [ ] **Step 4: Verify the renderer builds**

Run: `npm run build`
Expected: Vite build completes with no errors (the new action is valid JS and used nowhere yet).

- [ ] **Step 5: Commit**

```bash
git add electron/main.js electron/preload.js src/store/useAppStore.js
git commit -m "feat(games): wire renameGame through IPC, preload, store"
```

---

### Task 4: Clone detection module (renderer)

**Files:**
- Create: `src/lib/clones.js`
- Test: `src/lib/clones.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/clones.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { cloneKey, findCloneIds } = require('./clones.js');

test('cloneKey normalizes name and exe basename', () => {
  assert.strictEqual(
    cloneKey({ name: ' REPO ', executablePath: 'C:/Games/X/REPO.exe' }),
    'repo repo.exe',
  );
});

test('findCloneIds flags same name + same exe across different paths', () => {
  const games = [
    { id: 'a', name: 'REPO', executablePath: 'C:/x/REPO.exe' },
    { id: 'b', name: 'REPO', executablePath: 'D:/y/REPO.exe' },
  ];
  const ids = findCloneIds(games);
  assert.strictEqual(ids.has('a'), true);
  assert.strictEqual(ids.has('b'), true);
  assert.strictEqual(ids.size, 2);
});

test('findCloneIds ignores different exe basenames', () => {
  const games = [
    { id: 'a', name: 'REPO', executablePath: 'C:/x/REPO.exe' },
    { id: 'b', name: 'REPO', executablePath: 'D:/y/Game.exe' },
  ];
  assert.strictEqual(findCloneIds(games).size, 0);
});

test('findCloneIds returns empty for a single entry', () => {
  assert.strictEqual(findCloneIds([{ id: 'a', name: 'REPO', executablePath: 'C:/x/REPO.exe' }]).size, 0);
});

test('a nickname does not change clone membership (detection uses real name)', () => {
  const games = [
    { id: 'a', name: 'REPO', displayName: 'REPO (cracked)', executablePath: 'C:/x/REPO.exe' },
    { id: 'b', name: 'REPO', executablePath: 'D:/y/REPO.exe' },
  ];
  assert.strictEqual(findCloneIds(games).size, 2);
});

test('cloneKey tolerates missing fields', () => {
  assert.strictEqual(cloneKey({}), ' ');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/lib/clones.test.js`
Expected: FAIL — `Cannot find module './clones.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/clones.js`. Use CommonJS `module.exports` exactly like the sibling `src/lib/toasts.js` — Vite interops it so the renderer's `import { findCloneIds }` still works, and `node --test` can `require()` it:

```js
// Detect "clones": two or more library entries that refer to the same
// underlying game (e.g. a cracked and a legit install of REPO). Signal is the
// real game name + executable basename — NOT the display nickname — so renaming
// one clone never splits the group. Pure so it can be unit-tested.

function cloneKey(game) {
  const name = (game.name || '').trim().toLowerCase();
  const exe = ((game.executablePath || '').split(/[\\/]/).pop() || '').toLowerCase();
  return `${name} ${exe}`;
}

// Returns a Set of game ids that have at least one same-key sibling.
function findCloneIds(games) {
  const byKey = new Map();
  for (const g of games) {
    const k = cloneKey(g);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(g.id);
  }
  const clones = new Set();
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) clones.add(id);
  }
  return clones;
}

module.exports = { cloneKey, findCloneIds };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test src/lib/clones.test.js`
Expected: PASS — 6 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clones.js src/lib/clones.test.js
git commit -m "feat(games): clone-detection helper for the library"
```

---

### Task 5: Clone badge, launch note, and nickname display on GameCard

**Files:**
- Modify: `src/components/GameCard.jsx`

- [ ] **Step 1: Add a clone badge component and accept the `isClone` prop**

In `src/components/GameCard.jsx`, after the `StoreBadge` function (ends line 38), add:

```jsx
function CloneBadge() {
  return (
    <span
      className="inline-flex items-center rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300 ring-1 ring-amber-500/30"
      title="Another install of this game exists in your library"
    >
      clone
    </span>
  );
}
```

- [ ] **Step 2: Thread the new prop and a display label through the signature**

Change the component signature (line 50) from:

```jsx
export default function GameCard({ game, profile, onOpen, index = 0, view = 'list' }) {
```

to:

```jsx
export default function GameCard({ game, profile, onOpen, index = 0, view = 'list', isClone = false }) {
  const label = game.displayName || game.name;
```

(Insert the `label` line as the first line of the function body, before `const art = ...`.)

- [ ] **Step 3: Use `label` and show the badge + note in list view**

In the list-view block, replace the title/badge row (lines 95-101) with:

```jsx
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-neutral-100" title={game.name}>{label}</h3>
            <StoreBadge store={game.store} />
            {isClone && <CloneBadge />}
          </div>
          <p className="truncate text-xs text-neutral-500" title={game.installPath}>
            {game.installPath}
          </p>
          {isClone && game.store === 'steam' && (
            <p className="truncate text-[11px] text-amber-300/70">
              Another install exists — Steam may launch the wrong copy.
            </p>
          )}
```

- [ ] **Step 4: Use `label` and show the badge + note in grid view**

In the grid-view block, replace the title/badge group (lines 143-147) with:

```jsx
            <h3 className="truncate text-base font-semibold text-neutral-100" title={game.name}>{label}</h3>
            <span className="mt-0.5 inline-flex items-center gap-1.5">
              <StoreBadge store={game.store} />
              {isClone && <CloneBadge />}
            </span>
```

Then replace the install-path paragraph (lines 156-161) with:

```jsx
        <p
          className={`mb-1 truncate text-xs ${banner ? 'text-neutral-300' : 'text-neutral-500'}`}
          title={game.installPath}
        >
          {game.installPath}
        </p>
        {isClone && game.store === 'steam' && (
          <p className="mb-4 truncate text-[11px] text-amber-300/80">
            Another install exists — Steam may launch the wrong copy.
          </p>
        )}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/GameCard.jsx
git commit -m "feat(ui): clone badge, launch note, and nickname on GameCard"
```

---

### Task 6: Compute clones in Home and pass to each card

**Files:**
- Modify: `src/pages/Home.jsx` (import, compute set, pass prop at line ~443)

- [ ] **Step 1: Import the helper**

In `src/pages/Home.jsx`, add to the imports near the top (after the `GameCard` import on line 2):

```jsx
import { findCloneIds } from '../lib/clones.js';
```

- [ ] **Step 2: Compute the clone-id set**

Inside the `Home` component body, before the `return`/render that maps games to `GameCard`, add a memo. Find the variable holding the rendered game list (the array `.map`ped at line 443 — it renders `<GameCard key={game.id} ... />`). Immediately before that JSX block, add:

```jsx
  const cloneIds = React.useMemo(() => findCloneIds(games), [games]);
```

Use whichever games array is in scope at the map site (it is the store's `games`). If `React` is not imported as a namespace, use the existing hook import style already present in the file (e.g. `useMemo` from React) — match the file's convention.

- [ ] **Step 3: Pass `isClone` to the card**

At the `<GameCard ... />` usage (around line 443-444), add the prop:

```jsx
            <GameCard
              key={game.id}
              isClone={cloneIds.has(game.id)}
```

(Keep all existing props — `game`, `profile`, `onOpen`, `index`, `view` — exactly as they are; only add the `isClone` line.)

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "feat(ui): flag clones in the Home library grid"
```

---

### Task 7: Inline rename affordance in GameDetail

**Files:**
- Modify: `src/pages/GameDetail.jsx` (header at lines 119-133; read live game; add rename UI)

- [ ] **Step 1: Pull the live game record and the rename action**

In `src/pages/GameDetail.jsx`, near the other store selectors (the `updateGamePath` selector is at line 29), add:

```jsx
  const renameGame = useAppStore((s) => s.renameGame);
  const liveGame = useAppStore((s) => s.games.find((g) => g.id === game.id)) || game;
```

- [ ] **Step 2: Add rename local state**

Near the top of the component body (with the other `useState` hooks), add:

```jsx
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
```

Ensure `useState` is imported (the file already imports React hooks; if `useState` is not in the import, add it).

- [ ] **Step 3: Add a save handler**

With the other handlers in the component (e.g. near `handleChangeFolder`), add:

```jsx
  async function saveName() {
    const draft = nameDraft.trim();
    await renameGame(game.id, draft); // blank clears the nickname
    setEditingName(false);
  }
```

- [ ] **Step 4: Replace the header title block to show the label and a rename control**

Replace the header `<div className="mb-5">` block (lines 128-133) with:

```jsx
      <div className="mb-5">
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              placeholder={liveGame.name}
              className="rounded bg-neutral-800 px-2 py-1 text-2xl font-bold text-neutral-100 ring-1 ring-border-default focus:outline-none focus:ring-accent/50"
            />
            <button onClick={saveName} className="rounded bg-accent/20 px-2 py-1 text-sm text-accent hover:bg-accent/30">Save</button>
            <button onClick={() => setEditingName(false)} className="rounded px-2 py-1 text-sm text-neutral-400 hover:text-neutral-200">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-neutral-100" title={liveGame.name}>
              {liveGame.displayName || liveGame.name}
            </h1>
            {liveGame.manual && (
              <button
                onClick={() => { setNameDraft(liveGame.displayName || ''); setEditingName(true); }}
                className="text-neutral-500 hover:text-neutral-200"
                title="Rename (set a label to tell clones apart)"
              >
                <Icon name="pencil" size={16} />
              </button>
            )}
          </div>
        )}
        <p className="text-sm text-neutral-500">
          {modHubs.length ? `Mods from: ${modHubs.map((h) => h.label).join(', ')}` : 'No mod source for this game'}
        </p>
      </div>
```

Note: if the `Icon` set has no `pencil` glyph, use `edit` or `settings` — check `src/components/Icon.jsx` for an available name and use that.

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(ui): inline rename for game clones in GameDetail"
```

---

### Task 8: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `node --test electron/ipc/gameLogic.test.js src/lib/clones.test.js`
Expected: PASS — all tests green (7 + 6).

- [ ] **Step 2: Run the existing suite to confirm no regressions**

Run: `node --test electron/ipc/*.test.js electron/utils/*.test.js src/lib/*.test.js`
Expected: PASS — all pre-existing tests still green.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 4: Manual smoke test (document results, do not automate)**

Launch `npm run dev` and verify:
- Add two installs both named "REPO" at different folders → both appear (no overwrite), each shows its own install path and a "clone" badge.
- Open one, click the pencil, set "REPO (cracked)", Save → the header and card show the label; the other clone is unaffected; art is unchanged.
- Clear the label (Save with empty field) → reverts to the real name.
- Steam-store clones show the "Steam may launch the wrong copy" note; custom-store clones do not.

- [ ] **Step 5: Commit (if any doc/notes added)**

No code changes expected here. If the manual test surfaced an issue, return to the relevant task; otherwise this task is complete with no commit.
