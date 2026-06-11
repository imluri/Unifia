import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ModBrowseCard from '../components/ModBrowseCard.jsx';
import InstalledModRow from '../components/InstalledModRow.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function GameDetail({ game, onBack }) {
  const loadMods = useAppStore((s) => s.loadMods);
  const modsLoading = useAppStore((s) => s.modsLoading);
  const modError = useAppStore((s) => s.modError);
  const modCommunity = useAppStore((s) => s.modCommunity);
  const modList = useAppStore((s) => s.modList);
  const installedMods = useAppStore((s) => s.installedMods);
  const installMod = useAppStore((s) => s.installMod);

  const [tab, setTab] = useState('installed');
  const [bepBusy, setBepBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('downloads');
  const [category, setCategory] = useState('');

  useEffect(() => {
    if (game) loadMods(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  if (!game) return null;

  const categories = Array.from(new Set(modList.flatMap((m) => m.categories))).sort();
  const browse = modList
    .filter((m) => !query || `${m.name} ${m.owner} ${m.latest?.description || ''}`.toLowerCase().includes(query.toLowerCase()))
    .filter((m) => !category || m.categories.includes(category))
    .sort((a, b) =>
      sort === 'rating' ? b.rating - a.rating
      : sort === 'name' ? a.name.localeCompare(b.name)
      : b.totalDownloads - a.totalDownloads
    );

  const hasBepInEx = installedMods.some((m) => /bepinexpack/i.test(m.fullName));
  const bepPkg = modList.find((m) => /bepinexpack/i.test(m.fullName));
  async function installBepInEx() {
    if (!bepPkg) return;
    setBepBusy(true);
    try {
      await installMod(game.id, bepPkg.fullName);
    } finally {
      setBepBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 flex items-center gap-1.5 text-sm text-neutral-400 hover:text-neutral-200"
      >
        <Icon name="x" size={14} /> Back to library
      </button>

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-100">{game.name}</h1>
        <p className="text-sm text-neutral-500">
          {modCommunity ? `Thunderstore: ${modCommunity}` : 'No mod source for this game'}
        </p>
      </div>

      {modError ? (
        <div className="rounded-lg border border-red-900/50 bg-red-900/20 p-6 text-center text-sm text-red-300">
          Couldn&apos;t load mods: {modError}
          <div className="mt-3">
            <button
              onClick={() => loadMods(game.id, { refresh: true })}
              className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover"
            >
              Retry
            </button>
          </div>
        </div>
      ) : !modCommunity ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          This game isn&apos;t mapped to a Thunderstore community, so there are no mods to browse.
        </div>
      ) : (
        <>
          {!modsLoading && !hasBepInEx && (
            <div className="mb-4 rounded border border-yellow-900/40 bg-yellow-900/15 px-4 py-3 text-sm">
              {bepPkg ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-yellow-300">
                    BepInEx isn&apos;t installed for this game yet — mods need it to load.
                  </span>
                  <button
                    onClick={installBepInEx}
                    disabled={bepBusy}
                    className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
                  >
                    {bepBusy ? 'Installing…' : 'Install BepInEx'}
                  </button>
                </div>
              ) : (
                <span className="text-neutral-400">
                  BepInEx isn&apos;t available in this Thunderstore community.
                </span>
              )}
            </div>
          )}
          <div className="mb-5 inline-flex rounded-lg bg-neutral-800 p-1">
            {['installed', 'browse'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded px-4 py-1.5 text-sm font-medium capitalize transition ${
                  tab === t ? 'bg-accent text-accent-contrast' : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {modsLoading && <p className="text-sm text-neutral-500">Loading mods…</p>}

          {tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              {installedMods.length === 0 ? (
                <p className="text-sm text-neutral-500">No mods installed yet. Switch to Browse.</p>
              ) : (
                installedMods.map((m) => <InstalledModRow key={m.fullName} game={game} mod={m} />)
              )}
            </div>
          ) : (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search mods…"
                  className="flex-1 rounded bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
                />
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="downloads">Most downloaded</option>
                  <option value="rating">Top rated</option>
                  <option value="name">Name</option>
                </select>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {browse.map((m) => (
                  <ModBrowseCard key={m.fullName} game={game} mod={m} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
