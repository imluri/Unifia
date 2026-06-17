const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { store } = require('../store');
const { httpFetch } = require('../util');
const { modsDir, modCacheDir, downloadsDir, ensureDir } = require('../paths');
const thunderstore = require('./thunderstore');
const profiles = require('./profiles');
const { resolveInstallSet, deployTarget, hasBepInExPack } = require('./modResolver');
const { aggregateMods } = require('./modHubs/aggregate');
const { getDependents: getDependentsFromGraph, detectConflicts, computeDependents } = require('./modMetadata');
const { getProviders } = require('./modHubs');
const { filterDiscover } = require('./modHubs/discover');
const presetStore = require('./presetStore');

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function communityFor(game) {
  const profile = profiles.matchProfile(game);
  return profile.thunderstoreCommunity || null;
}

// Active-preset staging folder for a game.
function presetDir(gameId) {
  return modsDir(gameId, presetStore.getActiveId(gameId));
}

function modsState(gameId) {
  return presetStore.activeMods(gameId);
}

function saveModsState(gameId, state) {
  presetStore.setActiveMods(gameId, state);
}

// Does this game have an enabled BepInExPack staged? (i.e. the Thunderstore mod
// system provides the loader, so the GitHub BepInEx copy should be skipped.)
function hasEnabledBepInExPack(gameId) {
  return hasBepInExPack(modsState(gameId));
}

// List recorded mods for a game (installed state, for the Installed tab).
function getInstalledMods(gameId) {
  const state = modsState(gameId);
  return Object.entries(state).map(([fullName, m]) => ({ fullName, ...m }));
}

// Detect and clean up mods whose files are missing from disk
// Returns { missing: [fullNames], cleaned: boolean }
function validateInstalledMods(gameId) {
  const state = { ...modsState(gameId) };
  const missing = [];
  
  for (const [fullName] of Object.entries(state)) {
    const staging = path.join(presetDir(gameId), fullName);
    if (!fs.existsSync(staging)) {
      missing.push(fullName);
      delete state[fullName];
    }
  }
  
  if (missing.length > 0) {
    saveModsState(gameId, state);
    return { gameId, missing, cleaned: true };
  }
  
  return { gameId, missing: [], cleaned: false };
}

// Detect a BepInEx loader already present in the game folder on disk — e.g. a
// repack/cracked build that ships it, or a manual install Unifia didn't perform.
// Mods only need the loader to exist; it doesn't matter who put it there, so we
// shouldn't nag to install BepInEx when these markers are present.
const BEPINEX_DISK_MARKERS = ['BepInEx', 'winhttp.dll', 'doorstop_config.ini', 'doorstop_libs', '.doorstop_version'];
function gameHasBepInEx(gameId) {
  const game = findGame(gameId);
  const root = game.installPath;
  if (!root) return false;
  return BEPINEX_DISK_MARKERS.some((m) => fs.existsSync(path.join(root, m)));
}

// Aggregate this game's mods across all registered hub providers. Returns
// { packages, hubs } — each mod carries its hub tag.
async function fetchModList(gameId, opts) {
  const game = findGame(gameId);
  const profile = profiles.matchProfile(game);
  return aggregateMods(getProviders(), profile, opts || {});
}

// Thunderstore catalog games the user does NOT have installed (deduped against
// installed games' mapped communities).
async function getDiscoverGames(opts) {
  const catalog = await thunderstore.fetchCommunities(opts || {});
  const installedCommunities = (store.get('games') || [])
    .map((g) => profiles.matchProfile(g).thunderstoreCommunity)
    .filter(Boolean);
  return filterDiscover(catalog, installedCommunities);
}

// Aggregate mods for a community directly (used for not-installed games that
// aren't in the store).
async function fetchModListForCommunity(community, opts) {
  return aggregateMods(getProviders(), { thunderstoreCommunity: community }, opts || {});
}

// A cache target counts as present only if it exists AND is non-empty (an empty
// dir from an interrupted extract is treated as a miss so we re-download).
function isCached(dir) {
  try { return fs.existsSync(dir) && fs.readdirSync(dir).length > 0; }
  catch { return false; }
}

// Download one version zip and extract it into the global cache (once per
// fullName@version). A cache hit short-circuits — no network.
async function stageVersion(gameId, fullName, versionData, onProgress) {
  const target = modCacheDir(fullName, versionData.version_number);
  if (isCached(target)) {
    if (onProgress) onProgress({ percent: 100, bytesReceived: 0, totalBytes: 0, cached: true });
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  ensureDir(target);

  ensureDir(downloadsDir());
  const zipPath = path.join(downloadsDir(), `${fullName}-${versionData.version_number}.zip`);
  const res = await httpFetch(versionData.download_url, {
    headers: { 'User-Agent': 'Unifia-Launcher' },
  });
  if (!res.ok || !res.body) throw new Error(`Download failed ${res.status}: ${res.statusText}`);

  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    out.on('error', reject);
    const reader = res.body.getReader();
    const pump = () =>
      reader.read().then(({ done, value }) => {
        if (done) return out.end(() => resolve());
        received += value.length;
        out.write(Buffer.from(value));
        if (onProgress) {
          onProgress({
            percent: total ? Math.round((received / total) * 100) : 0,
            bytesReceived: received,
            totalBytes: total,
          });
        }
        return pump();
      }).catch((err) => { out.destroy(); reject(err); });
    pump();
  });

  await extract(zipPath, { dir: target });
  try { fs.unlinkSync(zipPath); } catch { /* temp cleanup */ }
}

// Install a mod + its dependencies into staging, recording state.
async function installMod(gameId, fullName, version, onProgress) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) throw new Error('This game has no Thunderstore mod source.');

  const packages = await thunderstore.fetchModList(community, {});
  const installed = modsState(gameId);
  const set = resolveInstallSet(packages, fullName, version || undefined, installed);
  if (set.length === 0) return { gameId, installed: [] };

  const state = { ...installed };
  const maxLoadOrder = Math.max(0, ...Object.values(state).map((m) => m.loadOrder || 0));
  
  for (const item of set) {
    await stageVersion(gameId, item.fullName, item.versionData, (p) =>
      onProgress && onProgress({ fullName: item.fullName, ...p })
    );
    state[item.fullName] = {
      version: item.version,
      enabled: true,
      isDependency: item.fullName !== fullName && !(installed[item.fullName] && !installed[item.fullName].isDependency),
      deployedFiles: [],
      loadOrder: (state[item.fullName]?.loadOrder) ?? (maxLoadOrder + 1),
    };
  }
  saveModsState(gameId, state);
  return { gameId, installed: set.map((s) => ({ fullName: s.fullName, version: s.version })) };
}

// Archive directory for disabled/removed mods
function archiveDir(gameId) {
  return path.join(modsDir(gameId, presetStore.getActiveId(gameId)), '.archive');
}

// Remove a mod from staging + state (deploy reconciles the live game folder).
// Mods are archived (moved to .archive/) rather than deleted, allowing recovery.
function uninstallMod(gameId, fullName) {
  const state = { ...modsState(gameId) };
  if (!state[fullName]) return { gameId, fullName, removed: false };
  
  const staging = path.join(presetDir(gameId), fullName);
  if (fs.existsSync(staging)) {
    const archive = archiveDir(gameId);
    ensureDir(archive);
    const archivePath = path.join(archive, fullName);
    // Remove existing archived version if present
    fs.rmSync(archivePath, { recursive: true, force: true });
    // Move to archive
    fs.renameSync(staging, archivePath);
  }
  
  delete state[fullName];
  saveModsState(gameId, state);
  return { gameId, fullName, removed: true };
}

// Restore a mod from archive back to staging (re-enables it)
function restoreArchivedMod(gameId, fullName) {
  const state = { ...modsState(gameId) };
  const archivePath = path.join(archiveDir(gameId), fullName);
  
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archived mod not found: ${fullName}`);
  }
  
  const staging = path.join(presetDir(gameId), fullName);
  // Remove if staging already exists (shouldn't happen, but be safe)
  fs.rmSync(staging, { recursive: true, force: true });
  
  fs.renameSync(archivePath, staging);
  state[fullName] = {
    version: state[fullName]?.version || 'unknown',
    enabled: true,
    isDependency: state[fullName]?.isDependency || false,
    deployedFiles: [],
  };
  saveModsState(gameId, state);
  return { gameId, fullName, restored: true };
}

// Scan for archived mods and list them
function listArchivedMods(gameId) {
  const archive = archiveDir(gameId);
  if (!fs.existsSync(archive)) return [];
  
  const archived = [];
  for (const entry of fs.readdirSync(archive, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      archived.push({ fullName: entry.name });
    }
  }
  return archived;
}

function setModEnabled(gameId, fullName, enabled) {
  const state = { ...modsState(gameId) };
  if (!state[fullName]) throw new Error(`Mod not installed: ${fullName}`);
  state[fullName].enabled = !!enabled;
  saveModsState(gameId, state);
  return { gameId, fullName, enabled: !!enabled };
}

// Compare installed versions against latest on Thunderstore.
async function checkModUpdates(gameId) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) return [];
  const packages = await thunderstore.fetchModList(community, {});
  const byName = new Map(packages.map((p) => [p.fullName, p]));
  const updates = [];
  for (const [fullName, m] of Object.entries(modsState(gameId))) {
    const pkg = byName.get(fullName);
    const latest = pkg && pkg.latest ? pkg.latest.version_number : null;
    if (latest && latest !== m.version) updates.push({ fullName, current: m.version, latest });
  }
  return updates;
}

function copyDirInto(src, dest, recordRel, baseDest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirInto(s, d, recordRel, baseDest);
    else {
      fs.copyFileSync(s, d);
      recordRel.push(path.relative(baseDest, d));
    }
  }
}

// Reconcile the game folder against staged mod state: remove previously-deployed
// files, then copy enabled mods in (BepInExPack → root, others → plugins).
// Additive and file-tracked, so it never touches files it didn't place (e.g.
// Unifia.Pun.dll installed by pluginManager).
function deployMods(gameId, installPath) {
  // Deep copy so the per-mod `deployedFiles` mutations below can never touch the
  // persisted state until we explicitly saveModsState after the loop succeeds.
  const state = JSON.parse(JSON.stringify(modsState(gameId)));
  let changed = false;

  for (const [fullName, m] of Object.entries(state)) {
    // Remove whatever this mod previously deployed.
    for (const rel of m.deployedFiles || []) {
      try { fs.rmSync(path.join(installPath, rel), { force: true }); } catch { /* gone */ }
    }
    m.deployedFiles = [];

    if (!m.enabled) { changed = true; continue; }

    const staging = path.join(presetDir(gameId), fullName);
    if (!fs.existsSync(staging)) { changed = true; continue; }

    const recordRel = [];
    if (deployTarget(fullName) === 'root') {
      // BepInExPack zips wrap their payload in a BepInExPack* folder; deploy its
      // contents to the game root, else deploy the staging root itself.
      const inner = fs.readdirSync(staging, { withFileTypes: true })
        .find((e) => e.isDirectory() && /bepinexpack/i.test(e.name));
      const from = inner ? path.join(staging, inner.name) : staging;
      copyDirInto(from, installPath, recordRel, installPath);
    } else {
      const dest = path.join(installPath, 'BepInEx', 'plugins', fullName);
      copyDirInto(staging, dest, recordRel, installPath);
    }
    m.deployedFiles = recordRel;
    changed = true;
  }

  if (changed) saveModsState(gameId, state);
  return { gameId, deployed: Object.values(state).filter((m) => m.enabled).length };
}

// Get mods that depend on a specific mod
async function getModDependents(gameId, fullName) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) return [];
  
  const packages = await thunderstore.fetchModList(community, {});
  const state = modsState(gameId);
  return getDependentsFromGraph(fullName, state, packages);
}

// Detect conflicts with the current mod
async function getModConflicts(gameId, fullName) {
  const game = findGame(gameId);
  const community = communityFor(game);
  if (!community) return [];
  
  const packages = await thunderstore.fetchModList(community, {});
  const state = modsState(gameId);
  return detectConflicts(fullName, state, packages);
}

// Get the current load order for all mods
function getModLoadOrder(gameId) {
  const state = modsState(gameId);
  return Object.entries(state)
    .map(([fullName, m]) => ({ fullName, loadOrder: m.loadOrder || 0, enabled: m.enabled }))
    .sort((a, b) => a.loadOrder - b.loadOrder);
}

// Update load order for mods (reorders by given array of fullNames)
function setModLoadOrder(gameId, orderedFullNames) {
  const state = { ...modsState(gameId) };
  
  // Assign new load orders based on position in array
  for (let i = 0; i < orderedFullNames.length; i++) {
    const fullName = orderedFullNames[i];
    if (state[fullName]) {
      state[fullName].loadOrder = i;
    }
  }
  
  saveModsState(gameId, state);
  return { gameId, reordered: orderedFullNames.length };
}

module.exports = {
  fetchModList,
  getDiscoverGames,
  fetchModListForCommunity,
  getInstalledMods,
  validateInstalledMods,
  gameHasBepInEx,
  installMod,
  uninstallMod,
  restoreArchivedMod,
  listArchivedMods,
  setModEnabled,
  checkModUpdates,
  getModDependents,
  getModConflicts,
  getModLoadOrder,
  setModLoadOrder,
  communityFor,
  modsState,
  saveModsState,
  deployMods,
  hasEnabledBepInExPack,
};
