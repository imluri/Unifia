const { test } = require('node:test');
const assert = require('node:assert');
const { deriveEdition, parseStatus } = require('./connectorStatus');

test('deriveEdition: official when matching configured id', () => {
  assert.strictEqual(deriveEdition('official-id', 'official-id'), 'official');
  assert.strictEqual(deriveEdition('other-id', 'official-id'), 'modded');
  assert.strictEqual(deriveEdition('any', ''), 'unknown');
  assert.strictEqual(deriveEdition('', 'official-id'), 'unknown');
});

test('parseStatus tolerates missing fields and derives editions', () => {
  const raw = JSON.stringify({
    loaded: true,
    room: 'unifia_AB',
    joined: true,
    self: { nick: 'Me', originalAppId: 'official-id' },
    players: [{ nick: 'Friend', originalAppId: 'crack-id' }, { nick: 'NoTag' }],
  });
  const s = parseStatus(raw, 'official-id');
  assert.strictEqual(s.joined, true);
  assert.strictEqual(s.self.edition, 'official');
  assert.strictEqual(s.players[0].edition, 'modded');
  assert.strictEqual(s.players[1].edition, 'unknown');
});

test('parseStatus returns null on garbage', () => {
  assert.strictEqual(parseStatus('not json', ''), null);
  assert.strictEqual(parseStatus('', ''), null);
});
