# Connector Identity & Lobby Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Unifia connector plugin a distinct identity, make the Lobby its management home, surface a read-only status row in the Installed tab, remove it from the Module modal, and make its Photon AppId/room reliably win at runtime.

**Architecture:** A single store slice (`connector[gameId]`) backs both the Lobby and the Installed tab. Two new small renderer components (`ConnectorBadge`, `ConnectorStatus`) give it identity and a management surface. The C# `PunController` becomes "sticky" — it re-asserts the host's AppId + room (never the region) and rejoins after any unexpected disconnect.

**Tech Stack:** Electron (CommonJS main), React + Vite + zustand (ESM renderer), BepInEx/Photon C# plugin (`mod/UnifiaPun`). Renderer verified with `npm run build`; main with `node --check`; C# with `dotnet build -c Release`.

**Spec:** `docs/superpowers/specs/2026-06-14-connector-identity-lobby-design.md`

---

## File Structure

- **Modify** `src/store/useAppStore.js` — add `connector` state + `refreshConnector`/`installConnector`/`uninstallConnector`; call `refreshConnector` from `loadMods`.
- **Create** `src/assets/unifia_logo_notext.png` — copy of the repo-root textless mark, importable by the renderer.
- **Create** `src/components/ConnectorBadge.jsx` — Unifia identity chip (logo + "Unifia · connector").
- **Create** `src/components/ConnectorStatus.jsx` — Lobby status + install/reinstall/remove for a gameId.
- **Modify** `src/pages/Lobby.jsx` — render `ConnectorStatus` under the game picker in Host and Join tabs.
- **Modify** `src/pages/GameDetail.jsx` — pinned read-only connector row above the Installed mods.
- **Modify** `src/components/GameModuleModal.jsx` — delete the connector block + its state.
- **Modify** `mod/UnifiaPun/PunController.cs` — sticky reconnect; stop pinning region.

---

### Task 1: Store connector slice

**Files:**
- Modify: `src/store/useAppStore.js`

The mod state block currently ends with `bepInExOnDisk: false,` (around line 40). The games actions include `removeGame` (around line 110). `loadMods(game, …)` (around line 185) loads mods for the open game.

- [ ] **Step 1: Add connector state**

In `src/store/useAppStore.js`, find:

```js
  bepInExOnDisk: false, // a BepInEx loader is already present in the game folder
```

Add immediately after it:

```js

  // Unifia connector plugin status, keyed by gameId:
  // { available, pluginInstalled, bepinexInstalled }. Backs both the Lobby and
  // the Installed-tab status row. null for a gameId means "status check failed".
  connector: {},
```

- [ ] **Step 2: Add connector actions**

In the same file, find the games action:

```js
  async removeGame(gameId) {
    await api.removeGame(gameId);
    set((s) => ({ games: s.games.filter((g) => g.id !== gameId) }));
  },
```

Add immediately after it:

```js

  // --- Unifia connector plugin (per game) ---
  async refreshConnector(gameId) {
    if (!gameId) return;
    try {
      const status = await api.getPluginStatus(gameId);
      set((s) => ({ connector: { ...s.connector, [gameId]: status } }));
    } catch {
      set((s) => ({ connector: { ...s.connector, [gameId]: null } }));
    }
  },
  async installConnector(gameId) {
    const status = await api.installPlugin(gameId);
    set((s) => ({ connector: { ...s.connector, [gameId]: status } }));
    return status;
  },
  async uninstallConnector(gameId) {
    const status = await api.uninstallPlugin(gameId);
    set((s) => ({ connector: { ...s.connector, [gameId]: status } }));
    return status;
  },
```

- [ ] **Step 3: Refresh connector when a game opens**

In `loadMods`, find this block (installed-game branch that resolves `bepInExOnDisk`):

```js
      const [{ hubs, packages }, installed, bepInExOnDisk] = await Promise.all([
        listPromise,
        api.getInstalledMods(game.id),
        // Not-installed Discover games have no install folder to inspect.
        notInstalled ? Promise.resolve(false) : api.gameHasBepInEx(game.id),
      ]);
      set({ modList: packages, modHubs: hubs, installedMods: installed, bepInExOnDisk });
```

Immediately after the `set(...)` line above, add:

```js
      // Connector status powers the Installed-tab pinned row (installed games only).
      if (!notInstalled) get().refreshConnector(game.id);
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.js
git commit -m "feat(connector): store connector-status slice + loadMods refresh"
```

---

### Task 2: Textless logo asset + ConnectorBadge

**Files:**
- Create: `src/assets/unifia_logo_notext.png`
- Create: `src/components/ConnectorBadge.jsx`

- [ ] **Step 1: Copy the textless mark into renderer assets**

The textless logo already exists at the repo root. Copy it where Vite can import it:

```bash
cp unifia_logo_notext.png src/assets/unifia_logo_notext.png
```

- [ ] **Step 2: Create the badge component**

Create `src/components/ConnectorBadge.jsx`:

```jsx
import React from 'react';
import logo from '../assets/unifia_logo_notext.png';

// Identity chip for the Unifia connector plugin — distinguishes it from community
// Thunderstore mods wherever it appears (Lobby status, Installed-tab row).
export default function ConnectorBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <img src={logo} alt="" className="h-4 w-4 rounded-sm object-contain" />
      <span className="text-sm font-medium text-neutral-100">Unifia</span>
      <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
        connector
      </span>
    </span>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` (component not imported yet, so Vite leaves it out — build stays green).

- [ ] **Step 4: Commit**

```bash
git add src/assets/unifia_logo_notext.png src/components/ConnectorBadge.jsx
git commit -m "feat(connector): ConnectorBadge identity component"
```

---

### Task 3: ConnectorStatus component (Lobby surface)

**Files:**
- Create: `src/components/ConnectorStatus.jsx`

This is the Lobby's management surface for one game. It reads `connector[gameId]` from the store, refreshes on mount/gameId change, and exposes install/reinstall/remove.

- [ ] **Step 1: Create the component**

Create `src/components/ConnectorStatus.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import ConnectorBadge from './ConnectorBadge.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Connector install/status surface for a single game, used by both Lobby tabs.
// The connector is what repoints Photon at the shared room, so the Lobby is its
// home. Renders nothing until a game is selected.
export default function ConnectorStatus({ gameId }) {
  const status = useAppStore((s) => s.connector[gameId]);
  const refreshConnector = useAppStore((s) => s.refreshConnector);
  const installConnector = useAppStore((s) => s.installConnector);
  const uninstallConnector = useAppStore((s) => s.uninstallConnector);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (gameId) refreshConnector(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (!gameId) return null;

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn(gameId);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const installed = status?.pluginInstalled;
  const available = status?.available;

  return (
    <div className="rounded border border-border-default bg-neutral-900/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ConnectorBadge />
          {installed && (
            <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs text-green-300">
              Installed ✓
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status === undefined ? (
            <span className="text-xs text-neutral-500">Checking…</span>
          ) : !available ? (
            <span className="text-xs text-yellow-500/80">Not built</span>
          ) : !installed ? (
            <button
              onClick={() => act(installConnector)}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
          ) : (
            <>
              <button
                onClick={() => act(installConnector)}
                disabled={busy}
                title="Copy the latest built DLL over the installed one"
                className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover disabled:opacity-50"
              >
                Reinstall
              </button>
              <button
                onClick={() => act(uninstallConnector)}
                disabled={busy}
                className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/60 disabled:opacity-50"
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">
        {!available
          ? 'Plugin not built — run dotnet build in mod/UnifiaPun.'
          : !installed
            ? 'Required for Unifia multiplayer — repoints the game at the shared room.'
            : status && !status.bepinexInstalled
              ? "BepInEx isn't in the game folder yet — it deploys on launch and the plugin loads then."
              : 'Repoints the game at the shared Unifia room on launch.'}
      </p>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ built` (not imported yet — stays green).

- [ ] **Step 3: Commit**

```bash
git add src/components/ConnectorStatus.jsx
git commit -m "feat(connector): ConnectorStatus lobby surface component"
```

---

### Task 4: Wire ConnectorStatus into both Lobby tabs

**Files:**
- Modify: `src/pages/Lobby.jsx`

Both `HostTab` and `JoinTab` have a local `gameId` state and a `<GamePicker games={games} value={gameId} onChange={setGameId} />`. Add the connector status right after the game picker's grid row in each.

- [ ] **Step 1: Import the component**

In `src/pages/Lobby.jsx`, find:

```jsx
import Icon from '../components/Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';
```

Change to:

```jsx
import Icon from '../components/Icon.jsx';
import ConnectorStatus from '../components/ConnectorStatus.jsx';
import { useAppStore } from '../store/useAppStore.js';
```

- [ ] **Step 2: Add to HostTab**

In `HostTab`, find this closing of the game-picker grid (the first occurrence):

```jsx
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Port</span>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
```

Immediately after that closing `</div>`, add:

```jsx

      {gameId && <ConnectorStatus gameId={gameId} />}
```

- [ ] **Step 3: Add to JoinTab**

In `JoinTab`, find this closing of its game-picker grid:

```jsx
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Host IP:PORT</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="192.168.1.10:7777"
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
```

Immediately after that closing `</div>`, add:

```jsx

      {gameId && <ConnectorStatus gameId={gameId} />}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Lobby.jsx
git commit -m "feat(connector): show ConnectorStatus in Lobby host + join tabs"
```

---

### Task 5: Pinned read-only connector row in the Installed tab

**Files:**
- Modify: `src/pages/GameDetail.jsx`

The Installed tab renders inside `{tab === 'installed' ? (<div className="flex flex-col gap-2">…</div>)`. Add a read-only connector row above the mod rows. Read connector status from the store.

- [ ] **Step 1: Import the badge and select connector status**

In `src/pages/GameDetail.jsx`, find:

```jsx
import InstalledModRow from '../components/InstalledModRow.jsx';
```

Add after it:

```jsx
import ConnectorBadge from '../components/ConnectorBadge.jsx';
```

Then find the selector block (near the other `useAppStore` selectors):

```jsx
  const bepInExOnDisk = useAppStore((s) => s.bepInExOnDisk);
```

Add after it:

```jsx
  const connector = useAppStore((s) => s.connector[game?.id]);
```

- [ ] **Step 2: Render the pinned row**

Find the Installed-tab body:

```jsx
          {tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              {modsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-[68px] rounded" />
                ))
              ) : installedMods.length === 0 ? (
                <p className="text-sm text-neutral-500">No mods installed yet. Switch to Browse.</p>
              ) : (
                installedMods.map((m) => <InstalledModRow key={m.fullName} game={game} mod={m} />)
              )}
            </div>
          ) : (
```

Replace it with:

```jsx
          {tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              {/* Pinned, read-only: the Unifia connector is a system component,
                  not a community mod. Manage it from the Lobby. */}
              <div className="flex items-center justify-between gap-3 rounded border border-accent/30 bg-accent/5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <ConnectorBadge />
                  {connector?.pluginInstalled ? (
                    <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs text-green-300">
                      Installed ✓
                    </span>
                  ) : (
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                      Not installed
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-500">Manage in Lobby →</span>
              </div>
              <div className="my-1 border-t border-border-subtle" />

              {modsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-[68px] rounded" />
                ))
              ) : installedMods.length === 0 ? (
                <p className="text-sm text-neutral-500">No mods installed yet. Switch to Browse.</p>
              ) : (
                installedMods.map((m) => <InstalledModRow key={m.fullName} game={game} mod={m} />)
              )}
            </div>
          ) : (
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(connector): pinned read-only connector row in Installed tab"
```

---

### Task 6: Remove the connector block from the Module modal

**Files:**
- Modify: `src/components/GameModuleModal.jsx`

The connector now lives in the Lobby, so strip it from the loader modal. There are three pieces to remove: the plugin state, the helpers, and the JSX block.

- [ ] **Step 1: Remove plugin state**

In `src/components/GameModuleModal.jsx`, delete:

```jsx
  // Unifia connector plugin (Unifia.Pun.dll) status for this game.
  const [pluginStatus, setPluginStatus] = useState(null);
  const [pluginBusy, setPluginBusy] = useState(false);

  async function refreshPluginStatus(id) {
    try {
      setPluginStatus(await window.unifia.getPluginStatus(id));
    } catch {
      setPluginStatus(null);
    }
  }

  useEffect(() => {
    if (game) refreshPluginStatus(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  async function togglePlugin(install) {
    setPluginBusy(true);
    setError(null);
    try {
      const next = install
        ? await window.unifia.installPlugin(game.id)
        : await window.unifia.uninstallPlugin(game.id);
      setPluginStatus(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setPluginBusy(false);
    }
  }
```

- [ ] **Step 2: Remove the connector JSX block**

Delete the entire connector block (the comment `{/* Unifia connector plugin */}` and the `<div className="rounded border border-border-default …">…</div>` that follows, including the trailing BepInEx-not-present `{pluginStatus && … }` paragraph inside it). It begins:

```jsx
          {/* Unifia connector plugin */}
          <div className="rounded border border-border-default bg-neutral-900/40 px-3 py-2.5">
```

and ends with the matching `</div>` just before:

```jsx
          {/* Module type selector (recommended by detected backend) */}
```

Remove everything from `{/* Unifia connector plugin */}` through its closing `</div>` (inclusive), leaving the "Active-for-this-game status" block above it and the "Module type selector" block below it untouched.

- [ ] **Step 3: Drop the now-unused `useEffect` import if unreferenced**

After removing the block, check whether `useEffect` is still used elsewhere in the file (it is — the file imports `React, { useEffect, useState }` but the only `useEffect` was the plugin one). If no `useEffect` remains, change:

```jsx
import React, { useEffect, useState } from 'react';
```

to:

```jsx
import React, { useState } from 'react';
```

Run `npx eslint src/components/GameModuleModal.jsx` if available, or rely on the build — Vite will not error on an unused import, so verify by searching the file for `useEffect(` and removing the import only if there are zero matches.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/components/GameModuleModal.jsx
git commit -m "refactor(connector): remove connector block from Module modal"
```

---

### Task 7: Connector C# — sticky win-settings, no region pin

**Files:**
- Modify: `mod/UnifiaPun/PunController.cs`

Make the connector re-assert AppId + room + version and rejoin after any unexpected disconnect, capped to avoid loops, and stop pinning the region (REPO has its own Photon region selector). There is no in-game stop UI, so `_engaged` stays true for the session; the only self-caused disconnect to guard is the pre-connect `Disconnect()` in `Activate()`.

- [ ] **Step 1: Add sticky fields**

In `mod/UnifiaPun/PunController.cs`, find:

```csharp
        private NetConfig _net;
        private UnifiaProfile _profile;
        private bool _activating;
        private float _autoTimer = -1f;
```

Replace with:

```csharp
        private const float ReconnectBackoff = 2f;
        private const int MaxReconnects = 5;

        private NetConfig _net;
        private UnifiaProfile _profile;
        private bool _activating;
        private float _autoTimer = -1f;

        // Once activated we stay "engaged" for the session and re-assert our
        // settings if anything knocks us off, so the host's AppId/room win.
        private bool _engaged;
        private bool _selfDisconnect; // guards the pre-connect Disconnect() below
        private float _reconnectTimer = -1f;
        private int _reconnects;
```

- [ ] **Step 2: Engage on activate, guard self-disconnect, stop pinning region**

Find the body of `Activate()` from the activating-guard down through the cloud-mode branch:

```csharp
            _activating = true;
            var mode = string.IsNullOrEmpty(_net.ConnectionMode) ? "cloud-region" : _net.ConnectionMode;
            UnifiaPlugin.Log.LogInfo($"Activating Unifia ({mode}) → room '{_net.RoomCode}'…");

            if (PhotonNetwork.IsConnected)
                PhotonNetwork.Disconnect();

            var app = PhotonNetwork.PhotonServerSettings.AppSettings;
            // Only swap the AppId for a real one — never clobber the game's own
            // Photon Cloud AppId with the self-hosted placeholder in cloud mode.
            bool overrideAppId = !string.IsNullOrEmpty(_net.AppId) && _net.AppId != "unifia-local";

            if (mode == "self-hosted")
            {
                // Point straight at the host's self-hosted Photon server.
                app.UseNameServer = false;
                app.Server = _net.ServerIP;
                app.Port = _net.Port;
                app.FixedRegion = "";
                if (!string.IsNullOrEmpty(_net.AppId)) app.AppIdRealtime = _net.AppId;
            }
            else
            {
                // Stay on Photon Cloud but pin everyone to one region + room so
                // cross-store players converge. Keep the game's own AppId.
                app.UseNameServer = true;
                app.Server = "";
                app.FixedRegion = string.IsNullOrEmpty(_net.Region) ? "" : _net.Region;
                if (overrideAppId) app.AppIdRealtime = _net.AppId;
            }
```

Replace with:

```csharp
            _activating = true;
            _engaged = true;
            var mode = string.IsNullOrEmpty(_net.ConnectionMode) ? "cloud-region" : _net.ConnectionMode;
            UnifiaPlugin.Log.LogInfo($"Activating Unifia ({mode}) → room '{_net.RoomCode}'…");

            if (PhotonNetwork.IsConnected)
            {
                _selfDisconnect = true; // our own teardown — don't treat as a knock-off
                PhotonNetwork.Disconnect();
            }

            var app = PhotonNetwork.PhotonServerSettings.AppSettings;
            // Only swap the AppId for a real one — never clobber the game's own
            // Photon Cloud AppId with the self-hosted placeholder in cloud mode.
            bool overrideAppId = !string.IsNullOrEmpty(_net.AppId) && _net.AppId != "unifia-local";

            if (mode == "self-hosted")
            {
                // Point straight at the host's self-hosted Photon server.
                app.UseNameServer = false;
                app.Server = _net.ServerIP;
                app.Port = _net.Port;
                app.FixedRegion = "";
                if (!string.IsNullOrEmpty(_net.AppId)) app.AppIdRealtime = _net.AppId;
            }
            else
            {
                // Stay on Photon Cloud. Match only the AppId (the "key") — the game
                // exposes its own Photon region selector, so leave FixedRegion as the
                // player set it and never pin a region from Unifia.
                app.UseNameServer = true;
                app.Server = "";
                if (overrideAppId) app.AppIdRealtime = _net.AppId;
            }
```

- [ ] **Step 3: Add a reconnect timer to Update()**

Find:

```csharp
        private void Update()
        {
            if (_autoTimer > 0f)
            {
                _autoTimer -= Time.deltaTime;
                if (_autoTimer <= 0f) Activate();
            }
            if (Input.GetKeyDown(Hotkey)) Activate();
        }
```

Replace with:

```csharp
        private void Update()
        {
            if (_autoTimer > 0f)
            {
                _autoTimer -= Time.deltaTime;
                if (_autoTimer <= 0f) Activate();
            }
            if (_reconnectTimer > 0f)
            {
                _reconnectTimer -= Time.deltaTime;
                if (_reconnectTimer <= 0f)
                {
                    _reconnectTimer = -1f;
                    Activate(); // re-asserts AppId + room and reconnects
                }
            }
            if (Input.GetKeyDown(Hotkey)) Activate();
        }
```

- [ ] **Step 4: Reset retry count on join, re-assert on unexpected disconnect**

Find:

```csharp
        public override void OnJoinedRoom()
        {
            _activating = false;
            int count = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;
            UnifiaPlugin.Log.LogInfo($"Joined Unifia room '{_net.RoomCode}' ({count} players).");
        }

        public override void OnJoinRoomFailed(short returnCode, string message)
        {
            _activating = false;
            UnifiaPlugin.Log.LogWarning($"JoinRoom failed ({returnCode}): {message}");
        }

        public override void OnDisconnected(DisconnectCause cause)
        {
            _activating = false;
            UnifiaPlugin.Log.LogInfo($"Disconnected: {cause}");
        }
```

Replace with:

```csharp
        public override void OnJoinedRoom()
        {
            _activating = false;
            _reconnects = 0; // back in the room — reset the re-assert budget
            int count = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;
            UnifiaPlugin.Log.LogInfo($"Joined Unifia room '{_net.RoomCode}' ({count} players).");
        }

        public override void OnJoinRoomFailed(short returnCode, string message)
        {
            _activating = false;
            UnifiaPlugin.Log.LogWarning($"JoinRoom failed ({returnCode}): {message}");
        }

        public override void OnDisconnected(DisconnectCause cause)
        {
            _activating = false;

            // Our own pre-connect teardown — expected, don't fight it.
            if (_selfDisconnect)
            {
                _selfDisconnect = false;
                UnifiaPlugin.Log.LogInfo($"Disconnected (self): {cause}");
                return;
            }

            UnifiaPlugin.Log.LogInfo($"Disconnected: {cause}");

            // Something knocked us off (the game's own connect flow, another mod,
            // a transient drop). Re-assert our AppId + room and rejoin so the
            // host's settings win — capped so we never loop forever.
            if (_engaged && _reconnects < MaxReconnects)
            {
                _reconnects++;
                _reconnectTimer = ReconnectBackoff;
                UnifiaPlugin.Log.LogInfo(
                    $"Re-asserting Unifia (attempt {_reconnects}/{MaxReconnects}) in {ReconnectBackoff}s…");
            }
        }
```

- [ ] **Step 5: Build the plugin**

Run: `dotnet build -c Release mod/UnifiaPun/UnifiaPun.csproj`
Expected: `Build succeeded.` and a refreshed `mod/UnifiaPun/bin/Release/Unifia.Pun.dll`.

(If `dotnet` isn't on PATH in this environment, the C# edits are still complete and syntactically self-contained; note it and let the human build in Visual Studio.)

- [ ] **Step 6: Commit**

```bash
git add mod/UnifiaPun/PunController.cs
git commit -m "feat(connector): sticky re-assert of AppId+room, stop pinning region"
```

---

## Notes for the implementer

- The connector status shape `{ available, pluginInstalled, bepinexInstalled }` comes straight from `pluginManager.getPluginStatus` — don't invent fields.
- `api` in the store is the `window.unifia` bridge; `getPluginStatus`/`installPlugin`/`uninstallPlugin` already exist in `electron/preload.js`. No new IPC is needed for this feature.
- Discover (not-installed) games never show the connector row or refresh connector status — the Installed tab guards on `game.installed === false` already, and `loadMods` only refreshes the connector for installed games.
- Don't touch the lobby networking / `unifia_net.cfg` writing or the `network.js` descriptor — region stays in the descriptor but the connector simply ignores it now. (Removing the descriptor's region field is Feature B cleanup, out of scope.)
- After all tasks: dispatch a final whole-feature review, then finish the branch (merge to main + push) per the repo's standing workflow.
