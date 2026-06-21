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

  let entryProfile = {};
  for (const entry of reg.games || []) {
    const m = entry.match || {};
    if (m.steamAppId && game.steamAppId && String(game.steamAppId) === String(m.steamAppId)) {
      entryProfile = entry.profile; break;
    }
    if (m.namePattern && game.name) {
      const re = safeRegex(m.namePattern);
      if (re && re.test(game.name)) { entryProfile = entry.profile; break; }
    }
  }

  const merged = resolveProfile({ base, entryProfile, analyzerOverride, recipeProfile });
  const gameStored = (store.get('gameProfiles') || {})[game.id];
  return applyCommunityOverride(merged, gameStored);
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

// Overlay the per-game Thunderstore community (auto-resolved or user-picked,
// stored in gameProfiles[id].thunderstoreCommunity) as the final precedence
// layer, so unregistered games get a source and users can correct a mismatch.
function applyCommunityOverride(profile, gameStored) {
  const c = (((gameStored || {}).thunderstoreCommunity) || '').trim();
  if (!c) return profile;
  return { ...profile, thunderstoreCommunity: c };
}

module.exports = { matchProfile, resolveProfile, applyAppIdOverride, applyCommunityOverride, loadRegistry };
