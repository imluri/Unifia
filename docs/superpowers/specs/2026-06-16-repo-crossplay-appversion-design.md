# REPO Crossplay — Pin Photon AppVersion via Recipe (Design)

**Date:** 2026-06-16
**Status:** Approved (design)
**Builds on:** the crossplay recipe distribution layer (`2026-06-16-crossplay-recipes-design.md`) and the UnifiaPun connector.

## Problem

REPO crossplay between a cracked copy and a legit copy fails to matchmake even when both point at the same Photon AppId. Decompiling REPO's `Assembly-CSharp.dll` (via the dnSpy MCP) revealed why:

`NetworkConnect.Start()` configures Photon matchmaking through three `DataDirector` calls before connecting:
- `PhotonSetAppId()` — sets `AppSettings.AppIdRealtime/AppIdVoice` (cracked copy reads `Riruka24.ini`; legit copy uses the baked-in official AppId).
- `PhotonSetVersion()` — sets `AppSettings.AppVersion = BuildManager.version.title` (the **per-build** game version string).
- `PhotonSetRegion()` — sets `AppSettings.FixedRegion = networkRegion` (in-game selector).

Two clients share a Photon virtual app only when `{AppIdRealtime, AppIdVoice, AppVersion, region}` all match, then meet by `RoomName`. The room-join paths (`TryJoiningRoom` → `JoinOrCreateRoom`, and the `connectRandom` branch) are **pure Photon with no Steam gating**; `SteamManager.SendSteamAuthTicket` uses `AuthType = None`, so there is no server-side Steam validation on a custom Photon app. **Steam is irrelevant to crossplay.**

The connector (`UnifiaPun`) already overrides `AppIdRealtime` + `AppIdVoice` on its reconnect, but for version it sets only `PhotonNetwork.GameVersion` — leaving `AppSettings.AppVersion` at each copy's differing build title. That mismatch segregates the two copies. **Root cause: the effective Photon AppVersion is not pinned to a shared value across copies.**

## Goal / Non-goals

**Goal:** Pin the effective Photon AppVersion to one shared, recipe-supplied constant on both copies, so different game builds still land in the same Photon virtual app. Ship it through the existing recipe pipeline (no app update) and the bundled connector.

**Non-goals:** Any Steam/DRM/auth work (the map proved it unnecessary). Region/room coordination (handled in-game + via the share-code invite). Changing the game's native connect flow (Unifia always reconnects via its own path).

## Design

### 1. New recipe field: `photonAppVersion`

Add `photonAppVersion` (string) to the recipe vocabulary allowlist in `electron/ipc/recipes.js` (`FIELD_TYPES`). It is a **per-game, public, non-sensitive constant** (e.g. `"unifia-repo-cp1"`) — an arbitrary agreed string that both copies pin to. It is **not** the Photon AppId: the AppId is a private key that stays in the per-session invite (`unifia_net.cfg`), never in a public GitHub recipe.

The field flows through `matchProfile` → `patcher.writeProfileConfig` → `unifia_profile.json` exactly like every other profile field — no new launcher plumbing.

### 2. Connector reads and pins it

- `mod/UnifiaPun/UnifiaConfig.cs` — add `public string photonAppVersion = "";` to `UnifiaProfile` (parsed by `JsonUtility` from `unifia_profile.json`).
- `mod/UnifiaPun/PunController.cs` — in `Activate()`, at the existing version line (`PhotonNetwork.GameVersion = _net.Version`), compute:
  ```
  pinned = !IsNullOrEmpty(_profile.photonAppVersion) ? _profile.photonAppVersion : _net.Version
  ```
  and when `pinned` is non-empty set **both**:
  ```
  app.AppVersion = pinned;            // AppSettings.AppVersion
  PhotonNetwork.GameVersion = pinned; // GameVersion
  ```
  Setting both is deliberate: PUN2's effective app version derives from `GameVersion` (and PUN appends its own version), while the game pins `AppSettings.AppVersion`; forcing both to the same string makes the version identical across copies regardless of which PUN ultimately transmits. `_profile` is already available to `PunController` via `Init(net, profile)`.

The AppId override is unchanged and already correct — UnifiaPun reconnects *after* the game's `PhotonSetAppId`, so it wins; no Harmony patch on the game setters is needed.

### 3. Author the recipe

Add `"photonAppVersion": "unifia-repo-cp1"` to both `recipes/repo.json` (published, remote-fetched) and `electron/data/recipes/repo.json` (bundled fallback), and bump each recipe's `version` (and the index entry's `version`) to `2`. Distributed via the existing recipe layer — reaches users with no app update.

### 4. Rebuild the bundled connector

Rebuild `mod/UnifiaPun/bin/Release/Unifia.Pun.dll` (the `extraResources` plugin in `package.json` build config) so the new `AppVersion` pin ships with installs.

## Data flow

```
recipes/repo.json { photonAppVersion } ──fetch/merge──▶ matchProfile ──▶ unifia_profile.json
                                                                              │
UnifiaPun.LoadProfile() ──▶ _profile.photonAppVersion ──▶ PunController.Activate():
    app.AppVersion = pinned; PhotonNetwork.GameVersion = pinned; ConnectUsingSettings()
    → both copies land in the same Photon virtual app → JoinOrCreateRoom(room)
```

## Error handling

- Recipe omits `photonAppVersion` → connector falls back to `_net.Version`, then to no override — identical to today's behavior (no regression for non-REPO games).
- `validateRecipe` already drops wrong-typed fields, so a malformed `photonAppVersion` is ignored.

## Testing

- **Unit (`electron/ipc/recipes.test.js`):** `validateRecipe` keeps a string `photonAppVersion` and drops a non-string one; the bundled `recipes/repo.json` still passes `validateRecipe` and now carries `photonAppVersion`.
- **Build:** the mod compiles to `Unifia.Pun.dll`; the renderer build stays green.
- **Live (the real proof, maintainer-run):** cracked + legit REPO, same invite (AppId) + same in-game region + same room code → both join the same room. This now targets the confirmed root cause rather than guessing.
