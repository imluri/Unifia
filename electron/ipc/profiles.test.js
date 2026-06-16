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

test('applyAppIdOverride: per-game invite AppId is used when no settings override', () => {
  const out = applyAppIdOverride(
    { photonAppId: '', photonVoiceAppId: '' },          // recipe community empty
    {},                                                  // no global settings override
    { photonAppId: '5327844c', photonVoiceAppId: '5c4680d5' }); // per-game invite
  assert.strictEqual(out.photonAppId, '5327844c');
  assert.strictEqual(out.photonVoiceAppId, '5c4680d5');
});

test('applyAppIdOverride: settings global override beats per-game invite', () => {
  const out = applyAppIdOverride(
    { photonAppId: 'community' },
    { photonAppIdOverride: 'global' },
    { photonAppId: 'pergame' });
  assert.strictEqual(out.photonAppId, 'global');
});
