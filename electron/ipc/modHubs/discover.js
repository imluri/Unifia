// Pure: catalog communities minus the ones already installed, mapped to
// lightweight "discover game" objects the UI/GameDetail can consume.
function filterDiscover(catalog, installedCommunities) {
  const installed = new Set(installedCommunities || []);
  return (catalog || [])
    .filter((c) => c && c.identifier && !installed.has(c.identifier))
    .map((c) => ({
      id: `ts:${c.identifier}`,
      name: c.name || c.identifier,
      community: c.identifier,
      installed: false,
    }));
}

module.exports = { filterDiscover };
