# Crossplay Recipe Distribution Layer — Design

**Date:** 2026-06-16
**Status:** Approved (design)
**Scope:** Layer (A) of the crossplay-recipes effort — remote distribution + merge of the *existing* profile vocabulary. Layer (B) — new connector capabilities (Steam-auth disable, lobby bypass) and the actual REPO reroute recipe — is a separate later cycle.

## Problem

Per-game network profiles that drive the Unifia connector live in a bundled file, `electron/data/game-profiles.json`, resolved by `matchProfile` ([electron/ipc/profiles.js](../../../electron/ipc/profiles.js)) and written to the game's `BepInEx/config/unifia_profile.json` at launch ([electron/ipc/launcher.js:84](../../../electron/ipc/launcher.js#L84)). Fixing or tuning a game's crossplay config therefore requires shipping a new Unifia build. We want to iterate a game's config (e.g. REPO's Photon settings) **without a release**, by fetching maintainer-curated "recipes" from GitHub at runtime.

## Goals / Non-goals

**Goals**
- Fetch per-game recipes from a `recipes/` folder in the Unifia GitHub repo and merge them over the bundled registry.
- Never block launch on the network; work fully offline via cache → bundled fallback.
- Recipes are **pure data over a constrained vocabulary** — no code execution; a bad/hostile recipe can at worst produce a non-working connection.

**Non-goals (this cycle)**
- New connector behavior/fields (Steam-auth disable, lobby bypass) — needs layer B (widen the allowlist **and** the C# connector).
- Recipe signing / cryptographic trust (HTTPS to `raw.githubusercontent.com` is the v1 trust anchor; noted as future).
- The actual REPO *reroute* recipe contents (layer B). This cycle ships only a **no-op mirror** recipe to exercise the pipeline.
- A "user override" precedence slot (reserved in the merge order, not built now).

## Architecture

Network work is decoupled from the synchronous `matchProfile`. A new module fetches/validates/caches recipes asynchronously; `matchProfile` only ever reads the already-cached result.

```
app startup ──> recipes.refreshRecipes() ──(httpFetch)──> recipes/index.json + recipes/<id>.json
                      │  validate (allowlist + types + version gate)
                      ▼
              cacheDir()/recipes/*.json   (disk cache, serve-stale on failure)
                      │
launchGame ──> profiles.matchProfile(game) ──(sync)──> recipes.recipeFor(game) ──> merged profile
                      └─> patcher.writeProfileConfig ──> BepInEx/config/unifia_profile.json
```

### Components

**`electron/ipc/recipes.js`** — the recipe layer. Split pure vs impure, mirroring `thunderstore.js`.
- Pure (unit-tested):
  - `validateRecipe(raw, appVersion)` → `{ id, match, profile }` or `null`. Enforces `schemaVersion`, drops fields outside the allowlist, type-checks values, and applies the `minUnifiaVersion` gate (returns `null` if `appVersion < minUnifiaVersion`).
  - `validateIndex(raw)` → array of `{ id, match, file, version, minUnifiaVersion }` (well-formed entries only).
  - `matchRecipe(recipes, game)` → the recipe whose `match` fits (steamAppId first, then namePattern), or `null`. Same matching semantics as `profiles.safeRegex`/registry.
- Impure shell:
  - `refreshRecipes({ force })` (async) — `httpFetch` index, then each recipe file; `validate*`; write validated recipes to `cacheDir()/recipes/`. On any fetch failure: keep existing cache (serve-stale); never throw to caller. Returns `{ count, fetchedAt, source, error? }`.
  - `recipeFor(game)` (sync) — read cached recipes (memoized; cache dir → bundled `electron/data/recipes/` fallback), run `matchRecipe`, return the recipe's `profile` fields or `null`.
  - `recipeStatus()` (sync) — `{ count, fetchedAt, source }` for the Settings UI.

**`electron/ipc/profiles.js`** — `matchProfile` gains the recipe layer in its merge (see Precedence).

**`electron/data/recipes/`** — bundled fallback copy of the published recipes (`index.json`, `repo.json`), so a fresh install with no network still has recipes.

**Vocabulary allowlist** (the constrained vocabulary — exactly today's profile fields):
`game` (string), `netcode` (string), `hookStrategy` (string), `autoDelaySeconds` (number), `supportsNativeLobby` (bool), `connectHookType` (string), `connectHookMethod` (string), `region` (string), `connectionMode` (string), `module` (string), `thunderstoreCommunity` (string).
Anything else in a recipe's `profile` is dropped by `validateRecipe`.

### Recipe format

`recipes/index.json`:
```json
{
  "schemaVersion": 1,
  "recipes": [
    { "id": "repo", "match": { "namePattern": "^R\\.?E\\.?P\\.?O\\.?$|\\bREPO\\b" },
      "file": "repo.json", "version": 3, "minUnifiaVersion": "0.1.0" }
  ]
}
```

`recipes/repo.json` (day-one no-op mirror of the bundled REPO entry):
```json
{
  "schemaVersion": 1,
  "id": "repo",
  "notes": "Mirror of bundled REPO profile; exercises the pipeline, no behavior change.",
  "profile": {
    "game": "REPO", "netcode": "pun2", "hookStrategy": "manual",
    "autoDelaySeconds": 3, "supportsNativeLobby": false,
    "connectionMode": "cloud-region", "region": "eu",
    "module": "bepinex_mono", "thunderstoreCommunity": "repo"
  }
}
```

### Precedence

`matchProfile` merge order (later wins):
```
default  →  bundled game entry  →  analyzer override  →  remote recipe  →  (user override: future)
```
Today it is `{ ...base, ...entry.profile, ...analyzerOverride }`. It becomes
`{ ...base, ...entry.profile, ...analyzerOverride, ...recipeProfile }`.
A recipe overrides the analyzer's guess; fields the recipe omits fall through to analyzer/bundled values. When no recipe matches, behavior is identical to today.

### Source configuration

- Default source constant: raw base `https://raw.githubusercontent.com/imluri/Unifia/main/recipes/`.
- Optional `settings.recipeSource` override (advanced; for testing against a fork/branch). Validated as an `https://` URL; falls back to the default if unset/invalid.

### UI (minimal)

- `refreshRecipes()` fires once on app startup (async, non-blocking).
- Settings: a **"Refresh recipes"** button + a status line (`recipeStatus()`: count, last-updated, source).
- GameDetail: a small indicator when `recipeFor(game)` is non-null (e.g. *"Crossplay recipe: REPO v3 ✓"*).

IPC additions (preload `window.unifia`): `refreshRecipes()`, `getRecipeStatus()`, `getRecipeFor(gameId)`.

## Error handling

- **Fetch failure / TLS quirk / offline:** `refreshRecipes` keeps the existing cache and returns `{ error }` for the UI; `recipeFor` serves cache → bundled. Launch is unaffected.
- **Malformed index/recipe:** `validate*` rejects it (drops the entry / returns null); a single bad recipe never poisons the others.
- **Version gate:** recipe with `minUnifiaVersion` newer than `app.getVersion()` is ignored (returns null), so future layer-B recipes don't break old clients.
- **Bad regex in `namePattern`:** wrapped in try/catch (reuse the `safeRegex` pattern); a non-compiling pattern simply doesn't match.

## Testing

`electron/ipc/recipes.test.js` (`node:test`, pure functions only):
- `validateRecipe` drops out-of-allowlist fields; type-checks; rejects wrong `schemaVersion`; applies `minUnifiaVersion` gate (newer → null, equal/older → kept).
- `validateIndex` keeps well-formed entries, drops malformed ones.
- `matchRecipe` matches by `steamAppId` first, then `namePattern`; returns null when none match; tolerates a non-compiling pattern.
- Merge precedence: a recipe field overrides an analyzer field; an omitted recipe field falls through; no recipe → unchanged from today.

Manual: set `settings.recipeSource` to a test branch, edit `recipes/repo.json` (e.g. `region: "us"`), click **Refresh recipes**, confirm GameDetail shows the new version and a REPO launch writes `region=us` into `unifia_profile.json`.
