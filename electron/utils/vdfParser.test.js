// Run with:  node --test electron/utils/vdfParser.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseVDF } = require('./vdfParser');

test('parses a flat block of key/value pairs', () => {
  const vdf = `
    "AppState"
    {
      "appid"   "1835470"
      "name"    "REPO"
    }
  `;
  const result = parseVDF(vdf);
  assert.deepStrictEqual(result, {
    AppState: { appid: '1835470', name: 'REPO' },
  });
});

test('handles arbitrarily nested objects', () => {
  const vdf = `
    "libraryfolders"
    {
      "0"
      {
        "path"  "C:\\\\Program Files (x86)\\\\Steam"
        "apps"
        {
          "1835470" "1234567890"
        }
      }
    }
  `;
  const result = parseVDF(vdf);
  assert.strictEqual(result.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
  assert.strictEqual(result.libraryfolders['0'].apps['1835470'], '1234567890');
});

test('keeps spaces inside quoted strings', () => {
  const vdf = `"name" "R.E.P.O - The Game"`;
  const result = parseVDF(vdf);
  assert.strictEqual(result.name, 'R.E.P.O - The Game');
});

test('decodes escaped characters (\\\\, \\", \\n, \\t)', () => {
  const vdf = `"line" "a\\tb\\nc" "quote" "say \\"hi\\"" "win" "D:\\\\Games\\\\X"`;
  const result = parseVDF(vdf);
  assert.strictEqual(result.line, 'a\tb\nc');
  assert.strictEqual(result.quote, 'say "hi"');
  assert.strictEqual(result.win, 'D:\\Games\\X');
});

test('strips // line comments', () => {
  const vdf = `
    // top-level comment
    "AppState"
    {
      "appid" "42"   // trailing comment
      // full-line comment
      "name"  "Test"
    }
  `;
  const result = parseVDF(vdf);
  assert.deepStrictEqual(result.AppState, { appid: '42', name: 'Test' });
});

test('handles unquoted keys and values', () => {
  const vdf = `AppState { appid 42 name Test }`;
  const result = parseVDF(vdf);
  assert.deepStrictEqual(result.AppState, { appid: '42', name: 'Test' });
});

test('parses a realistic appmanifest.acf', () => {
  const acf = `
    "AppState"
    {
      "appid"       "1835470"
      "name"        "REPO"
      "StateFlags"  "4"
      "installdir"  "REPO"
      "LastUpdated" "1712345678"
      "SizeOnDisk"  "1234567890"
      "buildid"     "12345678"
    }
  `;
  const { AppState } = parseVDF(acf);
  assert.strictEqual(AppState.appid, '1835470');
  assert.strictEqual(AppState.StateFlags, '4');
  assert.strictEqual(AppState.installdir, 'REPO');
  assert.strictEqual(AppState.buildid, '12345678');
});
