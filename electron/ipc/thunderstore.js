const fs = require('fs');
const path = require('path');
const { httpFetch } = require('../util');
const { cacheDir, ensureDir } = require('../paths');

const TTL_MS = 30 * 60 * 1000; // 30 minutes

// Normalize a raw Thunderstore /api/v1/package/ array into the shape the UI uses.
function parsePackages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const versions = p.versions || [];
    const totalDownloads = versions.reduce((sum, v) => sum + (v.downloads || 0), 0);
    return {
      name: p.name,
      fullName: p.full_name,
      owner: p.owner,
      packageUrl: p.package_url,
      deprecated: !!p.is_deprecated,
      rating: p.rating_score || 0,
      categories: p.categories || [],
      totalDownloads,
      icon: versions[0] ? versions[0].icon : null,
      latest: versions[0] || null,
      versions,
    };
  });
}

function isCacheFresh(entry, ttl = TTL_MS) {
  return !!(entry && entry.fetchedAt && Date.now() - entry.fetchedAt <= ttl);
}

function cacheFile(community) {
  return path.join(cacheDir(), 'thunderstore', `${community}.json`);
}

function readCache(community) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(community), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(community, packages) {
  try {
    const file = cacheFile(community);
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), packages }), 'utf8');
  } catch {
    /* non-fatal: cache write failure; next call will re-fetch */
  }
}

// Fetch a community's package list, using the disk cache unless stale/refresh.
async function fetchModList(community, { refresh = false } = {}) {
  if (!community) return [];
  if (!/^[\w-]+$/.test(community)) throw new Error('Invalid community');
  const cached = readCache(community);
  if (!refresh && isCacheFresh(cached)) return cached.packages;

  const url = `https://thunderstore.io/c/${community}/api/v1/package/`;
  const res = await httpFetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Unifia-Launcher' },
  });
  if (!res.ok) {
    if (cached) return cached.packages; // serve stale on failure
    throw new Error(`Thunderstore ${res.status}: ${res.statusText}`);
  }
  const parsed = parsePackages(await res.json());
  writeCache(community, parsed);
  return parsed;
}

const COMMUNITIES_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Normalize the /api/experimental/community/ results array.
function parseCommunities(results) {
  if (!Array.isArray(results)) return [];
  return results
    .filter((c) => c && c.identifier)
    .map((c) => ({ identifier: c.identifier, name: c.name || c.identifier }));
}

function communitiesCacheFile() {
  return path.join(cacheDir(), 'thunderstore', '_communities.json');
}

function readCommunitiesCache() {
  try {
    return JSON.parse(fs.readFileSync(communitiesCacheFile(), 'utf8'));
  } catch {
    return null;
  }
}

function writeCommunitiesCache(communities) {
  try {
    const file = communitiesCacheFile();
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), communities }), 'utf8');
  } catch {
    /* non-fatal cache write */
  }
}

// Fetch the full Thunderstore community list (all pages, bounded), cached.
async function fetchCommunities({ refresh = false } = {}) {
  const cached = readCommunitiesCache();
  if (!refresh && isCacheFresh(cached, COMMUNITIES_TTL)) return cached.communities;

  try {
    let url = 'https://thunderstore.io/api/experimental/community/';
    const all = [];
    for (let page = 0; url && page < 25; page += 1) {
      const res = await httpFetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Unifia-Launcher' },
      });
      if (!res.ok) throw new Error(`Thunderstore ${res.status}: ${res.statusText}`);
      const data = await res.json();
      all.push(...parseCommunities(data.results));
      url = (data.pagination && data.pagination.next_link) || data.next || null;
    }
    writeCommunitiesCache(all);
    return all;
  } catch (err) {
    if (cached) return cached.communities; // serve stale on failure
    throw err;
  }
}

module.exports = { parsePackages, isCacheFresh, fetchModList, cacheFile, parseCommunities, fetchCommunities };
