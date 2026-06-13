# Design: Select a Game First

**Date:** 2026-06-04
**Status:** Approved

## Summary

Change the Library so a game card is a **selectable tile** (click anywhere opens
the game's GameDetail view) rather than carrying inline action buttons. The
per-game actions — **Launch**, **Module** (loader config), **Remove** — move into
the GameDetail header, which becomes the full game page (Launch + module config +
mods, all in one place).

## Goal

- Library cards: clean, fully-clickable; no inline Launch/Module/✕.
- GameDetail: a header actions row with Launch (primary), Module, Remove — above
  the existing BepInEx banner and Installed | Browse mod tabs.

## Changes

### `src/components/GameCard.jsx`
- Make the whole card the click target (`onClick={onOpen}`, `cursor-pointer`),
  keeping the existing hover ring as the affordance. The game name reverts from a
  `<button>` to plain text (the tile is the click target).
- Remove the actions row (the Launch / Module / ✕ buttons) from BOTH the list and
  grid layouts, and the shared `actions` element.
- Props reduce to `{ game, profile, index, view, onOpen }` — drop `onLaunch`,
  `onConfigure`, `onRemove`. Keep icon/badges/path rendering.
- Stop click-through: the card click opens the game; nothing else on the card is
  interactive now.

### `src/pages/Home.jsx`
- Pass only `onOpen={() => onOpenGame(game)}` to `GameCard`.
- Remove launch handling (`handleLaunch`), the launch-result `notice` banner, the
  `removeGame` wiring on cards, and the `GameModuleModal` render + `moduleGame`
  state — these move to GameDetail. Search / filters / view toggle / rescan / add
  stay unchanged.

### `src/pages/GameDetail.jsx` (becomes the game page)
- Add a header **actions row** under the title:
  - **Launch** (primary) — calls the store `launchGame(game.id)`, shows a small
    inline notice ("Launched … / already running / Launch failed: …"), matching
    Home's old behavior.
  - **Module** — opens the existing `GameModuleModal` for this game (local
    `moduleOpen` state; render `<GameModuleModal game={game} onClose=… onManageAll=…/>`).
  - **Remove** — calls store `removeGame(game.id)`, then `onBack()` (the game no
    longer exists, so return to the library).
- Existing content (BepInEx banner, Installed | Browse tabs, hub filter/sort)
  stays below, unchanged.

### `src/App.jsx`
- Pass GameDetail a `goToModules` callback (`() => { setDetailGame(null); setPage('modules'); }`)
  so the module modal's "Manage all versions →" link works from the game page.
  GameDetail forwards it as `GameModuleModal`'s `onManageAll`.

## Data flow
```
Library card click → onOpen(game) → App.setDetailGame(game) → GameDetail
GameDetail header: Launch → launchGame; Module → GameModuleModal; Remove → removeGame + onBack
```

## Error handling
- Launch errors surface in the inline notice (as Home did).
- Remove: after removal, `onBack()` returns to the library; the removed game is
  gone from the store-backed list.

## Testing
- Manual (no new pure logic):
  - Click a card anywhere → the game opens.
  - Launch / Module / Remove work from the GameDetail header; Remove returns to
    the library and the card is gone.
  - The mod tabs, BepInEx banner, and hub filter/sort still work.
  - `npm run build` passes.

## Out of scope
- Any change to the mod browser, launch internals, or module modal behavior — only
  the *placement* of actions and card click behavior changes.
