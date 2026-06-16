// Pure logic for crossplay recipes: validation against a constrained vocabulary,
// game matching, and version gating. NO electron/fs/network requires here — the
// impure fetch/cache shell lives in recipeStore.js. Mirrors the presetLogic.js
// (pure) / presetStore.js (impure) split. See the crossplay-recipes spec.

const SCHEMA_VERSION = 1;

// Allowed recipe profile fields and their expected JS typeof. Anything else in a
// recipe's `profile` is dropped — this is the safety boundary (recipes are pure
// data over a fixed vocabulary; widening it is a deliberate layer-B change).
const FIELD_TYPES = {
  game: 'string',
  netcode: 'string',
  hookStrategy: 'string',
  autoDelaySeconds: 'number',
  supportsNativeLobby: 'boolean',
  connectHookType: 'string',
  connectHookMethod: 'string',
  region: 'string',
  connectionMode: 'string',
  module: 'string',
  thunderstoreCommunity: 'string',
};

// Compare dotted numeric versions: is `a` >= `b`? Non-numeric parts treated as 0.
function versionGte(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true; // equal
}

function safeRegex(pattern) {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

// Keep only allowlisted, correctly-typed fields from a raw profile object.
function sanitizeProfile(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, type] of Object.entries(FIELD_TYPES)) {
    if (key in raw && typeof raw[key] === type) out[key] = raw[key];
  }
  return out;
}

// Validate one recipe object against the vocabulary + version gate.
// Returns { id, match, profile } or null if it must be ignored.
function validateRecipe(raw, appVersion) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (!raw.profile || typeof raw.profile !== 'object') return null;
  if (raw.minUnifiaVersion && !versionGte(appVersion, raw.minUnifiaVersion)) return null;
  return {
    id: raw.id,
    match: raw.match && typeof raw.match === 'object' ? raw.match : {},
    profile: sanitizeProfile(raw.profile),
  };
}

// Validate the index manifest. Returns an array of well-formed entries
// (others dropped). Does not fetch the recipe files themselves.
function validateIndex(raw) {
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SCHEMA_VERSION) return [];
  if (!Array.isArray(raw.recipes)) return [];
  return raw.recipes.filter(
    (e) =>
      e && typeof e.id === 'string' && e.id &&
      typeof e.file === 'string' && e.file &&
      e.match && typeof e.match === 'object',
  );
}

// Find the recipe whose match fits the game: steamAppId first, then namePattern.
function matchRecipe(recipes, game) {
  if (!Array.isArray(recipes)) return null;
  for (const r of recipes) {
    const m = r.match || {};
    if (m.steamAppId && game.steamAppId && String(game.steamAppId) === String(m.steamAppId)) {
      return r;
    }
  }
  for (const r of recipes) {
    const m = r.match || {};
    if (m.namePattern && game.name) {
      const re = safeRegex(m.namePattern);
      if (re && re.test(game.name)) return r;
    }
  }
  return null;
}

module.exports = { SCHEMA_VERSION, FIELD_TYPES, versionGte, safeRegex, sanitizeProfile, validateRecipe, validateIndex, matchRecipe };
