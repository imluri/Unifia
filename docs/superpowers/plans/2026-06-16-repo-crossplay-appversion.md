# REPO Crossplay — Pin Photon AppVersion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recipe pin a shared Photon AppVersion so cracked and legit REPO copies land in the same Photon virtual app and can play together.

**Architecture:** Add a `photonAppVersion` field to the recipe vocabulary; it flows through `matchProfile` → `unifia_profile.json` to the UnifiaPun connector, which sets both `AppSettings.AppVersion` and `PhotonNetwork.GameVersion` to that shared constant on its reconnect. Author the REPO recipe with the constant and rebuild the bundled connector DLL.

**Tech Stack:** Node (electron main, `node:test`), C# (BepInEx/HarmonyX mod, net472, `dotnet build`), Vite renderer.

**Reference:** Spec at `docs/superpowers/specs/2026-06-16-repo-crossplay-appversion-design.md`.

---

### Task 1: Recipe vocabulary + REPO recipe data

**Files:**
- Modify: `electron/ipc/recipes.js` (`FIELD_TYPES`)
- Modify: `electron/ipc/recipes.test.js` (add tests)
- Modify: `electron/data/recipes/repo.json`, `recipes/repo.json` (add field)
- Modify: `electron/data/recipes/index.json`, `recipes/index.json` (bump version)

- [ ] **Step 1: Write the failing tests**

Append to `electron/ipc/recipes.test.js`:

```js
test('validateRecipe keeps a string photonAppVersion and drops a non-string one', () => {
  const ok = R.validateRecipe(
    { schemaVersion: 1, id: 'x', profile: { photonAppVersion: 'unifia-repo-cp1' } }, '0.1.1');
  assert.strictEqual(ok.profile.photonAppVersion, 'unifia-repo-cp1');
  const bad = R.validateRecipe(
    { schemaVersion: 1, id: 'x', profile: { photonAppVersion: 42 } }, '0.1.1');
  assert.strictEqual('photonAppVersion' in bad.profile, false);
});

test('bundled repo.json carries photonAppVersion', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'recipes', 'repo.json'), 'utf8'));
  const out = R.validateRecipe(raw, '0.1.1');
  assert.strictEqual(out.profile.photonAppVersion, 'unifia-repo-cp1');
});
```

(`fs` and `path` are already required in this test file from the bundled-data tests.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --test electron/ipc/recipes.test.js`
Expected: FAIL — the new tests fail (`photonAppVersion` not in the allowlist yet, and not in repo.json).

- [ ] **Step 3: Add `photonAppVersion` to the allowlist**

In `electron/ipc/recipes.js`, in the `FIELD_TYPES` object, add the field after `thunderstoreCommunity`:

```js
  thunderstoreCommunity: 'string',
  photonAppVersion: 'string',
```

- [ ] **Step 4: Add the field to both recipe files**

In `electron/data/recipes/repo.json` AND `recipes/repo.json`, add `photonAppVersion` to the `profile` object (after `thunderstoreCommunity`) and update the note:

```json
    "module": "bepinex_mono",
    "thunderstoreCommunity": "repo",
    "photonAppVersion": "unifia-repo-cp1"
```

Also change each file's top-level `"notes"` to:

```json
  "notes": "REPO crossplay: pins a shared Photon AppVersion so different builds matchmake together.",
```

- [ ] **Step 5: Bump the recipe version in both index files**

In `electron/data/recipes/index.json` AND `recipes/index.json`, change the repo entry's `"version": 1` to `"version": 2`.

- [ ] **Step 6: Run to verify the tests pass**

Run: `node --test electron/ipc/recipes.test.js`
Expected: PASS — all tests green (the 11 prior + 2 new = 13).

- [ ] **Step 7: Commit**

```bash
git add electron/ipc/recipes.js electron/ipc/recipes.test.js electron/data/recipes/ recipes/
git commit -m "feat(recipes): photonAppVersion field + REPO recipe pins shared Photon version"
```

End every commit body with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 2: Connector reads + pins the version

**Files:**
- Modify: `mod/UnifiaPun/UnifiaConfig.cs` (`UnifiaProfile`)
- Modify: `mod/UnifiaPun/PunController.cs` (`Activate`)

- [ ] **Step 1: Add the profile field**

In `mod/UnifiaPun/UnifiaConfig.cs`, in the `UnifiaProfile` class, add the field after `connectHookMethod` (currently the last field before `Default()`):

```csharp
        public string connectHookMethod = "";  // for reconnect-on-load: method to patch
        public string photonAppVersion = "";    // shared Photon AppVersion to pin for crossplay
```

- [ ] **Step 2: Pin both AppVersion and GameVersion in Activate**

In `mod/UnifiaPun/PunController.cs`, replace the existing version line in `Activate()`:

```csharp
            if (!string.IsNullOrEmpty(_net.Username)) PhotonNetwork.NickName = _net.Username;
            // Force a shared game version so Photon doesn't segregate by AppVersion.
            if (!string.IsNullOrEmpty(_net.Version)) PhotonNetwork.GameVersion = _net.Version;
```

with:

```csharp
            if (!string.IsNullOrEmpty(_net.Username)) PhotonNetwork.NickName = _net.Username;
            // Pin a shared Photon version so different game builds land in one virtual
            // app. The recipe constant (photonAppVersion) wins; else the per-session
            // invite version. Set BOTH AppSettings.AppVersion and GameVersion so the
            // effective version is identical across copies regardless of how PUN derives it.
            string pinnedVersion = !string.IsNullOrEmpty(_profile.photonAppVersion)
                ? _profile.photonAppVersion
                : _net.Version;
            if (!string.IsNullOrEmpty(pinnedVersion))
            {
                app.AppVersion = pinnedVersion;
                PhotonNetwork.GameVersion = pinnedVersion;
            }
```

(`app` is the local `var app = PhotonNetwork.PhotonServerSettings.AppSettings;` already declared earlier in `Activate`; `_profile` is the `UnifiaProfile` set in `Init`.)

- [ ] **Step 3: Build the connector DLL**

Run: `dotnet build mod/UnifiaPun/UnifiaPun.csproj -c Release`
Expected: build succeeds, producing `mod/UnifiaPun/bin/Release/Unifia.Pun.dll` (the `extraResources` plugin). If references (UnityEngine/Photon) fail to resolve, confirm the same reference paths the existing build used — a DLL was last built successfully, so the environment resolves them.

- [ ] **Step 4: Commit (source only — the DLL is a gitignored build artifact)**

```bash
git add mod/UnifiaPun/UnifiaConfig.cs mod/UnifiaPun/PunController.cs
git commit -m "feat(connector): pin AppSettings.AppVersion from recipe for crossplay"
```

---

### Task 3: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the recipe + full Node suite**

Run: `node --test electron/ipc/*.test.js electron/ipc/modHubs/*.test.js electron/utils/*.test.js src/lib/*.test.js src/lib/*.test.mjs`
Expected: PASS — all green, including the 2 new `recipes.test.js` cases; no regressions.

- [ ] **Step 2: Renderer build**

Run: `npm run build`
Expected: Vite build completes with no errors.

- [ ] **Step 3: Confirm the connector DLL rebuilt**

Run: `dotnet build mod/UnifiaPun/UnifiaPun.csproj -c Release` then `ls -la mod/UnifiaPun/bin/Release/Unifia.Pun.dll`
Expected: build succeeds and the DLL timestamp is current.

- [ ] **Step 4: Confirm recipe consistency (bundled == published)**

Run: `diff electron/data/recipes/repo.json recipes/repo.json && diff electron/data/recipes/index.json recipes/index.json && echo "recipes in sync"`
Expected: prints `recipes in sync` (the bundled fallback and the published root recipe match).

- [ ] **Step 5: Record live-test instructions (no code change)**

Document for the maintainer's live 2-player test: cracked + legit REPO both on Unifia with the REPO recipe (photonAppVersion `unifia-repo-cp1`); host shares an invite (same Photon AppId); both pick the same in-game region and enter the same room code; confirm they join the same room. This validates the fix against the confirmed root cause. No commit unless the live test surfaces a fix.
