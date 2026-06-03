# Unifia PUN Connector (BepInEx plugin)

A **generic** BepInEx (Unity Mono) plugin that makes a Photon (PUN2) game connect
to a Unifia host's **self-hosted Photon server** and join a shared room — the
in-game half of Unifia's cross-store multiplayer. One plugin covers many PUN
games; per-game differences are expressed as small **profiles**, not new code.

## How it fits together

```
Unifia launcher                          Game (with this plugin)
├─ host mints {serverIP,port,roomCode}   ├─ reads BepInEx/config/unifia_net.cfg
├─ writes unifia_net.cfg  ───────────────►   (room descriptor)
├─ writes unifia_profile.json  ──────────►   reads unifia_profile.json (behavior)
└─ deploys this plugin + launches        └─ repoints PUN → host server, joins room
```

The launcher writes two files into the game's `BepInEx/config/`:

- **`unifia_net.cfg`** — the room descriptor (`ServerIP`, `Port`, `AppId`,
  `RoomCode`, `Username`, `Version`). Produced by the launcher's `patcher.js`.
- **`unifia_profile.json`** — per-game behavior, matched from the launcher's
  profile registry (see [`profiles/schema.json`](profiles/schema.json)).

With **no** `unifia_net.cfg`, the plugin stays completely idle — installing it
never affects normal play.

## What the plugin does

1. On load, reads the two config files.
2. When activated, overrides PUN's `AppSettings` to point at the host
   (`Server`, `Port`, `UseNameServer = false`, `AppIdRealtime`), then
   `ConnectUsingSettings()`.
3. On `OnConnectedToMaster`, `JoinOrCreateRoom(RoomCode)`.

**Activation timing** is the one game-specific part, controlled by
`hookStrategy` in the profile:

- `manual` — press **F9** in-game to (re)join. Most reliable for bring-up.
- `auto-on-load` — activate automatically after `autoDelaySeconds`.
- `reconnect-on-load` — Harmony-patches the game's own connect call (named by
  `connectHookType` / `connectHookMethod` in the profile) so Unifia activates
  right after it. Reflection-based, so the target is data — a contributor just
  finds the right method and adds it to the registry, no plugin rebuild.

`supportsNativeLobby` is the seam for the "show a *unifia* region / list the room
in the game's own browser" integration (Level A). The current scaffold does the
robust auto-join-by-code path (Level B).

## Building

This is a normal BepInEx plugin and builds **outside** the Electron app.

1. Copy these from the target game's `<Game>_Data/Managed/` into `UnifiaPun/libs/`:
   - `UnityEngine.dll`, `UnityEngine.CoreModule.dll`
   - `PhotonUnityNetworking.dll`, `PhotonRealtime.dll`, `Photon3Unity3D.dll`
     (names may differ on older PUN builds — match what the game ships)
2. `cd mod/UnifiaPun && dotnet build -c Release`
3. Copy the resulting `Unifia.Pun.dll` into the game's `BepInEx/plugins/`.
   (Unifia's module manager will automate this step once the plugin is packaged.)

## Adding a game

For most PUN games, **no code** — add an entry to the launcher's profile registry
(`electron/data/game-profiles.json`) matching by Steam AppId or name, pointing at
a profile. Only games with custom connect flows, IL2CPP, or native-lobby
integration need dedicated work.

## Scope / honesty

- Targets **PUN2** (the common case). PUN classic and non-PUN stacks (Mirror,
  FishNet, NGO, Steamworks transport) are out of scope for this plugin and would
  be separate plugin families.
- The host still needs a **self-hosted Photon server** running and reachable
  (LAN, or port-forward/UPnP/overlay for WAN) — this plugin only handles the
  client side.
