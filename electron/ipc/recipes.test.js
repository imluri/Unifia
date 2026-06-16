const { test } = require('node:test');
const assert = require('node:assert');
const R = require('./recipes');

test('versionGte compares dotted numeric versions', () => {
  assert.strictEqual(R.versionGte('0.1.1', '0.1.0'), true);
  assert.strictEqual(R.versionGte('0.1.0', '0.1.0'), true);
  assert.strictEqual(R.versionGte('0.1.0', '0.2.0'), false);
  assert.strictEqual(R.versionGte('1.0.0', '0.9.9'), true);
});

test('validateRecipe keeps allowlisted fields and drops the rest', () => {
  const raw = {
    schemaVersion: 1, id: 'repo',
    profile: { game: 'REPO', region: 'eu', evilField: 'x', autoDelaySeconds: 3 },
  };
  const out = R.validateRecipe(raw, '0.1.1');
  assert.strictEqual(out.id, 'repo');
  assert.deepStrictEqual(out.profile, { game: 'REPO', region: 'eu', autoDelaySeconds: 3 });
  assert.strictEqual('evilField' in out.profile, false);
});

test('validateRecipe type-checks fields (wrong types dropped)', () => {
  const raw = { schemaVersion: 1, id: 'x', profile: { region: 5, supportsNativeLobby: 'yes', autoDelaySeconds: 'no' } };
  const out = R.validateRecipe(raw, '0.1.1');
  assert.deepStrictEqual(out.profile, {});
});

test('validateRecipe rejects wrong schemaVersion or missing id/profile', () => {
  assert.strictEqual(R.validateRecipe({ schemaVersion: 2, id: 'x', profile: {} }, '0.1.1'), null);
  assert.strictEqual(R.validateRecipe({ schemaVersion: 1, profile: {} }, '0.1.1'), null);
  assert.strictEqual(R.validateRecipe({ schemaVersion: 1, id: 'x' }, '0.1.1'), null);
  assert.strictEqual(R.validateRecipe(null, '0.1.1'), null);
});

test('validateRecipe applies the minUnifiaVersion gate', () => {
  const raw = { schemaVersion: 1, id: 'x', minUnifiaVersion: '0.2.0', profile: { region: 'eu' } };
  assert.strictEqual(R.validateRecipe(raw, '0.1.1'), null);
  assert.ok(R.validateRecipe({ ...raw, minUnifiaVersion: '0.1.0' }, '0.1.1'));
});

test('validateIndex keeps well-formed entries and drops malformed ones', () => {
  const raw = { schemaVersion: 1, recipes: [
    { id: 'repo', match: { namePattern: 'REPO' }, file: 'repo.json', version: 3 },
    { id: 'bad' },
    { match: { steamAppId: 1 }, file: 'a.json' },
  ] };
  const out = R.validateIndex(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'repo');
});

test('validateIndex rejects wrong schemaVersion', () => {
  assert.deepStrictEqual(R.validateIndex({ schemaVersion: 9, recipes: [] }), []);
  assert.deepStrictEqual(R.validateIndex(null), []);
});

test('matchRecipe matches by steamAppId first, then namePattern', () => {
  const recipes = [
    { id: 'repo', match: { namePattern: '\\bREPO\\b' }, profile: { region: 'eu' } },
    { id: 'foo', match: { steamAppId: '123' }, profile: { region: 'us' } },
  ];
  assert.strictEqual(R.matchRecipe(recipes, { steamAppId: '123', name: 'Foo' }).id, 'foo');
  assert.strictEqual(R.matchRecipe(recipes, { name: 'REPO' }).id, 'repo');
  assert.strictEqual(R.matchRecipe(recipes, { name: 'Other' }), null);
});

test('matchRecipe tolerates a non-compiling namePattern', () => {
  const recipes = [{ id: 'x', match: { namePattern: '[' }, profile: {} }];
  assert.strictEqual(R.matchRecipe(recipes, { name: 'anything' }), null);
});
