# Native-Browser Crossplay (Inject-Settings Connector) — Design

**Date:** 2026-06-16
**Status:** Approved (design)
**Supersedes (for browser-capable games):** the reconnect-hijack / F9 connection model in UnifiaPun.

## Problem

The current connector joins crossplay by **hijacking** the game's Photon connection: it `PhotonNetwork.Disconnect()`s and reconnects with Unifia's settings, then joins one specific room by code (triggered by F9 / `reconnect-on-load`). This:
- caused REPO to black-screen (disconnecting mid-lobby-load → null singletons),
- bypasses the game's own UI (room codes + a hotkey instead of the native server browser),
- needs an out-of-band room code per session.

Decompiling REPO (via the dnSpy MCP) showed a cleaner path: `NetworkConnect.Start()` configures Photon via `DataDirector.PhotonSetRegion/Version/AppId` then connects, and the game's `connectRandom` flow **is** a public server browser. If Unifia simply **overwrites the Photon AppId + AppVersion at the game's native connect** (no disconnect), both copies land on one shared Photon app and **find each other in REPO's own server browser**. Confirmed: `DataDirector.PhotonSetAppId` exists and is called from `Start` in **both** the cracked and legit assemblies, so a single Harmony postfix targets both.

## Goals / Non-goals

**Goals**
- Crossplay via the game's native server browser — no F9, no room codes.
- No `PhotonNetwork.Disconnect()` in the crossplay path → the black-screen class of bug is structurally impossible.
- A shared community Photon app by default, with a private-AppId override for closed groups.

**Non-goals**
- Removing mod-sync invites (kept — independent of the connection model; lets friends match mod lists).
- Steam/DRM/auth work (the map proved it irrelevant).
- Pinning region (REPO's in-game selector handles it; both players pick the same).

## Design

### 1. New connector strategy: `inject-settings`

`UnifiaPun` gains a strategy that registers a Harmony **postfix** on the method named by the recipe (`connectHookType` = `DataDirector`, `connectHookMethod` = `PhotonSetAppId`). The postfix overwrites, after the game's own setter runs:
```
AppSettings.AppIdRealtime = profile.photonAppId       (if non-empty)
AppSettings.AppIdVoice    = profile.photonVoiceAppId  (if non-empty)
AppSettings.AppVersion    = profile.photonAppVersion  (if non-empty)
```
Then it does nothing — the game connects natively. (`PhotonSetAppId` runs last of the three setters in `Start`, so AppVersion set by the prior `PhotonSetVersion` is already present; overwriting all three in this one postfix is robust regardless.)

### 2. Remove the reconnect/F9 path

Strip from `UnifiaPun`:
- `PunController.Activate()` and its reconnect/`ConnectUsingSettings`/`JoinOrCreateRoom` logic,
- the F9 hotkey + `Update()` polling,
- `HarmonyHooks` `AfterConnect → Activate` (the `OnConnectedToMaster` postfix),
- the `unifia_net.cfg` room-descriptor (`NetConfig`) usage for connection.

`HarmonyHooks` is repurposed/replaced by the inject postfix. `Plugin.cs` initializes `PunController` with the profile only; `Init` branches on `hookStrategy`:
- `inject-settings` → register the inject postfix (the only crossplay strategy going forward),
- `manual` / others → no-op (do nothing; the connector is inert), preserving safe behavior for games without a recipe.

Edition tagging (`OnJoinedRoom` custom props) is dropped with the reconnect path; it can return later if needed (YAGNI).

### 3. AppId resolution (community default + private override)

- Recipe carries community `photonAppId` / `photonVoiceAppId`.
- A **Settings** field holds a user's optional private Photon AppId (+ voice).
- The launcher resolves **effective AppId = settings override (if set) → else recipe community**, and writes `photonAppId` / `photonVoiceAppId` / `photonAppVersion` into `unifia_profile.json`. The connector injects whatever the profile holds — it never knows about "community vs private".

Resolution lives in the launcher's profile-write path (`launcher.js` → `patcher.writeProfileConfig(matchProfile(game))`): after `matchProfile`, overlay `settings.photonAppIdOverride` / `photonVoiceAppIdOverride` when present.

### 4. Recipe vocabulary + REPO recipe

- Add `photonAppId`, `photonVoiceAppId` (strings) to the recipe allowlist in `recipes.js` `FIELD_TYPES` (`photonAppVersion` already present).
- `recipes/repo.json` + bundled copy (bump index version): `hookStrategy: "inject-settings"`, `connectHookType: "DataDirector"`, `connectHookMethod: "PhotonSetAppId"`, `photonAppId`/`photonVoiceAppId` = the community Photon app, `photonAppVersion: "unifia-repo-cp1"`.

### 5. Settings UI

A "Crossplay" Settings block: optional **Private Photon AppId** + **Voice AppId** inputs (advanced), stored via `saveSettings`. Empty = use the community app from the recipe. Brief copy explaining the shared community app vs a private closed group.

## Components

- `electron/ipc/recipes.js` — allowlist += `photonAppId`, `photonVoiceAppId`.
- `recipes/repo.json` + `electron/data/recipes/repo.json` + both `index.json` (version bump) — REPO inject-settings recipe.
- `electron/ipc/launcher.js` (or `profiles.js`) — effective-AppId resolution (settings override → recipe), write to profile.
- `mod/UnifiaPun/UnifiaConfig.cs` — `UnifiaProfile` += `photonAppId`, `photonVoiceAppId` (photonAppVersion already added).
- `mod/UnifiaPun/PunController.cs` — implement `inject-settings`; remove `Activate`/F9/net-join.
- `mod/UnifiaPun/HarmonyHooks.cs` — postfix that overwrites AppSettings (replaces the reconnect postfix).
- `mod/UnifiaPun/Plugin.cs` — init wiring; drop the hotkey.
- `src/pages/Settings.jsx` + `src/store/useAppStore.js` — private-AppId override UI + persistence.

## Data flow

```
recipe { photonAppId(community), photonVoiceAppId, photonAppVersion,
         hookStrategy:inject-settings, connectHookType:DataDirector, connectHookMethod:PhotonSetAppId }
        │ matchProfile + (settings private override wins)
        ▼
unifia_profile.json ──▶ UnifiaPun.Init(inject-settings)
        │                  registers Harmony postfix on DataDirector.PhotonSetAppId
        ▼
game Start(): PhotonSetRegion/Version/AppId ──postfix──▶ AppSettings.AppId*/AppVersion = profile values
        │ native connect (no disconnect)
        ▼
both copies on one Photon app+version ──▶ REPO server browser lists shared rooms ──▶ join in-game
```

## Error handling

- Missing/empty `photonAppId` in the profile → the postfix leaves the game's own AppId untouched (no crossplay, but the game runs normally — no crash).
- Hook method not found (a copy lacking `DataDirector.PhotonSetAppId`) → `HarmonyHooks` already logs a warning and no-ops (existing behavior); the game runs vanilla.
- Settings override blank → community AppId used.

## Testing

- **Unit (`recipes.test.js`):** `validateRecipe` keeps string `photonAppId`/`photonVoiceAppId`, drops non-strings; bundled `repo.json` assembles (with its index entry) and matches REPO carrying `hookStrategy: inject-settings` + the AppIds.
- **Unit (launcher/profiles):** effective-AppId resolution — settings override wins over recipe community; empty override falls back to recipe.
- **Build:** `UnifiaPun` compiles to `Unifia.Pun.dll`; renderer build green.
- **Live (maintainer):** create the community Photon app; both cracked + legit launch REPO via Unifia (no F9); each appears in the other's in-game **public server browser** on the same region; join and play. The private-override path: paste a personal AppId → only that group's rooms show.

## Prerequisite (maintainer)

Create a Photon Cloud app (Realtime + Voice) for the community and place its AppIds in `recipes/repo.json`. Free tier ≈ 20 concurrent users; the AppId is public in the repo (rotatable via a recipe bump). The private-override path serves anyone who prefers their own app.
