const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { store } = require('../store');
const { modCacheDir, cacheDir } = require('../paths');

// getDataDir() uses Electron's app.getPath unless settings.dataDir is set; set an
// override so the path helpers resolve outside Electron.
let prev;
before(() => { prev = store.get('settings'); store.set('settings', { ...(prev || {}), dataDir: os.tmpdir() }); });
after(() => { if (prev === undefined) store.delete('settings'); else store.set('settings', prev); });

test('modCacheDir nests fullName + version under cache/mods', () => {
  const p = modCacheDir('Owner-Mod', '1.2.3').replace(/\\/g, '/');
  assert.ok(p.startsWith(cacheDir().replace(/\\/g, '/')), 'under cacheDir');
  assert.ok(p.endsWith('cache/mods/Owner-Mod/1.2.3'), p);
});

test('modCacheDir strips path separators from segments (no escape)', () => {
  const p = modCacheDir('Owner/Mod', '1.0\\x').replace(/\\/g, '/');
  const tail = p.split('cache/mods/')[1];
  assert.strictEqual(tail, 'Owner_Mod/1.0_x', tail);
});
