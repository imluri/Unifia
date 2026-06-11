# Design: Thunderstore Mod Browser

**Date:** 2026-06-04
**Status:** Approved (pending spec review)

## Summary

Add an r2modman-style, Thunderstore-backed **mod browser and installer** to Unifia,
scoped to the games Unifia already supports (REPO, etc.), alongside the existing
cross-store multiplayer feature. Clicking a game opens a full-screen detail view
with **Installed | Browse** tabs, search, category filters, and large mod cards
using Thunderstore icons. Installs auto-resolve dependencies. Mods are staged in
`unifia_data` and deployed into the game on launch (the r2modman model).

Reference: r2modmanPlus (MIT, Cade Ayres 2020) — concepts/code reusable with
attribution. It is a thin client over the public Thunderstore API; "use their
thumbnails" = consume the Thunderstore package list, whose `icon` field is the
mod's CDN thumbnail.

## Scope

**In scope (v1):**
- Per-game Thunderstore mod browser for games mapped to a Thunderstore community.
- Browse + search + **category filter + sort**.
- Install with **automatic dependency resolution** (incl. BepInExPack).
- Uninstall.
- **Enable/disable** installed mods.
- **Update detection** (installed vs latest).
- **Version picker** (install a specific version).

**Out of scope (v1):**
- Multiple profiles per game / profile import-export.
- General multi-game manager for arbitrary Thunderstore games beyond Unifia's list.
- Replacing the existing GitHub-based BepInEx Modules page (it stays; BepInExPack
  from Thunderstore may supersede it for Thunderstore games).

## Architecture

### Data source & caching (main process)
- New `electron/ipc/thunderstore.js`.
- Fetch community package list: `https://thunderstore.io/c/<community>/api/v1/package/`
  via existing `httpFetch`.
- The list is large (multi-MB) → cache to disk at
  `unifia_data/cache/thunderstore/<community>.json` with a TTL (~30 min); manual
  refresh supported.
- Package shape consumed: `name`, `owner`, `full_name`, `package_url`,
  `rating_score`, `categories[]`, `is_deprecated`, `versions[]` where each version
  has `version_number`, `dependencies[]` (full version strings `Owner-Mod-x.y.z`),
  `download_url`, `icon`, `description`, `file_size`, `date_created`.
- `icon` is rendered directly via `<img src>` (Thunderstore CDN; allowed by CSP
  `img-src https:`).

### Game → community mapping
- Add `thunderstoreCommunity` to the game-profile registry
  (`electron/data/game-profiles.json` + `profiles.js` passthrough), e.g.
  REPO → `"repo"`.
- Games without a community: the detail view shows a "No mod source for this game"
  empty state; no Thunderstore calls.

### Storage model (Approach A: staged + deployed)
- **On-disk staging:** `unifia_data/mods/<gameId>/<Owner-Mod>/…extracted files…`
- **State (electron-store):**
  `gameMods[gameId][fullName] = { version, enabled, isDependency, deployedFiles: [] }`
- New `electron/ipc/modManager.js` owns install/uninstall/enable/disable/
  update-check/deploy.
- **Deploy-on-launch:** the existing launcher, before spawning, reconciles the
  game folder against `gameMods[gameId]`:
  - enabled mods copied in; disabled mods' tracked files removed.
  - `BepInExPack` → game **root** (BepInEx/, doorstop, `winhttp.dll`).
  - all other mods → `BepInEx/plugins/<Owner-Mod>/`.
  - Additive + file-tracked: never clobbers our own `Unifia.Pun.dll` (installed
    directly by `pluginManager`).

### Renderer
- New full-screen **GameDetail** view. App gains a lightweight `selectedGame`
  route alongside the current `page` state; clicking a game card opens it.
- Header: game art/name. Tabs: **Installed | Browse**.
- Components:
  - `ModBrowseCard` — icon, name, owner, downloads, rating, Install (+ version
    picker), deprecated flag.
  - `InstalledModRow` — enable/disable toggle, version, update badge, uninstall.
  - Search / sort / category bar.
  - Dependency-confirm dialog.
- Store: a `mods` slice in `useAppStore` (browse list, installed map, busy/progress).

### IPC additions (wrapped in existing `{ok,data}` handler pattern)
- `fetchModList(gameId, { refresh? })`
- `installMod(gameId, fullName, version?)`
- `uninstallMod(gameId, fullName)`
- `setModEnabled(gameId, fullName, enabled)`
- `checkModUpdates(gameId)`
- (progress emitted on the existing `download-progress` event channel)

## Install + dependency resolution flow
1. Click Install → `modManager` reads the chosen version's `dependencies[]` from
   the cached list, finds each package, recurses, builds a flat de-duped install
   set (handles cycles, skips already-installed same-version).
2. Dependency-confirm dialog: "Installing X + N dependencies."
3. Each version zip (`download_url`) downloads with progress, extracts to staging,
   records `{ version, isDependency, deployedFiles }`.
4. BepInExPack special-cased by name → deploy target = game root; others → plugins.
5. Game folder is a projection rebuilt by the launcher deploy step on launch.

## The four extras
- **Enable/disable:** flip `enabled`; deploy step copies enabled / removes disabled
  tracked files. No re-download.
- **Category filter + sort + search:** client-side over the cached list
  (`categories[]`, `rating_score`, total downloads, date; search name/owner/desc).
- **Update detection:** compare installed `version` vs latest `version_number`;
  Update badge → re-run install (re-resolve deps).
- **Version picker:** dropdown of `versions[]` on the install control; default latest.

## Error handling
- API down → fall back to cached list; if none, error state + retry.
- Download/extract failure → discard partial staging, surface error, mod not recorded.
- Missing/removed dependency → warn, install what's resolvable.
- Unmapped game → friendly empty state.
- BepInExPack vs existing GitHub BepInEx → prefer Thunderstore's when present
  (both are BepInEx; overlay is safe).
- Deploy file conflict between two mods → last-wins, logged to scanner/mod log.

## Testing
- **Unit (highest risk):** dependency resolver as a pure function over a
  package-list fixture — correct flat set, cycle handling, dedup, missing-dep
  tolerance. Plus deploy-target classifier (BepInExPack→root vs plugins).
  Node `--test`, same harness as the vdf/engine tests.
- **Manual:** browse REPO (`repo`), install a mod with deps, launch, verify file
  placement, toggle disable/enable, trigger an update.

## Open considerations (non-blocking)
- Thunderstore v1 list size: TTL cache mitigates; could move to the experimental
  chunked endpoint later if needed.
- Immediate vs launch-time deploy: contract is launch-time (single source of
  truth); the Installed tab reflects staged state regardless.
