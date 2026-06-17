const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { store } = require('../store');
const presetStore = require('./presetStore');

// Regression: activating a different preset must remove the outgoing preset's
// deployed files from the game folder. applyInvite/importPreset used to skip
// this, so a friend-code import left the old mods (e.g. umamusume) deployed.
test('undeployActive removes the active preset deployed files and clears tracking', () => {
  const gid = 'test:undeploy';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unifia-undeploy-'));
  const rel = path.join('BepInEx', 'plugins', 'Owner-Mod', 'Mod.dll');
  fs.mkdirSync(path.join(tmp, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(tmp, rel), 'dll');

  const prev = store.get('gamePresets');
  try {
    // Pre-seed an entry so getEntry returns it directly (no fs migration path).
    store.set('gamePresets', {
      [gid]: {
        activeId: 'p1',
        presets: [{
          id: 'p1', name: 'A', updatedAt: 0,
          mods: { 'Owner-Mod': { version: '1.0.0', enabled: true, isDependency: false, deployedFiles: [rel] } },
        }],
      },
    });

    assert.strictEqual(fs.existsSync(path.join(tmp, rel)), true, 'deployed file exists before');
    presetStore.undeployActive(gid, tmp);
    assert.strictEqual(fs.existsSync(path.join(tmp, rel)), false, 'deployed file removed after');
    assert.deepStrictEqual(presetStore.activeMods(gid)['Owner-Mod'].deployedFiles, [], 'deployedFiles cleared');
  } finally {
    if (prev === undefined) store.delete('gamePresets'); else store.set('gamePresets', prev);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
