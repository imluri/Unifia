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

  // --- Bootstrap ---
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
      set({ settings, games, modules, moduleSources, gameProfiles, dataDir, ready: true });
      applyTheme(settings?.theme || 'dark');
      get().wireEvents();
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
    set({ games });
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

  // --- Launch ---
  async launchGame(gameId) {
    return api.launchGame(gameId);
  },
  async patchGame(gameId, config) {
    return api.patchGame(gameId, config);
  },
}));

// Toggle the `dark` class used by Tailwind's class-based dark mode.
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') root.classList.remove('dark');
  else root.classList.add('dark');
}

export { api };
