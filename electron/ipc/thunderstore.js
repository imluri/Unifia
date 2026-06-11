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

module.exports = { parsePackages, isCacheFresh, fetchModList, cacheFile };
