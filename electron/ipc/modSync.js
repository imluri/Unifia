// Pure mod-diff for share-code import: compare what a friend's invite wants
// against what's installed locally. No I/O.

// installed/wanted: [{ fullName, version }]. Returns partitioned changes.
function diffMods(installed, wanted) {
  const have = new Map((installed || []).map((m) => [m.fullName, m.version]));
  const toInstall = [];
  const toUpdate = [];
  const ok = [];
  for (const w of wanted || []) {
    if (!have.has(w.fullName)) {
      toInstall.push({ fullName: w.fullName, version: w.version });
    } else if (have.get(w.fullName) !== w.version) {
      toUpdate.push({ fullName: w.fullName, from: have.get(w.fullName), to: w.version });
    } else {
      ok.push({ fullName: w.fullName, version: w.version });
    }
  }
  return { toInstall, toUpdate, ok };
}

module.exports = { diffMods };
