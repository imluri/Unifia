const { test } = require('node:test');
const assert = require('node:assert');
const { encodeInvite, decodeInvite } = require('./inviteCode');

const sample = {
  community: 'repo',
  name: 'REPO',
  appId: 'abc-123',
  room: 'unifia_7F3K',
  version: '0.4.4',
  mods: [{ fullName: 'Zehs-REPOLib', version: '4.2.0' }],
};

test('round-trips a descriptor', () => {
  const decoded = decodeInvite(encodeInvite(sample));
  assert.deepStrictEqual(decoded, { v: 1, ...sample });
});

test('rejects malformed base64', () => {
  assert.throws(() => decodeInvite('not-valid-$$$'), /invite/i);
});

test('rejects unknown version', () => {
  const bad = Buffer.from(JSON.stringify({ v: 99, community: 'x' }), 'utf8').toString('base64url');
  assert.throws(() => decodeInvite(bad), /version/i);
});

test('rejects oversized input', () => {
  assert.throws(() => decodeInvite('A'.repeat(20001)), /invite/i);
});
