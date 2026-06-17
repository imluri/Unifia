# Mod Cache System Implementation

## Overview
A global, version-keyed mod cache has been implemented to replace per-preset mod staging. Mods are downloaded once and cached globally, then deployed to each game/preset as needed. This reduces bandwidth, storage, and installation time.

## Architecture

### Directory Structure
```
unifia_data/
├── cache/
│   ├── mods/
│   │   ├── BepInEx-BepInExPack/
│   │   │   ├── 5.4.2100/
│   │   │   │   ├── BepInExPack_Mono/
│   │   │   │   │   ├── BepInEx/
│   │   │   │   │   │   └── ...
│   │   │   │   │   └── ...
│   │   │   │   └── manifest.json
│   │   │   └── 5.4.2099/
│   │   │       └── ...
│   │   └── Author-ModName/
│   │       ├── 1.0.0/
│   │       ├── 1.1.0/
│   │       └── 2.0.0/
│   └── records/
│       ├── BepInEx-BepInExPack/
│       │   ├── 5.4.2100.json
│       │   └── 5.4.2099.json
│       └── Author-ModName/
│           ├── 1.0.0.json
│           ├── 1.1.0.json
│           └── 2.0.0.json
├── downloads/
│   └── (temporary zip files during download)
└── mods/
    ├── gameId/
    │   └── presetId/
    │       └── (no longer stores mod files, only metadata)
```

## Core Functions

### 1. Cache Recording
```javascript
recordCacheEntry(fullName, version, metadata = {})
```
- Creates metadata record after successful cache extraction
- Stores: fullName, version, cached_at, size, file_count
- Automatically calculates directory size and file count

### 2. Cache Retrieval
```javascript
getCacheRecord(fullName, version)
listCachedVersions(fullName)
```
- `getCacheRecord`: Get metadata for a specific mod version
- `listCachedVersions`: List all cached versions of a mod

### 3. Cache Validation
```javascript
validateCacheEntry(fullName, version)
validateCache()
```
- `validateCacheEntry`: Check if cache dir exists and has content
- `validateCache`: Scan all records and remove orphaned entries

### 4. Cache Statistics
```javascript
getCacheStats()
```
Returns: `{ totalSize, totalMods, totalVersions }`

### 5. Download with Cache-Awareness
```javascript
stageVersion(gameId, fullName, versionData, onProgress)
```
- Enhanced with cache hit detection
- Skips download if version already cached
- Emits `{ cached: true }` in progress callback on hit
- Records entry after extraction

### 6. Deployment with Validation
```javascript
deployModsWithValidation(gameId, installPath)
```
- Validates cache before deploying
- Returns deployment log with per-mod status
- Gracefully skips mods with missing/invalid cache
- Maintains file tracking for cleanup

### 7. Migration (One-time Operation)
```javascript
migratePresetsToCache(onProgress)
```
- Scans all presets for existing mod installations
- Moves mods to global cache (avoiding duplicates)
- Records cache entries with metadata
- Returns: `{ migrated, skipped, errors }`

## IPC Handlers (Electron Main Process)

All cache functions are exposed via IPC:

```javascript
// Cache validation and stats
unifia:validateCache()            // → { checked, repaired, errors }
unifia:getCacheStats()            // → { totalSize, totalMods, totalVersions }
unifia:getCacheRecord(fullName, version)
unifia:listCachedVersions(fullName)

// Migration
unifia:migratePresetsToCache()    // Emits: cache-migration-progress events

// Deployment
unifia:deployModsWithValidation(gameId, installPath)
```

## Usage Examples

### Check cache health
```javascript
const result = await window.unifia('unifia:validateCache');
// { checked: 42, repaired: 3, errors: [] }
```

### Get cache statistics
```javascript
const stats = await window.unifia('unifia:getCacheStats');
// { totalSize: 5368709120, totalMods: 47, totalVersions: 120 }
```

### Run migration (one-time)
```javascript
window.unifia('onCacheMigrationProgress', (progress) => {
  console.log(`Migrated: ${progress.migrated}, Skipped: ${progress.skipped}`);
});

const result = await window.unifia('unifia:migratePresetsToCache');
// { migrated: 128, skipped: 0, errors: [] }
```

## Workflow: Install → Cache → Deploy

1. **Install Request**
   ```
   User requests: installMod(gameId, modName, version)
   ```

2. **Download + Cache** (in `stageVersion`)
   ```
   Check: Is modCacheDir(modName, version) populated?
   ├─ YES → Skip download, emit { cached: true }
   └─ NO  → Download zip, extract to cache, recordCacheEntry()
   ```

3. **Record State**
   ```
   Update modsState[modName] = {
     version,
     enabled: true,
     isDependency: false,
     deployedFiles: [],
     ...
   }
   ```

4. **Deploy to Game** (in `deployModsWithValidation`)
   ```
   For each enabled mod in modsState:
   ├─ Validate: validateCacheEntry(modName, version)
   ├─ If valid: Copy modCacheDir → game/BepInEx/plugins/
   ├─ Track: deployedFiles = [rel paths]
   └─ If invalid: Skip, log error
   ```

5. **Cleanup on Uninstall**
   ```
   uninstallMod(gameId, modName):
   ├─ Archive mod files (if any deployed)
   ├─ Remove from modsState
   ├─ Cache remains (used by other presets/games)
   ```

## Backward Compatibility

- Existing `deployMods` function preserved for fallback
- Old preset staging folders automatically migrated (first run)
- Can coexist with legacy installations during transition
- All existing IPC handlers continue to work

## Testing

Run verification:
```bash
node electron/ipc/modManager.exports.test.js  # Verify exports
node electron/ipc/modResolver.test.js         # Existing tests still pass
```

## Performance Improvements

- **Bandwidth**: Download each mod version once (vs. once per preset)
- **Storage**: Deduplicated cache (no mod version duplicates)
- **Install Speed**: Cache hits skip network entirely
- **Disk I/O**: Single cache copy vs. multiple staging copies

## Migration Path

1. System detects first launch or missing migration marker
2. `migratePresetsToCache()` runs automatically
3. All existing preset mods move to cache
4. Progress shown to user via `cache-migration-progress` events
5. Migration state persisted to prevent re-runs

## Error Handling

- Missing cache on deploy: Skip with logging
- Orphaned records: Detected and cleaned by `validateCache()`
- Migration errors: Logged but don't block (partial success acceptable)
- Download failures: Existing error handling preserved

## Future Enhancements

- [ ] Cleanup old cache versions (keep only N latest)
- [ ] Cache compression (zip storage)
- [ ] Cache eviction policy (LRU by access)
- [ ] Cache integrity checking (checksums)
- [ ] Export/import cache between machines
