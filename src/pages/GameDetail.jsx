import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ModBrowseCard from '../components/ModBrowseCard.jsx';
import InstalledModRow from '../components/InstalledModRow.jsx';
import GameModuleModal from '../components/GameModuleModal.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Big communities return thousands of mods; rendering them all at once janks the
// page, so the Browse grid is paged.
const BROWSE_PAGE_SIZE = 12;

export default function GameDetail({ game, onBack, goToModules }) {
  const loadMods = useAppStore((s) => s.loadMods);
  const modsLoading = useAppStore((s) => s.modsLoading);
  const modError = useAppStore((s) => s.modError);
  const modHubs = useAppStore((s) => s.modHubs);
  const modList = useAppStore((s) => s.modList);
  const installedMods = useAppStore((s) => s.installedMods);
  const bepInExOnDisk = useAppStore((s) => s.bepInExOnDisk);
  const installMod = useAppStore((s) => s.installMod);
  const launchGame = useAppStore((s) => s.launchGame);
  const removeGame = useAppStore((s) => s.removeGame);

  const [tab, setTab] = useState(game?.installed === false ? 'browse' : 'installed');
  const [bepBusy, setBepBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('downloads');
  const [category, setCategory] = useState('');
  const [hub, setHub] = useState('');
  const [page, setPage] = useState(1);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (game) loadMods(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  // Any change to the search/filter/sort/tab resets Browse back to the first page.
  useEffect(() => {
    setPage(1);
  }, [query, sort, category, hub, tab]);

  if (!game) return null;

  const notInstalled = game.installed === false;

  const categories = Array.from(new Set(modList.flatMap((m) => m.categories))).sort();
  const browse = modList
    .filter((m) => !query || `${m.name} ${m.owner} ${m.latest?.description || ''}`.toLowerCase().includes(query.toLowerCase()))
    .filter((m) => !category || m.categories.includes(category))
    .filter((m) => !hub || m.hub === hub)
    .sort((a, b) =>
      sort === 'rating' ? b.rating - a.rating
      : sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'hub' ? a.hubLabel.localeCompare(b.hubLabel)
      : b.totalDownloads - a.totalDownloads
    );

  const totalPages = Math.max(1, Math.ceil(browse.length / BROWSE_PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const pageItems = browse.slice((pageClamped - 1) * BROWSE_PAGE_SIZE, pageClamped * BROWSE_PAGE_SIZE);

  // The loader can come from a Unifia-installed BepInExPack OR already exist in
  // the game folder (repacks/cracked builds often bundle it) — either satisfies it.
  const hasBepInEx = bepInExOnDisk || installedMods.some((m) => /bepinexpack/i.test(m.fullName));
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

  async function handleLaunch() {
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
  async function handleRemove() {
    await removeGame(game.id);
    onBack();
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
          {modHubs.length ? `Mods from: ${modHubs.map((h) => h.label).join(', ')}` : 'No mod source for this game'}
        </p>
      </div>

      {!notInstalled && (
        <>
          <div className="mb-5 flex items-center gap-2">
            <button
              onClick={handleLaunch}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95"
            >
              Launch
            </button>
            <button
              onClick={() => setModuleOpen(true)}
              className="rounded bg-neutral-700 px-4 py-2 text-sm text-neutral-100 transition hover:bg-surface-hover"
            >
              Module
            </button>
            <button
              onClick={handleRemove}
              title="Remove from library"
              className="ml-auto flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-400 transition hover:bg-red-900/60 hover:text-red-300"
            >
              <Icon name="x" size={15} /> Remove
            </button>
          </div>
          {notice && (
            <div className="mb-4 rounded bg-neutral-800 px-4 py-2 text-sm text-neutral-200">{notice}</div>
          )}
        </>
      )}
      {notInstalled && (
        <div className="mb-5 flex items-center gap-2 rounded border border-yellow-900/40 bg-yellow-900/15 px-4 py-3 text-sm text-yellow-300">
          Not installed — browsing mods only.
          <button
            onClick={() => window.unifia.openExternal(`https://thunderstore.io/c/${game.community}/`)}
            className="ml-auto rounded bg-neutral-700 px-3 py-1.5 text-xs text-neutral-100 hover:bg-surface-hover"
          >
            View on Thunderstore
          </button>
        </div>
      )}

      {modError ? (
        <div className="rounded-lg border border-red-900/50 bg-red-900/20 p-6 text-center text-sm text-red-300">
          Couldn&apos;t load mods: {modError}
          <div className="mt-3">
            <button
              onClick={() => loadMods(game, { refresh: true })}
              className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover"
            >
              Retry
            </button>
          </div>
        </div>
      ) : modHubs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          This game has no supported mod source, so there&apos;s nothing to browse.
        </div>
      ) : (
        <>
          {!modsLoading && !notInstalled && !hasBepInEx && (
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
            {(notInstalled ? ['browse'] : ['installed', 'browse']).map((t) => (
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
                  <option value="hub">Hub</option>
                </select>
                <select value={hub} onChange={(e) => setHub(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="">All hubs</option>
                  {modHubs.map((h) => (
                    <option key={h.id} value={h.id}>{h.label}</option>
                  ))}
                </select>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded bg-neutral-800 px-2 py-2 text-sm">
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {pageItems.map((m) => (
                  <ModBrowseCard key={m.id} game={game} mod={m} readOnly={notInstalled} />
                ))}
              </div>
              {browse.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">No mods match your search or filters.</p>
              ) : browse.length > BROWSE_PAGE_SIZE ? (
                <div className="mt-4 flex items-center justify-center gap-3 text-sm">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={pageClamped <= 1}
                    className="rounded bg-neutral-800 px-3 py-1.5 text-neutral-200 transition hover:bg-surface-hover disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <span className="text-neutral-500">
                    Page {pageClamped} of {totalPages} · {browse.length} mods
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={pageClamped >= totalPages}
                    className="rounded bg-neutral-800 px-3 py-1.5 text-neutral-200 transition hover:bg-surface-hover disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </>
      )}

      <GameModuleModal
        game={moduleOpen ? game : null}
        onClose={() => setModuleOpen(false)}
        onManageAll={goToModules}
      />
    </div>
  );
}
