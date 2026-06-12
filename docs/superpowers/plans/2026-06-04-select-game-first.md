# Select a Game First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Library game cards clean, fully-clickable tiles that open the game's GameDetail view, and move the per-game Launch / Module / Remove actions into the GameDetail header.

**Architecture:** Pure UI re-placement — no new logic. GameCard loses its action buttons and becomes a click target; Home stops handling launch/module/remove; GameDetail gains a header actions row (Launch, Module, Remove) and renders the GameModuleModal in place; App passes a `goToModules` callback to GameDetail.

**Tech Stack:** React + Vite + Tailwind (renderer), zustand.

---

## File Structure

**Modify:**
- `src/components/GameCard.jsx` — clickable tile; remove action buttons + unused props.
- `src/pages/Home.jsx` — cards `onOpen` only; drop launch/notice/module/remove + modal.
- `src/pages/GameDetail.jsx` — header actions row (Launch/Module/Remove) + modal + notice.
- `src/App.jsx` — pass `goToModules` to GameDetail; drop it from Home.

No tests (UI-only change). Each task ends with `npm run build`.

---

## Task 1: GameCard — clickable tile, no action buttons

**Files:**
- Modify: `src/components/GameCard.jsx`

- [ ] **Step 1: Reduce the props**

Change the component signature from:
```jsx
export default function GameCard({
  game,
  profile,
  onLaunch,
  onRemove,
  onConfigure,
  onOpen,
  index = 0,
  view = 'list',
}) {
```
to:
```jsx
export default function GameCard({ game, profile, onOpen, index = 0, view = 'list' }) {
```

- [ ] **Step 2: Delete the `actions` element**

Remove this entire block (the shared Launch/Module/✕ buttons):
```jsx
  const actions = (
    <>
      <button
        onClick={() => onLaunch(game)}
        className={`rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 ${
          view === 'grid' ? 'flex-1' : ''
        }`}
      >
        Launch
      </button>
      <button
        onClick={() => onConfigure(game)}
        className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition hover:bg-surface-hover"
      >
        Module
      </button>
      <button
        onClick={() => onRemove(game)}
        title="Remove from library"
        className="flex items-center rounded bg-neutral-800 px-2 py-1.5 text-neutral-400 transition hover:bg-red-900/60 hover:text-red-300"
      >
        <Icon name="x" size={16} />
      </button>
    </>
  );
```

- [ ] **Step 3: Make the list-view card a click target + plain name + drop its actions**

In the list-view return, change the root `<div>` opening tag from:
```jsx
      <div
        className="card-mount flex items-center gap-3 rounded bg-card px-3 py-2.5 ring-1 ring-border-subtle transition-all duration-150 hover:ring-accent/40"
        style={{ animationDelay: `${delay}ms` }}
      >
```
to:
```jsx
      <div
        onClick={onOpen}
        className="card-mount flex cursor-pointer items-center gap-3 rounded bg-card px-3 py-2.5 ring-1 ring-border-subtle transition-all duration-150 hover:ring-accent/40"
        style={{ animationDelay: `${delay}ms` }}
      >
```
Change the list-view name from a button back to plain text:
```jsx
            <button onClick={onOpen} className="truncate text-left text-sm font-semibold text-neutral-100 hover:text-accent" title={game.name}>{game.name}</button>
```
to:
```jsx
            <h3 className="truncate text-sm font-semibold text-neutral-100" title={game.name}>{game.name}</h3>
```
Delete the list-view actions line:
```jsx
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
```

- [ ] **Step 4: Make the grid-view card a click target + plain name + drop its actions**

In the grid-view return, change the root `<div>` opening tag from:
```jsx
    <div
      className="card-mount group relative flex min-h-[150px] flex-col overflow-hidden rounded bg-card p-4 shadow-sm ring-1 ring-border-subtle transition-all duration-150 hover:-translate-y-px hover:ring-accent/40"
      style={{ animationDelay: `${delay}ms` }}
    >
```
to:
```jsx
    <div
      onClick={onOpen}
      className="card-mount group relative flex min-h-[150px] cursor-pointer flex-col overflow-hidden rounded bg-card p-4 shadow-sm ring-1 ring-border-subtle transition-all duration-150 hover:-translate-y-px hover:ring-accent/40"
      style={{ animationDelay: `${delay}ms` }}
    >
```
Change the grid-view name from a button back to plain text:
```jsx
            <button onClick={onOpen} className="truncate text-left text-base font-semibold text-neutral-100 hover:text-accent" title={game.name}>{game.name}</button>
```
to:
```jsx
            <h3 className="truncate text-base font-semibold text-neutral-100" title={game.name}>{game.name}</h3>
```
Delete the grid-view actions line:
```jsx
        <div className="mt-auto flex gap-2">{actions}</div>
```

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: `✓ built` with no errors. (Home still passes the now-ignored `onLaunch`/`onRemove`/`onConfigure` props — harmless until Task 2.)

- [ ] **Step 6: Commit**

```bash
git add src/components/GameCard.jsx
git commit -m "feat(ui): game cards are clickable tiles without action buttons"
```

---

## Task 2: Home — cards only open; remove launch/module/remove

**Files:**
- Modify: `src/pages/Home.jsx`

- [ ] **Step 1: Remove the GameModuleModal import**

Delete the line:
```jsx
import GameModuleModal from '../components/GameModuleModal.jsx';
```

- [ ] **Step 2: Trim the component signature + unused store selectors + state**

Change `export default function Home({ goToModules, onOpenGame }) {` to:
```jsx
export default function Home({ onOpenGame }) {
```
Delete these store-selector lines:
```jsx
  const removeGame = useAppStore((s) => s.removeGame);
  const launchGame = useAppStore((s) => s.launchGame);
```
Delete these state lines:
```jsx
  const [moduleGame, setModuleGame] = useState(null); // game whose module modal is open
  const [notice, setNotice] = useState(null);
```

- [ ] **Step 3: Delete the launch handler**

Remove the entire `handleLaunch` function:
```jsx
  async function handleLaunch(game) {
    try {
      const res = await launchGame(game.id);
      setNotice(
        res.alreadyRunning
          ? `${game.name} is already running.`
          : `Launched ${game.name}${res.deployedModule ? ` with ${res.deployedModule.module} ${res.deployedModule.version}` : ''}.`
      );
    } catch (err) {
      setNotice(`Launch failed: ${err.message}`);
    }
  }
```

- [ ] **Step 4: Delete the notice banner**

Remove this block:
```jsx
      {notice && (
        <div className="mb-4 rounded bg-neutral-800 px-4 py-2 text-sm text-neutral-200">
          {notice}
        </div>
      )}
```

- [ ] **Step 5: Pass only `onOpen` to GameCard**

In the `filteredGames.map(...)`, remove the three action props so the card reads:
```jsx
          {filteredGames.map((game, i) => (
            <GameCard
              key={game.id}
              index={i}
              view={view}
              game={game}
              profile={gameProfiles[game.id]}
              onOpen={() => onOpenGame(game)}
            />
          ))}
```

- [ ] **Step 6: Delete the GameModuleModal render**

Remove this block near the end of the component:
```jsx
      <GameModuleModal
        game={moduleGame}
        onClose={() => setModuleGame(null)}
        onManageAll={goToModules}
      />
```

- [ ] **Step 7: Build check**

Run: `npm run build`
Expected: `✓ built` with no errors. (Searching the file for `notice`, `moduleGame`, `launchGame`, `removeGame`, `handleLaunch`, `GameModuleModal` should return zero remaining references.)

- [ ] **Step 8: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "feat(ui): Home cards only open the game (actions moved to detail)"
```

---

## Task 3: GameDetail — header actions (Launch / Module / Remove)

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Import the module modal**

Add to the imports at the top of `src/pages/GameDetail.jsx`:
```jsx
import GameModuleModal from '../components/GameModuleModal.jsx';
```

- [ ] **Step 2: Extend the signature + add store selectors + state + handlers**

Change `export default function GameDetail({ game, onBack }) {` to:
```jsx
export default function GameDetail({ game, onBack, goToModules }) {
```
After the existing `const installMod = useAppStore((s) => s.installMod);` line, add:
```jsx
  const launchGame = useAppStore((s) => s.launchGame);
  const removeGame = useAppStore((s) => s.removeGame);
```
After the existing `const [hub, setHub] = useState('');` line, add:
```jsx
  const [moduleOpen, setModuleOpen] = useState(false);
  const [notice, setNotice] = useState(null);
```
Just after the `installBepInEx` function (before `return (`), add:
```jsx
  async function handleLaunch() {
    try {
      const res = await launchGame(game.id);
      setNotice(
        res.alreadyRunning
          ? `${game.name} is already running.`
          : `Launched ${game.name}${res.deployedModule ? ` with ${res.deployedModule.module} ${res.deployedModule.version}` : ''}.`
      );
    } catch (err) {
      setNotice(`Launch failed: ${err.message}`);
    }
  }
  async function handleRemove() {
    await removeGame(game.id);
    onBack();
  }
```

- [ ] **Step 3: Render the header actions row + notice**

In the returned JSX, find the title block:
```jsx
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-100">{game.name}</h1>
        <p className="text-sm text-neutral-500">
          {modHubs.length ? `Mods from: ${modHubs.map((h) => h.label).join(', ')}` : 'No mod source for this game'}
        </p>
      </div>
```
Immediately AFTER that closing `</div>`, insert:
```jsx
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
```

- [ ] **Step 4: Render the module modal as the last child**

As the LAST child of the component's top-level returned `<div>` (immediately before its closing `</div>` and the `);`), add:
```jsx
      <GameModuleModal
        game={moduleOpen ? game : null}
        onClose={() => setModuleOpen(false)}
        onManageAll={goToModules}
      />
```
(`GameModuleModal` returns `null` when `game` is null, so passing `moduleOpen ? game : null` shows/hides it.)

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(ui): GameDetail header Launch/Module/Remove actions"
```

---

## Task 4: App — pass goToModules to GameDetail

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Update the GameDetail + Home renders**

In `src/App.jsx`, change the GameDetail branch:
```jsx
      return <GameDetail game={detailGame} onBack={() => setDetailGame(null)} />;
```
to:
```jsx
      return (
        <GameDetail
          game={detailGame}
          onBack={() => setDetailGame(null)}
          goToModules={() => { setDetailGame(null); setPage('modules'); }}
        />
      );
```
And change the Home render:
```jsx
        return <Home goToModules={() => setPage('modules')} onOpenGame={setDetailGame} />;
```
to:
```jsx
        return <Home onOpenGame={setDetailGame} />;
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat(ui): App passes goToModules to GameDetail"
```

---

## Final verification

- [ ] **Full build**

Run: `npm run build`
Expected: `✓ built` with no errors.

- [ ] **Manual smoke (`npm run dev`)**
  - Library: cards have no buttons; hovering shows the ring + pointer cursor; clicking anywhere on a card opens its GameDetail.
  - GameDetail header: **Launch** runs the game (shows the inline notice), **Module** opens the loader-config modal, **Remove** deletes the game and returns to the library (card gone).
  - The BepInEx banner, Installed | Browse tabs, hub filter/sort all still work.
  - Search / filters / view toggle / Rescan / Add game on the Library page are unchanged.

---

## Notes for the implementer

- UI-only change; no new pure logic, so no unit tests — `npm run build` + the manual smoke are the gates.
- Tasks run sequentially; between Task 2 and Task 3 commits, launching is momentarily unavailable (cards lost it, detail header not added yet). The feature is complete and coherent after Task 4.
- `Icon` is already imported in both GameCard.jsx and GameDetail.jsx.
