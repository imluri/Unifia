// Run with:  node --test electron/utils/engineDetector.test.js
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectEngine } = require('./engineDetector');

// Build a throwaway install folder from a spec of relative paths. A trailing
// slash means "directory"; otherwise an empty file is created.
const roots = [];
function makeInstall(entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'unifia-engine-'));
  roots.push(root);
  for (const entry of entries) {
    const full = path.join(root, entry);
    if (entry.endsWith('/')) {
      fs.mkdirSync(full, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
  }
  return root;
}

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

test('Unity IL2CPP (GameAssembly.dll)', () => {
  const dir = makeInstall(['GameName_Data/', 'GameAssembly.dll', 'GameName.exe', 'UnityPlayer.dll']);
  const r = detectEngine(dir);
  assert.strictEqual(r.engine, 'unity');
  assert.strictEqual(r.backend, 'il2cpp');
  assert.strictEqual(r.engineName, 'Unity (IL2CPP)');
});

test('Unity Mono (MonoBleedingEdge + Managed)', () => {
  const dir = makeInstall(['REPO_Data/Managed/Assembly-CSharp.dll', 'MonoBleedingEdge/', 'REPO.exe']);
  const r = detectEngine(dir);
  assert.strictEqual(r.engine, 'unity');
  assert.strictEqual(r.backend, 'mono');
});

test('Unity nested one folder deep (pirated repack layout)', () => {
  const dir = makeInstall([
    'Game/REPO_Data/Managed/Assembly-CSharp.dll',
    'Game/MonoBleedingEdge/',
    'Game/REPO.exe',
    'readme.txt',
  ]);
  const r = detectEngine(dir);
  assert.strictEqual(r.engine, 'unity');
  assert.strictEqual(r.backend, 'mono');
});

test('Unity nested IL2CPP one folder deep', () => {
  const dir = makeInstall(['repack/GameName_Data/il2cpp_data/', 'repack/GameAssembly.dll', 'repack/Game.exe']);
  const r = detectEngine(dir);
  assert.strictEqual(r.engine, 'unity');
  assert.strictEqual(r.backend, 'il2cpp');
});

test('Unreal Engine (Shipping exe + Paks)', () => {
  const dir = makeInstall(['MyGame/Binaries/Win64/MyGame-Win64-Shipping.exe', 'MyGame/Content/Paks/pakchunk0.pak']);
  assert.strictEqual(detectEngine(dir).engine, 'unreal');
});

test('Godot (.pck)', () => {
  const dir = makeInstall(['Game.exe', 'Game.pck']);
  assert.strictEqual(detectEngine(dir).engine, 'godot');
});

test('GameMaker (data.win)', () => {
  const dir = makeInstall(['Game.exe', 'data.win']);
  assert.strictEqual(detectEngine(dir).engine, 'gamemaker');
});

test('RPG Maker MV/MZ (www/) wins over Electron', () => {
  const dir = makeInstall(['www/index.html', 'resources/app.asar', 'Game.exe']);
  assert.strictEqual(detectEngine(dir).engine, 'rpgmaker');
});

test("Ren'Py (game/*.rpa)", () => {
  const dir = makeInstall(['Game.exe', 'renpy/', 'game/archive.rpa']);
  assert.strictEqual(detectEngine(dir).engine, 'renpy');
});

test('Source (gameinfo.txt)', () => {
  const dir = makeInstall(['hl2.exe', 'mymod/gameinfo.txt']);
  assert.strictEqual(detectEngine(dir).engine, 'source');
});

test('Electron / NW.js (app.asar)', () => {
  const dir = makeInstall(['App.exe', 'resources/app.asar', 'icudtl.dat']);
  assert.strictEqual(detectEngine(dir).engine, 'electron');
});

test('Java (.jar)', () => {
  const dir = makeInstall(['launcher.jar', 'run.bat']);
  assert.strictEqual(detectEngine(dir).engine, 'java');
});

test('Unknown when no signatures match', () => {
  const dir = makeInstall(['readme.txt', 'game.bin']);
  assert.strictEqual(detectEngine(dir).engine, 'unknown');
});

test('Missing path returns nulls', () => {
  const r = detectEngine(path.join(os.tmpdir(), 'does-not-exist-unifia'));
  assert.strictEqual(r.engine, null);
});
