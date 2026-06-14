// Pure codec for the shareable Unifia invite string — base64url of a small JSON
// descriptor. No I/O, so it is exhaustively unit-testable.

const VERSION = 1;
const MAX_LEN = 20000; // guard against pathological paste input

// Build the canonical descriptor (drops unknown keys, normalizes mods).
function normalize(d) {
  return {
    v: VERSION,
    community: String(d.community || ''),
    name: String(d.name || ''),
    presetName: String(d.presetName || ''),
    appId: String(d.appId || ''),
    voiceAppId: String(d.voiceAppId || ''),
    room: String(d.room || ''),
    version: String(d.version || ''),
    mods: (d.mods || []).map((m) => ({ fullName: m.fullName, version: m.version })),
  };
}

function encodeInvite(descriptor) {
  const json = JSON.stringify(normalize(descriptor));
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeInvite(code) {
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_LEN) {
    throw new Error('Invalid invite code');
  }
  let obj;
  try {
    obj = JSON.parse(Buffer.from(code.trim(), 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid invite code');
  }
  if (!obj || typeof obj !== 'object') throw new Error('Invalid invite code');
  if (obj.v !== VERSION) throw new Error(`Unsupported invite code version: ${obj.v}`);
  return normalize(obj);
}

module.exports = { encodeInvite, decodeInvite, VERSION };
