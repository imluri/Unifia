const { store } = require('../store');
const profiles = require('./profiles');
const thunderstore = require('./thunderstore');

// Thunderstore community identifiers are slugified game names. Lowercase, then
// collapse every run of non-alphanumeric characters into a single hyphen and
// trim leading/trailing hyphens. "Lethal Company" -> "lethal-company".
function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Exact-match a slug against the fetched community list. Returns the matching
// identifier or null. Pure — the list is passed in (no network here).
function pickCommunity(slug, communities) {
  if (!slug) return null;
  const hit = (communities || []).find((c) => c && c.identifier === slug);
  return hit ? hit.identifier : null;
}

// Resolve a game's Thunderstore community once and persist it. No-op when the
// game already resolves a community (registry/recipe/prior resolution), so REPO
// and registered games are never touched. Network failure degrades to null.
async function resolveCommunity(game) {
  const existing = profiles.matchProfile(game).thunderstoreCommunity;
  if (existing) return existing;

  const slug = slugify(game && game.name);
  if (!slug) return null;

  let communities;
  try {
    communities = await thunderstore.fetchCommunities();
  } catch {
    return null;
  }

  const id = pickCommunity(slug, communities);
  if (!id) return null;

  const gp = store.get('gameProfiles') || {};
  const entry = { ...(gp[game.id] || {}), thunderstoreCommunity: id };
  store.set('gameProfiles', { ...gp, [game.id]: entry });
  return id;
}

module.exports = { slugify, pickCommunity, resolveCommunity };
