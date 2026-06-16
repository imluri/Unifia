const { test } = require('node:test');
const assert = require('node:assert');
const { cloneKey, findCloneIds } = require('./clones.js');

test('cloneKey normalizes name and exe basename', () => {
  assert.strictEqual(
    cloneKey({ name: ' REPO ', executablePath: 'C:/Games/X/REPO.exe' }),
    'repo repo.exe',
  );
});

test('findCloneIds flags same name + same exe across different paths', () => {
  const games = [
    { id: 'a', name: 'REPO', executablePath: 'C:/x/REPO.exe' },
    { id: 'b', name: 'REPO', executablePath: 'D:/y/REPO.exe' },
  ];
  const ids = findCloneIds(games);
  assert.strictEqual(ids.has('a'), true);
  assert.strictEqual(ids.has('b'), true);
  assert.strictEqual(ids.size, 2);
});

test('findCloneIds ignores different exe basenames', () => {
  const games = [
    { id: 'a', name: 'REPO', executablePath: 'C:/x/REPO.exe' },
    { id: 'b', name: 'REPO', executablePath: 'D:/y/Game.exe' },
  ];
  assert.strictEqual(findCloneIds(games).size, 0);
});

test('findCloneIds returns empty for a single entry', () => {
  assert.strictEqual(findCloneIds([{ id: 'a', name: 'REPO', executablePath: 'C:/x/REPO.exe' }]).size, 0);
});

test('a nickname does not change clone membership (detection uses real name)', () => {
  const games = [
    { id: 'a', name: 'REPO', displayName: 'REPO (cracked)', executablePath: 'C:/x/REPO.exe' },
    { id: 'b', name: 'REPO', executablePath: 'D:/y/REPO.exe' },
  ];
  assert.strictEqual(findCloneIds(games).size, 2);
});

test('cloneKey tolerates missing fields', () => {
  assert.strictEqual(cloneKey({}), ' ');
});
