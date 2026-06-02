import React, { useMemo, useState } from 'react';
import GameCard from '../components/GameCard.jsx';
import GameModuleModal from '../components/GameModuleModal.jsx';
import Icon from '../components/Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Chip colors mirror the badges on the game cards.
const STORE_CHIP = {
  steam: 'bg-steam text-white',
  gog: 'bg-gog text-white',
  epic: 'bg-epic text-white',
  custom: 'bg-custom text-black',
};

// Resolve the chip color for a facet value, matching the card tag styling.
function chipColor(key, value) {
  if (key === 'store') return STORE_CHIP[value] || 'bg-neutral-700 text-neutral-100';
  if (key === 'module') {
    return value === 'ready' ? 'bg-green-900/70 text-green-200' : 'bg-neutral-700 text-neutral-200';
  }
  return 'bg-neutral-800 text-neutral-200'; // engine — neutral, like EngineBadge
}

// Faceted filter groups. valueOf maps a game to its value in the group; labelOf
// renders the human label for a value. `module` needs the game's profile to
// know whether a loader is active, so valueOf takes (game, profile).
const FACETS = [
  {
    key: 'store',
    label: 'Store',
    valueOf: (g) => g.store || 'custom',
    labelOf: (v) => v.toUpperCase(),
    order: ['steam', 'gog', 'epic', 'custom'],
  },
  {
    key: 'engine',
    // Facet on the full engine name so Unity Mono and Unity IL2CPP are
    // separate filters rather than collapsing into one "Unity" value.
    label: 'Engine',
    valueOf: (g) => g.engineName || 'Unknown',
    labelOf: (v) => v,
  },
  {
    key: 'module',
    label: 'Module',
    valueOf: (g, profile) => (profile && profile.activeModule && profile.moduleVersion ? 'ready' : 'none'),
    labelOf: (v) => (v === 'ready' ? 'Module ready' : 'No module'),
    order: ['ready', 'none'],
  },
];

// Simple modal for manually adding a game by name + executable path.
function ManualAddModal({ open, onClose, onAdd }) {
  const [name, setName] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [version, setVersion] = useState('');
  const [store, setStore] = useState('custom');

  // Open the native file picker for the executable; auto-fill the name from the
  // game's folder when the user hasn't typed one yet.
  async function browse() {
    const picked = await window.unifia?.pickExecutable();
    if (!picked) return;
    setExecutablePath(picked.path);
    setName((cur) => cur || picked.suggestedName || '');
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60">
      <div className="w-[28rem] rounded-lg bg-card p-5 ring-1 ring-white/10">
        <h3 className="mb-4 text-lg font-semibold">Add game manually</h3>
        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} placeholder="REPO" />
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-400">Executable path</span>
            <div className="flex gap-2">
              <input
                value={executablePath}
                onChange={(e) => setExecutablePath(e.target.value)}
                placeholder="C:/Games/REPO/REPO.exe"
                className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="button"
                onClick={browse}
                title="Browse for executable"
                className="flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-600"
              >
                <Icon name="folder-open" size={15} />
                Browse
              </button>
            </div>
          </label>
          <Field label="Version (optional)" value={version} onChange={setVersion} placeholder="auto-detect" />
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-400">Store</span>
            <select
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
            >
              <option value="steam">Steam</option>
              <option value="gog">GOG</option>
              <option value="epic">Epic</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600">
            Cancel
          </button>
          <button
            onClick={() => {
              if (!name || !executablePath) return;
              onAdd({ name, executablePath, version, store });
              setName('');
              setExecutablePath('');
              setVersion('');
            }}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

export default function Home({ goToModules }) {
  const games = useAppStore((s) => s.games);
  const gameProfiles = useAppStore((s) => s.gameProfiles);
  const rescan = useAppStore((s) => s.rescan);
  const addManualGame = useAppStore((s) => s.addManualGame);
  const removeGame = useAppStore((s) => s.removeGame);
  const launchGame = useAppStore((s) => s.launchGame);

  const [scanning, setScanning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [moduleGame, setModuleGame] = useState(null); // game whose module modal is open
  const [notice, setNotice] = useState(null);
  // Library layout. Defaults to list view; remembered across sessions via
  // localStorage so it doesn't need an electron-store round-trip.
  const [view, setView] = useState(() => localStorage.getItem('unifia.libraryView') || 'list');

  function changeView(next) {
    setView(next);
    localStorage.setItem('unifia.libraryView', next);
  }

  // --- Search + faceted filters ---
  const [query, setQuery] = useState('');
  // One Set of selected values per facet group. Within a group: OR; across
  // groups: AND.
  const [filters, setFilters] = useState({ store: new Set(), engine: new Set(), module: new Set() });

  const [filterOpen, setFilterOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const activeFilterCount = Object.values(filters).reduce((n, s) => n + s.size, 0);
  const anyActive = q !== '' || activeFilterCount > 0;

  function clearFilters() {
    setFilters({ store: new Set(), engine: new Set(), module: new Set() });
  }

  function toggleFilter(key, value) {
    setFilters((prev) => {
      const next = new Set(prev[key]);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return { ...prev, [key]: next };
    });
  }

  function clearAll() {
    setQuery('');
    setFilters({ store: new Set(), engine: new Set(), module: new Set() });
  }

  const profileOf = (g) => gameProfiles[g.id];
  const matchesQuery = (g) =>
    !q || `${g.name} ${g.store} ${g.engineName || ''}`.toLowerCase().includes(q);
  const matchesGroup = (g, key) => {
    const set = filters[key];
    if (!set || set.size === 0) return true;
    const facet = FACETS.find((f) => f.key === key);
    return set.has(facet.valueOf(g, profileOf(g)));
  };

  // Games matching everything except one group (used for that group's counts,
  // so a facet's own selections don't shrink its own numbers).
  const matchesAllExcept = (g, exceptKey) =>
    matchesQuery(g) && FACETS.every((f) => f.key === exceptKey || matchesGroup(g, f.key));

  const filteredGames = useMemo(
    () => games.filter((g) => matchesQuery(g) && FACETS.every((f) => matchesGroup(g, f.key))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, gameProfiles, q, filters]
  );

  // Build the chips per facet: distinct values present in the library, each with
  // a contextual count of how many games show up if that value is applied.
  const facetGroups = useMemo(() => {
    return FACETS.map((facet) => {
      const values = new Map(); // value -> count (in current context, excl. this group)
      for (const g of games) {
        const v = facet.valueOf(g, profileOf(g));
        if (!values.has(v)) values.set(v, 0);
        if (matchesAllExcept(g, facet.key)) values.set(v, values.get(v) + 1);
      }
      let entries = [...values.entries()].map(([value, count]) => ({
        value,
        count,
        label: facet.labelOf(value),
      }));
      // Stable ordering: explicit order first, then by count desc.
      if (facet.order) {
        entries.sort((a, b) => facet.order.indexOf(a.value) - facet.order.indexOf(b.value));
      } else {
        entries.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      }
      return { ...facet, entries };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, gameProfiles, q, filters]);

  async function handleScan() {
    setScanning(true);
    try {
      await rescan();
    } finally {
      setScanning(false);
    }
  }

  async function handleLaunch(game) {
    try {
      const res = await launchGame(game.id);
      setNotice(
        res.alreadyRunning
          ? `${game.name} is already running.`
          : `Launched ${game.name}${res.deployedModule ? ` with ${res.deployedModule.module} ${res.deployedModule.version}` : ''}.`
      );
    } catch (err) {
      setNotice(`Launch failed: ${err.message}`);
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Library</h1>
          <p className="text-sm text-neutral-500">
            {anyActive
              ? `${filteredGames.length} of ${games.length} games`
              : `${games.length} games detected`}
          </p>
        </div>
        <div className="flex gap-2">
          {/* List / grid view toggle */}
          <div className="flex items-center rounded bg-neutral-800 p-0.5">
            {[
              { id: 'list', icon: 'list', label: 'List view' },
              { id: 'grid', icon: 'layout-grid', label: 'Grid view' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => changeView(opt.id)}
                title={opt.label}
                aria-pressed={view === opt.id}
                className={`flex items-center rounded px-2.5 py-1.5 transition ${
                  view === opt.id
                    ? 'bg-surface-hover text-neutral-100'
                    : 'text-neutral-500 hover:text-neutral-300'
                }`}
              >
                <Icon name={opt.icon} size={16} />
              </button>
            ))}
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 rounded bg-neutral-700 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
          >
            <Icon name="refresh-cw" size={15} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Rescan'}
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:opacity-90"
          >
            <Icon name="plus" size={16} />
            Add game
          </button>
        </div>
      </div>

      {/* Search + filter popup */}
      {games.length > 0 && (
        <div className="mb-5 flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500">
              <Icon name="search" size={15} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search games…"
              className="w-full rounded bg-neutral-800 py-2 pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setFilterOpen((o) => !o)}
              className={`flex items-center gap-2 rounded px-3 py-2 text-sm transition ${
                filterOpen || activeFilterCount > 0
                  ? 'bg-surface-hover text-neutral-100'
                  : 'bg-neutral-800 text-neutral-200 hover:bg-surface-hover'
              }`}
            >
              <Icon name="sliders-horizontal" size={15} />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-contrast">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {filterOpen && (
              <>
                {/* Click-away backdrop */}
                <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg bg-card p-3 shadow-xl ring-1 ring-border-default">
                  {facetGroups.map((group) => (
                    <div key={group.key} className="mb-3 last:mb-0">
                      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                        {group.label}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.entries.map(({ value, count, label }) => {
                          const active = filters[group.key].has(value);
                          const disabled = count === 0 && !active;
                          return (
                            <button
                              key={value}
                              onClick={() => toggleFilter(group.key, value)}
                              disabled={disabled}
                              className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition ${chipColor(
                                group.key,
                                value
                              )} ${
                                active
                                  ? 'ring-2 ring-accent'
                                  : disabled
                                    ? 'opacity-30'
                                    : 'opacity-70 hover:opacity-100'
                              }`}
                            >
                              {label}
                              <span className="opacity-70">({count})</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div className="mt-1 flex items-center justify-between border-t border-border-subtle pt-2">
                    <button
                      onClick={clearFilters}
                      disabled={activeFilterCount === 0}
                      className="text-xs text-neutral-400 hover:text-neutral-200 disabled:opacity-40"
                    >
                      Clear filters
                    </button>
                    <button
                      onClick={() => setFilterOpen(false)}
                      className="rounded bg-neutral-700 px-3 py-1 text-xs text-neutral-100 hover:bg-surface-hover"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {anyActive && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs text-neutral-400 hover:bg-surface-hover hover:text-neutral-200"
            >
              <Icon name="x" size={14} />
              Clear
            </button>
          )}
        </div>
      )}

      {notice && (
        <div className="mb-4 rounded bg-neutral-800 px-4 py-2 text-sm text-neutral-200">
          {notice}
        </div>
      )}

      {games.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          No games found. Try <button onClick={handleScan} className="text-accent underline">rescanning</button> or add one manually.
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          No games match your search or filters.{' '}
          <button onClick={clearAll} className="text-accent underline">
            Clear
          </button>
        </div>
      ) : (
        <div
          className={
            view === 'grid'
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
              : 'flex flex-col gap-2'
          }
        >
          {filteredGames.map((game, i) => (
            <GameCard
              key={game.id}
              index={i}
              view={view}
              game={game}
              profile={gameProfiles[game.id]}
              onLaunch={handleLaunch}
              onRemove={(g) => removeGame(g.id)}
              onConfigure={(g) => setModuleGame(g)}
            />
          ))}
        </div>
      )}

      <ManualAddModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={async (game) => {
          await addManualGame(game);
          setModalOpen(false);
        }}
      />

      <GameModuleModal
        game={moduleGame}
        onClose={() => setModuleGame(null)}
        onManageAll={goToModules}
      />
    </div>
  );
}
