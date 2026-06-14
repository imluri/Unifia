# Connector Identity & Lobby Integration — Design Spec

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Feature:** A (of a two-part effort; Feature B = per-game Photon IDs + shareable invite code, specced separately later)

## Problem

The Unifia connector plugin (`Unifia.Pun.dll`) is what makes the **Lobby** work in-game — it
repoints Photon PUN at the shared room. But today it is:

- managed inside the **Module modal** (which is otherwise about the BepInEx *loader*), so it reads
  as just another loader setting;
- invisible on the **Lobby** page that actually depends on it — you can "host"/"join" a game whose
  connector isn't installed and nothing tells you;
- visually indistinguishable from community Thunderstore mods, with no identity of its own.

Users conflate "installed Thunderstore mods" with "the Unifia connector that powers the Lobby."

## Goals

1. Give the connector a distinct **Unifia identity** wherever it appears.
2. Make the **Lobby** the connector's management home (install / reinstall / remove).
3. Show a pinned, **read-only status row** in the Installed tab so users see it's present and
   distinct from community mods.
4. Make the connector's Photon settings **reliably win at runtime** ("runs on top") — specifically
   it must match the host's **AppId (key) + room**, re-asserting after any disruption.

## Non-goals (explicit)

- **Region handling.** REPO (and Photon games generally) expose Photon's own region selector
  in-game; players match region there. The connector will **not** pin `FixedRegion` — it leaves
  whatever the game/player chose. There is no region setting in Unifia.
- Per-game Photon AppIds and the shareable "Unifia invite code" — that's Feature B.
- BepInEx Awake-time load ordering. Activation is runtime, so order is moot; "on top" is achieved
  by the runtime re-assert (Goal 4), not load priority metadata.

## Architecture

### 1. Store: connector-status slice (single source of truth)

`src/store/useAppStore.js` gains:

- State: `connector: {}` — a map `gameId -> { available, pluginInstalled, bepinexInstalled }`
  (the shape already returned by `getPluginStatus`).
- `async refreshConnector(gameId)` → calls `api.getPluginStatus(gameId)`, writes
  `connector[gameId]`; on error writes `null` for that id.
- `async installConnector(gameId)` → `api.installPlugin(gameId)`, stores returned status.
- `async uninstallConnector(gameId)` → `api.uninstallPlugin(gameId)`, stores returned status.
- `loadMods(game)` additionally calls `refreshConnector(game.id)` for installed games (so the
  Installed-tab row is populated when a game opens).

Both the Lobby and the Installed tab read from this one cache, so status stays consistent and there
is no ad-hoc per-component fetching.

### 2. `ConnectorBadge` (identity)

New `src/components/ConnectorBadge.jsx`: the Unifia textless mark (`unifia_logo_notext.png`, added
to `src/assets/` for renderer import) + an accent-tinted "Unifia · connector" label. Small, reused
by both the Lobby status and the Installed-tab row so the component is unmistakably a system
component, never mistaken for a community mod.

### 3. `ConnectorStatus` (Lobby — the management home)

New `src/components/ConnectorStatus.jsx`, rendered in **both** the Host and Join tabs of
`src/pages/Lobby.jsx`, directly under the game picker, shown once a game is selected. States:

- `available:false` (DLL not built) → dev hint: "Plugin not built — run dotnet build in
  mod/UnifiaPun."
- `pluginInstalled:false` → `ConnectorBadge` + "Required for Unifia multiplayer." + **Install**
  button (`installConnector`).
- `pluginInstalled:true` → `ConnectorBadge` + "Installed ✓" + quiet **Reinstall** and **Remove**
  links.
- `pluginInstalled:true && bepinexInstalled:false` → the existing "BepInEx isn't in the game folder
  yet — it deploys on launch and the plugin loads then" note.

On game select, the tab calls `refreshConnector(gameId)`.

### 4. Installed tab: pinned read-only row

In `src/pages/GameDetail.jsx`, above the Thunderstore mod rows (separated by a divider), render a
specially-styled **read-only** row using `ConnectorBadge`: "Installed ✓" / "Not installed", with a
quiet "Manage in Lobby →" hint (no actions here — actions live in the Lobby). Reads
`connector[game.id]` from the store. Only shown for installed (non-Discover) games.

### 5. Module modal: remove the connector section

Delete the entire "Unifia connector plugin" block (and its `pluginStatus`/`togglePlugin` state) from
`src/components/GameModuleModal.jsx`, so that modal is purely the BepInEx loader. This is the core
de-confusion.

### 6. Connector C#: "win the Photon settings" (sticky)

In `mod/UnifiaPun/PunController.cs`:

- Add an `_engaged` flag set `true` on `Activate()` and cleared only by a user-initiated stop.
- **Cloud mode:** stop setting `app.FixedRegion` — leave the game's/player's chosen region intact.
  Continue to set `AppIdRealtime` (when a real AppId is supplied), `NickName`, and `GameVersion`,
  and join the room. The settings the connector asserts are **AppId + room (+ version)** only.
- In `OnDisconnected(cause)`: if `_engaged` and the disconnect was **not** one the connector caused
  itself, re-assert AppId + room + version and reconnect after a short backoff (e.g. 1–2 s, capped
  retries). So if the game or another mod yanks Photon back to its own AppId, the connector
  re-applies and rejoins — its key always wins after any disruption.
- Distinguish self-caused disconnects: the `PhotonNetwork.Disconnect()` the connector calls at the
  top of `Activate()` (before reconnecting) and a user-initiated stop must set a short-lived
  `_selfDisconnect` flag so `OnDisconnected` skips the reconnect path for those and never loops.

(Alternative considered: per-frame re-assert in `Update()`. Rejected — event-driven sticky-reconnect
avoids polling and only acts when something actually changed.)

## Data flow

```
Lobby (Host/Join) ── select game ─▶ refreshConnector(id) ─▶ store.connector[id]
            │                                                      ▲
            └─ Install / Reinstall / Remove ─▶ IPC ───────────────┘
GameDetail.loadMods(game) ─▶ refreshConnector(game.id) ─▶ Installed-tab pinned row reads store.connector[game.id]
In-game: connector engaged ─▶ on unexpected disconnect ─▶ re-assert AppId+room+version ─▶ rejoin
```

## Error handling

- `getPluginStatus` failure → `connector[id] = null` → UI shows "Checking…"/unknown, never a false
  "not installed."
- Install/remove errors surfaced inline in the Lobby status block.
- Connector reconnect: capped retries with backoff; on user stop, `_engaged=false` so it does not
  fight an intentional disconnect.

## Testing

- **JS:** the connector store slice is thin IPC wrappers; smoke-test that `refreshConnector` /
  `installConnector` / `uninstallConnector` update `connector[id]` from a mocked `window.unifia`.
- **UI:** manual — Lobby shows correct status per game; Installed tab shows the pinned row; Module
  modal no longer has the connector block.
- **C# (no test harness in repo):** manual verification via the BepInEx log — confirm the
  `loaded.`/`Joined Unifia room` lines, then force a disconnect and confirm the connector
  re-asserts the AppId and rejoins the same room without pinning region.

## Out of scope → Feature B

Per-game Photon AppId/Voice entry and a copy-paste base64 "Unifia invite code" bundling
AppId + room + server/version for one-paste joining.
