// Pure helpers for the connector's unifia_status.json. The connector reports
// each player's ORIGINAL (pre-override) Photon AppId; we label editions against
// an optional per-game official AppId. Self-reported — a transparency label,
// never a trust signal.

function deriveEdition(originalAppId, officialAppId) {
  if (!officialAppId || !originalAppId) return 'unknown';
  return originalAppId === officialAppId ? 'official' : 'modded';
}

function tagPlayer(p, officialAppId) {
  return {
    nick: p && p.nick ? String(p.nick) : '',
    originalAppId: p && p.originalAppId ? String(p.originalAppId) : '',
    edition: deriveEdition(p && p.originalAppId, officialAppId),
  };
}

// Parse the raw status file contents; returns null on any garbage so the UI can
// fall back to "launch the game to see players".
function parseStatus(raw, officialAppId) {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  return {
    loaded: !!obj.loaded,
    room: obj.room ? String(obj.room) : '',
    joined: !!obj.joined,
    self: obj.self ? tagPlayer(obj.self, officialAppId) : null,
    players: Array.isArray(obj.players) ? obj.players.map((p) => tagPlayer(p, officialAppId)) : [],
  };
}

module.exports = { deriveEdition, parseStatus, tagPlayer };
