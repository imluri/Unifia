const fs = require('fs');
const path = require('path');
const { store } = require('../store');

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function configDirFor(game) {
  return path.join(game.installPath, 'BepInEx', 'config');
}

function listConfigs(gameId) {
  const game = findGame(gameId);
  const cfgDir = configDirFor(game);
  if (!fs.existsSync(cfgDir)) return [];
  const files = fs.readdirSync(cfgDir).filter((f) => {
    try {
      const stat = fs.statSync(path.join(cfgDir, f));
      return stat.isFile();
    } catch {
      return false;
    }
  });
  // map to objects with basic metadata
  return files.sort().map((f) => {
    const p = path.join(cfgDir, f);
    const s = fs.statSync(p);
    return { name: f, size: s.size, mtime: s.mtimeMs };
  });
}

function ensureSafePath(cfgDir, filename) {
  if (filename.indexOf('\\') !== -1 || filename.indexOf('/') !== -1) {
    // disallow paths
    throw new Error('Invalid filename');
  }
  const resolved = path.resolve(cfgDir, filename);
  if (!resolved.startsWith(path.resolve(cfgDir) + path.sep) && resolved !== path.resolve(cfgDir, filename)) {
    throw new Error('Invalid filename');
  }
  return resolved;
}

function readConfig(gameId, filename) {
  const game = findGame(gameId);
  const cfgDir = configDirFor(game);
  if (!fs.existsSync(cfgDir)) throw new Error('Config folder not found');
  const target = ensureSafePath(cfgDir, filename);
  return fs.readFileSync(target, 'utf8');
}

function writeConfig(gameId, filename, contents) {
  const game = findGame(gameId);
  const cfgDir = configDirFor(game);
  if (!fs.existsSync(cfgDir)) throw new Error('Config folder not found');
  const target = ensureSafePath(cfgDir, filename);
  fs.writeFileSync(target, contents, 'utf8');
  return true;
}

function inferConfigFile(gameId, fullName) {
  const game = findGame(gameId);
  const cfgDir = configDirFor(game);
  if (!fs.existsSync(cfgDir)) return null;
  const files = fs.readdirSync(cfgDir).filter((f) => f.toLowerCase().endsWith('.cfg'));
  if (!files.length) return null;

  const normalize = (text) =>
    String(text || '')
      .toLowerCase()
      .replace(/[\s._-]+/g, '');

  const candidates = new Set();
  const addCandidate = (value) => {
    if (!value) return;
    candidates.add(normalize(value));
  };

  addCandidate(fullName);
  addCandidate(fullName.replace(/\//g, '.'));
  addCandidate(fullName.split('/').pop());
  addCandidate(fullName.split('-').pop());
  addCandidate(fullName.split('-').slice(1).join('-'));
  addCandidate(fullName.replace(/-/g, '.'));
  addCandidate(fullName.replace(/_/g, '.'));
  addCandidate(fullName.replace(/[-_]/g, '.'));

  const pluginDir = path.join(game.installPath, 'BepInEx', 'plugins', fullName);
  if (fs.existsSync(pluginDir)) {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        addCandidate(manifest.name);
      } catch {
        // ignore broken manifest
      }
    }
  }

  const fileEntries = files.map((file) => ({
    name: file,
    key: normalize(path.basename(file, '.cfg')),
  }));

  for (const file of fileEntries) {
    if (candidates.has(file.key)) return file.name;
  }

  for (const file of fileEntries) {
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (file.key.includes(candidate) || candidate.includes(file.key)) return file.name;
    }
  }

  return null;
}

module.exports = { listConfigs, readConfig, writeConfig, inferConfigFile };
