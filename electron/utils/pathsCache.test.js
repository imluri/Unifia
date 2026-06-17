const { test } = require('node:test');
const assert = require('node:assert');
const { modCacheDir, cacheDir } = require('../paths');

test('modCacheDir nests fullName + version under cache/mods', () => {
  const p = modCacheDir('Owner-Mod', '1.2.3');
  assert.ok(p.startsWith(cacheDir()), 'under cacheDir');
  assert.ok(p.replace(/\\/g, '/').endsWith('cache/mods/Owner-Mod/1.2.3'), p);
});

test('modCacheDir sanitizes unsafe segments', () => {
  const p = modCacheDir('Owner-Mod', '1.0/../x').replace(/\\/g, '/');
  assert.ok(!p.includes('..'), 'no path traversal: ' + p);
});
