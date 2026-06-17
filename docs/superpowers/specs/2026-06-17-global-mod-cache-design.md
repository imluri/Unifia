# Global Mod Cache + Copy-Deploy (r2modman model) — Design

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

Mods are downloaded into the **active preset's** staging folder — `modsDir(gameId, presetId)/<fullName>/` ([modManager.js `stageVersion`:112](../../../electron/ipc/modManager.js#L112)) — and `deployMods` copies from there into `BepInEx/plugins/` ([:301](../../../electron/ipc/modManager.js#L301)). So the **same mod is re-downloaded for every preset** that uses it, and importing a friend's preset re-fetches everything. This is wasteful and slow. Thunderstore/r2modman solve it with a **global, version-keyed mod cache**: download a mod once, then deploy copies of it into whichever profile is active.

## Goal / Non-goals

**Goal:** Download each `fullName@version` **once** into a shared cache; presets deploy enabled mods *from* the cache by copy. Switching presets, re-enabling a mod, or importing a friend's preset never re-downloads an already-cached version.

**Non-goals:** hardlink/symlink deploy modes; cache size limits / garbage collection (a "Clear mod cache" action is a later add); dependency auto-resolution beyond what `resolveInstallSet` already does; full r2modman UI parity.

## Design

### 1. Global version-keyed cache

A shared cache directory, independent of game/preset:
```
cacheDir()/mods/<fullName>/<version>/…extracted mod contents…
```
A new `paths.modCacheDir(fullName, version)` resolves this. `cacheDir()` already exists in `paths.js`.

### 2. Cache-aware staging (download once)

`stageVersion(gameId, fullName, versionData, onProgress)` becomes cache-oriented:
- Target = `modCacheDir(fullName, versionData.version_number)`.
- **If the target already exists and is non-empty, return immediately** (cache hit — no download).
- Otherwise download the zip + extract into the cache target (same download/extract code as today).

It no longer writes into a per-preset folder. `installMod` is otherwise unchanged: it still records `{ version, enabled, isDependency, deployedFiles, loadOrder }` on the active preset's state (the record shape is unchanged; only the file location moved to the cache).

### 3. Copy-deploy from the cache

`deployMods(gameId, installPath)` changes one thing: the per-mod source becomes the cache keyed by the mod's recorded version, instead of the preset staging folder:
```
const staging = paths.modCacheDir(fullName, m.version);   // was presetDir(gameId)/fullName
```
Everything else (remove previous `deployedFiles`, BepInExPack→root vs others→`plugins/<fullName>`, additive file tracking) stays the same. Undeploy (today's `presetStore.undeployActive` + the per-mod removal loop) is unchanged and removes only deployed copies — the cache is never touched.

### 4. Uninstall / disable / archive (adapted, keeps ArchivedModsSection working)

Today archive = moving a mod's **staging folder** to `.archive/` and restoring it from there (`uninstallMod`/`restoreArchivedMod`/`listArchivedMods`). With the cache, there is no per-preset staging folder to move, and the files already persist in the cache — so archive becomes **records only**, never file moves:

- **Disable** (`setModEnabled`): unchanged — the mod isn't copied on the next deploy; stays cached for instant re-enable.
- **Uninstall** (`uninstallMod`): remove the mod from the active preset's state, undeploy its files, and record `{ fullName, version, isDependency }` in a per-preset **archived-records** map — a new store key `gameArchivedMods[gameId][presetId]`. **No files are deleted** (the cache keeps them; other presets/games may share that `fullName@version`).
- **Restore** (`restoreArchivedMod`): move the record back into the preset state (version preserved → the next deploy is a cache hit, no download); drop it from the archived map.
- **List** (`listArchivedMods`): read the archived-records map and return `{ fullName, version }`, so `ArchivedModsSection` keeps working — its data source changes from the `.archive/` folder to the records map, but its shape (`{ fullName }` + version) is preserved.

The old `.archive/` folder mechanism is removed; the cache is the durable file store.

### 5. Migration (one-time, with lazy fallback)

On first run after the update, migrate existing per-preset staging into the cache so installs keep working without re-downloading:
- For each game's presets, for each recorded mod `fullName@version`, if `modCacheDir(fullName, version)` is missing but the old staging folder `modsDir(gameId, presetId)/<fullName>` exists, **move** it into the cache.
- Runs once (guarded by a `store` flag, e.g. `settings.modCacheMigrated`).
- **Lazy fallback:** if `deployMods` finds a recorded mod with no cache folder (migration missed it / fresh), it triggers a re-download via the normal install path (or logs and skips, leaving the mod undeployed with a clear status). The common case (migrated) needs no network.

### 6. Components

- `electron/paths.js` — add `modCacheDir(fullName, version)`.
- `electron/ipc/modManager.js` — `stageVersion` → cache + skip-if-cached; `deployMods` → copy from cache; `uninstallMod`/`restoreArchivedMod`/`listArchivedMods` → operate on the `gameArchivedMods` records map (no `.archive/` folder); remove `presetDir`/`archiveDir` usage.
- `electron/ipc/modCacheMigrate.js` (new) — one-time staging→cache migration, run on startup.
- `electron/main.js` — call the migration once on `app.whenReady` (after `ensureLayout`).

## Data flow

```
installMod ─▶ stageVersion: modCacheDir(fullName, version) exists? ─yes─▶ (skip)
                                                    └no─▶ download+extract into cache
            └▶ record {version,enabled,...} on active preset
deployMods ─▶ for active preset's enabled mods: copy modCacheDir(fullName, version) → plugins/<fullName>
switch/import/disable ─▶ undeploy (remove copies) + deploy (copy from cache) — never re-downloads
```

## Error handling

- Cache hit with a partial/corrupt extract: treat an empty target as a miss (re-download). (Check for non-empty dir, not just existence.)
- Recorded mod missing from cache at deploy: lazy re-download or skip-with-status; never crash the launch.
- Migration is best-effort per mod (try/catch each move); a locked file leaves the staging copy and lazy-recache handles it.
- Disk-copy failures during deploy surface as today (the launch is non-fatal; mods may be incomplete).

## Testing

- **Pure (`node:test`):** `modCacheDir` key derivation (`fullName` + `version` → path); a pure helper for "is this cache target a hit?" (exists + non-empty); migration mapping (given preset records + existing staging dirs → list of moves).
- **Existing suites** (presetLogic, presetStore.undeployActive, modSync) stay green.
- **Manual:** install mod X into preset A; create preset B and add X → **no second download** (cache hit); switch A↔B → `plugins/` holds exactly the active preset's enabled mods; disable X → removed from `plugins/`, still cached; re-enable → instant (no download).
