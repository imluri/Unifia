# Auto-resolve a game's Thunderstore community — Design

**Date:** 2026-06-21
**Status:** Approved

## Problem

Mod support only loads for games whose Thunderstore community is hardcoded in
`electron/data/game-profiles.json`, which currently contains only REPO. When the
user added **Lethal Company** from Steam, `matchProfile` returned an empty
`thunderstoreCommunity`, so `communityFor` returned `null`, no mod hub resolved,
and GameDetail showed "No mod source for this game". This does not scale to
Thunderstore's hundreds of communities.

## Insight

Thunderstore community identifiers are slugified game names:
`"Lethal Company"` → `"lethal-company"`, `"Content Warning"` → `"content-warning"`,
`"REPO"` → `"repo"`. So `slugify(game.name)` resolves the common case directly.
Unifia already fetches and caches the full community list via
`thunderstore.fetchCommunities()` (used by Discover), so we can **validate** a
slug against it before trusting it.

## Design

### Resolution model: resolve once (async), persist, read sync

`matchProfile` / `communityFor` are synchronous and called in many hot paths
(launch, invite, deploy, Discover dedupe). `fetchCommunities()` is async + cached.
So we resolve **once** in the async mod-loading path, **persist** the result to
the per-game settings bag, and let all sync callers read the persisted value.

The per-game bag is `gameProfiles[gameId]` — the same object the invite modal
already writes (`photonAppId`). We add one field: `thunderstoreCommunity`.

### Precedence (effective community)

```
gameProfiles[gameId].thunderstoreCommunity   (user-set OR auto-resolved)   ← wins if set
  else registry/recipe community (game-profiles.json / recipe)
  else ''  (no source; manual picker offered)
```

This keeps REPO on its recipe community (`"repo"`) — REPO's resolved community is
never empty, so the resolver never runs for it and never writes a per-game value.
Unregistered games fall to the per-game value the resolver/picker fills.

### Components

**1. `slugify(name)` — pure, in a new `electron/ipc/communityResolver.js`.**
Lowercase, trim, replace any run of non-alphanumeric characters with a single
hyphen, strip leading/trailing hyphens. `"Lethal Company"` → `"lethal-company"`,
`"R.E.P.O."` → `"r-e-p-o"`. Pure and unit-tested.

**2. `pickCommunity(slug, communities)` — pure, same file.**
Given a slug and the `fetchCommunities()` result (`[{identifier, name}]`), return
the matching `identifier` or `null`. Match is exact on `identifier`. Pure and
unit-tested (no network, list passed in).

**3. `resolveCommunity(game)` — async, same file.**
- If `communityFor(game)` already returns a community, return it (no-op).
- Else `slug = slugify(game.name)`; `communities = await thunderstore.fetchCommunities()`;
  `id = pickCommunity(slug, communities)`.
- If `id`, persist it: set `gameProfiles[gameId].thunderstoreCommunity = id` via the
  store, and return `id`. Else return `null` (leave unresolved).
- Network/fetch failure is swallowed (returns the current community or `null`); mod
  loading degrades to "no source", never throws.

**4. `profiles.matchProfile` — prefer the per-game community (sync).**
After the existing precedence merge, overlay the per-game value:
```js
const merged = resolveProfile({ base, entryProfile, analyzerOverride, recipeProfile });
const stored = (store.get('gameProfiles') || {})[game.id] || {};
if (stored.thunderstoreCommunity) merged.thunderstoreCommunity = stored.thunderstoreCommunity;
return merged;
```
Applied at all three return points (refactor the function to a single return).
`communityFor` is unchanged and now transparently sees the persisted value.

**5. `modManager.fetchModList(gameId)` — trigger resolution.**
Before aggregating, if `communityFor(game)` is empty, `await resolveCommunity(game)`,
then re-read the profile. This makes the first GameDetail open for an unregistered
game resolve + persist the community, then load its mods.

**6. `setGameCommunity(gameId, community)` — manual override IPC.**
`modManager.setGameCommunity(gameId, community)`: writes/clears
`gameProfiles[gameId].thunderstoreCommunity` (empty string clears it back to
auto/registry). Wired as `unifia:setGameCommunity` in `electron/main.js`, exposed
in `electron/preload.js`, and called from the store.

**7. Community picker UI — GameDetail.**
When a game resolves to no community (the existing "No mod source" branch), render
a searchable community picker built from the **full** Thunderstore community list.
`getDiscoverGames` filters out installed communities, so this needs an unfiltered
source — add a `listCommunities()` IPC (`unifia:listCommunities` →
`thunderstore.fetchCommunities()`) + preload bridge if one isn't already exposed.
Selecting one calls `setGameCommunity` then reloads mods.
A small "change mod community" affordance is also available when a community *is*
set, to correct a wrong auto-match.

## Data flow

```
GameDetail open (installed game)
  → loadMods(game) → api.fetchModList(game.id)
      → communityFor empty? → resolveCommunity(game)
            → slugify(name) → fetchCommunities() → pickCommunity → persist gameProfiles[id].thunderstoreCommunity
      → matchProfile now returns the community → aggregateMods → mod list

User corrects a mismatch
  → picker → api.setGameCommunity(id, community) → loadMods(game) again
```

## Error handling

- `fetchCommunities()` failure inside `resolveCommunity`: swallow, return null →
  GameDetail shows "No mod source" + the picker (manual fallback still works).
- Slug not in the community list: return null (do **not** query a non-existent
  community) — picker offered.
- Empty string to `setGameCommunity`: clears the override (revert to auto/registry).

## Testing

**Unit (node, pure — no Electron):**
- `slugify`: `"Lethal Company"→"lethal-company"`, `"Content Warning"→"content-warning"`,
  `"REPO"→"repo"`, `"R.E.P.O."→"r-e-p-o"`, leading/trailing junk trimmed.
- `pickCommunity`: slug present in list → identifier; slug absent → null; empty list → null.

**Manual:**
- Open Lethal Company → mod list loads; `gameProfiles.steam_1966720.thunderstoreCommunity`
  persists as `"lethal-company"`.
- A game whose name doesn't slugify to its community → picker sets it → mods load.
- REPO still loads its `repo` community (regression — resolver must not run for it).

## Out of scope

- Fuzzy/alias matching beyond exact slug (manual picker covers mismatches).
- Curated steamAppId→community map (rejected in favor of slug+validate).
- Changing REPO's recipe-driven community resolution.

## Files

- Create: `electron/ipc/communityResolver.js` (`slugify`, `pickCommunity`, `resolveCommunity`)
- Create: `electron/ipc/communityResolver.test.js` (pure unit tests)
- Modify: `electron/ipc/profiles.js` (`matchProfile` per-game overlay)
- Modify: `electron/ipc/modManager.js` (`fetchModList` triggers resolve; export `setGameCommunity`)
- Modify: `electron/main.js` (`unifia:setGameCommunity` + `unifia:listCommunities` handlers)
- Modify: `electron/preload.js` (`setGameCommunity` + `listCommunities` bridges)
- Modify: `src/store/useAppStore.js` (`setGameCommunity` action; reload after set)
- Modify: `src/pages/GameDetail.jsx` (community picker in the no-source branch)
