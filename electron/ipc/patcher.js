const fs = require('fs');
const path = require('path');
const { store } = require('../store');

// The patcher writes plugin configuration into a game's BepInEx folder after
// the loader has been copied in. Today it knows about the Photon config used by
// REPO, but it is structured so additional per-game patches can be added.

const PHOTON_CONFIG_REL = 'BepInEx/config/com.photon.unity3d.cfg';

// REPO is a Unity game that uses Photon for multiplayer. To let cross-store
// players share a lobby we point every client at the same Photon AppId.
function buildPhotonConfig(appIdRealtime, appIdVoice) {
  return [
    '## Settings file was created by Unifia',
    '',
    '[PhotonServerSettings]',
    '',
    '## Photon Realtime application id used for matchmaking.',
    `AppIdRealtime = ${appIdRealtime || ''}`,
    '',
    '## Photon Voice application id.',
    `AppIdVoice = ${appIdVoice || ''}`,
    '',
  ].join('\n');
}

// Apply the Photon patch into a game directory. The config object carries the
// AppIds (usually sourced from Settings). Returns the written path.
function applyPhotonPatch(installPath, config) {
  const cfgPath = path.join(installPath, PHOTON_CONFIG_REL);
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });

  // If a config already exists, replace only the AppId lines so we don't stomp
  // unrelated user tweaks; otherwise write a fresh file.
  let contents;
  if (fs.existsSync(cfgPath)) {
    contents = fs.readFileSync(cfgPath, 'utf8');
    contents = replaceOrAppend(contents, 'AppIdRealtime', config.photonAppId);
    contents = replaceOrAppend(contents, 'AppIdVoice', config.photonVoiceAppId);
  } else {
    contents = buildPhotonConfig(config.photonAppId, config.photonVoiceAppId);
  }
  fs.writeFileSync(cfgPath, contents, 'utf8');
  return cfgPath;
}

// Replace `Key = value` in an ini-ish file, or append it if the key is absent.
function replaceOrAppend(contents, key, value) {
  const line = `${key} = ${value || ''}`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (re.test(contents)) {
    return contents.replace(re, line);
  }
  return `${contents.trimEnd()}\n${line}\n`;
}

// Verify a patch landed by reading the file back and confirming the expected
// AppId is present. The launcher calls this before allowing a launch.
function verifyPhotonPatch(installPath, config) {
  const cfgPath = path.join(installPath, PHOTON_CONFIG_REL);
  if (!fs.existsSync(cfgPath)) return { ok: false, reason: 'Photon config not found' };
  const contents = fs.readFileSync(cfgPath, 'utf8');
  if (config.photonAppId && !contents.includes(config.photonAppId)) {
    return { ok: false, reason: 'AppIdRealtime not written' };
  }
  return { ok: true, path: cfgPath };
}

// Public entry point used over IPC. Looks up the game, applies known patches,
// verifies, and returns a result the renderer can surface.
function patchGame(gameId, config) {
  const games = store.get('games') || [];
  const game = games.find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);

  const merged = {
    photonAppId: config.photonAppId ?? store.get('settings.photonAppId'),
    photonVoiceAppId: config.photonVoiceAppId ?? store.get('settings.photonVoiceAppId'),
  };

  const writtenPath = applyPhotonPatch(game.installPath, merged);
  const verification = verifyPhotonPatch(game.installPath, merged);
  if (!verification.ok) {
    throw new Error(`Patch verification failed: ${verification.reason}`);
  }

  // Record what we wrote into the game profile.
  const profiles = store.get('gameProfiles') || {};
  profiles[gameId] = {
    ...(profiles[gameId] || {}),
    photonConfig: merged,
  };
  store.set('gameProfiles', profiles);

  return { gameId, path: writtenPath, verified: true };
}

module.exports = { patchGame, applyPhotonPatch, verifyPhotonPatch };
