const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { store } = require('../store');
const { httpFetch } = require('../util');
const { moduleDir, downloadsDir, ensureDir } = require('../paths');

// Map our internal module ids to their GitHub release source and the asset
// matcher used to pick the right zip from a release. BepInEx ships one repo
// with differently named assets for the Mono and IL2CPP flavours.
// [DISABLED] — Module system removed; BepInEx now via Thunderstore mods only.
const MODULE_SOURCES = {};

function moduleStoreKey(moduleName) {
  return `modules.${moduleName}`;
}

// Fetch every release page from the GitHub API and flatten to a version list.
// Pre-releases are kept or dropped based on includePrerelease so the UI toggle
// can re-query without us caching stale data.
// [DISABLED] — Module system removed; BepInEx now via Thunderstore mods only.
async function fetchModuleVersions(moduleName, { includePrerelease = false } = {}) {
  throw new Error('Module system disabled. BepInEx is now available via Thunderstore mods only.');
}

// Download the release zip with progress reporting, then extract it into the
// versioned module folder. onProgress receives { percent, bytesReceived,
// totalBytes } so the renderer can drive a progress bar.
// [DISABLED] — Module system removed; BepInEx now via Thunderstore mods only.
async function installModule(moduleName, version, downloadUrl, onProgress) {
  throw new Error('Module system disabled. BepInEx is now available via Thunderstore mods only.');
}

function uninstallModule(moduleName, version) {
  throw new Error('Module system disabled. BepInEx is now available via Thunderstore mods only.');
}

function getInstalledModules() {
  const modules = store.get('modules') || {};
  // Decorate with labels and install dates derived from the folder mtime.
  const result = {};
  for (const [name, entry] of Object.entries(modules)) {
    const source = MODULE_SOURCES[name];
    result[name] = {
      label: source ? source.label : name,
      active: entry.active || null,
      installed: (entry.installed || []).map((version) => {
        let installedAt = null;
        try {
          installedAt = fs.statSync(moduleDir(name, version)).mtime.toISOString();
        } catch {
          /* folder may have been removed externally */
        }
        return { version, installedAt };
      }),
    };
  }
  return result;
}

// Set the active module version for the whole module and link it to a specific
// game profile so the launcher knows what to copy for that game.
function setActiveModule(gameId, moduleName, version) {
  const key = moduleStoreKey(moduleName);
  const entry = store.get(key) || { installed: [], active: null };
  if (!entry.installed.includes(version)) {
    throw new Error(`Version ${version} of ${moduleName} is not installed`);
  }
  entry.active = version;
  store.set(key, entry);

  if (gameId) {
    const profiles = store.get('gameProfiles') || {};
    profiles[gameId] = {
      ...(profiles[gameId] || {}),
      activeModule: moduleName,
      moduleVersion: version,
    };
    store.set('gameProfiles', profiles);
  }

  return { gameId, moduleName, version };
}

function listModuleSources() {
  return []; // Module system disabled
}

module.exports = {
  MODULE_SOURCES,
  fetchModuleVersions,
  installModule,
  uninstallModule,
  getInstalledModules,
  setActiveModule,
  listModuleSources,
};
