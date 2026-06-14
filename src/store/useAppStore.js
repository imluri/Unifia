import { create } from 'zustand';

// Thin wrapper so the rest of the renderer can call the IPC bridge without
// repeatedly checking that window.unifia exists (it won't in a plain browser
// preview, only inside Electron).
const api = typeof window !== 'undefined' ? window.unifia : undefined;

// Global app state. Keeps the detected games, installed modules, settings and
// live lobby/session state in one place so pages stay thin.
export const useAppStore = create((set, get) => ({
  ready: false,
  error: null,

  games: [],
  gameProfiles: {},
  modules: {}, // installed modules keyed by module id
  moduleSources: [],
  settings: null,
  dataDir: '',

  // Download progress keyed by `${moduleName}@${version}`
  downloads: {},

  // Resolved game art keyed by gameId: { banner, icon, hero }
  art: {},

  // Mods (per open game detail view)
  modList: [], // browse list for the active community
  modHubs: [], // [{ id, label }] hubs that map the open game
  installedMods: [], // [{ fullName, version, enabled, isDependency }]
  modUpdates: [], // [{ fullName, current, latest }]
  modsLoading: false,
  modError: null, // surfaced when the Thunderstore list fails to load
  modProgress: {}, // fullName -> { percent }
  bepInExOnDisk: false, // a BepInEx loader is already present in the game folder

  // Unifia connector plugin status, keyed by gameId:
  // { available, pluginInstalled, bepinexInstalled }. Backs both the Lobby and
  // the Installed-tab status row. null for a gameId means "status check failed".
  connector: {},

  // Discover (not-installed Thunderstore catalog games, for Home > Discover)
  discoverGames: [], // [{ id, name, community, installed:false }]
  discoverLoading: false,
  discoverError: null,

  // --- Bootstrap ---
  // Called by the LoadingScreen once its sequenced steps have gathered data.
  // Centralizes "we're live now": store the data, apply the theme, wire events.
  hydrate(partial) {
    set({ ...partial, ready: true });
    if (partial.settings) applyTheme(partial.settings.theme);
    get().wireEvents();
  },

  // Fallback full bootstrap (used if something renders before the loader runs).
  async init() {
    if (!api) {
      set({ error: 'Unifia bridge unavailable (run inside Electron).', ready: true });
      return;
    }
    try {
      const [settings, games, modules, moduleSources, gameProfiles, dataDir] = await Promise.all([
        api.getSettings(),
        api.scanGames(),
        api.getInstalledModules(),
        api.listModuleSources(),
        api.getGameProfiles(),
        api.getDataDir(),
      ]);
      get().hydrate({ settings, games, modules, moduleSources, gameProfiles, dataDir });
    } catch (err) {
      set({ error: err.message, ready: true });
    }
  },

  // Subscribe to push events from the main process exactly once.
  _wired: false,
  wireEvents() {
    if (get()._wired || !api) return;
    set({ _wired: true });

    api.onDownloadProgress((p) => {
      if (p.mod && p.fullName) {
        set((s) => ({ modProgress: { ...s.modProgress, [p.fullName]: p } }));
      } else {
        const key = `${p.moduleName}@${p.version}`;
        set((s) => ({ downloads: { ...s.downloads, [key]: p } }));
      }
    });
  },

  // --- Games ---
  async rescan() {
    const games = await api.scanGames();
    // Clear the in-memory art memo so cards re-resolve art on the next render.
    // Games that previously had no art (e.g. before a SteamGridDB key was set)
    // will now fetch from the API; already-cached art returns instantly from
    // the main-process cache, so this stays cheap.
    set({ games, art: {} });
  },
  async addManualGame(game) {
    await api.addManualGame(game);
    const games = await api.scanGames();
    set({ games });
  },
  async removeGame(gameId) {
    await api.removeGame(gameId);
    set((s) => ({ games: s.games.filter((g) => g.id !== gameId) }));
  },

  // --- Unifia connector plugin (per game) ---
  async refreshConnector(gameId) {
    if (!gameId) return;
    try {
      const status = await api.getPluginStatus(gameId);
      set((s) => ({ connector: { ...s.connector, [gameId]: status } }));
    } catch {
      set((s) => ({ connector: { ...s.connector, [gameId]: null } }));
    }
  },
  async installConnector(gameId) {
    const status = await api.installPlugin(gameId);
    set((s) => ({ connector: { ...s.connector, [gameId]: status } }));
    return status;
  },
  async uninstallConnector(gameId) {
    const status = await api.uninstallPlugin(gameId);
    set((s) => ({ connector: { ...s.connector, [gameId]: status } }));
    return status;
  },
  async updateGamePath(gameId, newPath) {
    const updated = await api.updateGamePath(gameId, newPath);
    set((s) => ({ games: s.games.map((g) => (g.id === gameId ? updated : g)) }));
    return updated;
  },

  // --- Modules ---
  async refreshModules() {
    const modules = await api.getInstalledModules();
    const gameProfiles = await api.getGameProfiles();
    set({ modules, gameProfiles });
  },
  async installModule(moduleName, version, downloadUrl) {
    await api.installModule(moduleName, version, downloadUrl);
    set((s) => {
      const d = { ...s.downloads };
      delete d[`${moduleName}@${version}`];
      return { downloads: d };
    });
    await get().refreshModules();
  },
  async uninstallModule(moduleName, version) {
    await api.uninstallModule(moduleName, version);
    await get().refreshModules();
  },
  async setActiveModule(gameId, moduleName, version) {
    await api.setActiveModule(gameId, moduleName, version);
    await get().refreshModules();
  },

  // --- Settings ---
  async saveSettings(partial) {
    const settings = await api.saveSettings(partial);
    set({ settings });
    if (partial.theme) applyTheme(partial.theme);
  },

  // --- Multiplayer (share-code) ---
  connectorPlayers: {}, // gameId -> parsed status (or null)
  async buildInvite(gameId, opts) {
    return api.buildInvite(gameId, opts);
  },
  async parseInvite(code) {
    return api.parseInvite(code);
  },
  async applyInvite(gameId, code) {
    return api.applyInvite(gameId, code);
  },
  async saveGameProfile(gameId, patch) {
    const profile = await api.saveGameProfile(gameId, patch);
    set((s) => ({ gameProfiles: { ...s.gameProfiles, [gameId]: profile } }));
    return profile;
  },
  async refreshConnectorPlayers(gameId) {
    const status = await api.getConnectorPlayers(gameId);
    set((s) => ({ connectorPlayers: { ...s.connectorPlayers, [gameId]: status } }));
    return status;
  },

  // --- Game art ---
  // Resolve art for a game (cached in main + memoized here). Returns the art
  // object or null. Safe to call repeatedly; in-flight/known results are reused.
  async fetchArt(game) {
    if (!api || !game) return null;
    const existing = get().art[game.id];
    if (existing !== undefined) return existing;
    try {
      const art = await api.fetchGameArt(game.id, game.name, game.steamAppId);
      set((s) => ({ art: { ...s.art, [game.id]: art } }));
      return art;
    } catch {
      set((s) => ({ art: { ...s.art, [game.id]: null } }));
      return null;
    }
  },

  // --- Mods ---
  async loadMods(game, { refresh = false } = {}) {
    // Clear the previous game's lists up front so opening a card shows a loading
    // state, never a stale list or a premature "nothing installed" flash.
    set({ modsLoading: true, modError: null, modList: [], modHubs: [], installedMods: [], modUpdates: [] });
    try {
      // Not-installed Discover games aren't in the store; fetch their mod list
      // by community directly instead of by gameId.
      const notInstalled = game.installed === false;
      const listPromise = notInstalled
        ? api.fetchModListForCommunity(game.community, { refresh })
        : api.fetchModList(game.id, { refresh });
      const [{ hubs, packages }, installed, bepInExOnDisk] = await Promise.all([
        listPromise,
        api.getInstalledMods(game.id),
        // Not-installed Discover games have no install folder to inspect.
        notInstalled ? Promise.resolve(false) : api.gameHasBepInEx(game.id),
      ]);
      set({ modList: packages, modHubs: hubs, installedMods: installed, bepInExOnDisk });
      // Connector status powers the Installed-tab pinned row (installed games only).
      if (!notInstalled) get().refreshConnector(game.id);
      if (notInstalled) {
        // checkModUpdates calls findGame in main and would throw for a game the
        // store doesn't know about; there's nothing installed to update anyway.
        set({ modUpdates: [] });
      } else {
        api.checkModUpdates(game.id).then((u) => set({ modUpdates: u })).catch(() => {});
      }
    } catch (err) {
      // Don't leave the UI looking like "no mod source" on a fetch failure.
      set({ modError: err.message || String(err) });
    } finally {
      set({ modsLoading: false });
    }
  },
  async loadDiscover({ refresh = false } = {}) {
    set({ discoverLoading: true, discoverError: null });
    try {
      const games = await api.fetchDiscoverGames({ refresh });
      set({ discoverGames: games });
    } catch (err) {
      set({ discoverError: err.message || String(err) });
    } finally {
      set({ discoverLoading: false });
    }
  },
  // Detect a BepInEx loader in the game folder, independent of the mod-list
  // fetch (which can be slow or fail). Always safe to call for installed games.
  async refreshBepInEx(gameId) {
    try {
      set({ bepInExOnDisk: await api.gameHasBepInEx(gameId) });
    } catch {
      set({ bepInExOnDisk: false });
    }
  },
  async installMod(gameId, fullName, version) {
    await api.installMod(gameId, fullName, version);
    // Drop the now-finished progress entry so it can't be read stale later.
    set((s) => {
      const next = { ...s.modProgress };
      delete next[fullName];
      return { modProgress: next };
    });
    set({ installedMods: await api.getInstalledMods(gameId) });
  },
  async uninstallMod(gameId, fullName) {
    await api.uninstallMod(gameId, fullName);
    set({ installedMods: await api.getInstalledMods(gameId) });
  },
  async setModEnabled(gameId, fullName, enabled) {
    await api.setModEnabled(gameId, fullName, enabled);
    set({ installedMods: await api.getInstalledMods(gameId) });
  },

  // --- Launch ---
  async launchGame(gameId) {
    return api.launchGame(gameId);
  },
  async patchGame(gameId, config) {
    return api.patchGame(gameId, config);
  },
}));

// Set the active theme by writing data-theme on <html>; themes.css keys all
// CSS variables off this attribute. Unknown values fall back to Mono.
const THEMES = ['mono', 'slate'];
function applyTheme(theme) {
  const next = THEMES.includes(theme) ? theme : 'mono';
  document.documentElement.setAttribute('data-theme', next);
}

export { api, applyTheme };
