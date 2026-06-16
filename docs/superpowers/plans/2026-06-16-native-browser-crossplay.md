# Native-Browser Crossplay (Inject-Settings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the F9/reconnect crossplay model with `inject-settings`: the connector overwrites the Photon AppId/AppVersion at the game's native connect so both copies meet in the game's own server browser — no disconnect, no room codes.

**Architecture:** A recipe carries a shared community Photon AppId + version + the hook target. The launcher resolves the effective AppId (a Settings private override beats the community value) and writes it to `unifia_profile.json`. The connector registers a Harmony postfix on `DataDirector.PhotonSetAppId` that overwrites `AppSettings.AppIdRealtime/AppIdVoice/AppVersion`, then gets out of the way. The reconnect/F9 path is removed.

**Tech Stack:** Node (electron main, `node:test`), C# (BepInEx/HarmonyX mod, net472), React renderer.

**Reference:** Spec at `docs/superpowers/specs/2026-06-16-native-browser-crossplay-design.md`.

---

### Task 1: Recipe vocabulary — `photonAppId` / `photonVoiceAppId`

**Files:**
- Modify: `electron/ipc/recipes.js` (`FIELD_TYPES`)
- Modify: `electron/ipc/recipes.test.js`

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/recipes.test.js`:

```js
test('validateRecipe keeps photonAppId/photonVoiceAppId strings and drops non-strings', () => {
  const ok = R.validateRecipe({ schemaVersion: 1, id: 'x', profile: {
    photonAppId: 'abc-123', photonVoiceAppId: 'def-456' } }, '0.1.1');
  assert.strictEqual(ok.profile.photonAppId, 'abc-123');
  assert.strictEqual(ok.profile.photonVoiceAppId, 'def-456');
  const bad = R.validateRecipe({ schemaVersion: 1, id: 'x', profile: { photonAppId: 7 } }, '0.1.1');
  assert.strictEqual('photonAppId' in bad.profile, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test electron/ipc/recipes.test.js`
Expected: FAIL — `photonAppId` is dropped (not in allowlist), so `ok.profile.photonAppId` is undefined.

- [ ] **Step 3: Add the fields to the allowlist**

In `electron/ipc/recipes.js`, in `FIELD_TYPES`, after `photonAppVersion`:

```js
  photonAppVersion: 'string',
  photonAppId: 'string',
  photonVoiceAppId: 'string',
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test electron/ipc/recipes.test.js`
Expected: PASS — all green (the prior cases plus the new one).

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/recipes.js electron/ipc/recipes.test.js
git commit -m "feat(recipes): photonAppId/photonVoiceAppId vocabulary"
```

End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 2: Launcher — effective-AppId resolution (Settings override → recipe)

**Files:**
- Modify: `electron/ipc/profiles.js` (add pure `applyAppIdOverride`, export it)
- Modify: `electron/ipc/launcher.js` (use it when writing the profile)
- Test: `electron/ipc/profiles.test.js`

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/profiles.test.js`:

```js
const { applyAppIdOverride } = require('./profiles');

test('applyAppIdOverride: settings override wins over recipe community AppId', () => {
  const out = applyAppIdOverride(
    { photonAppId: 'community', photonVoiceAppId: 'community-v', game: 'REPO' },
    { photonAppIdOverride: 'mine', photonVoiceAppIdOverride: 'mine-v' });
  assert.strictEqual(out.photonAppId, 'mine');
  assert.strictEqual(out.photonVoiceAppId, 'mine-v');
  assert.strictEqual(out.game, 'REPO');
});

test('applyAppIdOverride: blank/absent override keeps the recipe community AppId', () => {
  const out = applyAppIdOverride(
    { photonAppId: 'community', photonVoiceAppId: 'community-v' },
    { photonAppIdOverride: '   ' });
  assert.strictEqual(out.photonAppId, 'community');
  assert.strictEqual(out.photonVoiceAppId, 'community-v');
});

test('applyAppIdOverride: no settings object is a no-op', () => {
  const out = applyAppIdOverride({ photonAppId: 'community' }, undefined);
  assert.strictEqual(out.photonAppId, 'community');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test electron/ipc/profiles.test.js`
Expected: FAIL — `applyAppIdOverride is not a function`.

- [ ] **Step 3: Implement `applyAppIdOverride`**

In `electron/ipc/profiles.js`, add this pure function above `module.exports`, and add it to the exports:

```js
// Overlay a user's private Photon AppId (from settings) onto a resolved profile.
// A non-empty override beats the recipe's community AppId; blank/absent keeps it.
function applyAppIdOverride(profile, settings) {
  const s = settings || {};
  const out = { ...profile };
  const id = (s.photonAppIdOverride || '').trim();
  const voice = (s.photonVoiceAppIdOverride || '').trim();
  if (id) out.photonAppId = id;
  if (voice) out.photonVoiceAppId = voice;
  return out;
}
```

```js
module.exports = { matchProfile, resolveProfile, applyAppIdOverride, loadRegistry };
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test electron/ipc/profiles.test.js`
Expected: PASS — all green (3 prior + 3 new = 6).

- [ ] **Step 5: Wire it into the launch profile write**

In `electron/ipc/launcher.js`, find the profile write (around line 84):

```js
    patcher.writeProfileConfig(game.installPath, profiles.matchProfile(game));
```

Replace with:

```js
    patcher.writeProfileConfig(
      game.installPath,
      profiles.applyAppIdOverride(profiles.matchProfile(game), store.get('settings')));
```

Confirm `store` is already required at the top of `launcher.js`; if not, add `const { store } = require('../store');`.

- [ ] **Step 6: Verify the renderer build is unaffected + main loads**

Run: `node -e "require('./electron/ipc/launcher.js'); require('./electron/ipc/profiles.js'); console.log('load ok')"`
Expected: prints `load ok` (no SyntaxError; electron-store noise is fine).

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/profiles.js electron/ipc/profiles.test.js electron/ipc/launcher.js
git commit -m "feat(launcher): resolve effective Photon AppId (settings override > recipe)"
```

---

### Task 3: REPO recipe — inject-settings

**Files:**
- Modify: `electron/data/recipes/repo.json`, `recipes/repo.json`
- Modify: `electron/data/recipes/index.json`, `recipes/index.json` (version bump)
- Modify: `electron/ipc/recipes.test.js`

The community Photon AppId is a maintainer prerequisite (Task 6, Step 5). Ship the recipe with the inject-settings wiring and EMPTY AppId strings — the connector skips empty AppIds (game runs vanilla, no crossplay) until the maintainer fills them.

- [ ] **Step 1: Write the failing test**

Append to `electron/ipc/recipes.test.js`:

```js
test('bundled REPO recipe is inject-settings with the DataDirector hook', () => {
  const index = R.validateIndex(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'recipes', 'index.json'), 'utf8')));
  const entry = index.find((e) => e.id === 'repo');
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'recipes', 'repo.json'), 'utf8'));
  const r = R.assembleRecipe(entry, raw, '0.1.1');
  const hit = R.matchRecipe([r], { name: 'REPO' });
  assert.strictEqual(hit.profile.hookStrategy, 'inject-settings');
  assert.strictEqual(hit.profile.connectHookType, 'DataDirector');
  assert.strictEqual(hit.profile.connectHookMethod, 'PhotonSetAppId');
  assert.strictEqual(hit.profile.photonAppVersion, 'unifia-repo-cp1');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test electron/ipc/recipes.test.js`
Expected: FAIL — current recipe has `hookStrategy: manual`, no hook fields.

- [ ] **Step 3: Update both recipe files**

Write `electron/data/recipes/repo.json` AND `recipes/repo.json` (identical) to:

```json
{
  "schemaVersion": 1,
  "id": "repo",
  "notes": "REPO crossplay via inject-settings: overwrites Photon AppId+version at native connect so cracked+legit meet in the in-game server browser. Set photonAppId/photonVoiceAppId to your community Photon app before this enables crossplay.",
  "profile": {
    "game": "REPO",
    "netcode": "pun2",
    "hookStrategy": "inject-settings",
    "connectHookType": "DataDirector",
    "connectHookMethod": "PhotonSetAppId",
    "autoDelaySeconds": 3,
    "supportsNativeLobby": false,
    "connectionMode": "cloud-region",
    "region": "eu",
    "module": "bepinex_mono",
    "thunderstoreCommunity": "repo",
    "photonAppVersion": "unifia-repo-cp1",
    "photonAppId": "",
    "photonVoiceAppId": ""
  }
}
```

- [ ] **Step 4: Bump the recipe version in both index files**

In `electron/data/recipes/index.json` AND `recipes/index.json`, change the repo entry's `"version": 2` to `"version": 3`.

- [ ] **Step 5: Run to verify it passes + recipes in sync**

Run: `node --test electron/ipc/recipes.test.js`
Expected: PASS.
Run: `diff electron/data/recipes/repo.json recipes/repo.json && diff electron/data/recipes/index.json recipes/index.json && echo synced`
Expected: prints `synced`.

- [ ] **Step 6: Commit**

```bash
git add electron/data/recipes/ recipes/ electron/ipc/recipes.test.js
git commit -m "feat(recipes): REPO inject-settings recipe (community AppId to fill)"
```

---

### Task 4: Connector — inject-settings + remove reconnect/F9

**Files:**
- Modify: `mod/UnifiaPun/UnifiaConfig.cs` (`UnifiaProfile` += AppId fields)
- Rewrite: `mod/UnifiaPun/HarmonyHooks.cs`
- Rewrite: `mod/UnifiaPun/PunController.cs`
- Rewrite: `mod/UnifiaPun/Plugin.cs`

- [ ] **Step 1: Add AppId fields to the profile**

In `mod/UnifiaPun/UnifiaConfig.cs`, in `UnifiaProfile`, after `photonAppVersion`:

```csharp
        public string photonAppVersion = "";    // shared Photon AppVersion to pin for crossplay
        public string photonAppId = "";          // shared Photon Realtime AppId to inject
        public string photonVoiceAppId = "";      // shared Photon Voice AppId to inject
```

- [ ] **Step 2: Rewrite HarmonyHooks.cs as the settings-injection postfix**

Replace `mod/UnifiaPun/HarmonyHooks.cs` entirely:

```csharp
using System;
using System.Linq;
using System.Reflection;
using HarmonyLib;
using Photon.Pun;

namespace Unifia.Pun
{
    // inject-settings: postfix the game's own Photon-setup method (named in the
    // recipe, e.g. DataDirector.PhotonSetAppId) and overwrite AppSettings with the
    // shared community AppId/version so the game connects natively to the shared
    // Photon app and crossplay shows up in the game's own server browser.
    //
    // Reflection-based on purpose — no compile-time reference to the game; the
    // target method is recipe data.
    internal static class HarmonyHooks
    {
        private static Harmony _harmony;
        private static string _appId;
        private static string _voiceAppId;
        private static string _appVersion;

        public static void ApplyInject(string typeName, string methodName,
            string appId, string voiceAppId, string appVersion)
        {
            if (string.IsNullOrEmpty(typeName) || string.IsNullOrEmpty(methodName))
            {
                UnifiaPlugin.Log.LogWarning(
                    "inject-settings needs connectHookType + connectHookMethod in the profile.");
                return;
            }

            _appId = appId;
            _voiceAppId = voiceAppId;
            _appVersion = appVersion;

            var type = AppDomain.CurrentDomain
                .GetAssemblies()
                .Select(a => SafeGetType(a, typeName))
                .FirstOrDefault(t => t != null);
            if (type == null)
            {
                UnifiaPlugin.Log.LogWarning($"Hook type '{typeName}' not found in loaded assemblies.");
                return;
            }

            var method = type.GetMethod(
                methodName,
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static);
            if (method == null)
            {
                UnifiaPlugin.Log.LogWarning($"Hook method '{typeName}.{methodName}' not found.");
                return;
            }

            try
            {
                _harmony = new Harmony(UnifiaPlugin.Guid);
                var postfix = new HarmonyMethod(
                    typeof(HarmonyHooks).GetMethod(nameof(InjectSettings), BindingFlags.NonPublic | BindingFlags.Static));
                _harmony.Patch(method, postfix: postfix);
                UnifiaPlugin.Log.LogInfo($"Hooked {typeName}.{methodName} for inject-settings.");
            }
            catch (Exception ex)
            {
                UnifiaPlugin.Log.LogError($"Failed to patch {typeName}.{methodName}: {ex.Message}");
            }
        }

        private static Type SafeGetType(Assembly asm, string typeName)
        {
            try { return asm.GetType(typeName, false); }
            catch { return null; }
        }

        // Runs after the game's Photon-setup method; overwrite the AppId/version so
        // both copies share one Photon virtual app.
        private static void InjectSettings()
        {
            try
            {
                var app = PhotonNetwork.PhotonServerSettings.AppSettings;
                if (!string.IsNullOrEmpty(_appId)) app.AppIdRealtime = _appId;
                if (!string.IsNullOrEmpty(_voiceAppId)) app.AppIdVoice = _voiceAppId;
                if (!string.IsNullOrEmpty(_appVersion)) app.AppVersion = _appVersion;
                UnifiaPlugin.Log.LogInfo("Unifia injected shared Photon AppId/version.");
            }
            catch (Exception ex)
            {
                UnifiaPlugin.Log.LogError($"Inject failed: {ex.Message}");
            }
        }
    }
}
```

- [ ] **Step 3: Rewrite PunController.cs (inject-settings only; no reconnect/F9)**

Replace `mod/UnifiaPun/PunController.cs` entirely:

```csharp
using System.Collections.Generic;
using System.IO;
using BepInEx;
using Photon.Pun;
using Photon.Realtime;
using UnityEngine;

namespace Unifia.Pun
{
    // inject-settings connector: registers a Harmony postfix that overwrites the
    // Photon AppId/version at the game's native connect, then stays out of the way.
    // The player joins via the game's own server browser. No disconnect, no hotkey.
    // Still a MonoBehaviourPunCallbacks so it can report room status (read by the
    // launcher's Multiplayer tab) once the player joins a room normally.
    public class PunController : MonoBehaviourPunCallbacks
    {
        private UnifiaProfile _profile;

        public void Init(UnifiaProfile profile)
        {
            _profile = profile ?? UnifiaProfile.Default();
            UnifiaPlugin.Log.LogInfo($"Unifia ready — strategy={_profile.hookStrategy}.");

            if (_profile.hookStrategy == "inject-settings")
            {
                HarmonyHooks.ApplyInject(
                    _profile.connectHookType, _profile.connectHookMethod,
                    _profile.photonAppId, _profile.photonVoiceAppId, _profile.photonAppVersion);
            }
            WriteStatus();
        }

        // --- Edition status file (read by the launcher's Multiplayer tab) --------

        private static string StatusPath() => Path.Combine(Paths.ConfigPath, "unifia_status.json");

        private static string JsonStr(string s) =>
            "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

        private static string PlayerJson(Player p, string originalAppId)
        {
            string nick = p != null ? p.NickName : "";
            return "{\"nick\":" + JsonStr(nick) + ",\"originalAppId\":" + JsonStr(originalAppId) + "}";
        }

        private void WriteStatus()
        {
            try
            {
                string room = PhotonNetwork.InRoom && PhotonNetwork.CurrentRoom != null
                    ? PhotonNetwork.CurrentRoom.Name : "";
                var sb = new System.Text.StringBuilder();
                sb.Append("{");
                sb.Append("\"loaded\":true,");
                sb.Append("\"room\":").Append(JsonStr(room)).Append(",");
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

        public override void OnJoinedRoom()
        {
            // Tag ourselves so the game's player list shows who came in via Unifia.
            var props = new ExitGames.Client.Photon.Hashtable { { "unifia_appid", UnifiaPlugin.OriginalAppId } };
            PhotonNetwork.LocalPlayer.SetCustomProperties(props);
            if (!string.IsNullOrEmpty(PhotonNetwork.NickName) && !PhotonNetwork.NickName.EndsWith(" [U]"))
                PhotonNetwork.NickName = PhotonNetwork.NickName + " [U]";

            int count = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 0;
            UnifiaPlugin.Log.LogInfo($"Joined room '{(PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.Name : "")}' ({count} players).");
            WriteStatus();
        }

        public override void OnLeftRoom() { WriteStatus(); }
        public override void OnPlayerEnteredRoom(Player newPlayer) { WriteStatus(); }
        public override void OnPlayerLeftRoom(Player otherPlayer) { WriteStatus(); }
        public override void OnPlayerPropertiesUpdate(Player target, ExitGames.Client.Photon.Hashtable changedProps) { WriteStatus(); }
    }
}
```

- [ ] **Step 4: Rewrite Plugin.cs (gate on inject-settings profile, not a room descriptor)**

Replace `mod/UnifiaPun/Plugin.cs` entirely:

```csharp
using BepInEx;
using BepInEx.Logging;
using UnityEngine;

namespace Unifia.Pun
{
    // BepInEx entry point. Reads the launcher-written profile (unifia_profile.json).
    // It spins up the connector only for the inject-settings strategy with a PUN
    // netcode; otherwise it stays idle, so the plugin never affects normal play.
    [BepInPlugin(Guid, Name, Version)]
    public class UnifiaPlugin : BaseUnityPlugin
    {
        public const string Guid = "dev.unifia.pun";
        public const string Name = "Unifia PUN Connector";
        public const string Version = "0.2.0";

        internal static ManualLogSource Log;
        // The game's baked-in Photon AppId, captured before we override it — the
        // edition signal (official copy vs crack carry different ids).
        internal static string OriginalAppId = "";
        private GameObject _controller;

        private void Awake()
        {
            Log = Logger;
            Log.LogInfo($"{Name} {Version} loaded.");

            try { OriginalAppId = Photon.Pun.PhotonNetwork.PhotonServerSettings.AppSettings.AppIdRealtime; }
            catch { OriginalAppId = ""; }

            var profile = UnifiaConfig.LoadProfile();
            if (profile.netcode != "pun2" && profile.netcode != "pun1")
            {
                Log.LogWarning($"Profile netcode '{profile.netcode}' is not PUN — staying idle.");
                return;
            }
            if (profile.hookStrategy != "inject-settings")
            {
                Log.LogInfo($"hookStrategy '{profile.hookStrategy}' — connector idle (only inject-settings is active).");
                return;
            }

            _controller = new GameObject("UnifiaPunController");
            DontDestroyOnLoad(_controller);
            _controller.hideFlags = HideFlags.HideAndDontSave;
            _controller.AddComponent<PunController>().Init(profile);
        }
    }
}
```

- [ ] **Step 5: Build the connector DLL**

Run: `dotnet build mod/UnifiaPun/UnifiaPun.csproj -c Release`
Expected: builds `mod/UnifiaPun/bin/Release/Unifia.Pun.dll`, 0 errors. (Removed members: `NetConfig` is now unused by Plugin/PunController but still defined in `UnifiaConfig.cs` — that compiles fine. If the compiler errors on an unused `using` or a missing reference, fix the specific error.)

- [ ] **Step 6: Commit**

```bash
git add mod/UnifiaPun/
git commit -m "feat(connector): inject-settings model; remove reconnect/F9 (v0.2.0)"
```

---

### Task 5: Settings — private Photon AppId override

**Files:**
- Modify: `src/pages/Settings.jsx`
- Modify: `src/store/useAppStore.js` (if a local draft pattern is used; otherwise Settings uses `saveSettings` directly)

- [ ] **Step 1: Read the file for the section + save pattern**

Read `src/pages/Settings.jsx`. Note the `useAppStore` selectors (`settings`, `saveSettings`) and how an existing text setting (e.g. the SteamGridDB key block) is rendered + persisted (`saveSettings({ key: value })`). You will add a "Crossplay" section following that pattern.

- [ ] **Step 2: Add the override inputs**

Add a section (matching the file's existing section wrapper classes) with two text inputs bound to `settings.photonAppIdOverride` / `settings.photonVoiceAppIdOverride`, each persisting on change/blur via `saveSettings`:

```jsx
      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold text-neutral-100">Crossplay (advanced)</h2>
        <p className="mb-3 text-xs text-neutral-500">
          Unifia uses a shared community Photon app so you appear in the in-game server browser.
          To run a closed group instead, paste your own Photon App IDs — they override the community app.
        </p>
        <label className="mb-2 block text-xs text-neutral-400">Private Photon AppId (Realtime)</label>
        <input
          type="text"
          defaultValue={settings?.photonAppIdOverride || ''}
          onBlur={(e) => saveSettings({ photonAppIdOverride: e.target.value.trim() })}
          placeholder="Leave blank to use the community app"
          className="mb-3 w-full rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 ring-1 ring-border-default focus:outline-none focus:ring-accent/50"
        />
        <label className="mb-2 block text-xs text-neutral-400">Private Photon AppId (Voice)</label>
        <input
          type="text"
          defaultValue={settings?.photonVoiceAppIdOverride || ''}
          onBlur={(e) => saveSettings({ photonVoiceAppIdOverride: e.target.value.trim() })}
          placeholder="Optional"
          className="w-full rounded bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 ring-1 ring-border-default focus:outline-none focus:ring-accent/50"
        />
      </section>
```

Ensure `settings` and `saveSettings` are selected from `useAppStore` at the top of the component (the file already uses `saveSettings`; add a `settings` selector if absent: `const settings = useAppStore((s) => s.settings);`).

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.jsx src/store/useAppStore.js
git commit -m "feat(ui): private Photon AppId override in Settings"
```

---

### Task 6: Full verification + maintainer follow-up

**Files:** none (verification only)

- [ ] **Step 1: Full Node suite**

Run: `node --test electron/ipc/*.test.js electron/ipc/modHubs/*.test.js electron/utils/*.test.js src/lib/*.test.js src/lib/*.test.mjs`
Expected: PASS — all green (recipes + profiles new cases included); no regressions.

- [ ] **Step 2: Renderer build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 3: Connector build + recipe sync**

Run: `dotnet build mod/UnifiaPun/UnifiaPun.csproj -c Release` and `diff electron/data/recipes/repo.json recipes/repo.json && diff electron/data/recipes/index.json recipes/index.json && echo synced`
Expected: DLL builds, prints `synced`.

- [ ] **Step 4: Confirm inject path resolves end-to-end**

Run:
```bash
node -e "const p=require('./electron/ipc/profiles'); const prof=p.applyAppIdOverride(p.matchProfile({id:'custom:REPO',name:'REPO',unityBackend:'mono'}), {}); console.log('hookStrategy:', prof.hookStrategy, '| hook:', prof.connectHookType+'.'+prof.connectHookMethod, '| appVersion:', prof.photonAppVersion);"
```
Expected: `hookStrategy: inject-settings | hook: DataDirector.PhotonSetAppId | appVersion: unifia-repo-cp1` (after the stale recipe cache is cleared/refreshed; delete `%APPDATA%/unifia/unifia_data/cache/recipes/recipes.json` if it shadows the bundled recipe).

- [ ] **Step 5: Maintainer prerequisite (no code; document)**

Create a Photon Cloud app (Realtime + Voice). Put its AppIds into `photonAppId` / `photonVoiceAppId` in BOTH `recipes/repo.json` and `electron/data/recipes/repo.json`, bump the index `version` to 4, commit, and push so the remote recipe serves them. Until filled, the connector injects nothing (game runs vanilla; no crossplay). Then the live test: cracked + legit launch REPO via Unifia (no F9) → both appear in REPO's in-game public server browser on the same region → join and play. Private-override path: paste a personal AppId in Settings → only that group's rooms show.
```
