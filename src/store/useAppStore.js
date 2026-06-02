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

  // Lobby/session state
  session: null, // { role: 'host'|'client', ... }
  players: [],
  versionMismatch: null,

  // Download progress keyed by `${moduleName}@${version}`
  downloads: {},

  // Resolved game art keyed by gameId: { banner, icon, hero }
  art: {},

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
      const key = `${p.moduleName}@${p.version}`;
      set((s) => ({ downloads: { ...s.downloads, [key]: p } }));
    });
    api.onVersionMismatch((payload) => set({ versionMismatch: payload }));
    api.onPlayerJoined(() => get().refreshPlayers());
    api.onPlayerLeft(() => get().refreshPlayers());
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

  // --- Lobby / session ---
  async hostSession(gameId, port) {
    const res = await api.hostSession(gameId, port);
    set({ session: { role: 'host', ...res }, versionMismatch: null });
    get().refreshPlayers();
    return res;
  },
  async joinSession(gameId, ip, port) {
    const res = await api.joinSession(gameId, ip, port);
    set({ session: { role: 'client', ...res }, players: res.players || [] });
    return res;
  },
  async stopSession() {
    await api.stopSession();
    set({ session: null, players: [] });
  },
  async refreshPlayers() {
    if (!api) return;
    const players = await api.getPlayers();
    set({ players });
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
