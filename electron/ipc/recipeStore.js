const fs = require('fs');
const path = require('path');
const { httpFetch } = require('../util');
const { cacheDir, ensureDir } = require('../paths');
const { store } = require('../store');
const R = require('./recipes');

// App version drives the recipe minUnifiaVersion gate. package.json is the build
// version (electron-builder uses it), so it matches app.getVersion() and is
// requirable in plain node too.
const APP_VERSION = require('../../package.json').version;

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/imluri/Unifia/main/recipes/';
const BUNDLED_DIR = path.join(__dirname, '..', 'data', 'recipes');

// Validated, in-memory recipe list + status. Loaded lazily from disk cache, with
// the bundled folder as the fallback. refreshRecipes() updates both.
let memo = null;

function sourceBase() {
  const override = store.get('settings.recipeSource');
  if (typeof override === 'string' && /^https:\/\//i.test(override)) {
    return override.endsWith('/') ? override : override + '/';
  }
  return DEFAULT_SOURCE;
}

function cacheFile() {
  return path.join(cacheDir(), 'recipes', 'recipes.json');
}

// Read the persisted cache: { fetchedAt, source, recipes:[{id,match,profile,version}] }.
function readCache() {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    const file = cacheFile();
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* non-fatal: cache write failure; next refresh retries */
  }
}

// Validate the bundled folder into the same shape as a fetched payload.
function loadBundled() {
  try {
    const index = R.validateIndex(JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, 'index.json'), 'utf8')));
    const recipes = [];
    for (const entry of index) {
      const raw = JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, entry.file), 'utf8'));
      const recipe = R.assembleRecipe(entry, raw, APP_VERSION);
      if (recipe) recipes.push(recipe);
    }
    return { fetchedAt: 0, source: 'bundled', recipes };
  } catch {
    return { fetchedAt: 0, source: 'bundled', recipes: [] };
  }
}

// Resolve the active payload: in-memory memo → disk cache → bundled.
function active() {
  if (memo) return memo;
  memo = readCache() || loadBundled();
  return memo;
}

// Fetch the index + each recipe file, validate, persist. Never throws; on any
// failure the existing cache/bundled stays active. Returns a status object.
async function refreshRecipes({ force = false } = {}) {
  const base = sourceBase();
  try {
    const idxRes = await httpFetch(base + 'index.json', { headers: { 'User-Agent': 'Unifia-Launcher' } });
    if (!idxRes.ok) throw new Error(`index ${idxRes.status}`);
    const index = R.validateIndex(await idxRes.json());
    const recipes = [];
    for (const entry of index) {
      try {
        const res = await httpFetch(base + entry.file, { headers: { 'User-Agent': 'Unifia-Launcher' } });
        if (!res.ok) continue;
        const recipe = R.assembleRecipe(entry, await res.json(), APP_VERSION);
        if (recipe) recipes.push(recipe);
      } catch {
        /* skip this recipe; others still load */
      }
    }
    const payload = { fetchedAt: Date.now(), source: base, recipes };
    writeCache(payload);
    memo = payload;
    return recipeStatus();
  } catch (err) {
    // Offline / TLS quirk / bad index: keep whatever is active.
    active();
    return { ...recipeStatus(), error: String(err && err.message || err) };
  }
}

// Sync: the validated profile fields for a game's matching recipe, or null.
function recipeFor(game) {
  const r = R.matchRecipe(active().recipes, game || {});
  return r ? r.profile : null;
}

// Sync: the matched recipe's id + version for a game (for UI labels), or null.
function recipeMetaFor(game) {
  const r = R.matchRecipe(active().recipes, game || {});
  return r ? { id: r.id, version: r.version || 0 } : null;
}

function recipeStatus() {
  const a = active();
  return { count: a.recipes.length, fetchedAt: a.fetchedAt, source: a.source };
}

module.exports = { refreshRecipes, recipeFor, recipeMetaFor, recipeStatus };
