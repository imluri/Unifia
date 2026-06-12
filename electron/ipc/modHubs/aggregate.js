// Pure aggregation across mod hub providers. For each provider that maps the
// game (non-null gameRef), fetch its mods and decorate them with hub metadata.
// A provider that throws is skipped (its mods omitted) but still counts as a hub
// that maps the game. Returns { packages, hubs }.
async function aggregateMods(providers, profile, opts) {
  const hubs = [];
  const packages = [];

  for (const provider of providers || []) {
    const ref = provider.gameRef(profile);
    if (!ref) continue;
    hubs.push({ id: provider.id, label: provider.label });

    let mods = [];
    try {
      mods = await provider.fetchMods(ref, opts || {});
    } catch {
      mods = []; // hub unreachable right now — keep the others
    }

    for (const m of mods || []) {
      packages.push({
        ...m,
        hub: provider.id,
        hubLabel: provider.label,
        canInstall: !!provider.canInstall,
        id: `${provider.id}:${m.fullName}`,
        pageUrl: m.pageUrl || m.packageUrl || null,
      });
    }
  }

  return { packages, hubs };
}

module.exports = { aggregateMods };
