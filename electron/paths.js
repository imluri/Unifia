const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { store } = require('./store');

// Resolve the root of the on-disk unifia_data folder. Honors the user-defined
// override from Settings, otherwise falls back to a stable location under the
// per-user app data directory.
function getDataDir() {
  const override = store.get('settings.dataDir');
  const root = override && override.trim()
    ? override.trim()
    : path.join(app.getPath('userData'), 'unifia_data');
  return root;
}

function subdir(...parts) {
  return path.join(getDataDir(), ...parts);
}

// Per-module storage root, e.g. unifia_data/modules/bepinex_mono/v5.4.23.2
function moduleDir(moduleName, version) {
  return version
    ? subdir('modules', moduleName, version)
    : subdir('modules', moduleName);
}

function downloadsDir() {
  return subdir('downloads');
}

function logsDir() {
  return subdir('logs');
}

// Make sure a directory exists, creating parents as needed.
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Game ids look like "custom:REPO" or "steam:480". The colon (and other
// reserved characters) are illegal in Windows paths, so map any id used as a
// folder name to a safe form. Store keys keep the raw id — only the on-disk
// folder is sanitized.
function safeSegment(name) {
  return String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
}

function modsDir(gameId, presetId) {
  if (!gameId) return subdir('mods');
  return presetId
    ? subdir('mods', safeSegment(gameId), safeSegment(presetId))
    : subdir('mods', safeSegment(gameId));
}

function cacheDir() {
  return subdir('cache');
}

// Global, version-keyed mod cache: a downloaded mod version lives here once and
// is copied into each game's BepInEx/plugins on deploy. Shared across presets+games.
function modCacheDir(fullName, version) {
  return subdir('cache', 'mods', safeSegment(fullName), safeSegment(String(version || '')));
}

// Create the baseline folder layout once on startup.
function ensureLayout() {
  ensureDir(getDataDir());
  ensureDir(subdir('modules'));
  ensureDir(downloadsDir());
  ensureDir(logsDir());
}

module.exports = {
  getDataDir,
  subdir,
  moduleDir,
  downloadsDir,
  logsDir,
  modsDir,
  cacheDir,
  modCacheDir,
  ensureDir,
  ensureLayout,
};
