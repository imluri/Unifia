// Pure mod logic — no I/O — so it is exhaustively unit-testable.

// Split "Owner-Mod-1.2.3" into { fullName: "Owner-Mod", version: "1.2.3" }.
// The version is the trailing dotted-number segment; everything before is the name.
function parseDependency(dep) {
  const m = /^(.*)-(\d+\.\d+\.\d+(?:\.\d+)?)$/.exec(dep);
  if (!m) return { fullName: dep, version: null };
  return { fullName: m[1], version: m[2] };
}

function findVersion(pkg, version) {
  if (!pkg) return null;
  const versions = pkg.versions || [];
  return versions.find((v) => v.version_number === version) || versions[0] || null;
}

// Build the flat install set for a target mod: the mod plus every dependency,
// de-duped, with dependencies ordered before the dependents that need them.
// `installed` maps fullName -> { version }; same-version entries are skipped.
function resolveInstallSet(packages, fullName, version, installed = {}) {
  const byName = new Map(packages.map((p) => [p.fullName, p]));
  const result = [];
  const seen = new Set();

  function visit(name, ver) {
    if (seen.has(name)) return;
    seen.add(name);

    const pkg = byName.get(name);
    if (!pkg) return; // missing/removed dependency — tolerate
    const v = findVersion(pkg, ver);
    if (!v) return;

    for (const dep of v.dependencies || []) {
      const { fullName: depName, version: depVer } = parseDependency(dep);
      visit(depName, depVer);
    }

    const already = installed[name];
    if (already && already.version === v.version_number) return; // already satisfied
    result.push({ fullName: name, version: v.version_number, versionData: v });
  }

  visit(fullName, version);
  return result;
}

// Where a mod's files deploy: BepInExPack variants are the loader (game root);
// everything else is a plugin.
function deployTarget(fullName) {
  return /bepinexpack/i.test(fullName) ? 'root' : 'plugins';
}

module.exports = { parseDependency, resolveInstallSet, findVersion, deployTarget };
