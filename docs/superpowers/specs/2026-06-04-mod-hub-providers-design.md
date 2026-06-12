# Design: Mod Hub Providers (multi-hub foundation)

**Date:** 2026-06-04
**Status:** Approved (pending spec review)

## Summary

Refactor the existing Thunderstore mod browsing into a pluggable **mod hub
provider** abstraction so Unifia can aggregate a game's mods from multiple hub
REST APIs. Each mod carries a **hub tag**, and the Browse tab gains a hub
filter + hub sort. Thunderstore is the first (and, in v1, only) provider. Adding
a future hub becomes a small isolated adapter. Everything stays **pure REST API
→ native React cards** (no webview). Install stays Thunderstore-only in v1.

## Goal

- A clean provider interface; Thunderstore reimplemented as the first provider.
- Mods aggregated across all providers that map a game, each tagged with its hub.
- Browse tab: hub tag on cards, hub filter, hub sort.
- Adding hub #2 (browse) later = one provider module + one registry field.

## Non-goals (v1)

- A second concrete hub (deferred; abstraction makes it cheap).
- Installing from non-Thunderstore hubs (needs per-hub install pipelines + state
  namespacing).
- Removing/altering the Thunderstore install/stage/deploy path.

## Architecture

### Provider abstraction (main process)
New `electron/ipc/modHubs/`:
- `index.js` — exports `getProviders()` returning the registry array.
- `thunderstore.js` — the Thunderstore provider. Wraps the existing
  `electron/ipc/thunderstore.js` API client (unchanged).
- `aggregate.js` — pure `aggregateMods(providers, profile, opts)` (unit-tested).

Provider contract (one object per hub):
```js
{
  id: 'thunderstore',                 // stable hub id → the tag
  label: 'Thunderstore',
  canInstall: true,                   // v1: only Thunderstore is true
  gameRef(profile) -> string | null,  // per-hub game identifier from the profile
  async fetchMods(ref, opts) -> mod[] // call the hub REST API, return normalized mods
}
```

### Aggregator (pure, the key new logic)
`aggregateMods(providers, profile, opts)`:
- For each provider, compute `ref = provider.gameRef(profile)`; skip if null.
- `await provider.fetchMods(ref, opts)`; a provider that throws is caught and
  skipped (logged), not fatal.
- Every returned mod is decorated: `hub`, `hubLabel`, `canInstall`, and a
  composite `id = "<hub>:<fullName>"` (React key + future install namespacing).
- Returns `{ packages, hubs }` where `hubs = [{ id, label }]` for every provider
  that produced a non-null `ref` (drives the filter UI / empty state).

### modManager
`fetchModList(gameId, opts)` becomes:
```js
const profile = profiles.matchProfile(findGame(gameId));
return aggregateMods(getProviders(), profile, opts);  // { packages, hubs }
```
`installMod` / `uninstallMod` / `setModEnabled` / `checkModUpdates` / `deployMods`
are **unchanged** (Thunderstore `fullName`-keyed). `communityFor` stays for the
Thunderstore install path.

## Data shape

Normalized mod (Thunderstore fields unchanged) gains:
- `hub` (provider id), `hubLabel`, `canInstall`, `id` (`"<hub>:<fullName>"`),
  `pageUrl` (the mod's hub page — Thunderstore's `packageUrl`).

`fetchModList` IPC returns `{ packages, hubs }` (was `{ community, packages }`).

## UI (renderer)

- **Store slice:** replace `modCommunity` with `modHubs` (array of `{id,label}`).
  `loadMods` destructures `{ hubs, packages }` and sets `modHubs`. `installedMods`
  unchanged.
- **GameDetail:**
  - Empty state when `modHubs.length === 0` (was `!modCommunity`).
  - Browse tab: a **Hub filter** (chips built from `modHubs`) and **"Hub"** added
    to the sort dropdown (sort by `hubLabel`). Existing search/sort/category stay.
- **ModBrowseCard:**
  - A small **hub tag** chip (`hubLabel`).
  - Card key uses `mod.id`.
  - Install button gated on `mod.canInstall`; otherwise a **"View on <hub>"**
    button opening `mod.pageUrl` via a new `openExternal(url)` IPC
    (`shell.openExternal`). (With only Thunderstore registered, the View branch
    won't render in v1, but the gating completes the abstraction.)

## Registry

Per-hub game-ref fields in `electron/data/game-profiles.json`; each provider's
`gameRef(profile)` reads its own field (`thunderstoreCommunity` today). Adding a
hub = new field + new provider module; existing entries unchanged.

## Error handling
- A hub API failure → that provider is skipped in `aggregateMods` (logged);
  other hubs still render. If every provider fails/returns no ref → empty state.
- `openExternal` validates it's an http(s) URL before calling `shell.openExternal`.

## Testing
- **Unit (new):** `aggregateMods` with fake providers —
  - merges + hub-tags mods from multiple providers;
  - `hubs` lists only providers with a non-null `gameRef`;
  - a throwing provider is skipped, others still returned;
  - null-ref providers contribute nothing;
  - composite `id` is `"<hub>:<fullName>"`.
- Existing `thunderstore.test.js` / `modResolver.test.js` stay green.
- **Manual:** REPO → Browse shows mods tagged "Thunderstore"; hub filter + hub
  sort work; install/uninstall/enable/update unchanged.

## Scope honesty
With one provider, the hub tag/filter/sort operate on a single hub — the value is
the abstraction. An *installable* second hub later needs per-hub install state
namespacing (keying by `id` not `fullName`), which is explicitly out of scope.
