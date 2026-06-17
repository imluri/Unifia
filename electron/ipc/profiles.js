const fs = require('fs');
const path = require('path');
const { store } = require('../store');
const recipeStore = require('./recipeStore');

// Loads the bundled game-profile registry and resolves the network profile for
// a game. The profile is what the launcher writes to unifia_profile.json for the
// BepInEx mod, telling it how to behave per game. Most games are a data entry in
// game-profiles.json; unknown games fall back to engine-derived defaults.

let cache = null;

function loadRegistry() {
  if (cache) return cache;
  try {
    const file = path.join(__dirname, '..', 'data', 'game-profiles.json');
    cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    cache = { default: {}, games: [] };
  }
  return cache;
}

function safeRegex(pattern) {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

// Analyzer-owned fields written by the auto-profiler (gameProfiles[id].analysis).
// These take precedence so discovered hooks drive the connector.
function storedOverride(game) {
  const a = ((store.get('gameProfiles') || {})[game.id] || {}).analysis;
  if (!a) return {};
  const o = {};
  if (a.netcode) o.netcode = a.netcode;
  if (a.hookStrategy) o.hookStrategy = a.hookStrategy;
  if (a.connectHookType) o.connectHookType = a.connectHookType;
  if (a.connectHookMethod) o.connectHookMethod = a.connectHookMethod;
  return o;
}

// Pure precedence merge (later wins): base < entry < analyzer < recipe.
function resolveProfile({ base = {}, entryProfile = {}, analyzerOverride = {}, recipeProfile = {} }) {
  return { ...base, ...entryProfile, ...analyzerOverride, ...recipeProfile };
}

// Resolve a profile for a game: registry match (by steamAppId or namePattern)
// merged over defaults, then the analyzer override last, else engine defaults.
function matchProfile(game) {
  const reg = loadRegistry();
  const base = reg.default || {};
  const analyzerOverride = storedOverride(game);
  const recipeProfile = recipeStore.recipeFor(game) || {};

  for (const entry of reg.games || []) {
    const m = entry.match || {};
    if (m.steamAppId && game.steamAppId && String(game.steamAppId) === String(m.steamAppId)) {
      return resolveProfile({ base, entryProfile: entry.profile, analyzerOverride, recipeProfile });
    }
    if (m.namePattern && game.name) {
      const re = safeRegex(m.namePattern);
      if (re && re.test(game.name)) {
        return resolveProfile({ base, entryProfile: entry.profile, analyzerOverride, recipeProfile });
      }
    }
  }

  // No explicit entry — use base profile without module defaults (BepInEx now via Thunderstore mods).
  return resolveProfile({ base, entryProfile: {}, analyzerOverride, recipeProfile });
}

// Resolve the effective Photon AppId onto a profile. Precedence (most specific
// wins): a global Settings override → the per-game value the invite modal saved
// (gameProfiles[id].photonAppId) → the recipe's community AppId already on the
// profile. Empty strings never clobber a real value.
function applyAppIdOverride(profile, settings, gameStored) {
  const s = settings || {};
  const g = gameStored || {};
  const out = { ...profile };
  const pick = (...vals) => {
    for (const v of vals) {
      const t = (v || '').trim();
      if (t) return t;
    }
    return '';
  };
  const id = pick(s.photonAppIdOverride, g.photonAppId);
  const voice = pick(s.photonVoiceAppIdOverride, g.photonVoiceAppId);
  if (id) out.photonAppId = id;
  if (voice) out.photonVoiceAppId = voice;
  return out;
}

module.exports = { matchProfile, resolveProfile, applyAppIdOverride, loadRegistry };
