const fs = require('fs');
const path = require('path');
const { store } = require('../store');
const modManager = require('./modManager');
const { encodeInvite, decodeInvite } = require('./inviteCode');
const { diffMods } = require('./modSync');
const { parseStatus } = require('./connectorStatus');
const presetStore = require('./presetStore');

function findGame(gameId) {
  const game = (store.get('games') || []).find((g) => g.id === gameId);
  if (!game) throw new Error(`Unknown game: ${gameId}`);
  return game;
}

function getProfile(gameId) {
  return (store.get('gameProfiles') || {})[gameId] || {};
}

function saveProfile(gameId, patch) {
  const all = store.get('gameProfiles') || {};
  all[gameId] = { ...(all[gameId] || {}), ...patch };
  store.set('gameProfiles', all);
  return all[gameId];
}

function makeRoomCode() {
  return 'unifia_' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

// Enabled installed mods as [{ fullName, version }] for the invite payload.
function enabledMods(gameId) {
  return modManager
    .getInstalledMods(gameId)
    .filter((m) => m.enabled)
    .map((m) => ({ fullName: m.fullName, version: m.version }));
}

// Build a shareable invite for this game. Persists the host's own room descriptor
// (netConfig) + AppId so they're ready to launch, and returns the encoded string.
function buildInvite(gameId, { appId, voiceAppId, room, presetName } = {}) {
  const game = findGame(gameId);
  const community = modManager.communityFor(game);
  const realAppId = (appId || getProfile(gameId).photonAppId || '').trim();
  if (!realAppId) throw new Error('Enter this game’s Photon AppId first.');
  const voice = (voiceAppId !== undefined ? voiceAppId : getProfile(gameId).photonVoiceAppId || '').trim();
  const roomCode = (room || '').trim() || makeRoomCode();

  // The preset must be named before sharing — rename the active preset to the
  // supplied name, else carry its current name.
  let pName = (presetName || '').trim();
  if (pName) presetStore.rename(gameId, presetStore.getActiveId(gameId), pName);
  else pName = presetStore.activeName(gameId);

  const descriptor = {
    community: community || '',
    name: game.name,
    presetName: pName,
    appId: realAppId,
    voiceAppId: voice,
    room: roomCode,
    version: String(game.version || ''),
    mods: enabledMods(gameId),
  };
  // Persist so the host launches into the same room (cloud-region mode).
  saveProfile(gameId, {
    photonAppId: realAppId,
    photonVoiceAppId: voice,
    netConfig: {
      connectionMode: 'cloud-region',
      appId: realAppId,
      voiceAppId: voice,
      roomCode,
      version: descriptor.version,
    },
  });
  return { code: encodeInvite(descriptor), room: roomCode };
}

// Decode an invite for preview only (no side effects).
function parseInvite(code) {
  return decodeInvite(code);
}

// Adopt a friend's invite: validate same game, set AppId + room descriptor, and
// stage a fresh preset (active) for the invite's mod set. Returns the mod diff to
// drive the renderer's review-then-sync (it installs into the new active preset).
function applyInvite(gameId, code) {
  const game = findGame(gameId);
  const d = decodeInvite(code);
  const community = modManager.communityFor(game);
  if (d.community && community && d.community !== community) {
    throw new Error(`This code is for ${d.community}, not this game.`);
  }
  saveProfile(gameId, {
    photonAppId: d.appId,
    photonVoiceAppId: d.voiceAppId || '',
    netConfig: {
      connectionMode: 'cloud-region',
      appId: d.appId,
      voiceAppId: d.voiceAppId || '',
      roomCode: d.room,
      version: d.version,
    },
  });
  // The invite's mod set becomes a new preset we switch to; the renderer's Sync
  // installs the diff into it. Name it from the code (falls back to room).
  const presetId = presetStore.create(gameId, d.presetName || `${d.name || 'Friend'} ${d.room}`, false);
  presetStore.setActive(gameId, presetId);
  const diff = diffMods(modManager.getInstalledMods(gameId), d.mods);
  return { descriptor: d, diff, hostVersion: d.version, localVersion: String(game.version || ''), presetId };
}

// Read the connector's status file (written in-game) for the player/edition list.
function getConnectorPlayers(gameId) {
  const game = findGame(gameId);
  const officialAppId = getProfile(gameId).officialAppId || '';
  const file = path.join(game.installPath, 'BepInEx', 'config', 'unifia_status.json');
  try {
    return parseStatus(fs.readFileSync(file, 'utf8'), officialAppId);
  } catch {
    return null; // not running / no file yet
  }
}

module.exports = { buildInvite, parseInvite, applyInvite, getConnectorPlayers, saveProfile };
