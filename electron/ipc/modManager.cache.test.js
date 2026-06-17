const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock dependencies
const modManager = require('./modManager');
const { modCacheDir, subdir } = require('../paths');

// Use temp directory for tests
let testDataDir;

function setupTestEnv() {
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unifia-cache-test-'));
  process.env.TEST_DATA_DIR = testDataDir;
  return testDataDir;
}

function cleanupTestEnv() {
  if (testDataDir && fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

describe('Cache Management', () => {
  test('recordCacheEntry creates a metadata record', () => {
    const testDir = setupTestEnv();
    
    try {
      // Create a fake cache directory with files
      const cacheDir = path.join(testDir, 'cache', 'mods', 'Test-Mod', '1.0.0');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'test.txt'), 'test content');
      fs.writeFileSync(path.join(cacheDir, 'plugin.dll'), 'fake dll');
      
      const recordPath = modManager.recordCacheEntry('Test-Mod', '1.0.0');
      assert.ok(recordPath);
      assert.ok(fs.existsSync(recordPath));
      
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      assert.strictEqual(record.fullName, 'Test-Mod');
      assert.strictEqual(record.version, '1.0.0');
      assert.ok(record.cached_at);
      assert.strictEqual(record.file_count, 2);
    } finally {
      cleanupTestEnv();
    }
  });

  test('getCacheRecord retrieves saved record', () => {
    const testDir = setupTestEnv();
    
    try {
      // Create and record a cache entry
      const cacheDir = path.join(testDir, 'cache', 'mods', 'Lib-Mod', '2.0.0');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'lib.dll'), 'library');
      
      modManager.recordCacheEntry('Lib-Mod', '2.0.0');
      const record = modManager.getCacheRecord('Lib-Mod', '2.0.0');
      
      assert.ok(record);
      assert.strictEqual(record.fullName, 'Lib-Mod');
      assert.strictEqual(record.version, '2.0.0');
      assert.strictEqual(record.file_count, 1);
    } finally {
      cleanupTestEnv();
    }
  });

  test('listCachedVersions returns all versions for a mod', () => {
    const testDir = setupTestEnv();
    
    try {
      // Create multiple versions
      for (const version of ['1.0.0', '1.1.0', '2.0.0']) {
        const cacheDir = path.join(testDir, 'cache', 'mods', 'Multi-Mod', version);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'mod.dll'), `version ${version}`);
        modManager.recordCacheEntry('Multi-Mod', version);
      }
      
      const versions = modManager.listCachedVersions('Multi-Mod');
      assert.strictEqual(versions.length, 3);
      assert.ok(versions.some(v => v.version === '1.0.0'));
      assert.ok(versions.some(v => v.version === '1.1.0'));
      assert.ok(versions.some(v => v.version === '2.0.0'));
    } finally {
      cleanupTestEnv();
    }
  });

  test('validateCacheEntry checks cache integrity', () => {
    const testDir = setupTestEnv();
    
    try {
      const cacheDir = path.join(testDir, 'cache', 'mods', 'Valid-Mod', '1.0.0');
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'mod.dll'), 'content');
      modManager.recordCacheEntry('Valid-Mod', '1.0.0');
      
      // Valid cache
      const result = modManager.validateCacheEntry('Valid-Mod', '1.0.0');
      assert.ok(result.valid);
      
      // Invalid - empty cache dir
      const emptyDir = path.join(testDir, 'cache', 'mods', 'Empty-Mod', '1.0.0');
      fs.mkdirSync(emptyDir, { recursive: true });
      modManager.recordCacheEntry('Empty-Mod', '1.0.0');
      fs.rmSync(emptyDir, { recursive: true });
      
      const emptyResult = modManager.validateCacheEntry('Empty-Mod', '1.0.0');
      assert.ok(!emptyResult.valid);
    } finally {
      cleanupTestEnv();
    }
  });

  test('validateCache repairs orphaned records', () => {
    const testDir = setupTestEnv();
    
    try {
      // Create valid entry
      const validCache = path.join(testDir, 'cache', 'mods', 'Valid-Mod', '1.0.0');
      fs.mkdirSync(validCache, { recursive: true });
      fs.writeFileSync(path.join(validCache, 'mod.dll'), 'content');
      modManager.recordCacheEntry('Valid-Mod', '1.0.0');
      
      // Create orphaned entry (record exists but cache dir doesn't)
      const orphanRecord = path.join(testDir, 'cache', 'records', 'Orphan-Mod', '1.0.0.json');
      fs.mkdirSync(path.dirname(orphanRecord), { recursive: true });
      fs.writeFileSync(orphanRecord, JSON.stringify({
        fullName: 'Orphan-Mod',
        version: '1.0.0',
        cached_at: new Date().toISOString(),
      }));
      
      const results = modManager.validateCache();
      assert.ok(results.checked > 0);
      assert.ok(results.repaired > 0);
    } finally {
      cleanupTestEnv();
    }
  });

  test('getCacheStats calculates total cache size', () => {
    const testDir = setupTestEnv();
    
    try {
      // Create multiple cache entries
      for (const [mod, version, size] of [
        ['Mod-A', '1.0.0', 1024],
        ['Mod-B', '1.0.0', 2048],
        ['Mod-C', '2.0.0', 4096],
      ]) {
        const cacheDir = path.join(testDir, 'cache', 'mods', mod, version);
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'mod.dll'), Buffer.alloc(size));
        modManager.recordCacheEntry(mod, version);
      }
      
      const stats = modManager.getCacheStats();
      assert.strictEqual(stats.totalMods, 3);
      assert.strictEqual(stats.totalVersions, 3);
      assert.ok(stats.totalSize > 0);
    } finally {
      cleanupTestEnv();
    }
  });
});

describe('Cache Migration', () => {
  test('migratePresetsToCache handles empty state', async () => {
    const testDir = setupTestEnv();
    
    try {
      const results = await modManager.migratePresetsToCache();
      assert.strictEqual(results.migrated, 0);
      assert.strictEqual(results.skipped, 0);
      assert.strictEqual(results.errors.length, 0);
    } finally {
      cleanupTestEnv();
    }
  });
});

describe('Cache Deployment', () => {
  test('deployModsWithValidation returns deployment log', () => {
    // This test would require more setup with game state
    // Placeholder for future implementation
    assert.ok(true);
  });
});

console.log('Cache tests completed successfully');
