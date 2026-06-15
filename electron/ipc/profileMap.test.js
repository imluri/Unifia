const { test } = require('node:test');
const assert = require('node:assert');
const { mapReportToProfile } = require('./profileMap');

test('pun2 + steam lobby → needs-reroute, reconnect-on-load, join hook', () => {
  const p = mapReportToProfile({
    netcode: 'pun2', usesSteamLobbies: true, feasibility: 'needs-reroute',
    hooks: { join: { type: 'REPO.Net', method: 'JoinGame' } },
  });
  assert.strictEqual(p.netcode, 'pun2');
  assert.strictEqual(p.feasibility, 'needs-reroute');
  assert.strictEqual(p.hookStrategy, 'reconnect-on-load');
  assert.strictEqual(p.connectHookType, 'REPO.Net');
  assert.strictEqual(p.connectHookMethod, 'JoinGame');
});

test('pun2, no steam lobby → supported, auto-on-load', () => {
  const p = mapReportToProfile({ netcode: 'pun2', usesSteamLobbies: false, feasibility: 'supported', hooks: {} });
  assert.strictEqual(p.hookStrategy, 'auto-on-load');
  assert.strictEqual(p.connectHookType, '');
});

test('unknown netcode → manual, empty hooks', () => {
  const p = mapReportToProfile({ netcode: 'unknown', feasibility: 'unknown', hooks: {} });
  assert.strictEqual(p.hookStrategy, 'manual');
  assert.strictEqual(p.connectHookMethod, '');
});
