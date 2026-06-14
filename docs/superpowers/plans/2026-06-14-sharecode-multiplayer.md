# Share-Code Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Lobby page with cloud-only "share-code" multiplayer inside each game's page — generate/import a base64 invite (Photon AppId + room + mods), review-then-sync mods, and tag player editions via the connector's original-AppId + a status file.

**Architecture:** The launch path is unchanged (`writeNetConfig` → connector joins). We change how `profile.netConfig` is populated (TCP handshake → invite code), move Photon AppId to per-game profile, delete the TCP broker, and add a connector status-file bridge for an in-launcher player/edition list.

**Tech Stack:** Electron (CommonJS main), React + Vite + zustand (ESM renderer), BepInEx/Photon C# (`mod/UnifiaPun`). Verify: renderer `npm run build`; main `node --check` + `node --test`; C# `dotnet build -c Release`.

**Spec:** `docs/superpowers/specs/2026-06-14-sharecode-multiplayer-design.md`

---

## File Structure

- **Create** `electron/ipc/inviteCode.js` (+ `.test.js`) — pure encode/decode of the invite string.
- **Create** `electron/ipc/modSync.js` (+ `.test.js`) — pure `diffMods(installed, wanted)`.
- **Create** `electron/ipc/connectorStatus.js` (+ `.test.js`) — pure `deriveEdition` + `parseStatus`.
- **Create** `electron/ipc/multiplayer.js` — main orchestration (buildInvite/parseInvite/applyInvite/getConnectorPlayers) using the pure modules + `modManager`/`profiles`/`patcher`.
- **Modify** `electron/main.js`, `electron/preload.js` — add multiplayer IPC; remove network/upnp IPC + wiring.
- **Modify** `src/store/useAppStore.js` — multiplayer actions; remove lobby/session slice.
- **Create** `src/pages/MultiplayerTab.jsx` — the Multiplayer tab body (kept out of GameDetail to keep that file focused).
- **Modify** `src/pages/GameDetail.jsx` — add the "Multiplayer" tab.
- **Delete** `src/pages/Lobby.jsx`, `src/components/PlayerList.jsx`, `electron/ipc/network.js`, `electron/ipc/upnp.js`.
- **Modify** `src/App.jsx` (drop `lobby` nav), `src/pages/Settings.jsx` (drop Photon section).
- **Modify** `mod/UnifiaPun/PunController.cs`, `mod/UnifiaPun/Plugin.cs` — edition capture + status file.

---

### Task 1: Invite code codec (pure + tested)

**Files:**
- Create: `electron/ipc/inviteCode.js`
- Test: `electron/ipc/inviteCode.test.js`

- [ ] **Step 1: Write the failing test**

`electron/ipc/inviteCode.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { encodeInvite, decodeInvite } = require('./inviteCode');

const sample = {
  community: 'repo',
  name: 'REPO',
  appId: 'abc-123',
  room: 'unifia_7F3K',
  version: '0.4.4',
  mods: [{ fullName: 'Zehs-REPOLib', version: '4.2.0' }],
};

test('round-trips a descriptor', () => {
  const decoded = decodeInvite(encodeInvite(sample));
  assert.deepStrictEqual(decoded, { v: 1, ...sample });
});

test('rejects malformed base64', () => {
  assert.throws(() => decodeInvite('not-valid-$$$'), /invite/i);
});

test('rejects unknown version', () => {
  const bad = Buffer.from(JSON.stringify({ v: 99, community: 'x' }), 'utf8').toString('base64url');
  assert.throws(() => decodeInvite(bad), /version/i);
});

test('rejects oversized input', () => {
  assert.throws(() => decodeInvite('A'.repeat(20001)), /invite/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/ipc/inviteCode.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`electron/ipc/inviteCode.js`:

```js
// Pure codec for the shareable Unifia invite string — base64url of a small JSON
// descriptor. No I/O, so it is exhaustively unit-testable.

const VERSION = 1;
const MAX_LEN = 20000; // guard against pathological paste input

// Build the canonical descriptor (drops unknown keys, normalizes mods).
function normalize(d) {
  return {
    v: VERSION,
    community: String(d.community || ''),
    name: String(d.name || ''),
    appId: String(d.appId || ''),
    room: String(d.room || ''),
    version: String(d.version || ''),
    mods: (d.mods || []).map((m) => ({ fullName: m.fullName, version: m.version })),
  };
}

function encodeInvite(descriptor) {
  const json = JSON.stringify(normalize(descriptor));
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeInvite(code) {
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_LEN) {
    throw new Error('Invalid invite code');
  }
  let obj;
  try {
    obj = JSON.parse(Buffer.from(code.trim(), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid invite code');
  }
  if (!obj || typeof obj !== 'object') throw new Error('Invalid invite code');
  if (obj.v !== VERSION) throw new Error(`Unsupported invite code version: ${obj.v}`);
  return normalize(obj);
}

module.exports = { encodeInvite, decodeInvite, VERSION };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test electron/ipc/inviteCode.test.js`
Expected: PASS (4 tests). Note: `decodeInvite` re-runs `normalize`, so the round-trip includes `v:1` — the assertion accounts for that.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/inviteCode.js electron/ipc/inviteCode.test.js
git commit -m "feat(mp): invite code codec (pure + tested)"
```

---

### Task 2: Mod diff (pure + tested)

**Files:**
- Create: `electron/ipc/modSync.js`
- Test: `electron/ipc/modSync.test.js`

- [ ] **Step 1: Write the failing test**

`electron/ipc/modSync.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { diffMods } = require('./modSync');

test('partitions install / update / ok', () => {
  const installed = [
    { fullName: 'A-Mod', version: '1.0.0' },
    { fullName: 'B-Mod', version: '2.0.0' },
  ];
  const wanted = [
    { fullName: 'A-Mod', version: '1.0.0' }, // ok
    { fullName: 'B-Mod', version: '2.1.0' }, // update
    { fullName: 'C-Mod', version: '0.5.0' }, // install
  ];
  const d = diffMods(installed, wanted);
  assert.deepStrictEqual(d.ok, [{ fullName: 'A-Mod', version: '1.0.0' }]);
  assert.deepStrictEqual(d.toUpdate, [{ fullName: 'B-Mod', from: '2.0.0', to: '2.1.0' }]);
  assert.deepStrictEqual(d.toInstall, [{ fullName: 'C-Mod', version: '0.5.0' }]);
});

test('empty wanted yields empty diff', () => {
  assert.deepStrictEqual(diffMods([{ fullName: 'A', version: '1' }], []), {
    toInstall: [], toUpdate: [], ok: [],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/ipc/modSync.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`electron/ipc/modSync.js`:

```js
// Pure mod-diff for share-code import: compare what a friend's invite wants
// against what's installed locally. No I/O.

// installed/wanted: [{ fullName, version }]. Returns partitioned changes.
function diffMods(installed, wanted) {
  const have = new Map((installed || []).map((m) => [m.fullName, m.version]));
  const toInstall = [];
  const toUpdate = [];
  const ok = [];
  for (const w of wanted || []) {
    if (!have.has(w.fullName)) {
      toInstall.push({ fullName: w.fullName, version: w.version });
    } else if (have.get(w.fullName) !== w.version) {
      toUpdate.push({ fullName: w.fullName, from: have.get(w.fullName), to: w.version });
    } else {
      ok.push({ fullName: w.fullName, version: w.version });
    }
  }
  return { toInstall, toUpdate, ok };
}

module.exports = { diffMods };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test electron/ipc/modSync.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/modSync.js electron/ipc/modSync.test.js
git commit -m "feat(mp): pure mod-diff for invite sync"
```

---

### Task 3: Connector status parse + edition (pure + tested)

**Files:**
- Create: `electron/ipc/connectorStatus.js`
- Test: `electron/ipc/connectorStatus.test.js`

- [ ] **Step 1: Write the failing test**

`electron/ipc/connectorStatus.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { deriveEdition, parseStatus } = require('./connectorStatus');

test('deriveEdition: official when matching configured id', () => {
  assert.strictEqual(deriveEdition('official-id', 'official-id'), 'official');
  assert.strictEqual(deriveEdition('other-id', 'official-id'), 'modded');
  assert.strictEqual(deriveEdition('any', ''), 'unknown');
  assert.strictEqual(deriveEdition('', 'official-id'), 'unknown');
});

test('parseStatus tolerates missing fields and derives editions', () => {
  const raw = JSON.stringify({
    loaded: true,
    room: 'unifia_AB',
    joined: true,
    self: { nick: 'Me', originalAppId: 'official-id' },
    players: [{ nick: 'Friend', originalAppId: 'crack-id' }, { nick: 'NoTag' }],
  });
  const s = parseStatus(raw, 'official-id');
  assert.strictEqual(s.joined, true);
  assert.strictEqual(s.self.edition, 'official');
  assert.strictEqual(s.players[0].edition, 'modded');
  assert.strictEqual(s.players[1].edition, 'unknown');
});

test('parseStatus returns null on garbage', () => {
  assert.strictEqual(parseStatus('not json', ''), null);
  assert.strictEqual(parseStatus('', ''), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/ipc/connectorStatus.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`electron/ipc/connectorStatus.js`:

```js
// Pure helpers for the connector's unifia_status.json. The connector reports
// each player's ORIGINAL (pre-override) Photon AppId; we label editions against
// an optional per-game official AppId. Self-reported — a transparency label,
// never a trust signal.

function deriveEdition(originalAppId, officialAppId) {
  if (!officialAppId || !originalAppId) return 'unknown';
  return originalAppId === officialAppId ? 'official' : 'modded';
}

function tagPlayer(p, officialAppId) {
  return {
    nick: p && p.nick ? String(p.nick) : '',
    originalAppId: p && p.originalAppId ? String(p.originalAppId) : '',
    edition: deriveEdition(p && p.originalAppId, officialAppId),
  };
}

// Parse the raw status file contents; returns null on any garbage so the UI can
// fall back to "launch the game to see players".
function parseStatus(raw, officialAppId) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  return {
    loaded: !!obj.loaded,
    room: obj.room ? String(obj.room) : '',
    joined: !!obj.joined,
    self: obj.self ? tagPlayer(obj.self, officialAppId) : null,
    players: Array.isArray(obj.players) ? obj.players.map((p) => tagPlayer(p, officialAppId)) : [],
  };
}

module.exports = { deriveEdition, parseStatus, tagPlayer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test electron/ipc/connectorStatus.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/connectorStatus.js electron/ipc/connectorStatus.test.js
git commit -m "feat(mp): pure connector-status parse + edition derivation"
```

---

### Task 4: Multiplayer orchestration module (main)

**Files:**
- Create: `electron/ipc/multiplayer.js`

Uses: `inviteCode`, `modSync.diffMods`, `connectorStatus.parseStatus`, plus `store`, `profiles`, `modManager` (for `getInstalledMods`), and `path`/`fs`. Reads the game from `store.get('games')`.

- [ ] **Step 1: Implement**

`electron/ipc/multiplayer.js`:

```js
const fs = require('fs');
const path = require('path');
const { store } = require('../store');
const profiles = require('./profiles');
const modManager = require('./modManager');
const { encodeInvite, decodeInvite } = require('./inviteCode');
const { diffMods } = require('./modSync');
const { parseStatus } = require('./connectorStatus');

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function getProfile(gameId) {
  return (store.get('gameProfiles') || {})[gameId] || {};
}

function saveProfile(gameId, patch) {
  const all = store.get('gameProfiles') || {};
  all[gameId] = { ...(all[gameId] || {}), ...patch };
  store.set('gameProfiles', all);
  return all[gameId];
}

function makeRoomCode() {
  return 'unifia_' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Enabled installed mods as [{ fullName, version }] for the invite payload.
function enabledMods(gameId) {
  return modManager
    .getInstalledMods(gameId)
    .filter((m) => m.enabled)
    .map((m) => ({ fullName: m.fullName, version: m.version }));
}

// Build a shareable invite for this game. Persists the host's own room descriptor
// (netConfig) + AppId so they're ready to launch, and returns the encoded string.
function buildInvite(gameId, { appId, room } = {}) {
  const game = findGame(gameId);
  const community = modManager.communityFor(game);
  const realAppId = (appId || getProfile(gameId).photonAppId || '').trim();
  if (!realAppId) throw new Error('Enter this game’s Photon AppId first.');
  const roomCode = (room || '').trim() || makeRoomCode();
  const descriptor = {
    community: community || '',
    name: game.name,
    appId: realAppId,
    room: roomCode,
    version: String(game.version || ''),
    mods: enabledMods(gameId),
  };
  // Persist so the host launches into the same room (connection mode cloud).
  saveProfile(gameId, {
    photonAppId: realAppId,
    netConfig: {
      connectionMode: 'cloud-region',
      appId: realAppId,
      roomCode,
      version: descriptor.version,
    },
  });
  return { code: encodeInvite(descriptor), room: roomCode };
}

// Decode an invite for preview only (no side effects).
function parseInvite(code) {
  return decodeInvite(code);
}

// Adopt a friend's invite: validate same game, set AppId + room descriptor,
// return the mod diff to drive review-then-sync. Does NOT install mods.
function applyInvite(gameId, code) {
  const game = findGame(gameId);
  const d = decodeInvite(code);
  const community = modManager.communityFor(game);
  if (d.community && community && d.community !== community) {
    throw new Error(`This code is for ${d.community}, not this game.`);
  }
  saveProfile(gameId, {
    photonAppId: d.appId,
    netConfig: {
      connectionMode: 'cloud-region',
      appId: d.appId,
      roomCode: d.room,
      version: d.version,
    },
  });
  const diff = diffMods(modManager.getInstalledMods(gameId), d.mods);
  return { descriptor: d, diff, hostVersion: d.version, localVersion: String(game.version || '') };
}

// Read the connector's status file (written in-game) for the player/edition list.
function getConnectorPlayers(gameId) {
  const game = findGame(gameId);
  const officialAppId = getProfile(gameId).officialAppId || '';
  const file = path.join(game.installPath, 'BepInEx', 'config', 'unifia_status.json');
  try {
    return parseStatus(fs.readFileSync(file, 'utf8'), officialAppId);
  } catch {
    return null; // not running / no file yet
  }
}

module.exports = { buildInvite, parseInvite, applyInvite, getConnectorPlayers, saveProfile };
```

- [ ] **Step 2: Syntax check**

Run: `node --check electron/ipc/multiplayer.js`
Expected: no output (OK).

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/multiplayer.js
git commit -m "feat(mp): multiplayer orchestration (buildInvite/parseInvite/applyInvite/players)"
```

---

### Task 5: IPC handlers + preload (add new, remove network/upnp)

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`

- [ ] **Step 1: main.js — require the module**

In `electron/main.js`, after `const pluginManager = require('./ipc/pluginManager');` add:

```js
const multiplayer = require('./ipc/multiplayer');
```

- [ ] **Step 2: main.js — add multiplayer handlers**

After the `handle('unifia:gameHasBepInEx', …)` line, add:

```js
  handle('unifia:buildInvite', (gameId, opts) => multiplayer.buildInvite(gameId, opts || {}));
  handle('unifia:parseInvite', (code) => multiplayer.parseInvite(code));
  handle('unifia:applyInvite', (gameId, code) => multiplayer.applyInvite(gameId, code));
  handle('unifia:getConnectorPlayers', (gameId) => multiplayer.getConnectorPlayers(gameId));
  handle('unifia:saveGameProfile', (gameId, patch) => multiplayer.saveProfile(gameId, patch || {}));
```

- [ ] **Step 3: main.js — remove network/upnp**

Delete these lines:
- `const upnp = require('./ipc/upnp');`
- `const { createNetwork } = require('./ipc/network');`
- `const network = createNetwork(emit);`
- The five handlers: `unifia:getLocalIP`, `unifia:hostSession`, `unifia:joinSession`, `unifia:stopSession`, `unifia:getPlayers`.
- In `app.on('window-all-closed', …)` remove `network.stopSession();`.
- In `app.on('before-quit', …)` remove `network.stopSession();` and `upnp.shutdown();` (delete the now-empty handler body's references; if the handler becomes empty, keep `() => {}`).

- [ ] **Step 4: preload.js — add new methods, remove old**

In the Thunderstore-mods section add:

```js
  buildInvite: (gameId, opts) => invoke('unifia:buildInvite', gameId, opts),
  parseInvite: (code) => invoke('unifia:parseInvite', code),
  applyInvite: (gameId, code) => invoke('unifia:applyInvite', gameId, code),
  getConnectorPlayers: (gameId) => invoke('unifia:getConnectorPlayers', gameId),
  saveGameProfile: (gameId, patch) => invoke('unifia:saveGameProfile', gameId, patch),
```

Remove the `Network / lobby` block (`getLocalIP`, `hostSession`, `joinSession`, `stopSession`, `getPlayers`) and the event subscriptions `onPlayerJoined`, `onPlayerLeft`, `onVersionMismatch`. Also remove `'player-joined'`, `'player-left'`, `'version-mismatch'` from the `listeners` object.

- [ ] **Step 5: Verify**

Run: `node --check electron/main.js && node --check electron/preload.js`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add electron/main.js electron/preload.js
git commit -m "feat(mp): multiplayer IPC + preload; remove network/upnp IPC"
```

---

### Task 6: Store — multiplayer actions, drop lobby slice

**Files:**
- Modify: `src/store/useAppStore.js`

- [ ] **Step 1: Remove lobby/session state**

Delete the lobby state:

```js
  // Lobby/session state
  session: null, // { role: 'host'|'client', ... }
  players: [],
  versionMismatch: null,
```

- [ ] **Step 2: Remove lobby actions + event subscriptions**

Delete the actions `hostSession`, `joinSession`, `stopSession`, `refreshPlayers` (the `// --- Lobby / session ---` block), and in `wireEvents` delete the lines:

```js
    api.onVersionMismatch((payload) => set({ versionMismatch: payload }));
    api.onPlayerJoined(() => get().refreshPlayers());
    api.onPlayerLeft(() => get().refreshPlayers());
```

- [ ] **Step 3: Add multiplayer actions**

After the connector actions (`uninstallConnector`), add:

```js

  // --- Multiplayer (share-code) ---
  connectorPlayers: {}, // gameId -> parsed status (or null)
  async buildInvite(gameId, opts) {
    return api.buildInvite(gameId, opts);
  },
  async parseInvite(code) {
    return api.parseInvite(code);
  },
  async applyInvite(gameId, code) {
    return api.applyInvite(gameId, code);
  },
  async saveGameProfile(gameId, patch) {
    const profile = await api.saveGameProfile(gameId, patch);
    set((s) => ({ gameProfiles: { ...s.gameProfiles, [gameId]: profile } }));
    return profile;
  },
  async refreshConnectorPlayers(gameId) {
    const status = await api.getConnectorPlayers(gameId);
    set((s) => ({ connectorPlayers: { ...s.connectorPlayers, [gameId]: status } }));
    return status;
  },
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built` (Lobby still imports removed store fields — it will be deleted in Task 9; if the build fails on `src/pages/Lobby.jsx`, that's expected here. To keep the build green at every commit, do Task 9's Lobby/Settings/nav deletions BEFORE building. See note.)

> **Ordering note:** Steps that remove store fields used by `Lobby.jsx`/`Settings.jsx` break their imports. To keep each commit building, perform **Task 9 (removals) immediately after Task 6's edits, before building/committing Task 6**, or combine Task 6 + Task 9 into one commit. The recommended path: make Task 6 edits, then Task 9 deletions, then build once, then commit both. Adjust the commit in Step 5 accordingly.

- [ ] **Step 5: Commit (combined with Task 9 — see note)**

```bash
git add src/store/useAppStore.js
git commit -m "feat(mp): store multiplayer actions; drop lobby/session slice"
```

---

### Task 7: MultiplayerTab component

**Files:**
- Create: `src/pages/MultiplayerTab.jsx`

Self-contained tab body. Props: `game`. Uses store actions + `ConnectorStatus`. Renders connector status, the per-game Photon AppId + optional official AppId fields, the invite generator, the import+sync panel, and the players list.

- [ ] **Step 1: Implement**

`src/pages/MultiplayerTab.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import ConnectorStatus from '../components/ConnectorStatus.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function MultiplayerTab({ game }) {
  const profile = useAppStore((s) => s.gameProfiles[game.id]) || {};
  const settings = useAppStore((s) => s.settings);
  const saveGameProfile = useAppStore((s) => s.saveGameProfile);
  const buildInvite = useAppStore((s) => s.buildInvite);
  const parseInvite = useAppStore((s) => s.parseInvite);
  const applyInvite = useAppStore((s) => s.applyInvite);
  const installMod = useAppStore((s) => s.installMod);
  const loadMods = useAppStore((s) => s.loadMods);
  const players = useAppStore((s) => s.connectorPlayers[game.id]);
  const refreshConnectorPlayers = useAppStore((s) => s.refreshConnectorPlayers);

  // Migration: fall back to the old global Settings AppId if this game has none yet.
  const [appId, setAppId] = useState(profile.photonAppId || settings?.photonAppId || '');
  const [officialAppId, setOfficialAppId] = useState(profile.officialAppId || '');
  const [room, setRoom] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState('');
  const [diff, setDiff] = useState(null);
  const [importInfo, setImportInfo] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  // Poll the connector status file while the tab is open (populated once the
  // game is running and the connector has joined).
  useEffect(() => {
    refreshConnectorPlayers(game.id);
    const t = setInterval(() => refreshConnectorPlayers(game.id), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  async function saveIds() {
    await saveGameProfile(game.id, { photonAppId: appId.trim(), officialAppId: officialAppId.trim() });
  }

  async function onGenerate() {
    setError(null);
    try {
      await saveIds();
      const res = await buildInvite(game.id, { appId: appId.trim(), room: room.trim() });
      setCode(res.code);
      setRoom(res.room);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function onImport() {
    setError(null);
    setDiff(null);
    setImportInfo(null);
    try {
      const res = await applyInvite(game.id, paste.trim());
      setDiff(res.diff);
      setImportInfo(res);
      setAppId(res.descriptor.appId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onSync() {
    if (!diff) return;
    setSyncing(true);
    setError(null);
    try {
      for (const m of [...diff.toInstall, ...diff.toUpdate]) {
        await installMod(game.id, m.fullName, m.to || m.version);
      }
      await loadMods(game);
      setDiff({ toInstall: [], toUpdate: [], ok: [...diff.ok, ...diff.toInstall, ...diff.toUpdate] });
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const pendingCount = diff ? diff.toInstall.length + diff.toUpdate.length : 0;

  return (
    <div className="flex flex-col gap-5">
      <ConnectorStatus gameId={game.id} />

      {/* Photon identity */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Photon</h3>
        <label className="mb-2 block text-xs text-neutral-400">
          AppId (the Photon app everyone shares)
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            onBlur={saveIds}
            placeholder="xxxxxxxx-xxxx-…"
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label className="block text-xs text-neutral-400">
          Official AppId (optional — labels players official vs modded)
          <input
            value={officialAppId}
            onChange={(e) => setOfficialAppId(e.target.value)}
            onBlur={saveIds}
            placeholder="leave blank to group by raw AppId"
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </section>

      {/* Your invite */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Your invite</h3>
        <div className="flex items-center gap-2">
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="room code (auto)"
            className="w-40 rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={onGenerate}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95"
          >
            Generate
          </button>
        </div>
        {code && (
          <div className="mt-3">
            <textarea
              readOnly
              value={code}
              rows={3}
              className="w-full resize-none rounded bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-300"
            />
            <button
              onClick={onCopy}
              className="mt-2 rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover"
            >
              {copied ? 'Copied ✓' : 'Copy invite'}
            </button>
            <p className="mt-1 text-xs text-neutral-500">
              Share this string. Friends paste it below, sync mods, and launch.
            </p>
          </div>
        )}
      </section>

      {/* Join a friend */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Join a friend</h3>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder="paste a friend's invite code…"
          className="w-full resize-none rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={onImport}
          disabled={!paste.trim()}
          className="mt-2 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
        >
          Import
        </button>

        {importInfo && (
          <div className="mt-3 rounded bg-neutral-900/40 px-3 py-2 text-sm">
            <p className="text-neutral-300">
              Room <span className="font-mono text-neutral-100">{importInfo.descriptor.room}</span> ·
              host v{importInfo.hostVersion}
              {importInfo.hostVersion !== importInfo.localVersion && (
                <span className="ml-1 text-yellow-400">(you have v{importInfo.localVersion})</span>
              )}
            </p>
            <p className="mt-1 text-neutral-400">
              Mods: {diff.toInstall.length} to install, {diff.toUpdate.length} to update,{' '}
              {diff.ok.length} match.
            </p>
            {pendingCount > 0 && (
              <button
                onClick={onSync}
                disabled={syncing}
                className="mt-2 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : `Sync ${pendingCount} mod${pendingCount === 1 ? '' : 's'}`}
              </button>
            )}
            {pendingCount === 0 && (
              <p className="mt-2 text-green-400">Ready — launch from the header.</p>
            )}
          </div>
        )}
      </section>

      {/* Players (from the connector status file, when running) */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Players in room</h3>
        {!players || !players.joined ? (
          <p className="text-xs text-neutral-500">Launch the game to see who&apos;s in the room.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[players.self, ...players.players].filter(Boolean).map((p, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span className="text-neutral-200">{p.nick || 'Player'}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] ${
                    p.edition === 'official'
                      ? 'bg-green-900/60 text-green-300'
                      : p.edition === 'modded'
                        ? 'bg-yellow-900/50 text-yellow-300'
                        : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {p.edition}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ built` (component not imported yet).

- [ ] **Step 3: Commit**

```bash
git add src/pages/MultiplayerTab.jsx
git commit -m "feat(mp): MultiplayerTab (invite/import/sync/players)"
```

---

### Task 8: GameDetail — add the Multiplayer tab

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Import**

After `import ConnectorBadge from '../components/ConnectorBadge.jsx';` add:

```jsx
import MultiplayerTab from './MultiplayerTab.jsx';
```

- [ ] **Step 2: Add 'multiplayer' to the tab list**

Find:

```jsx
            {(notInstalled ? ['browse'] : ['installed', 'browse']).map((t) => (
```

Replace with:

```jsx
            {(notInstalled ? ['browse'] : ['installed', 'browse', 'multiplayer']).map((t) => (
```

- [ ] **Step 3: Render the tab body**

Find the start of the installed/browse conditional:

```jsx
          {tab === 'installed' ? (
```

Change to render multiplayer first:

```jsx
          {tab === 'multiplayer' ? (
            <MultiplayerTab game={game} />
          ) : tab === 'installed' ? (
```

(The existing `) : (` for the browse branch and its closing stay as-is — this just adds one leading branch.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(mp): Multiplayer tab in GameDetail"
```

---

### Task 9: Remove Lobby, network.js, upnp.js, PlayerList, nav + Settings Photon

**Files:**
- Delete: `src/pages/Lobby.jsx`, `src/components/PlayerList.jsx`, `electron/ipc/network.js`, `electron/ipc/upnp.js`
- Modify: `src/App.jsx`, `src/pages/Settings.jsx`

> Do these edits together with Task 6 (or right after) so the build stays green.

- [ ] **Step 1: Delete files**

```bash
git rm src/pages/Lobby.jsx src/components/PlayerList.jsx electron/ipc/network.js electron/ipc/upnp.js
```

- [ ] **Step 2: App.jsx — drop the lobby route + nav + import**

In `src/App.jsx`:
- Remove `import Lobby from './pages/Lobby.jsx';`.
- Remove `{ id: 'lobby', label: 'Lobby', icon: 'globe' },` from `NAV`.
- Remove the `case 'lobby': return <Lobby />;` line in `renderPage`.

- [ ] **Step 3: Settings.jsx — remove the Photon section**

In `src/pages/Settings.jsx`, delete the whole `{/* Photon */}` `<section>…</section>` block (the `Photon (REPO)` heading + the two `TextField`s for `photonAppId` and `photonVoiceAppId`). Leave the rest of the settings untouched. If `draft.photonAppId`/`draft.photonVoiceAppId` are referenced nowhere else in the file after this, no further change is needed (they remain harmless keys in the settings object).

- [ ] **Step 4: Build + check main**

Run: `npm run build && node --check electron/main.js`
Expected: `✓ built` and OK. No remaining import of the deleted files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(mp): remove Lobby page, network.js, upnp.js, PlayerList, Settings Photon"
```

---

### Task 10: Connector C# — original-AppId capture + status file

**Files:**
- Modify: `mod/UnifiaPun/Plugin.cs`, `mod/UnifiaPun/PunController.cs`

Capture the original AppId before any override, tag the local player, append a `[U]` marker to the nickname, and (re)write `BepInEx/config/unifia_status.json` on load, join, and player join/leave.

- [ ] **Step 1: Capture original AppId at load (Plugin.cs)**

In `mod/UnifiaPun/Plugin.cs`, inside `Awake()`, immediately after `Log = Logger;` add:

```csharp
            // Capture the game's baked-in Photon AppId before anything overrides it —
            // this is the edition signal (official copy vs crack carry different ids).
            try { OriginalAppId = Photon.Pun.PhotonNetwork.PhotonServerSettings.AppSettings.AppIdRealtime; }
            catch { OriginalAppId = ""; }
```

And add a static field to the class (near `internal static ManualLogSource Log;`):

```csharp
        internal static string OriginalAppId = "";
```

- [ ] **Step 2: Tag + status fields (PunController.cs)**

In `mod/UnifiaPun/PunController.cs`, add `using System.IO;`, `using System.Collections.Generic;`, and `using BepInEx;` at the top if not present. Add a helper that writes the status file:

```csharp
        private string StatusPath()
        {
            return Path.Combine(Paths.ConfigPath, "unifia_status.json");
        }

        private static string JsonStr(string s)
        {
            return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
        }

        private void WriteStatus()
        {
            try
            {
                var sb = new System.Text.StringBuilder();
                sb.Append("{");
                sb.Append("\"loaded\":true,");
                sb.Append("\"room\":").Append(JsonStr(_net != null ? _net.RoomCode : "")).Append(",");
                sb.Append("\"joined\":").Append(PhotonNetwork.InRoom ? "true" : "false").Append(",");
                sb.Append("\"self\":").Append(PlayerJson(PhotonNetwork.LocalPlayer, UnifiaPlugin.OriginalAppId)).Append(",");
                sb.Append("\"players\":[");
                if (PhotonNetwork.InRoom)
                {
                    var others = new List<string>();
                    foreach (var p in PhotonNetwork.PlayerListOthers)
                    {
                        object appid;
                        string oid = p.CustomProperties.TryGetValue("unifia_appid", out appid) ? appid as string : "";
                        others.Add(PlayerJson(p, oid));
                    }
                    sb.Append(string.Join(",", others.ToArray()));
                }
                sb.Append("]}");
                File.WriteAllText(StatusPath(), sb.ToString());
            }
            catch (System.Exception e) { UnifiaPlugin.Log.LogWarning($"status write failed: {e.Message}"); }
        }

        private string PlayerJson(Player p, string originalAppId)
        {
            string nick = p != null ? p.NickName : "";
            return "{\"nick\":" + JsonStr(nick) + ",\"originalAppId\":" + JsonStr(originalAppId) + "}";
        }
```

- [ ] **Step 3: Set the custom property + nickname marker on join, write status on lifecycle**

In `OnJoinedRoom()` (after the existing `_reconnects = 0;`), add:

```csharp
            var props = new ExitGames.Client.Photon.Hashtable { { "unifia_appid", UnifiaPlugin.OriginalAppId } };
            PhotonNetwork.LocalPlayer.SetCustomProperties(props);
            if (!string.IsNullOrEmpty(PhotonNetwork.NickName) && !PhotonNetwork.NickName.EndsWith(" [U]"))
                PhotonNetwork.NickName = PhotonNetwork.NickName + " [U]";
            WriteStatus();
```

Add player-list callbacks to keep the file fresh:

```csharp
        public override void OnPlayerEnteredRoom(Player newPlayer) { WriteStatus(); }
        public override void OnPlayerLeftRoom(Player otherPlayer) { WriteStatus(); }
        public override void OnPlayerPropertiesUpdate(Player target, ExitGames.Client.Photon.Hashtable changedProps) { WriteStatus(); }
```

Also call `WriteStatus();` at the end of `Init(...)` (so "loaded" appears even before joining), and in `OnDisconnected` after logging (so `joined:false` is reflected).

- [ ] **Step 4: Build the plugin**

Run: `dotnet build -c Release mod/UnifiaPun/UnifiaPun.csproj`
Expected: `Build succeeded.`

(If `dotnet` is unavailable, the edits are self-contained; note it for the human to build in Visual Studio. `Paths.ConfigPath` comes from `BepInEx`; `Player`/`PhotonNetwork`/`ExitGames…Hashtable` come from the already-referenced Photon assemblies.)

- [ ] **Step 5: Commit**

```bash
git add mod/UnifiaPun/Plugin.cs mod/UnifiaPun/PunController.cs
git commit -m "feat(mp): connector original-AppId capture, player tag, status file"
```

---

## Notes for the implementer

- **Build-green ordering:** Tasks 6 and 9 are interdependent (removing store fields breaks `Lobby.jsx`; deleting `Lobby.jsx` removes the consumer). Execute Task 6 edits, then Task 9 deletions, then build once. Commit either as two commits in quick succession or one combined commit — just don't build/commit Task 6 alone.
- `modManager.communityFor(game)` and `modManager.getInstalledMods(gameId)` already exist and are exported — use them; don't reimplement community mapping.
- The launch path (`patcher.writeNetConfig`, connector reading `unifia_net.cfg`) is unchanged. `applyInvite`/`buildInvite` only populate `profile.netConfig`; launching writes the cfg as today.
- Don't add region anywhere — cloud-region mode with no `FixedRegion` (the connector already stopped pinning region in the prior feature).
- `installMod(gameId, fullName, version)` is the existing store action; reuse it for sync (it also clears progress + refreshes installed mods).
- After all tasks: final whole-feature review, then finish the branch (merge to main + push) per the standing workflow.
```
