# Mod Presets (isolated profiles) — Design Spec

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Builds on:** the invite codec (`electron/ipc/inviteCode.js`) and the share-code multiplayer
feature (`2026-06-14-sharecode-multiplayer-design.md`). The multiplayer invite is refactored to ride
on presets.

## Problem & goal

Unifia keeps a single mod loadout per game. Users want **named, switchable mod presets** (r2modman /
Thunderstore "profiles"): save a loadout, switch between loadouts, and **import/export a preset as a
code** that autofills everything. Each preset is an **isolated folder** so switching is clean; apply
**verifies + installs** so the set always matches; presets are **mutable** (update a mod → update the
preset's code under the same preset).

## Decisions (locked)

- **Full swap** on switch — the active preset's mods are what's installed/deployed.
- **Isolated folder per preset** — `mods/<gameId>/<presetId>/…` (true profile isolation, like
  r2modman). Switching never re-downloads another preset's mods; it deploys the active preset's.
- **Apply = verify + install** — switching/applying ensures every mod in the preset is staged at the
  right version (downloads missing/wrong), then deploys.
- **Preset code reuses the invite codec** — a preset code is a mods-only invite (empty `appId`/
  `room`). The multiplayer invite = preset code **+** room/appId; importing an invite creates/updates
  a preset *and* joins the room.
- **Migration** — existing `gameMods[gameId]` becomes a **"Default"** preset, set active. Idempotent.

## Non-goals

- Config-file contents in presets (the parked **mod config editor**; a preset could include configs
  later).
- Cross-game presets / global preset library (presets are per game).
- Dedup of identical mods across presets (isolation may duplicate downloads, like r2modman — fine).

## Architecture

### 1. Data model

New store key `gamePresets`:

```
gamePresets[gameId] = {
  activeId: 'p_xxxx',
  presets: [
    { id: 'p_xxxx', name: 'Default', updatedAt: 1718000000000,
      mods: { 'Owner-Mod': { version: '1.2.3', enabled: true, isDependency: false, deployedFiles: [] } } },
    ...
  ],
}
```

The per-preset `mods` map is exactly today's `gameMods[gameId]` shape — so the existing install/
deploy logic carries over unchanged once it reads from the active preset.

### 2. modManager rework (contained at the seam)

Today every mod operation flows through three functions: `modsState(gameId)`, `saveModsState(gameId,
state)`, and `modsDir(gameId)`. We make **those three** preset-aware and leave the rest
(`stageVersion`, `installMod`, `uninstallMod`, `setModEnabled`, `deployMods`, `getInstalledMods`,
`hasEnabledBepInExPack`, `checkModUpdates`) essentially untouched:

- `modsState(gameId)` → returns the **active preset's** `mods` map.
- `saveModsState(gameId, state)` → writes the **active preset's** `mods` map + bumps `updatedAt`.
- `modsDir(gameId)` → `mods/<safeSegment(gameId)>/<activePresetId>` (path now includes the preset).

A small internal `activePreset(gameId)` resolves/creates the active preset (auto-creates "Default" on
first access — this *is* the migration). `paths.modsDir` gains an optional `presetId` arg.

### 3. Preset operations (new `electron/ipc/presets.js`)

- `listPresets(gameId)` → `{ activeId, presets: [{ id, name, updatedAt, modCount }] }`.
- `createPreset(gameId, name, { fromActive = false })` → new empty (or snapshot of active) preset.
- `renamePreset(gameId, id, name)`, `deletePreset(gameId, id)` (can't delete the last one).
- `setActivePreset(gameId, id)` → **undeploy the outgoing preset first** (remove its tracked
  `deployedFiles` from the game folder so no stale mods linger across the swap), then switch active
  and **verify+install** the new preset's mods (download missing/wrong versions). The next launch's
  `deployMods` lays down the new active set. Returns the install diff. (Deploy reconciliation is
  cross-preset: because `deployedFiles` are tracked per preset, the switch must clean the old one — a
  fresh preset's deploy only knows its own files.)
- `updatePresetFromActive(gameId, id)` → re-snapshot current active mods into preset `id` (the
  "update the code under the same preset" flow).
- `exportPreset(gameId, id)` → invite codec string (mods-only).
- `importPreset(gameId, code, { name })` → decode, create a preset from `mods`, set active, verify+
  install. Reuses the codec + the share-code mod-diff/sync.

### 4. Multiplayer invite unifies with presets

`multiplayer.applyInvite` already decodes `{ community, appId, room, version, mods }`. It now ALSO
creates/updates a preset from `mods` and sets it active (in addition to writing the Photon
`netConfig`). `buildInvite` sources its `mods` from the **active preset**. So "join a friend" =
"import their preset + room," and the formats are one.

### 5. UI

- **Presets bar atop the Installed tab:** `Active: <preset> ▾` dropdown to switch (with verify+
  install progress), plus **New**, **Save/Update**, **Rename**, **Delete**, **Import code**, **Copy
  code**. The Installed list renders the **active** preset's mods (unchanged row component).
- **Multiplayer tab:** invite generate/import round-trip through presets (generate = active preset +
  room; import = create preset + join).

### 6. Store

`gamePresets` mirror in the renderer store: `presets: {}` (gameId → list+activeId), actions
`loadPresets`, `createPreset`, `renamePreset`, `deletePreset`, `switchPreset`, `updatePreset`,
`exportPreset`, `importPreset`. `loadMods(game)` refreshes presets alongside installed mods so the
bar and list stay consistent.

## Data flow

```
Switch:  setActivePreset(id) ─▶ activePreset resolves ─▶ verify+install missing/wrong ─▶ deploy on launch
Save:    updatePresetFromActive(id)  |  createPreset(name, fromActive:true)
Export:  exportPreset(id) ─▶ invite codec (mods-only) ─▶ copy
Import:  importPreset(code) ─▶ decode ─▶ new preset ─▶ set active ─▶ verify+install
Invite:  applyInvite(code) ─▶ create/active preset (mods) + write netConfig (room/appId) ─▶ sync ─▶ launch
Migrate: first access ─▶ gameMods[gameId] → "Default" preset (active), once
```

## Error handling

- A preset mod no longer published on its hub → install what's available, flag the missing one,
  don't abort the switch.
- Delete is blocked on the last remaining preset (there's always one active).
- Switching mid-download is serialized per game (the existing install path already awaits).
- Migration only runs when `gamePresets[gameId]` is absent — never clobbers existing presets.

## Testing

- **Pure, unit-tested:** preset list/active resolution + migration shape (`gameMods` → Default), and
  the verify diff (reuse `modSync.diffMods`). The invite codec is already tested.
- **modManager seam:** a focused test that `modsState`/`saveModsState` read/write the active preset's
  `mods` (with a stubbed store).
- **UI / integration:** build + manual — create/switch/rename/delete presets; import a code creates a
  preset and installs; the Installed list reflects the active preset; a multiplayer invite both joins
  and creates a preset.

## Build order (informs the plan)

1. `paths.modsDir(gameId, presetId)`; `gamePresets` model + `activePreset`/migration (pure-ish) + test.
2. Preset-scope the three seam functions in `modManager`; verify existing install/deploy still works.
3. `presets.js` operations (CRUD + setActive verify+install + export/import) + IPC + preload.
4. Refactor `multiplayer.buildInvite`/`applyInvite` to source/create presets.
5. Store presets slice + actions.
6. Installed-tab presets bar UI; wire Multiplayer tab invite to presets.

Steps 1–2 are the risky core (storage rework); 3–6 build the UX on top.
