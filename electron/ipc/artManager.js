const { store } = require('../store');
const { httpFetch } = require('../util');

// SteamGridDB integration with a Steam CDN fallback. Fetched art URLs are
// cached in electron-store for a week so we don't hammer the API on every
// launch. Users supply their own free SteamGridDB key in Settings.

const API_BASE = 'https://www.steamgriddb.com/api/v2';
const STEAM_CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getKey() {
  return (store.get('settings.steamGridDbKey') || '').trim();
}

// Call a SteamGridDB endpoint with the given (or stored) key. Throws on a
// missing key or a non-OK response so callers can fall back gracefully.
async function sgdb(pathname, overrideKey) {
  const key = (overrideKey || getKey()).trim();
  if (!key) throw new Error('No SteamGridDB API key set');
  const res = await httpFetch(`${API_BASE}${pathname}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      'User-Agent': 'Unifia-Launcher',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`SteamGridDB ${res.status}: ${res.statusText}`);
  const json = await res.json();
  if (json && json.success === false) {
    throw new Error((json.errors && json.errors.join(', ')) || 'SteamGridDB error');
  }
  return json;
}

// Pick the highest-rated asset from a SteamGridDB list response.
function bestUrl(json) {
  const data = (json && json.data) || [];
  if (data.length === 0) return null;
  const sorted = [...data].sort(
    (a, b) => (b.upvotes || 0) - (b.downvotes || 0) - ((a.upvotes || 0) - (a.downvotes || 0))
  );
  return sorted[0].url || sorted[0].thumb || null;
}

// Search SteamGridDB by name; returns { id, name } of the top hit, or null.
async function searchGame(gameName) {
  const json = await sgdb(`/search/autocomplete/${encodeURIComponent(gameName)}`);
  const hit = (json.data || [])[0];
  return hit ? { id: hit.id, name: hit.name } : null;
}

async function getGameBanner(sgdbId) {
  const json = await sgdb(`/grids/game/${sgdbId}?dimensions=460x215`);
  return bestUrl(json);
}

async function getGameIcon(sgdbId) {
  const json = await sgdb(`/icons/game/${sgdbId}`);
  return bestUrl(json);
}

async function getGameHero(sgdbId) {
  const json = await sgdb(`/heroes/game/${sgdbId}`);
  return bestUrl(json);
}

// Deterministic Steam CDN URLs — no API key or network round-trip needed.
function getSteamFallback(steamAppId) {
  return {
    banner: `${STEAM_CDN}/${steamAppId}/header.jpg`,
    icon: `${STEAM_CDN}/${steamAppId}/capsule_sm_120.jpg`,
    hero: `${STEAM_CDN}/${steamAppId}/library_600x900.jpg`,
  };
}

function readCache(gameId) {
  const cache = store.get('artCache') || {};
  const entry = cache[gameId];
  if (!entry) return null;
  if (Date.now() - (entry.fetchedAt || 0) > CACHE_TTL) return null; // stale
  return entry;
}

function writeCache(gameId, art) {
  const cache = store.get('artCache') || {};
  cache[gameId] = { ...art, fetchedAt: Date.now() };
  store.set('artCache', cache);
}

// Main entry point. Returns { banner, icon, hero } (any field may be null) or
// null when nothing could be resolved. Order: cache → SteamGridDB → Steam CDN.
async function fetchGameArt(gameId, gameName, steamAppId) {
  const cached = readCache(gameId);
  if (cached) {
    return { banner: cached.banner, icon: cached.icon, hero: cached.hero, cached: true };
  }

  let art = { banner: null, icon: null, hero: null };

  // 1. Try SteamGridDB if the user configured a key.
  if (getKey() && gameName) {
    try {
      const found = await searchGame(gameName);
      if (found) {
        // Each asset is best-effort: a missing icon shouldn't lose the banner.
        art.banner = await getGameBanner(found.id).catch(() => null);
        art.icon = await getGameIcon(found.id).catch(() => null);
        art.hero = await getGameHero(found.id).catch(() => null);
      }
    } catch {
      /* fall through to Steam fallback */
    }
  }

  // 2. Steam CDN fallback for anything still missing, when we have an appId.
  if ((!art.banner || !art.icon || !art.hero) && steamAppId) {
    const fb = getSteamFallback(steamAppId);
    art.banner = art.banner || fb.banner;
    art.icon = art.icon || fb.icon;
    art.hero = art.hero || fb.hero;
  }

  // 3. Nothing resolved → null so the UI shows a placeholder.
  if (!art.banner && !art.icon && !art.hero) return null;

  writeCache(gameId, art);
  return art;
}

function clearArtCache(gameId) {
  if (gameId) {
    const cache = store.get('artCache') || {};
    delete cache[gameId];
    store.set('artCache', cache);
  } else {
    store.set('artCache', {});
  }
  return { cleared: gameId || 'all' };
}

// Used by the Settings "Test Key" button: a cheap call that should 200 with a
// valid key. We hit grids for game id 1 as a known-good reference.
async function testKey(overrideKey) {
  await sgdb('/grids/game/1', overrideKey);
  return { ok: true };
}

module.exports = {
  searchGame,
  getGameBanner,
  getGameIcon,
  getGameHero,
  getSteamFallback,
  fetchGameArt,
  clearArtCache,
  testKey,
};
