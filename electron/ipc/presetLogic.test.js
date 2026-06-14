const { test } = require('node:test');
const assert = require('node:assert');
const L = require('./presetLogic');

const modsA = { 'Owner-A': { version: '1.0.0', enabled: true, isDependency: false, deployedFiles: [] } };

test('migrate wraps a gameMods map into a Default active preset', () => {
  const entry = L.migrate(modsA, () => 'p_1');
  assert.strictEqual(entry.activeId, 'p_1');
  assert.strictEqual(entry.presets.length, 1);
  assert.strictEqual(entry.presets[0].name, 'Default');
  assert.deepStrictEqual(entry.presets[0].mods, modsA);
});

test('activePreset returns the active entry', () => {
  const entry = L.migrate(modsA, () => 'p_1');
  assert.strictEqual(L.activePreset(entry).id, 'p_1');
});

test('withActiveMods replaces the active preset mods', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  const mods2 = { 'Owner-B': { version: '2.0.0', enabled: true, isDependency: false, deployedFiles: [] } };
  entry = L.withActiveMods(entry, mods2);
  assert.deepStrictEqual(L.activePreset(entry).mods, mods2);
});

test('addPreset / setActive / removePreset', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  entry = L.addPreset(entry, 'Modded', {}, () => 'p_2');
  assert.strictEqual(entry.presets.length, 2);
  entry = L.setActive(entry, 'p_2');
  assert.strictEqual(entry.activeId, 'p_2');
  entry = L.removePreset(entry, 'p_1');
  assert.strictEqual(entry.presets.length, 1);
  assert.strictEqual(entry.activeId, 'p_2'); // unaffected
});

test('removePreset of the active falls back to the first remaining', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  entry = L.addPreset(entry, 'B', {}, () => 'p_2');
  entry = L.setActive(entry, 'p_2');
  entry = L.removePreset(entry, 'p_2');
  assert.strictEqual(entry.activeId, 'p_1');
});

test('removePreset refuses the last preset', () => {
  const entry = L.migrate(modsA, () => 'p_1');
  assert.throws(() => L.removePreset(entry, 'p_1'), /last preset/i);
});

test('renamePreset and snapshot', () => {
  let entry = L.migrate(modsA, () => 'p_1');
  entry = L.addPreset(entry, 'B', {}, () => 'p_2');
  entry = L.renamePreset(entry, 'p_2', 'Renamed');
  assert.strictEqual(entry.presets.find((p) => p.id === 'p_2').name, 'Renamed');
  entry = L.snapshot(entry, 'p_1', 'p_2'); // copy p_1's mods into p_2
  assert.deepStrictEqual(entry.presets.find((p) => p.id === 'p_2').mods, modsA);
});
