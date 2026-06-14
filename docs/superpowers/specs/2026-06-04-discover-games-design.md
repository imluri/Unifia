# Design: Discover Games (Thunderstore catalog on Home)

**Date:** 2026-06-04
**Status:** Approved

## Summary

Add a **Discover** section to Home that lists moddable games from Thunderstore's
community catalog (games you don't have installed), alongside the existing
**Library** of locally-installed games. Clicking a Discover game opens the
existing GameDetail view in **browse-only** mode — you can browse its mods, but
not Launch or install (no game folder). All pure-API → native cards (no webview).

## Goal

- Home has two sections: **Library** (installed, unchanged) and **Discover**
  (Thunderstore catalog, searchable).
- A not-installed game opens GameDetail read-only: browse mods, "View on
  Thunderstore", no Launch/Module/Remove.
- Installed games are not duplicated in Discover.

## Non-goals (v1)

- Art for discover cards (community API has none → placeholder).
- Pre-staging/installing mods for not-installed games.
- Matching installed↔catalog by anything other than the `thunderstoreCommunity`
  profile field.
- Server-side/paginated catalog search (fetch-all + client-side search is fine
  for a few hundred communities).

## Architecture

### Catalog source (main process)
- Thunderstore community list: `https://thunderstore.io/api/experimental/community/`
  (paginated; each result `{ identifier, name }`, no art).
- `electron/ipc/thunderstore.js` (or a sibling) gains `fetchCommunities({refresh})`:
  fetch all pages once, cache to disk (`unifia_data/cache/thunderstore/_communities.json`)
  with a TTL, return `[{ identifier, name }]`. `parseCommunities(apiResults)` is a
  pure helper.

### Discover games + dedup (modManager or a discover module)
- A discover game object: `{ id: "ts:<identifier>", name, community: <identifier>, installed: false }`.
- Pure `filterDiscover(catalog, installedCommunities)` → catalog entries whose
  `identifier` is NOT in `installedCommunities`, each mapped to a discover-game
  object. Unit-tested.
- `getDiscoverGames({refresh})`: fetch catalog, compute `installedCommunities`
  from `store.games` (each game's `profiles.matchProfile(game).thunderstoreCommunity`),
  return `filterDiscover(catalog, installedCommunities)`.

### Mods for a not-installed game
- `modManager.fetchModListForCommunity(community, opts)` →
  `aggregateMods(getProviders(), { thunderstoreCommunity: community }, opts)`
  (the aggregator already takes a profile; the Thunderstore provider's `gameRef`
  reads `thunderstoreCommunity`). No `findGame` (the game isn't in the store).

### IPC
- `unifia:fetchDiscoverGames(opts)` → `getDiscoverGames(opts)`.
- `unifia:fetchModListForCommunity(community, opts)` → the above.

### Renderer
- **Store:** `discoverGames: []`, `discoverLoading`, `loadDiscover({refresh})`.
  `loadMods(game, opts)` branches: if `game.installed === false`, call
  `api.fetchModListForCommunity(game.community, opts)`; else the existing
  `api.fetchModList(game.id, opts)`. (loadMods takes the game object now, not
  just an id, so it can read `installed`/`community`.)
- **Home:** a segmented **Library | Discover** control by the title.
  - Library tab: existing installed grid/list + search/filters/view/rescan/add.
  - Discover tab: lazy-load `discoverGames` on first open; a search box filters
    client-side by name; render `DiscoverCard` per game; clicking calls
    `onOpenGame(discoverGame)`.
- **DiscoverCard** (`src/components/DiscoverCard.jsx`): name + a "Thunderstore"
  tag + placeholder icon; whole card clickable (`onOpen`). No store/engine/version
  badges (discover games lack those).
- **GameDetail** (browse-only when `game.installed === false`):
  - Hide the Launch/Module/Remove header row; show a "Not installed — browsing
    mods only" note with a "View on Thunderstore" link
    (`https://thunderstore.io/c/<community>/`, via `openExternal`).
  - Default to the **Browse** tab; suppress the BepInEx banner.
  - Pass `readOnly` to `ModBrowseCard`.
- **ModBrowseCard:** new `readOnly` prop → render "View on Thunderstore" (using
  `mod.pageUrl` + `openExternal`) regardless of `canInstall`.

## Data flow
```
Home Discover tab → loadDiscover() → fetchDiscoverGames → catalog minus installed
Click discover card → onOpenGame({id:'ts:x', community:'x', installed:false}) → GameDetail
GameDetail (installed:false) → loadMods(game) → fetchModListForCommunity(community) → mods (read-only)
```

## Error handling
- Catalog fetch failure → serve stale cache if present, else a Discover error
  state with retry (mirrors the mod-list error handling).
- `fetchModListForCommunity` failure → the GameDetail `modError` path already
  surfaces a retry.
- A discover game whose community has no mods → empty Browse list (not an error).

## Testing
- **Unit (pure):** `parseCommunities(apiResults)` (maps identifier/name, tolerates
  missing fields) and `filterDiscover(catalog, installedCommunities)` (excludes
  installed, maps to discover-game objects, dedups). Node `--test`.
- **Manual:** Discover tab lists communities; search filters; click a game →
  browse-only GameDetail (no Launch/Module, mods show "View on Thunderstore",
  "Not installed" note); an installed game (REPO) is absent from Discover.

## Scope honesty
Discover cards are intentionally minimal (no art/badges). The catalog is fetched
whole and searched client-side. Only the `thunderstoreCommunity` profile field
drives installed-vs-discover dedup.
