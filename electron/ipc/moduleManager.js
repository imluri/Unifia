const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');
const { store } = require('../store');
const { httpFetch } = require('../util');
const { moduleDir, downloadsDir, ensureDir } = require('../paths');

// Map our internal module ids to their GitHub release source and the asset
// matcher used to pick the right zip from a release. BepInEx ships one repo
// with differently named assets for the Mono and IL2CPP flavours.
const MODULE_SOURCES = {
  bepinex_mono: {
    label: 'BepInEx (Unity Mono)',
    repo: 'BepInEx/BepInEx',
    // Mono x64 Windows builds, e.g. BepInEx_win_x64_5.4.23.2.zip or
    // BepInEx_x64_5.4.22.0.zip. Exclude IL2CPP / Unity.IL2CPP assets.
    matchAsset: (name) => {
      const n = name.toLowerCase();
      return n.endsWith('.zip') &&
        n.includes('bepinex') &&
        (n.includes('x64') || n.includes('win')) &&
        !n.includes('il2cpp') &&
        !n.includes('unitymono_x86') &&
        !n.includes('linux') &&
        !n.includes('macos');
    },
  },
  bepinex_il2cpp: {
    label: 'BepInEx (Unity IL2CPP)',
    repo: 'BepInEx/BepInEx',
    // IL2CPP bleeding-edge builds, e.g. BepInEx-Unity.IL2CPP-win-x64-6.0.0-be.755.zip
    matchAsset: (name) => {
      const n = name.toLowerCase();
      return n.endsWith('.zip') &&
        n.includes('il2cpp') &&
        (n.includes('x64') || n.includes('win')) &&
        !n.includes('linux') &&
        !n.includes('macos');
    },
  },
};

function moduleStoreKey(moduleName) {
  return `modules.${moduleName}`;
}

// Fetch every release page from the GitHub API and flatten to a version list.
// Pre-releases are kept or dropped based on includePrerelease so the UI toggle
// can re-query without us caching stale data.
async function fetchModuleVersions(moduleName, { includePrerelease = false } = {}) {
  const source = MODULE_SOURCES[moduleName];
  if (!source) throw new Error(`Unknown module: ${moduleName}`);

  const versions = [];
  const perPage = 100;
  let page = 1;
  const maxPages = 5; // safety bound — BepInEx has far fewer than 500 releases

  while (page <= maxPages) {
    const url = `https://api.github.com/repos/${source.repo}/releases?per_page=${perPage}&page=${page}`;
    const res = await httpFetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Unifia-Launcher',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}: ${res.statusText}`);
    }
    const releases = await res.json();
    if (!Array.isArray(releases) || releases.length === 0) break;

    for (const rel of releases) {
      if (rel.draft) continue;
      if (rel.prerelease && !includePrerelease) continue;

      const asset = (rel.assets || []).find((a) => source.matchAsset(a.name));
      if (!asset) continue; // no matching flavour asset in this release

      versions.push({
        tag: rel.tag_name,
        name: rel.name || rel.tag_name,
        url: asset.browser_download_url,
        assetName: asset.name,
        size: asset.size,
        date: rel.published_at,
        prerelease: !!rel.prerelease,
      });
    }

    if (releases.length < perPage) break; // last page reached
    page += 1;
  }

  return versions;
}

// Download the release zip with progress reporting, then extract it into the
// versioned module folder. onProgress receives { percent, bytesReceived,
// totalBytes } so the renderer can drive a progress bar.
async function installModule(moduleName, version, downloadUrl, onProgress) {
  if (!MODULE_SOURCES[moduleName]) throw new Error(`Unknown module: ${moduleName}`);

  ensureDir(downloadsDir());
  const targetDir = moduleDir(moduleName, version);
  ensureDir(targetDir);

  const zipPath = path.join(downloadsDir(), `${moduleName}-${version}.zip`);

  const res = await httpFetch(downloadUrl, {
    headers: { 'User-Agent': 'Unifia-Launcher' },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status}: ${res.statusText}`);
  }

  const totalBytes = Number(res.headers.get('content-length')) || 0;
  let bytesReceived = 0;

  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(zipPath);
    out.on('error', reject);

    const report = () => {
      const percent = totalBytes ? Math.round((bytesReceived / totalBytes) * 100) : 0;
      if (typeof onProgress === 'function') {
        onProgress({ percent, bytesReceived, totalBytes });
      }
    };

    // The Fetch body is a web ReadableStream in Electron's main process; read it
    // with a reader rather than assuming a Node stream.
    const reader = res.body.getReader();
    const pump = () =>
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            out.end(() => resolve());
            return;
          }
          bytesReceived += value.length;
          out.write(Buffer.from(value));
          report();
          return pump();
        })
        .catch((err) => {
          out.destroy();
          reject(err);
        });
    report();
    pump();
  });

  // Extract into the version folder, then clean up the temp zip.
  await extract(zipPath, { dir: targetDir });
  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* non-fatal: temp file cleanup */
  }

  // Record the install in the store, de-duplicated.
  const key = moduleStoreKey(moduleName);
  const entry = store.get(key) || { installed: [], active: null };
  if (!entry.installed.includes(version)) {
    entry.installed.push(version);
  }
  if (!entry.active) entry.active = version;
  store.set(key, entry);

  return { moduleName, version, path: targetDir };
}

function uninstallModule(moduleName, version) {
  const key = moduleStoreKey(moduleName);
  const entry = store.get(key) || { installed: [], active: null };

  const dir = moduleDir(moduleName, version);
  fs.rmSync(dir, { recursive: true, force: true });

  entry.installed = entry.installed.filter((v) => v !== version);
  if (entry.active === version) {
    entry.active = entry.installed[0] || null;
  }
  store.set(key, entry);

  return { moduleName, version, removed: true };
}

function getInstalledModules() {
  const modules = store.get('modules') || {};
  // Decorate with labels and install dates derived from the folder mtime.
  const result = {};
  for (const [name, entry] of Object.entries(modules)) {
    const source = MODULE_SOURCES[name];
    result[name] = {
      label: source ? source.label : name,
      active: entry.active || null,
      installed: (entry.installed || []).map((version) => {
        let installedAt = null;
        try {
          installedAt = fs.statSync(moduleDir(name, version)).mtime.toISOString();
        } catch {
          /* folder may have been removed externally */
        }
        return { version, installedAt };
      }),
    };
  }
  return result;
}

// Set the active module version for the whole module and link it to a specific
// game profile so the launcher knows what to copy for that game.
function setActiveModule(gameId, moduleName, version) {
  const key = moduleStoreKey(moduleName);
  const entry = store.get(key) || { installed: [], active: null };
  if (!entry.installed.includes(version)) {
    throw new Error(`Version ${version} of ${moduleName} is not installed`);
  }
  entry.active = version;
  store.set(key, entry);

  if (gameId) {
    const profiles = store.get('gameProfiles') || {};
    profiles[gameId] = {
      ...(profiles[gameId] || {}),
      activeModule: moduleName,
      moduleVersion: version,
    };
    store.set('gameProfiles', profiles);
  }

  return { gameId, moduleName, version };
}

function listModuleSources() {
  return Object.entries(MODULE_SOURCES).map(([id, s]) => ({ id, label: s.label }));
}

module.exports = {
  MODULE_SOURCES,
  fetchModuleVersions,
  installModule,
  uninstallModule,
  getInstalledModules,
  setActiveModule,
  listModuleSources,
};
