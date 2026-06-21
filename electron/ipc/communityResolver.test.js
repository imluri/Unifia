const { test } = require('node:test');
const assert = require('node:assert');
const { slugify, pickCommunity } = require('./communityResolver');

test('slugify lowercases and hyphenates spaces', () => {
  assert.strictEqual(slugify('Lethal Company'), 'lethal-company');
  assert.strictEqual(slugify('Content Warning'), 'content-warning');
});

test('slugify collapses non-alphanumeric runs and trims hyphens', () => {
  assert.strictEqual(slugify('  R.E.P.O.  '), 'r-e-p-o');
  assert.strictEqual(slugify('REPO'), 'repo');
  assert.strictEqual(slugify("Buckshot Roulette!!!"), 'buckshot-roulette');
  assert.strictEqual(slugify(''), '');
});

test('pickCommunity returns the identifier when the slug matches', () => {
  const list = [{ identifier: 'lethal-company', name: 'Lethal Company' }, { identifier: 'repo', name: 'REPO' }];
  assert.strictEqual(pickCommunity('lethal-company', list), 'lethal-company');
});

test('pickCommunity returns null when the slug is absent or list empty', () => {
  assert.strictEqual(pickCommunity('not-a-game', [{ identifier: 'repo', name: 'REPO' }]), null);
  assert.strictEqual(pickCommunity('repo', []), null);
  assert.strictEqual(pickCommunity('', [{ identifier: 'repo', name: 'REPO' }]), null);
});
