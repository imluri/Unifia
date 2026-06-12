const client = require('../thunderstore');

// Thunderstore mod hub provider. Wraps the existing thunderstore.js REST client.
module.exports = {
  id: 'thunderstore',
  label: 'Thunderstore',
  canInstall: true,
  gameRef(profile) {
    return (profile && profile.thunderstoreCommunity) || null;
  },
  async fetchMods(ref, opts) {
    return client.fetchModList(ref, opts || {});
  },
};
