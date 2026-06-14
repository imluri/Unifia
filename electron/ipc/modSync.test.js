const { test } = require('node:test');
const assert = require('node:assert');
const { diffMods } = require('./modSync');

test('partitions install / update / ok', () => {
  const installed = [
    { fullName: 'A-Mod', version: '1.0.0' },
    { fullName: 'B-Mod', version: '2.0.0' },
  ];
  const wanted = [
    { fullName: 'A-Mod', version: '1.0.0' }, // ok
    { fullName: 'B-Mod', version: '2.1.0' }, // update
    { fullName: 'C-Mod', version: '0.5.0' }, // install
  ];
  const d = diffMods(installed, wanted);
  assert.deepStrictEqual(d.ok, [{ fullName: 'A-Mod', version: '1.0.0' }]);
  assert.deepStrictEqual(d.toUpdate, [{ fullName: 'B-Mod', from: '2.0.0', to: '2.1.0' }]);
  assert.deepStrictEqual(d.toInstall, [{ fullName: 'C-Mod', version: '0.5.0' }]);
});

test('empty wanted yields empty diff', () => {
  assert.deepStrictEqual(diffMods([{ fullName: 'A', version: '1' }], []), {
    toInstall: [], toUpdate: [], ok: [],
  });
});
