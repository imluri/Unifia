const { test } = require('node:test');
const assert = require('node:assert');
const { parsePackages, isCacheFresh, parseCommunities } = require('./thunderstore');

test('parsePackages maps the fields the UI needs', () => {
  const raw = [
    {
      name: 'CoolMod',
      full_name: 'Owner-CoolMod',
      owner: 'Owner',
      package_url: 'https://thunderstore.io/c/repo/p/Owner/CoolMod/',
      is_deprecated: false,
      rating_score: 42,
      categories: ['Mods', 'Tweaks'],
      versions: [
        {
          version_number: '1.2.0',
          dependencies: ['BepInEx-BepInExPack-5.4.2100'],
          download_url: 'https://cdn/Owner-CoolMod-1.2.0.zip',
          icon: 'https://gcdn.thunderstore.io/x.png',
          description: 'Does cool things',
          file_size: 1234,
          date_created: '2025-01-01T00:00:00Z',
        },
        { version_number: '1.1.0', dependencies: [], download_url: 'u', icon: 'i', description: 'old', file_size: 1, date_created: '2024-01-01T00:00:00Z' },
      ],
    },
  ];
  const parsed = parsePackages(raw);
  assert.strictEqual(parsed.length, 1);
  const m = parsed[0];
  assert.strictEqual(m.fullName, 'Owner-CoolMod');
  assert.strictEqual(m.owner, 'Owner');
  assert.strictEqual(m.icon, 'https://gcdn.thunderstore.io/x.png');
  assert.strictEqual(m.latest.version_number, '1.2.0');
  assert.strictEqual(m.totalDownloads, 0); // none in fixture
  assert.deepStrictEqual(m.categories, ['Mods', 'Tweaks']);
  assert.strictEqual(m.versions.length, 2);
});

test('parsePackages returns [] for non-array input', () => {
  assert.deepStrictEqual(parsePackages(null), []);
  assert.deepStrictEqual(parsePackages(undefined), []);
  assert.deepStrictEqual(parsePackages([]), []);
});

test('isCacheFresh respects the TTL', () => {
  const now = Date.now();
  assert.strictEqual(isCacheFresh({ fetchedAt: now - 1000 }, 60000), true);
  assert.strictEqual(isCacheFresh({ fetchedAt: now - 120000 }, 60000), false);
  assert.strictEqual(isCacheFresh(null, 60000), false);
  assert.strictEqual(isCacheFresh({}, 60000), false);
});

test('parseCommunities maps identifier + name, tolerating missing fields', () => {
  const results = [
    { identifier: 'repo', name: 'REPO' },
    { identifier: 'lethal-company' }, // missing name → falls back to identifier
    { name: 'No Identifier' }, // no identifier → dropped
    null,
  ];
  assert.deepStrictEqual(parseCommunities(results), [
    { identifier: 'repo', name: 'REPO' },
    { identifier: 'lethal-company', name: 'lethal-company' },
  ]);
  assert.deepStrictEqual(parseCommunities(null), []);
});
