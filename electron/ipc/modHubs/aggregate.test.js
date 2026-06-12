const { test } = require('node:test');
const assert = require('node:assert');
const { aggregateMods } = require('./aggregate');

const A = {
  id: 'a', label: 'Hub A', canInstall: true,
  gameRef: () => 'aref',
  fetchMods: async () => [{ fullName: 'X-Mod', name: 'Mod', packageUrl: 'http://a/x' }],
};
const Bnull = {
  id: 'b', label: 'Hub B', canInstall: false,
  gameRef: () => null,
  fetchMods: async () => [{ fullName: 'Y-Mod', name: 'Y' }],
};
const Cthrow = {
  id: 'c', label: 'Hub C', canInstall: false,
  gameRef: () => 'cref',
  fetchMods: async () => { throw new Error('hub down'); },
};

test('aggregateMods merges + hub-tags mods from providers with a ref', async () => {
  const { packages, hubs } = await aggregateMods([A, Bnull, Cthrow], {});
  assert.deepStrictEqual(hubs.map((h) => h.id).sort(), ['a', 'c']);
  assert.deepStrictEqual(hubs.find((h) => h.id === 'a'), { id: 'a', label: 'Hub A' });
  assert.strictEqual(packages.length, 1);
  const m = packages[0];
  assert.strictEqual(m.hub, 'a');
  assert.strictEqual(m.hubLabel, 'Hub A');
  assert.strictEqual(m.canInstall, true);
  assert.strictEqual(m.id, 'a:X-Mod');
  assert.strictEqual(m.pageUrl, 'http://a/x');
  assert.strictEqual(m.fullName, 'X-Mod');
});

test('aggregateMods returns empty result for no providers', async () => {
  assert.deepStrictEqual(await aggregateMods([], {}), { packages: [], hubs: [] });
});
