const { test } = require('node:test');
const assert = require('node:assert');
const G = require('./gameLogic');

test('newManualId formats m_ + hex from random bytes', () => {
  const id = G.newManualId(() => Buffer.from([0x3f, 0x9a, 0x2c, 0x81, 0xd0, 0x44]));
  assert.strictEqual(id, 'm_3f9a2c81d044');
});

test('appendManualGame adds a new entry with a fresh id and manual:true', () => {
  const games = G.appendManualGame([], { name: 'REPO', executablePath: 'C:/a/REPO.exe' }, () => 'm_1');
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].id, 'm_1');
  assert.strictEqual(games[0].manual, true);
});

test('appendManualGame keeps same-name different-path installs as distinct clones', () => {
  let games = G.appendManualGame([], { name: 'REPO', executablePath: 'C:/a/REPO.exe' }, () => 'm_1');
  games = G.appendManualGame(games, { name: 'REPO', executablePath: 'C:/b/REPO.exe' }, () => 'm_2');
  assert.strictEqual(games.length, 2);
  assert.deepStrictEqual(games.map((g) => g.id), ['m_1', 'm_2']);
});

test('appendManualGame re-adding the same executablePath updates in place (keeps id)', () => {
  let games = G.appendManualGame([], { name: 'REPO', executablePath: 'C:/a/REPO.exe', version: '1' }, () => 'm_1');
  games = G.appendManualGame(games, { name: 'REPO', executablePath: 'C:/a/REPO.exe', version: '2' }, () => 'm_2');
  assert.strictEqual(games.length, 1);
  assert.strictEqual(games[0].id, 'm_1');
  assert.strictEqual(games[0].version, '2');
});

test('renameGameIn sets displayName', () => {
  const games = [{ id: 'm_1', name: 'REPO' }];
  const out = G.renameGameIn(games, 'm_1', 'REPO (cracked)');
  assert.strictEqual(out[0].displayName, 'REPO (cracked)');
});

test('renameGameIn with blank input clears displayName', () => {
  const games = [{ id: 'm_1', name: 'REPO', displayName: 'old' }];
  const out = G.renameGameIn(games, 'm_1', '   ');
  assert.strictEqual('displayName' in out[0], false);
});

test('renameGameIn throws on unknown id', () => {
  assert.throws(() => G.renameGameIn([], 'nope', 'x'), /Unknown game: nope/);
});
