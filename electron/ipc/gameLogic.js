// Pure logic for the manual-game library: id generation and array operations.
// Kept free of electron-store / fs so it can be unit-tested directly
// (gameScanner.js is the thin store-backed wrapper around these). See the
// game-clones spec: manual ids are immutable random tokens so that two installs
// of the same game ("clones") never collide on a store:name id.

// Generate an immutable id for a manually-added install. Random — not derived
// from name or path — so the id survives Rename and Change-folder, and two
// same-named installs get distinct ids. `randomBytes` is injectable for tests.
function newManualId(randomBytes) {
  return `m_${randomBytes(6).toString('hex')}`;
}

// Add a fully-built manual game record to `games`. If a manual entry with the
// same executablePath already exists, update it in place (re-adding the exact
// same install is idempotent and keeps its id). Otherwise append with a fresh
// id from makeId(). Never overwrites by name, so same-name clones coexist.
function appendManualGame(games, game, makeId) {
  const existing = games.find(
    (g) => g.manual && g.executablePath === game.executablePath,
  );
  if (existing) {
    const updated = { ...existing, ...game, id: existing.id, manual: true };
    return games.map((g) => (g.id === existing.id ? updated : g));
  }
  return [...games, { ...game, id: makeId(), manual: true }];
}

// Set or clear a game's optional display label. Blank/whitespace clears it.
// Throws if the id is absent (mirrors updateGamePath).
function renameGameIn(games, gameId, displayName) {
  const idx = games.findIndex((g) => g.id === gameId);
  if (idx === -1) throw new Error(`Unknown game: ${gameId}`);
  const label = (displayName || '').trim();
  const updated = { ...games[idx] };
  if (label) updated.displayName = label;
  else delete updated.displayName;
  return games.map((g, i) => (i === idx ? updated : g));
}

module.exports = { newManualId, appendManualGame, renameGameIn };
