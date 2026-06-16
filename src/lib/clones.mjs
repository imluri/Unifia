// Detect "clones": two or more library entries that refer to the same
// underlying game (e.g. a cracked and a legit install of REPO). Signal is the
// real game name + executable basename — NOT the display nickname — so renaming
// one clone never splits the group. Pure so it can be unit-tested.

function cloneKey(game) {
  const name = (game.name || '').trim().toLowerCase();
  const exe = ((game.executablePath || '').split(/[\\/]/).pop() || '').toLowerCase();
  return `${name} ${exe}`;
}

// Returns a Set of game ids that have at least one same-key sibling.
function findCloneIds(games) {
  const byKey = new Map();
  for (const g of games) {
    const k = cloneKey(g);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(g.id);
  }
  const clones = new Set();
  for (const ids of byKey.values()) {
    if (ids.length > 1) for (const id of ids) clones.add(id);
  }
  return clones;
}

export { cloneKey, findCloneIds };
