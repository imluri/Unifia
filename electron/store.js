const Store = require('electron-store');

// Persistent configuration. Defaults define the full shape of the saved data
// so the rest of the app can read nested keys without guarding every access.
const store = new Store({
  name: 'unifia-config',
  defaults: {
    games: [],
    settings: {
      storePaths: {
        steam: 'C:/Program Files (x86)/Steam/steamapps/common',
        gog: 'C:/GOG Games',
        epic: 'C:/Program Files/Epic Games',
        custom: [],
      },
      photonAppId: '',
      photonVoiceAppId: '',
      username: 'Player',
      theme: 'dark',
      dataDir: '', // empty => default under userData
    },
    modules: {
      bepinex_mono: { installed: [], active: null },
      bepinex_il2cpp: { installed: [], active: null },
    },
    // gameProfiles[gameId] = { activeModule, moduleVersion, photonConfig }
    gameProfiles: {},
  },
});

module.exports = { store };
