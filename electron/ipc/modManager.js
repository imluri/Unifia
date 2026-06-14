const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { store } = require('../store');
const { httpFetch } = require('../util');
const { modsDir, downloadsDir, ensureDir } = require('../paths');
const thunderstore = require('./thunderstore');
const profiles = require('./profiles');
const { resolveInstallSet, deployTarget, hasBepInExPack } = require('./modResolver');
const { aggregateMods } = require('./modHubs/aggregate');
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

// Download one version zip to a temp file, extract into its staging folder.
async function stageVersion(gameId, fullName, versionData, onProgress) {
  const target = path.join(presetDir(gameId), fullName);
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
  for (const item of set) {
    await stageVersion(gameId, item.fullName, item.versionData, (p) =>
      onProgress && onProgress({ fullName: item.fullName, ...p })
    );
    state[item.fullName] = {
      version: item.version,
      enabled: true,
      isDependency: item.fullName !== fullName && !(installed[item.fullName] && !installed[item.fullName].isDependency),
      deployedFiles: [],
    };
  }
  saveModsState(gameId, state);
  return { gameId, installed: set.map((s) => ({ fullName: s.fullName, version: s.version })) };
}

// Remove a mod from staging + state (deploy reconciles the live game folder).
function uninstallMod(gameId, fullName) {
  const state = { ...modsState(gameId) };
  if (!state[fullName]) return { gameId, fullName, removed: false };
  fs.rmSync(path.join(presetDir(gameId), fullName), { recursive: true, force: true });
  delete state[fullName];
  saveModsState(gameId, state);
  return { gameId, fullName, removed: true };
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

module.exports = {
  fetchModList,
  getDiscoverGames,
  fetchModListForCommunity,
  getInstalledMods,
  gameHasBepInEx,
  installMod,
  uninstallMod,
  setModEnabled,
  checkModUpdates,
  communityFor,
  modsState,
  saveModsState,
  deployMods,
  hasEnabledBepInExPack,
};
