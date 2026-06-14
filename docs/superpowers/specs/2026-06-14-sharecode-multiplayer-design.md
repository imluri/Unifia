# Share-Code Multiplayer (in the game page) — Design Spec

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Supersedes:** the Lobby page and the connector's "Lobby home" from
`2026-06-14-connector-identity-lobby-design.md` (Feature A). The connector store slice,
`ConnectorBadge`, and `ConnectorStatus` from Feature A are reused/re-homed here.

## Problem & goal

The separate Lobby page (TCP host/join, IP/port, UPnP, launcher-side player list) is heavier than
this game needs. For cloud Photon, everything a friend needs to play together is just **the same
Photon AppId + room code + the same mods** — which fits in a copy-paste string.

Replace the Lobby with a **Multiplayer tab inside each game's page**: enter the per-game Photon
AppId, **Generate** a shareable invite string, or **Import** a friend's string to adopt their
AppId + room and **sync mods**, then launch. Cloud Photon only. Additionally, surface a
**per-player edition label** (official vs cracked/modded) derived from each client's original
baked-in AppId.

## Scope decisions (locked)

- **Cloud-only.** Remove the Lobby page and the entire TCP broker (`network.js`) + UPnP
  (`upnp.js`). No self-hosted Photon server, no IP/port sharing, no port-forwarding.
- **Mod sync = review-then-sync.** Import fills Photon + shows a mod diff with a **Sync** button;
  no surprise downloads.
- **Per-game Photon AppId.** Move `photonAppId`/`photonVoiceAppId` from global Settings to each
  game's profile (with a one-time fallback read of the old global value for migration).
- **Edition tagging + launcher status bridge.** Connector self-reports each player's original
  AppId; launcher reads a status file and shows edition labels. Self-reported, not anti-cheat.

## Non-goals

- Self-hosted Photon, NAT traversal, port-forwarding (removed).
- Launcher-side live "who's in the lobby" via TCP (replaced by the connector status file).
- Verifying licenses / preventing cracked play (impossible without breaking crossplay; labels are
  self-reported only).
- Voice: `photonVoiceAppId` is carried in the per-game profile but **not** overridden at runtime by
  the connector (out of scope, same as today).

## Architecture

The launch path is **unchanged**: on launch, `patcher.writeNetConfig` writes `unifia_net.cfg` from
the game's `profile.netConfig`, and the connector reads it and joins the room. We only change *how
`profile.netConfig` gets populated* — from the TCP handshake to **Generate/Import of an invite
code** — and add an **edition status** read path.

### 1. Invite code (`electron/ipc/inviteCode.js`, pure + unit-tested)

A base64url string of a small JSON descriptor:

```
{ v: 1, community, name, appId, room, version, mods: [{ fullName, version }] }
```

- `community` — the game's Thunderstore community (import confirms it's the same game).
- `name` — host's game display name (for nicer preview).
- `appId` — host's Photon AppId; the joiner adopts it.
- `room` — room code (auto-generated, editable).
- `version` — host's game version (mismatch warning on import).
- `mods` — host's **enabled** mods (`fullName` + exact `version`) for syncing.

Module exports pure `encodeInvite(descriptor) -> string` and `decodeInvite(string) -> descriptor`
(throws a typed error on malformed input or unknown `v`). No I/O — fully unit-testable.

### 2. Main-process orchestration (`electron/ipc/modManager.js` + a small `multiplayer.js`)

New IPC handlers:

- `unifia:buildInvite(gameId, { appId, room })` — reads the game's enabled mods + version, mints a
  `room` if none given, builds the descriptor, **persists** `profile.netConfig` (so the host is
  ready to launch) and `profile.photonAppId`, returns the encoded string.
- `unifia:parseInvite(code)` — decodes for preview; returns the descriptor (no side effects).
- `unifia:applyInvite(gameId, code)` — validates `community` matches the game, sets
  `profile.photonAppId = appId` and `profile.netConfig` (with the local username), and returns a
  **mod diff**: `{ toInstall: [{fullName, version}], toUpdate: [{fullName, from, to}], ok: [...] }`
  computed against the game's installed mods. Does **not** install — the renderer drives sync.
- Mod sync reuses the existing `installMod(gameId, fullName, version)` per diff entry.
- `unifia:getConnectorPlayers(gameId)` — reads `<installPath>/BepInEx/config/unifia_status.json`
  (written by the connector) and returns `{ loaded, room, joined, self, players: [...] }` or null
  if absent. Each player entry: `{ nick, originalAppId, edition }` where `edition` is
  `official | modded | unknown` (see §4).

### 3. Renderer: GameDetail "Multiplayer" tab

A third tab beside Installed/Browse (installed games only; Discover/not-installed games never show
it). Top of the tab re-homes the Feature A **`ConnectorStatus`** block (install/reinstall/remove +
identity). Below it, two panels:

- **Your invite:** `Photon AppId` field (per-game, saved to profile) + `Room code` (auto-filled,
  editable) + **Generate** → shows the string in a read-only box with **Copy**.
- **Join a friend:** paste box + **Import** → preview (game name, host version vs yours with a
  warning if different) + **mod diff** ("3 to install, 1 to update, 2 match") + **Sync mods** button
  (installs the diff with per-mod progress) → "Ready — launch from the header."
- **Players (when available):** polls `getConnectorPlayers` while the tab is open and shows the
  room's players with edition labels once the game is running and the connector has written status.

The per-game `Photon AppId` field also lives here (the global Settings → Photon section is removed).

### 4. Connector C# — edition tagging + status file (`mod/UnifiaPun`)

- **Capture original AppId at load:** in `PunController.Init` (or plugin `Awake`), read
  `PhotonNetwork.PhotonServerSettings.AppSettings.AppIdRealtime` **before** any override and store
  it as `_originalAppId`.
- **Self-tag:** on connect, set `PhotonNetwork.LocalPlayer.CustomProperties` with
  `unifia_appid = _originalAppId`, and append a plain **Unifia marker** `[U]` to `NickName` so the
  game's own player list shows who came in via Unifia. The precise `official`/`modded` edition is
  **not** put in the nickname (the game list only shows names) — it lives in the custom property and
  is rendered as a label in the launcher's Multiplayer players list.
- **Edition rule:** `official` when `_originalAppId == officialAppId`, `modded` when it differs,
  `unknown` when `officialAppId` is unset — in which case the launcher groups players by raw
  `originalAppId` instead of labeling. `officialAppId` is an **optional** per-game profile field,
  edited in the Multiplayer tab's Photon settings (an "Official AppId (optional)" input); it is
  written into `unifia_profile.json` so the connector can compare. Default empty → grouping mode.
- **Status file:** maintain `BepInEx/config/unifia_status.json`, rewritten on load, join, and
  player join/leave: `{ loaded, version, room, joined, self: {nick, originalAppId, edition},
  players: [{nick, originalAppId, edition}], ts }`. Players' `originalAppId` come from their
  `unifia_appid` custom property (absent → `unknown`). This file is the launcher's window into the
  room and doubles as connector-health proof.
- Keep the Feature A sticky-reconnect behavior; AppId/room still win, region still not pinned.

### 5. Removals

- `src/pages/Lobby.jsx`, `src/components/PlayerList.jsx`, the `lobby` nav entry in `App.jsx`.
- `electron/ipc/network.js`, `electron/ipc/upnp.js`; their IPC handlers
  (`getLocalIP`/`hostSession`/`joinSession`/`stopSession`/`getPlayers`) + the `before-quit`
  `upnp.shutdown()`; preload methods.
- Store: `session`, `players`, `versionMismatch`; actions `hostSession`/`joinSession`/`stopSession`/
  `refreshPlayers`; the `player-joined`/`player-left`/`version-mismatch` event subscriptions in
  `wireEvents` and the matching preload event channels.
- Settings → Photon section (AppId fields move to the per-game Multiplayer tab).

## Data flow

```
Host:  enter AppId + room ─▶ Generate ─▶ buildInvite (reads enabled mods + version)
                                       ─▶ persists profile.netConfig + photonAppId ─▶ copy string
Joiner: paste ─▶ parseInvite (preview) ─▶ Import ─▶ applyInvite sets profile.appId + netConfig,
                                       returns mod diff ─▶ Sync (installMod per entry) ─▶ launch
Launch (unchanged): writeNetConfig ─▶ connector reads unifia_net.cfg ─▶ overrides AppId+room ─▶ joins
In-game: connector captures original AppId, tags players, writes unifia_status.json
Launcher (tab open, game running): getConnectorPlayers polls the status file ─▶ edition list
```

## Error handling

- `decodeInvite`: malformed/oversized/unknown-version → typed error → "Couldn't read this invite
  code." Wrong game → "This code is for <community>, not this game."
- Mod sync: per-mod failures surfaced inline; a mod no longer published on the hub is skipped with a
  note rather than aborting the whole sync.
- `getConnectorPlayers`: missing/locked/old status file → returns null; the tab simply shows "Launch
  the game to see players." Never throws into the UI.
- Empty/blank AppId on Generate → block with "Enter this game's Photon AppId first."

## Testing

- **`inviteCode.js`** — real `node --test` unit tests: encode→decode round-trip, `enabled` mods only
  in `mods`, unknown `v` rejected, malformed base64 rejected, oversized input rejected.
- **Mod-diff logic** — pure function `diffMods(installed, wanted)` unit-tested (install/update/ok
  partitioning).
- **Connector status parse** — pure `parseStatus(json)` unit-tested (missing fields tolerated,
  edition derivation).
- **UI / IPC** — build + manual: Generate produces a copyable string; Import previews + syncs;
  Players list populates from a hand-written `unifia_status.json`.
- **C#** — `dotnet build -c Release`; manual via BepInEx log + the status file.

## Build order (informs the plan)

1. Pure `inviteCode.js` + `diffMods` + tests.
2. Main IPC (`buildInvite`/`parseInvite`/`applyInvite`/`getConnectorPlayers`) + per-game Photon
   profile fields + preload.
3. Store: invite/sync/connector-players actions; drop the lobby/session slice.
4. GameDetail "Multiplayer" tab (re-home `ConnectorStatus`, invite/import/sync UI, players list).
5. Remove Lobby page, `network.js`, `upnp.js`, `PlayerList`, Settings Photon section, nav entry.
6. Connector C#: original-AppId capture, custom-property tag + nickname suffix, `unifia_status.json`.

Steps 1–5 deliver working share-code multiplayer; step 6 adds edition tagging and is a clean,
separable layer.
