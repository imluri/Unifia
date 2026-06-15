# Netcode Analyzer + Auto-Profiler — Design Spec

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Goal

Give Unifia the ability to statically analyze a Mono Unity game's `Assembly-CSharp.dll`, classify its
networking stack (PUN2 / Steam lobbies / Steam auth / …), surface the **host/join/auth hook points**,
and **auto-populate the connector's per-game profile** (`netcode`, `hookStrategy`,
`connectHookType`/`connectHookMethod`) that the BepInEx connector already consumes. This replaces
hand-authoring per-game profiles and tells users honestly which games are feasible.

## Scope

In: a bundled .NET (Mono.Cecil) analyzer exe; launcher integration that runs it and maps the report
to a connector profile; a feasibility classifier; a Multiplayer-tab UI surfacing the findings.

Out: the actual **reroute recipes** / writing REPO's crossplay patch (the analyzer *enables* that,
doesn't do it); **IL2CPP** games (no managed assembly — Cecil can't read them); non-Windows analyzer
builds. The connector's runtime hook machinery (`HarmonyHooks.Apply`) is unchanged.

## Non-goals / honesty

The analyzer finds *where* a game does networking, not *how to correctly reroute it*. Knowing REPO's
join method does not encode REPO's host-assignment/session-setup semantics. So the deliverable is an
**investigation + auto-profiling aid + feasibility detector**, not a crossplay solver.

## Architecture

### 1. Analyzer tool — `tools/UnifiaAnalyzer` (new C# project)

A self-contained single-file console exe using **Mono.Cecil**.

- **Input:** path to `Assembly-CSharp.dll` (CLI arg). Reads it with `AssemblyDefinition.ReadAssembly`.
  No assembly *resolution* needed — call targets are matched by the `MethodReference`'s
  `DeclaringType.FullName` + `Name` read directly from the IL operand, so missing Photon/Steamworks
  assemblies don't matter.
- **Scan:** iterate every `TypeDefinition` → `MethodDefinition` with a body → each `Instruction`
  whose `OpCode` is `Call`/`Callvirt`/`Newobj`; resolve the target's declaring-type full name +
  method name; match against the **pattern catalog**. Record `{ api, role, type, method }` where
  `type`/`method` are the **containing** type+method (the hook candidate).
- **Pattern catalog** (embedded constant list): `{ declaringTypeContains, method, role, netcode? }`:
  - `Photon.Pun.PhotonNetwork` · `ConnectUsingSettings` → role `connect`, netcode `pun2`
  - `Photon.Pun.PhotonNetwork` · `JoinOrCreateRoom`/`JoinRoom` → role `join`, netcode `pun2`
  - `Photon.Pun.PhotonNetwork` · `CreateRoom` → role `host`, netcode `pun2`
  - `Photon.Realtime.AuthenticationValues` (newobj / `SetAuthPostData`) → role `authValues`, `pun2`
  - `Steamworks.SteamUser` · `GetAuthSessionTicket` → role `authTicket`, flag `usesSteamAuth`
  - `Steamworks.SteamMatchmaking` · `CreateLobby`/`JoinLobby` → role `steamLobby`, flag `usesSteamLobbies`
  - `Mirror.NetworkManager`/`FishNet.*` markers → netcode `mirror`/`fishnet`
  (Catalog is the core IP and is unit-tested; matching is by called-API, robust across games.)
- **Output (stdout JSON, schema 1):**
  ```json
  {
    "schema": 1,
    "netcode": "pun2|pun1|mirror|fishnet|unknown",
    "usesSteamLobbies": true,
    "usesSteamAuth": true,
    "hooks": {
      "connect":    { "type": "Full.Type", "method": "Name" },
      "host":       { "type": "...", "method": "..." },
      "join":       { "type": "...", "method": "..." },
      "authTicket": { "type": "...", "method": "..." }
    },
    "matches": [ { "api": "...", "role": "...", "type": "...", "method": "..." } ],
    "feasibility": "supported|needs-reroute|unsupported|unknown",
    "confidence": 0.0
  }
  ```
  When a role has multiple containing methods, the first/most-referenced wins for the `hooks` slot;
  all are kept in `matches` for evidence. **Feasibility** (computed here AND recomputable in JS):
  `pun2 && usesSteamLobbies → needs-reroute`; `pun2 && !usesSteamLobbies → supported`;
  `mirror|fishnet → unsupported` (connector is PUN-only); else `unknown`.
- **Errors:** unreadable/locked/IL2CPP/non-.NET file → exit non-zero with a JSON `{ error, netcode:
  "unknown", feasibility: "unknown" }` so the launcher always gets structured output.

### 2. Launcher integration — `electron/ipc/analyzer.js`

- `resolveAnalyzerExe()` — packaged `process.resourcesPath/analyzer/UnifiaAnalyzer.exe`, else dev
  `tools/UnifiaAnalyzer/bin/Release/.../UnifiaAnalyzer.exe` (same pattern as `resolvePluginDll`).
- `findManagedAssembly(installPath)` — locate `*_Data/Managed/Assembly-CSharp.dll` under the game.
- `analyzeGame(gameId)` — resolve game; if `unityBackend === 'il2cpp'` short-circuit to
  `{ feasibility: 'unsupported', reason: 'IL2CPP' }` (Unifia already detects backend); else find the
  assembly, `execFile` the analyzer exe, parse JSON. Cache the report in `store` under
  `gameAnalysis[gameId]`. Map → profile and persist (see §3). Returns the report.
- IPC `unifia:analyzeGame` + preload `analyzeGame(gameId)`.

### 3. Auto-profiler mapping — pure `mapReportToProfile(report)`

`electron/ipc/profileMap.js` (pure, unit-tested):
```
mapReportToProfile(report) -> {
  netcode: report.netcode,                 // 'pun2' etc.
  feasibility: report.feasibility,
  hookStrategy:                            // how the connector activates
    report.hooks.join ? 'reconnect-on-load'
    : report.netcode === 'pun2' ? 'auto-on-load'
    : 'manual',
  connectHookType:   (report.hooks.join || report.hooks.connect || {}).type   || '',
  connectHookMethod: (report.hooks.join || report.hooks.connect || {}).method || '',
}
```
`analyzer.js` writes this into `gameProfiles[gameId]` (store). **`profiles.matchProfile` is extended**
to merge the per-game stored override last: `{ ...base, ...registryEntry.profile, ...storedOverride }`
(import `store`, read `gameProfiles[gameId]`, pick the analyzer-owned keys). So
`writeProfileConfig(installPath, matchProfile(game))` emits the discovered hooks, and the connector's
existing `HarmonyHooks.Apply(connectHookType, connectHookMethod)` uses them — **no connector change**.

### 4. UI — Multiplayer tab

A card: **"Analyze multiplayer"** button (auto-runs once on tab open if no cached report, installed
Mono games only). Renders: netcode, Steam lobby/auth flags, feasibility badge
(`supported`/`needs-reroute`/`unsupported`/`unknown` with color), and the discovered hook points
(`Join → X.JoinGame`). A short explainer per feasibility so expectations are honest (e.g.
"needs-reroute: PUN + Steam lobbies — hooks found, but a game-specific reroute is still required").
Store slice: `analysis: {}` keyed by gameId + `analyzeGame(gameId)` action.

### 5. Build & bundling

- `tools/UnifiaAnalyzer/UnifiaAnalyzer.csproj` (net8.0, `PackageReference Mono.Cecil`).
- Publish: `dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true`
  → `UnifiaAnalyzer.exe`.
- electron-builder `extraResources` adds `{ from: "tools/UnifiaAnalyzer/bin/Release/net8.0/win-x64/publish/UnifiaAnalyzer.exe", to: "analyzer/UnifiaAnalyzer.exe" }`.
- `npm run dist` gains a pre-step (or documented manual step) to publish the analyzer before
  packaging.

## Data flow

```
Open installed Mono game ─▶ analyzeGame ─▶ UnifiaAnalyzer.exe Assembly-CSharp.dll
   ─▶ JSON report ─▶ cache (gameAnalysis) + mapReportToProfile ─▶ gameProfiles[gameId]
   ─▶ UI shows netcode / feasibility / hooks
Launch (unchanged) ─▶ writeProfileConfig(matchProfile(game)) ─▶ unifia_profile.json
   ─▶ connector HarmonyHooks.Apply(connectHookType, connectHookMethod)
```

## Error handling

- IL2CPP / missing / unreadable assembly → `feasibility: 'unsupported'|'unknown'` + a clear UI note;
  never blocks.
- Analyzer non-zero exit / timeout (cap ~30 s) → structured `unknown`, surfaced as a toast/inline.
- `mapReportToProfile` tolerates missing hook slots (empty strings) — the connector falls back to
  `manual` behavior, exactly as today for un-profiled games.

## Testing

- **Analyzer (C#):** unit tests against a small synthetic assembly compiled with known
  Photon/Steamworks call sites (or a checked-in fixture DLL) — assert netcode, flags, and that the
  containing method is reported as the hook.
- **`mapReportToProfile` (JS):** `node --test` with fixture reports — pun2+steamLobby → needs-reroute
  + reconnect-on-load + join hook; pun2-only → supported + auto-on-load; mirror → unsupported.
- **Integration:** manual on REPO — expect `pun2`, `usesSteamLobbies`, `usesSteamAuth`, hooks found,
  `needs-reroute`.

## Build order (informs the plan)

1. `tools/UnifiaAnalyzer` — Cecil project, pattern catalog, report JSON + C# tests.
2. `profileMap.js` `mapReportToProfile` (pure) + tests.
3. `analyzer.js` (resolve exe, find assembly, run, cache, map) + IPC + preload; extend
   `profiles.matchProfile` to merge the per-game override.
4. electron-builder `extraResources` for the analyzer exe + `dist` publish step.
5. Store `analysis` slice + Multiplayer-tab "Analyze multiplayer" card.
