const fs = require('fs');
const path = require('path');

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

// Resolve a profile for a game: registry match (by steamAppId or namePattern)
// merged over defaults, else defaults seeded from the detected engine.
function matchProfile(game) {
  const reg = loadRegistry();
  const base = reg.default || {};

  for (const entry of reg.games || []) {
    const m = entry.match || {};
    if (m.steamAppId && game.steamAppId && String(game.steamAppId) === String(m.steamAppId)) {
      return { ...base, ...entry.profile };
    }
    if (m.namePattern && game.name) {
      const re = safeRegex(m.namePattern);
      if (re && re.test(game.name)) return { ...base, ...entry.profile };
    }
  }

  // No explicit entry — derive sensible defaults from the engine backend so the
  // mod at least picks the right module flavour.
  const module = game.unityBackend === 'il2cpp' ? 'bepinex_il2cpp' : 'bepinex_mono';
  return { ...base, game: game.name, module };
}

module.exports = { matchProfile, loadRegistry };
