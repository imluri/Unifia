const { test } = require('node:test');
const assert = require('node:assert');
const { parseDependency, resolveInstallSet, deployTarget, hasBepInExPack } = require('./modResolver');

const PKGS = [
  { fullName: 'BepInEx-BepInExPack', versions: [{ version_number: '5.4.2100', dependencies: [] }] },
  { fullName: 'Owner-Lib', versions: [{ version_number: '1.0.0', dependencies: ['BepInEx-BepInExPack-5.4.2100'] }] },
  {
    fullName: 'Owner-CoolMod',
    versions: [
      { version_number: '1.2.0', dependencies: ['BepInEx-BepInExPack-5.4.2100', 'Owner-Lib-1.0.0'] },
    ],
  },
];

test('parseDependency splits full_name and version', () => {
  assert.deepStrictEqual(parseDependency('BepInEx-BepInExPack-5.4.2100'), {
    fullName: 'BepInEx-BepInExPack',
    version: '5.4.2100',
  });
  assert.deepStrictEqual(parseDependency('Owner-Cool-Mod-1.2.0'), {
    fullName: 'Owner-Cool-Mod',
    version: '1.2.0',
  });
});

test('resolveInstallSet returns target + all deps, deduped, deepest first', () => {
  const set = resolveInstallSet(PKGS, 'Owner-CoolMod', '1.2.0', {});
  const names = set.map((s) => s.fullName);
  assert.ok(names.includes('Owner-CoolMod'));
  assert.ok(names.includes('Owner-Lib'));
  assert.ok(names.includes('BepInEx-BepInExPack'));
  assert.ok(names.indexOf('BepInEx-BepInExPack') < names.indexOf('Owner-CoolMod'));
  assert.strictEqual(names.filter((n) => n === 'BepInEx-BepInExPack').length, 1);
});

test('resolveInstallSet skips already-installed same version', () => {
  const installed = { 'BepInEx-BepInExPack': { version: '5.4.2100' } };
  const set = resolveInstallSet(PKGS, 'Owner-CoolMod', '1.2.0', installed);
  assert.ok(!set.some((s) => s.fullName === 'BepInEx-BepInExPack'));
});

test('resolveInstallSet tolerates missing dependency', () => {
  const pkgs = [{ fullName: 'A-Mod', versions: [{ version_number: '1.0.0', dependencies: ['Ghost-Gone-9.9.9'] }] }];
  const set = resolveInstallSet(pkgs, 'A-Mod', '1.0.0', {});
  assert.deepStrictEqual(set.map((s) => s.fullName), ['A-Mod']);
});

test('deployTarget routes BepInExPack to root, others to plugins', () => {
  assert.strictEqual(deployTarget('BepInEx-BepInExPack'), 'root');
  assert.strictEqual(deployTarget('denikson-BepInExPack_Valheim'), 'root');
  assert.strictEqual(deployTarget('Owner-CoolMod'), 'plugins');
});

test('hasBepInExPack: true only when an enabled BepInExPack entry exists', () => {
  assert.strictEqual(
    hasBepInExPack({ 'BepInEx-BepInExPack': { enabled: true }, 'Owner-Mod': { enabled: true } }),
    true
  );
  assert.strictEqual(hasBepInExPack({ 'denikson-BepInExPack_Valheim': { enabled: true } }), true);
  // disabled BepInExPack does not count
  assert.strictEqual(hasBepInExPack({ 'BepInEx-BepInExPack': { enabled: false } }), false);
  // unrelated mods only
  assert.strictEqual(hasBepInExPack({ 'Owner-Mod': { enabled: true } }), false);
  // empty / missing
  assert.strictEqual(hasBepInExPack({}), false);
  assert.strictEqual(hasBepInExPack(null), false);
});
