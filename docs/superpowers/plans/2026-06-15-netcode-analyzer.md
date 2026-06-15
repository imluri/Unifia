# Netcode Analyzer + Auto-Profiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bundled Mono.Cecil analyzer that classifies a Mono game's netcode + finds host/join/auth hook points, and an auto-profiler that maps the report into the connector's existing per-game profile fields.

**Architecture:** A self-contained .NET exe (`tools/UnifiaAnalyzer`, Mono.Cecil) emits a JSON report from `Assembly-CSharp.dll`. `electron/ipc/analyzer.js` runs it, caches the report, and a pure `mapReportToProfile()` writes the connector profile fields into `gameProfiles`; `profiles.matchProfile` merges them so the existing `unifia_profile.json` → `HarmonyHooks` path consumes them. A Multiplayer-tab card surfaces findings.

**Tech Stack:** .NET 9 (Mono.Cecil), Electron main (CommonJS), React/zustand renderer. Verify: `dotnet build`/run, `node --test`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-06-15-netcode-analyzer-design.md`

---

## File Structure

- **Create** `tools/UnifiaAnalyzer/UnifiaAnalyzer.csproj`, `tools/UnifiaAnalyzer/Program.cs` — the analyzer.
- **Create** `electron/ipc/profileMap.js` (+ `.test.js`) — pure report→profile mapping.
- **Create** `electron/ipc/analyzer.js` — locate assembly, run exe, cache, map.
- **Modify** `electron/main.js`, `electron/preload.js` — `unifia:analyzeGame` IPC + preload.
- **Modify** `electron/ipc/profiles.js` — merge per-game analyzer override in `matchProfile`.
- **Modify** `package.json` — `extraResources` for the analyzer exe.
- **Modify** `src/store/useAppStore.js` — `analysis` slice + `analyzeGame` action.
- **Create** `src/components/NetcodeCard.jsx` — the Multiplayer-tab analysis card.
- **Modify** `src/pages/MultiplayerTab.jsx` — render `NetcodeCard`.

---

### Task 1: Analyzer .NET project (Mono.Cecil)

**Files:**
- Create: `tools/UnifiaAnalyzer/UnifiaAnalyzer.csproj`
- Create: `tools/UnifiaAnalyzer/Program.cs`

- [ ] **Step 1: Create the csproj**

`tools/UnifiaAnalyzer/UnifiaAnalyzer.csproj`:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <AssemblyName>UnifiaAnalyzer</AssemblyName>
    <Nullable>disable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <InvariantGlobalization>true</InvariantGlobalization>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Mono.Cecil" Version="0.11.5" />
  </ItemGroup>
</Project>
```

- [ ] **Step 2: Implement the analyzer**

`tools/UnifiaAnalyzer/Program.cs`:

```csharp
using System.Text.Json;
using Mono.Cecil;
using Mono.Cecil.Cil;

// UnifiaAnalyzer <path-to-Assembly-CSharp.dll>
// Scans IL for known Photon/Steamworks call sites and prints a JSON report.

static class Catalog
{
    // declaringTypeContains, method, role, netcode (null = no netcode signal)
    public static readonly (string Type, string Method, string Role, string Netcode)[] Rules =
    {
        ("Photon.Pun.PhotonNetwork", "ConnectUsingSettings", "connect", "pun2"),
        ("Photon.Pun.PhotonNetwork", "JoinOrCreateRoom",     "join",    "pun2"),
        ("Photon.Pun.PhotonNetwork", "JoinRoom",             "join",    "pun2"),
        ("Photon.Pun.PhotonNetwork", "CreateRoom",           "host",    "pun2"),
        ("Photon.Realtime.AuthenticationValues", ".ctor",    "authValues", "pun2"),
        ("Steamworks.SteamUser",        "GetAuthSessionTicket", "authTicket", null),
        ("Steamworks.SteamMatchmaking", "CreateLobby",          "steamLobby", null),
        ("Steamworks.SteamMatchmaking", "JoinLobby",            "steamLobby", null),
        ("Mirror.NetworkManager",  "StartHost",   "host",    "mirror"),
        ("FishNet.Managing.NetworkManager", "", "connect",   "fishnet"),
    };
}

record Hook(string type, string method);

class Report
{
    public int schema { get; set; } = 1;
    public string netcode { get; set; } = "unknown";
    public bool usesSteamLobbies { get; set; }
    public bool usesSteamAuth { get; set; }
    public Dictionary<string, Hook> hooks { get; set; } = new();
    public List<object> matches { get; set; } = new();
    public string feasibility { get; set; } = "unknown";
    public double confidence { get; set; }
    public string error { get; set; }
}

class Program
{
    static int Main(string[] args)
    {
        var opts = new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
        if (args.Length < 1)
        {
            Console.WriteLine(JsonSerializer.Serialize(new Report { error = "usage: UnifiaAnalyzer <assembly.dll>" }, opts));
            return 2;
        }
        var report = new Report();
        try
        {
            var asm = AssemblyDefinition.ReadAssembly(args[0]);
            foreach (var type in AllTypes(asm.MainModule))
            {
                foreach (var method in type.Methods)
                {
                    if (!method.HasBody) continue;
                    foreach (var ins in method.Body.Instructions)
                    {
                        if (ins.OpCode.Code != Code.Call && ins.OpCode.Code != Code.Callvirt && ins.OpCode.Code != Code.Newobj)
                            continue;
                        if (ins.Operand is not MethodReference mref) continue;
                        var declTypeFull = mref.DeclaringType?.FullName ?? "";
                        var calledName = mref.Name ?? "";
                        foreach (var rule in Catalog.Rules)
                        {
                            bool nameOk = rule.Method.Length == 0 || calledName == rule.Method;
                            if (!declTypeFull.Contains(rule.Type) || !nameOk) continue;
                            ApplyMatch(report, rule, type.FullName, method.Name);
                        }
                    }
                }
            }
            Finalize(report);
        }
        catch (Exception e)
        {
            report.error = e.Message;
            report.netcode = "unknown";
            report.feasibility = "unknown";
            Console.WriteLine(JsonSerializer.Serialize(report, opts));
            return 1;
        }
        Console.WriteLine(JsonSerializer.Serialize(report, opts));
        return 0;
    }

    static IEnumerable<TypeDefinition> AllTypes(ModuleDefinition mod)
    {
        foreach (var t in mod.Types)
        {
            yield return t;
            foreach (var n in Nested(t)) yield return n;
        }
    }
    static IEnumerable<TypeDefinition> Nested(TypeDefinition t)
    {
        foreach (var n in t.NestedTypes)
        {
            yield return n;
            foreach (var nn in Nested(n)) yield return nn;
        }
    }

    static void ApplyMatch(Report r, (string Type, string Method, string Role, string Netcode) rule, string containingType, string containingMethod)
    {
        r.matches.Add(new { api = rule.Type + "::" + rule.Method, role = rule.Role, type = containingType, method = containingMethod });
        if (rule.Role == "steamLobby") r.usesSteamLobbies = true;
        if (rule.Role is "authTicket" or "authValues") r.usesSteamAuth = r.usesSteamAuth || rule.Role == "authTicket";
        if (rule.Netcode != null && r.netcode == "unknown") r.netcode = rule.Netcode;
        // First container wins for the named hook slots.
        if (rule.Role is "connect" or "host" or "join" or "authTicket" && !r.hooks.ContainsKey(rule.Role))
            r.hooks[rule.Role] = new Hook(containingType, containingMethod);
    }

    static void Finalize(Report r)
    {
        if (r.netcode == "pun2")
            r.feasibility = r.usesSteamLobbies ? "needs-reroute" : "supported";
        else if (r.netcode is "mirror" or "fishnet")
            r.feasibility = "unsupported";
        else
            r.feasibility = "unknown";
        r.confidence = r.matches.Count == 0 ? 0.0 : Math.Min(1.0, 0.4 + 0.1 * r.matches.Count);
    }
}
```

- [ ] **Step 3: Build it**

Run: `dotnet build -c Release tools/UnifiaAnalyzer/UnifiaAnalyzer.csproj`
Expected: `Build succeeded.`

- [ ] **Step 4: Integration-verify against a real game**

Run it against REPO's managed assembly (adjust path to your install):
`tools/UnifiaAnalyzer/bin/Release/net9.0/UnifiaAnalyzer.exe "C:/Games/REPO.v.0.4.4.3-Riruka24/REPO_Data/Managed/Assembly-CSharp.dll"`
Expected JSON: `"netcode":"pun2"`, `"usesSteamLobbies":true`, `"usesSteamAuth":true`, `"feasibility":"needs-reroute"`, and `hooks.join` pointing at REPO's join method. (If the path differs, point at any Mono PUN game's `*_Data/Managed/Assembly-CSharp.dll`.)

- [ ] **Step 5: Commit**

```bash
git add tools/UnifiaAnalyzer/UnifiaAnalyzer.csproj tools/UnifiaAnalyzer/Program.cs
git commit -m "feat(analyzer): Mono.Cecil netcode analyzer (Photon/Steam pattern scan)"
```

---

### Task 2: Pure report→profile mapping

**Files:**
- Create: `electron/ipc/profileMap.js`
- Test: `electron/ipc/profileMap.test.js`

- [ ] **Step 1: Write the failing test**

`electron/ipc/profileMap.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { mapReportToProfile } = require('./profileMap');

test('pun2 + steam lobby → needs-reroute, reconnect-on-load, join hook', () => {
  const p = mapReportToProfile({
    netcode: 'pun2', usesSteamLobbies: true, feasibility: 'needs-reroute',
    hooks: { join: { type: 'REPO.Net', method: 'JoinGame' } },
  });
  assert.strictEqual(p.netcode, 'pun2');
  assert.strictEqual(p.feasibility, 'needs-reroute');
  assert.strictEqual(p.hookStrategy, 'reconnect-on-load');
  assert.strictEqual(p.connectHookType, 'REPO.Net');
  assert.strictEqual(p.connectHookMethod, 'JoinGame');
});

test('pun2, no steam lobby → supported, auto-on-load', () => {
  const p = mapReportToProfile({ netcode: 'pun2', usesSteamLobbies: false, feasibility: 'supported', hooks: {} });
  assert.strictEqual(p.hookStrategy, 'auto-on-load');
  assert.strictEqual(p.connectHookType, '');
});

test('unknown netcode → manual, empty hooks', () => {
  const p = mapReportToProfile({ netcode: 'unknown', feasibility: 'unknown', hooks: {} });
  assert.strictEqual(p.hookStrategy, 'manual');
  assert.strictEqual(p.connectHookMethod, '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test electron/ipc/profileMap.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`electron/ipc/profileMap.js`:

```js
// Pure mapping from an analyzer report to the connector's per-game profile
// fields (netcode/hookStrategy/connectHookType/connectHookMethod/feasibility).
function mapReportToProfile(report) {
  const hooks = report.hooks || {};
  const hook = hooks.join || hooks.connect || {};
  const hookStrategy = hooks.join
    ? 'reconnect-on-load'
    : report.netcode === 'pun2'
      ? 'auto-on-load'
      : 'manual';
  return {
    netcode: report.netcode || 'unknown',
    feasibility: report.feasibility || 'unknown',
    hookStrategy,
    connectHookType: hook.type || '',
    connectHookMethod: hook.method || '',
  };
}

module.exports = { mapReportToProfile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test electron/ipc/profileMap.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/profileMap.js electron/ipc/profileMap.test.js
git commit -m "feat(analyzer): pure report→connector-profile mapping + tests"
```

---

### Task 3: Launcher analyzer module + IPC + profile merge

**Files:**
- Create: `electron/ipc/analyzer.js`
- Modify: `electron/main.js`, `electron/preload.js`, `electron/ipc/profiles.js`

- [ ] **Step 1: Implement analyzer.js**

`electron/ipc/analyzer.js`:

```js
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');
const { store } = require('../store');
const { mapReportToProfile } = require('./profileMap');

const EXE = 'UnifiaAnalyzer.exe';

// Locate the bundled analyzer exe (packaged) or the dev build output.
function resolveAnalyzerExe() {
  const candidates = [
    path.join(process.resourcesPath || '', 'analyzer', EXE),
    path.join(app.getAppPath(), 'resources', 'analyzer', EXE),
    path.join(__dirname, '..', '..', 'tools', 'UnifiaAnalyzer', 'bin', 'Release', 'net9.0', EXE),
    path.join(__dirname, '..', '..', 'tools', 'UnifiaAnalyzer', 'bin', 'Release', 'net9.0', 'win-x64', 'publish', EXE),
  ];
  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

// Find <game>/*_Data/Managed/Assembly-CSharp.dll under the install folder.
function findManagedAssembly(installPath) {
  try {
    for (const entry of fs.readdirSync(installPath, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.endsWith('_Data')) {
        const dll = path.join(installPath, entry.name, 'Managed', 'Assembly-CSharp.dll');
        if (fs.existsSync(dll)) return dll;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function runExe(exe, dll) {
  return new Promise((resolve) => {
    execFile(exe, [dll], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ netcode: 'unknown', feasibility: 'unknown', error: err ? err.message : 'analyzer produced no JSON' });
      }
    });
  });
}

// Persist the analyzer-derived profile fields into the game's profile so
// matchProfile/writeProfileConfig emit them for the connector.
function saveProfileFromReport(gameId, report) {
  const mapped = mapReportToProfile(report);
  const all = store.get('gameProfiles') || {};
  all[gameId] = { ...(all[gameId] || {}), analysis: mapped };
  store.set('gameProfiles', all);
  return mapped;
}

// Analyze a game's networking. IL2CPP games have no managed assembly.
async function analyzeGame(gameId) {
  const game = findGame(gameId);
  if (game.unityBackend === 'il2cpp') {
    const report = { netcode: 'unknown', feasibility: 'unsupported', reason: 'IL2CPP — no managed assembly' };
    store.set('gameAnalysis', { ...(store.get('gameAnalysis') || {}), [gameId]: report });
    return report;
  }
  const exe = resolveAnalyzerExe();
  if (!exe) throw new Error('Analyzer not built — run dotnet build in tools/UnifiaAnalyzer.');
  const dll = findManagedAssembly(game.installPath);
  if (!dll) {
    const report = { netcode: 'unknown', feasibility: 'unknown', reason: 'No Assembly-CSharp.dll found' };
    store.set('gameAnalysis', { ...(store.get('gameAnalysis') || {}), [gameId]: report });
    return report;
  }
  const report = await runExe(exe, dll);
  store.set('gameAnalysis', { ...(store.get('gameAnalysis') || {}), [gameId]: report });
  if (!report.error) saveProfileFromReport(gameId, report);
  return report;
}

module.exports = { analyzeGame, resolveAnalyzerExe, findManagedAssembly };
```

- [ ] **Step 2: main.js — require + handler**

In `electron/main.js`, after `const presets = require('./ipc/presets');` add:

```js
const analyzer = require('./ipc/analyzer');
```

After the presets handlers add:

```js
  handle('unifia:analyzeGame', (gameId) => analyzer.analyzeGame(gameId));
```

- [ ] **Step 3: preload.js — method**

After the preset preload block add:

```js
  analyzeGame: (gameId) => invoke('unifia:analyzeGame', gameId),
```

- [ ] **Step 4: profiles.js — merge the per-game analyzer override**

In `electron/ipc/profiles.js`, add `const { store } = require('../store');` at the top, and a helper
that picks the analyzer-owned keys from the stored profile, then merge it last in `matchProfile`.
Replace the `matchProfile` body's two `return { ...base, ...entry.profile };` and the final return so
each merges the override:

```js
const { store } = require('../store');

// Analyzer-owned fields written by the auto-profiler (gameProfiles[id].analysis).
function storedOverride(game) {
  const a = ((store.get('gameProfiles') || {})[game.id] || {}).analysis;
  if (!a) return {};
  return {
    netcode: a.netcode,
    hookStrategy: a.hookStrategy,
    connectHookType: a.connectHookType,
    connectHookMethod: a.connectHookMethod,
  };
}
```

Then in `matchProfile`, change the registry-match returns to
`return { ...base, ...entry.profile, ...storedOverride(game) };` (both the steamAppId and namePattern
branches) and the final default return to
`return { ...base, game: game.name, module, ...storedOverride(game) };`.

- [ ] **Step 5: Verify**

Run: `node --check electron/ipc/analyzer.js && node --check electron/main.js && node --check electron/preload.js && node --check electron/ipc/profiles.js`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add electron/ipc/analyzer.js electron/main.js electron/preload.js electron/ipc/profiles.js
git commit -m "feat(analyzer): analyzeGame IPC + auto-profiler merge into matchProfile"
```

---

### Task 4: Bundle the analyzer in the installer

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add extraResources entry**

In `package.json` `build.extraResources`, add the analyzer next to the connector DLL:

```json
    "extraResources": [
      {
        "from": "mod/UnifiaPun/bin/Release/Unifia.Pun.dll",
        "to": "plugins/Unifia.Pun.dll"
      },
      {
        "from": "tools/UnifiaAnalyzer/bin/Release/net9.0/win-x64/publish/UnifiaAnalyzer.exe",
        "to": "analyzer/UnifiaAnalyzer.exe"
      }
    ],
```

- [ ] **Step 2: Document the publish step**

The `dist` build needs the analyzer published self-contained first. Verify the publish command
produces the exe at the `from` path:

Run: `dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true tools/UnifiaAnalyzer/UnifiaAnalyzer.csproj`
Expected: `UnifiaAnalyzer.exe` at `tools/UnifiaAnalyzer/bin/Release/net9.0/win-x64/publish/UnifiaAnalyzer.exe`.

(Release builds: publish the analyzer + `dotnet build -c Release mod/UnifiaPun` before `npm run dist`.)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: bundle UnifiaAnalyzer.exe in the installer"
```

---

### Task 5: Store slice + Multiplayer-tab card

**Files:**
- Modify: `src/store/useAppStore.js`
- Create: `src/components/NetcodeCard.jsx`
- Modify: `src/pages/MultiplayerTab.jsx`

- [ ] **Step 1: Store — analysis slice + action**

In `src/store/useAppStore.js`, after the `refreshConnectorPlayers` action add:

```js

  // --- Netcode analysis ---
  analysis: {}, // gameId -> report
  async analyzeGame(gameId) {
    const report = await api.analyzeGame(gameId);
    set((s) => ({ analysis: { ...s.analysis, [gameId]: report } }));
    return report;
  },
```

- [ ] **Step 2: NetcodeCard component**

`src/components/NetcodeCard.jsx`:

```jsx
import React, { useEffect, useState } from 'react';
import Button from './ui/Button.jsx';
import { useAppStore } from '../store/useAppStore.js';

const FEASIBILITY = {
  supported: { label: 'Supported', cls: 'bg-green-900/60 text-green-300' },
  'needs-reroute': { label: 'Needs reroute', cls: 'bg-yellow-900/50 text-yellow-300' },
  unsupported: { label: 'Unsupported', cls: 'bg-red-900/50 text-red-300' },
  unknown: { label: 'Unknown', cls: 'bg-neutral-800 text-neutral-400' },
};
const EXPLAIN = {
  supported: 'Plain Photon rooms — the connector can join by code directly.',
  'needs-reroute': 'Photon + Steam lobbies — hook points found, but a game-specific reroute is still required.',
  unsupported: 'Not a Photon game (or IL2CPP) — the connector can’t drive this netcode.',
  unknown: 'Couldn’t analyze this game’s assembly.',
};

export default function NetcodeCard({ game }) {
  const report = useAppStore((s) => s.analysis[game.id]);
  const analyzeGame = useAppStore((s) => s.analyzeGame);
  const pushToast = useAppStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await analyzeGame(game.id);
    } catch (err) {
      pushToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Auto-run once when the tab opens, if we have no cached report.
  useEffect(() => {
    if (!report && !busy) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const feas = FEASIBILITY[report?.feasibility] || FEASIBILITY.unknown;

  return (
    <section className="rounded border border-border-subtle bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-200">Netcode analysis</h3>
        <Button size="sm" loading={busy} onClick={run}>Analyze</Button>
      </div>
      {!report ? (
        <p className="text-xs text-neutral-500">{busy ? 'Analyzing…' : 'Not analyzed yet.'}</p>
      ) : (
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-300">Netcode: <span className="font-mono">{report.netcode}</span></span>
            {report.usesSteamLobbies && <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">Steam lobbies</span>}
            {report.usesSteamAuth && <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">Steam auth</span>}
            <span className={`rounded px-2 py-0.5 text-[10px] ${feas.cls}`}>{feas.label}</span>
          </div>
          <p className="text-xs text-neutral-500">{EXPLAIN[report?.feasibility] || EXPLAIN.unknown}</p>
          {report.hooks?.join && (
            <p className="text-xs text-neutral-400">
              Join hook: <span className="font-mono text-neutral-300">{report.hooks.join.type}.{report.hooks.join.method}</span>
            </p>
          )}
          {report.reason && <p className="text-xs text-neutral-500">{report.reason}</p>}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Render it in the Multiplayer tab**

In `src/pages/MultiplayerTab.jsx`, add `import NetcodeCard from '../components/NetcodeCard.jsx';`
and render `<NetcodeCard game={game} />` right after the `<ConnectorStatus gameId={game.id} />` line.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.js src/components/NetcodeCard.jsx src/pages/MultiplayerTab.jsx
git commit -m "feat(analyzer): netcode analysis card in the Multiplayer tab"
```

---

## Notes for the implementer

- The analyzer matches call targets by **name** read from the IL operand — it never needs to resolve
  Photon/Steamworks assemblies, so a missing `libs/` folder is fine (unlike the connector build).
- Only run the analyzer for **Mono** games — `analyzeGame` short-circuits IL2CPP via the existing
  `game.unityBackend` detection.
- `matchProfile` must merge **only** the analyzer-owned keys (netcode/hookStrategy/connectHookType/
  connectHookMethod); do not spill `gameProfiles` fields like `photonAppId`/`netConfig` into the
  network profile.
- This plan does **not** implement reroute recipes — `needs-reroute` games surface their hooks but
  the actual patch is separate, per-netcode work.
- Release builds must `dotnet publish` the analyzer (Task 4 Step 2) and `dotnet build -c Release` the
  connector before `npm run dist`.
- After all tasks: final whole-feature review, then finish the branch (merge to main + push) per the
  standing workflow.
```
