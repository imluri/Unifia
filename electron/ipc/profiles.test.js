const { test } = require('node:test');
const assert = require('node:assert');
const { resolveProfile } = require('./profiles');

test('resolveProfile applies precedence: base < entry < analyzer < recipe', () => {
  const out = resolveProfile({
    base: { region: 'eu', netcode: 'pun2', module: 'bepinex_mono' },
    entryProfile: { region: 'us' },
    analyzerOverride: { netcode: 'pun1' },
    recipeProfile: { region: 'asia' },
  });
  assert.strictEqual(out.region, 'asia');
  assert.strictEqual(out.netcode, 'pun1');
  assert.strictEqual(out.module, 'bepinex_mono');
});

test('resolveProfile: recipe overrides analyzer on the same field', () => {
  const out = resolveProfile({
    base: {},
    entryProfile: {},
    analyzerOverride: { hookStrategy: 'auto-on-load' },
    recipeProfile: { hookStrategy: 'reconnect-on-load' },
  });
  assert.strictEqual(out.hookStrategy, 'reconnect-on-load');
});

test('resolveProfile with no recipe equals base<entry<analyzer (today behavior)', () => {
  const out = resolveProfile({
    base: { region: 'eu' },
    entryProfile: { game: 'X' },
    analyzerOverride: { netcode: 'pun2' },
    recipeProfile: {},
  });
  assert.deepStrictEqual(out, { region: 'eu', game: 'X', netcode: 'pun2' });
});
