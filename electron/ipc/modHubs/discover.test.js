const { test } = require('node:test');
const assert = require('node:assert');
const { filterDiscover } = require('./discover');

test('filterDiscover drops installed communities and maps the rest', () => {
  const catalog = [
    { identifier: 'repo', name: 'REPO' },
    { identifier: 'lethal-company', name: 'Lethal Company' },
    { identifier: 'valheim', name: 'Valheim' },
  ];
  const result = filterDiscover(catalog, ['repo']);
  assert.deepStrictEqual(result, [
    { id: 'ts:lethal-company', name: 'Lethal Company', community: 'lethal-company', installed: false },
    { id: 'ts:valheim', name: 'Valheim', community: 'valheim', installed: false },
  ]);
});

test('filterDiscover tolerates empty/missing inputs', () => {
  assert.deepStrictEqual(filterDiscover([], []), []);
  assert.deepStrictEqual(filterDiscover(null, null), []);
  assert.deepStrictEqual(filterDiscover([{ name: 'x' }], []), []);
});
