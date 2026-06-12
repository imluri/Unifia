# Design: BepInEx via Thunderstore

**Date:** 2026-06-04
**Status:** Approved (pending spec review)

## Summary

For Thunderstore-mapped games, treat **BepInEx as just another Thunderstore
package (BepInExPack)** — installed, staged, and deployed through the exact same
mod path the mod browser already uses (staging in `unifia_data/mods/<gameId>/`,
deployed to the game on launch; BepInExPack routes to the game **root**). This
unifies the loader source with the mods, prevents the current double-install,
and adds a one-click way to get BepInEx. The existing GitHub-based BepInEx
Modules flow stays as the fallback for games with no Thunderstore community.

## Context

Two BepInEx sources currently both deploy on launch:
- GitHub Modules flow: `launcher.deployModule(game)` copies the active
  `bepinex_mono|il2cpp` module into the game.
- Mod system: `modManager.deployMods` copies enabled Thunderstore mods, routing
  BepInExPack to the game root (via `deployTarget`).

A Thunderstore game that has installed any mod (which pulls BepInExPack as a
dependency) can therefore end up with both loaders overlapping.

## Goal

BepInEx for a Thunderstore-mapped game comes from BepInExPack, deployed like any
mod, with **exactly one** loader in the game folder and a one-click install. No
regression for non-Thunderstore games.

## Changes (three focused units)

### 1. No double-install — `modManager` helper + `launcher`
- Add `modManager.hasEnabledBepInExPack(gameId)`: reads `gameMods[gameId]`,
  returns true if any entry is enabled and its `fullName` matches `/bepinexpack/i`.
  Pure over store state → unit-testable with fixtures.
- In `launcher.launchGame`, when `hasEnabledBepInExPack(game.id)` is true, **skip
  `deployModule(game)`** (the GitHub BepInEx copy). `deployMods` still runs and
  lays down BepInExPack at the root. Result: one loader.
- Non-Thunderstore games (no staged BepInExPack) are unaffected — GitHub flow
  runs as before.

### 2. One-click "Install BepInEx" — GameDetail UI
- In the GameDetail view, when no BepInExPack is staged for the game, show a small
  banner with an **Install BepInEx** button.
- It finds the `*BepInExPack*` package in the already-loaded `modList`
  (match `/bepinexpack/i`) and installs it via the existing `installMod` flow
  (latest version; dependencies resolve normally).
- If the community lists no BepInExPack package, the banner shows
  "BepInEx isn't available in this community" instead of a button.
- Hidden once a BepInExPack is staged.

### 3. Detection recognizes staged BepInExPack — `pluginManager`
- `pluginManager.bepinexInstalled(installPath)` is used by the connector-plugin
  modal to hint "needs BepInEx". Extend the plugin-status path so BepInEx counts
  as present when an enabled BepInExPack is **staged** for the game (it will
  deploy on launch), in addition to the existing on-disk game-folder check.
- Concretely: `getPluginStatus(gameId)` ORs the on-disk check with
  `modManager.hasEnabledBepInExPack(gameId)`.

## Data flow

```
Install BepInEx (GameDetail) → installMod(BepInExPack) → staged in unifia_data/mods
Launch → hasEnabledBepInExPack? yes → skip GitHub deployModule
       → deployMods → BepInExPack files copied to game root (one loader)
Plugin modal → bepinexInstalled = on-disk OR staged BepInExPack → no false nag
```

## Error handling
- No BepInExPack in the community list → one-click shows a clear "not available"
  message; nothing installs.
- `hasEnabledBepInExPack` tolerates missing/empty `gameMods` → returns false.
- Skipping `deployModule` only happens when BepInExPack is actually staged, so a
  game relying on the GitHub flow is never left without a loader.

## Testing
- **Unit:** `hasEnabledBepInExPack` over `gameMods` fixtures (enabled match,
  disabled match → false, no mods → false, non-BepInExPack mods → false).
- **Manual:** map game → GameDetail → Install BepInEx → launch → confirm a single
  BepInEx in the game folder (no GitHub overlay); confirm the connector-plugin
  modal no longer nags "BepInEx isn't in the game folder".

## Out of scope
- Other mod hubs (future direction).
- Removing the GitHub BepInEx Modules flow.
- Redirecting the per-game module modal's BepInEx "Install & use" button.
