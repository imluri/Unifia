// Simple verification that new cache functions are exported
const modManager = require('./modManager');

console.log('Checking cache function exports...');

const cacheFunctions = [
  'recordCacheEntry',
  'getCacheRecord',
  'listCachedVersions',
  'validateCacheEntry',
  'validateCache',
  'getCacheStats',
  'migratePresetsToCache',
  'deployModsWithValidation',
];

for (const fn of cacheFunctions) {
  if (typeof modManager[fn] === 'function') {
    console.log(`✔ ${fn} is exported`);
  } else {
    console.log(`✗ ${fn} is NOT exported`);
    process.exit(1);
  }
}

console.log('\nAll cache functions are properly exported');

// Verify existing functions still work
const existingFunctions = [
  'fetchModList',
  'getInstalledMods',
  'installMod',
  'uninstallMod',
  'deployMods',
  'checkModUpdates',
];

for (const fn of existingFunctions) {
  if (typeof modManager[fn] === 'function') {
    console.log(`✔ ${fn} still exported`);
  } else {
    console.log(`✗ ${fn} is missing`);
    process.exit(1);
  }
}

console.log('\nAll existing functions still properly exported');

const newFunctions = ['setGameCommunity', 'listCommunities'];
for (const fn of newFunctions) {
  if (typeof modManager[fn] === 'function') {
    console.log(`✔ ${fn} is exported`);
  } else {
    console.log(`✗ ${fn} is NOT exported`);
    process.exit(1);
  }
}

console.log('✔ Export verification complete');
