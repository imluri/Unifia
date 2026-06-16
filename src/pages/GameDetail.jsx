import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ModBrowseCard from '../components/ModBrowseCard.jsx';
import InstalledModRow from '../components/InstalledModRow.jsx';
import ArchivedModsSection from '../components/ArchivedModsSection.jsx';
import ModLoadOrderManager from '../components/ModLoadOrderManager.jsx';
import ConnectorBadge from '../components/ConnectorBadge.jsx';
import MultiplayerTab from './MultiplayerTab.jsx';
import PresetBar from '../components/PresetBar.jsx';
import InviteModal from '../components/InviteModal.jsx';
import GameModuleModal from '../components/GameModuleModal.jsx';
import Button from '../components/ui/Button.jsx';
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
  const modProgress = useAppStore((s) => s.modProgress);
  const bepInExOnDisk = useAppStore((s) => s.bepInExOnDisk);
  const connector = useAppStore((s) => s.connector[game?.id]);
  const installMod = useAppStore((s) => s.installMod);
  const launchGame = useAppStore((s) => s.launchGame);
  const removeGame = useAppStore((s) => s.removeGame);
  const updateGamePath = useAppStore((s) => s.updateGamePath);
  const refreshBepInEx = useAppStore((s) => s.refreshBepInEx);
  const pushToast = useAppStore((s) => s.pushToast);
  const renameGame = useAppStore((s) => s.renameGame);
  const liveGame = useAppStore((s) => s.games.find((g) => g.id === game.id)) || game;

  const [tab, setTab] = useState(game?.installed === false ? 'browse' : 'installed');
  const [bepBusy, setBepBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('downloads');
  const [category, setCategory] = useState('');
  const [hub, setHub] = useState('');
  const [page, setPage] = useState(1);
  const [moduleOpen, setModuleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [recipeMeta, setRecipeMeta] = useState(null);
  const [installedQuery, setInstalledQuery] = useState('');
  const [installedFilter, setInstalledFilter] = useState('all'); // all | enabled | disabled

  useEffect(() => {
    if (game) loadMods(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  // Any change to the search/filter/sort/tab resets Browse back to the first page.
  useEffect(() => {
    setPage(1);
  }, [query, sort, category, hub, tab]);

  useEffect(() => {
    let active = true;
    window.unifia.getRecipeFor(game.id).then((m) => { if (active) setRecipeMeta(m); }).catch(() => {});
    return () => { active = false; };
  }, [game.id]);

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

  // Merge installed mods with mods currently downloading to show immediate feedback
  const displayedMods = [
    ...installedMods,
    ...Object.keys(modProgress)
      .filter((fullName) => !installedMods.some((m) => m.fullName === fullName))
      .map((fullName) => ({
        fullName,
        version: 'installing',
        enabled: true,
        isDependency: false,
      })),
  ];

  // Installed-tab search (name/owner) + enabled/disabled filter.
  const filteredInstalled = displayedMods
    .filter((m) =>
      installedFilter === 'enabled' ? m.enabled
      : installedFilter === 'disabled' ? !m.enabled
      : true)
    .filter((m) => {
      const q = installedQuery.trim().toLowerCase();
      return !q || `${m.name || ''} ${m.fullName || ''} ${m.owner || ''}`.toLowerCase().includes(q);
    });

  // The loader can come from a Unifia-installed BepInExPack OR already exist in
  // the game folder (repacks/cracked builds often bundle it) — either satisfies it.
  const hasBepInEx = bepInExOnDisk || displayedMods.some((m) => /bepinexpack/i.test(m.fullName));
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
      pushToast({
        type: 'success',
        message: res.alreadyRunning
          ? `${game.name} is already running.`
          : `Launched ${game.name}${res.deployedModule ? ` with ${res.deployedModule.module} ${res.deployedModule.version}` : ''}.`,
      });
    } catch (err) {
      pushToast({ type: 'error', message: `Launch failed: ${err.message}` });
    }
  }
  async function handleRemove() {
    await removeGame(game.id);
    onBack();
  }
  async function saveName() {
    const draft = nameDraft.trim();
    await renameGame(game.id, draft); // blank clears the nickname
    setEditingName(false);
  }
  async function handleChangeFolder() {
    const picked = await window.unifia.pickDirectory();
    if (!picked) return;
    try {
      await updateGamePath(game.id, picked.path);
      // Always re-detect BepInEx against the new folder, independent of the mod
      // list (so a slow/failed mod fetch can't leave stale loader status).
      await refreshBepInEx(game.id);
      await loadMods(game);
      pushToast({ type: 'success', message: `Folder updated to ${picked.path}.` });
    } catch (err) {
      pushToast({ type: 'error', message: `Couldn't change folder: ${err.message}` });
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
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
              placeholder={liveGame.name}
              className="rounded bg-neutral-800 px-2 py-1 text-2xl font-bold text-neutral-100 ring-1 ring-border-default focus:outline-none focus:ring-accent/50"
            />
            <button onClick={saveName} className="rounded bg-accent/20 px-2 py-1 text-sm text-accent hover:bg-accent/30">Save</button>
            <button onClick={() => setEditingName(false)} className="rounded px-2 py-1 text-sm text-neutral-400 hover:text-neutral-200">Cancel</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-neutral-100" title={liveGame.name}>
              {liveGame.displayName || liveGame.name}
            </h1>
            {liveGame.manual && (
              <button
                onClick={() => { setNameDraft(liveGame.displayName || ''); setEditingName(true); }}
                className="text-neutral-500 hover:text-neutral-200"
                title="Rename (set a label to tell clones apart)"
              >
                <Icon name="pencil" size={16} />
              </button>
            )}
          </div>
        )}
        <p className="text-sm text-neutral-500">
          {modHubs.length ? `Mods from: ${modHubs.map((h) => h.label).join(', ')}` : 'No mod source for this game'}
        </p>
        {recipeMeta && (
          <p className="mt-0.5 text-xs text-accent">
            Crossplay recipe: {recipeMeta.id} v{recipeMeta.version} ✓
          </p>
        )}
      </div>

      {!notInstalled && (
        <>
          <div className="mb-5 flex items-center gap-2">
            <Button variant="primary" icon="play" onClick={handleLaunch}>Launch</Button>
            <Button icon="package" onClick={() => setModuleOpen(true)}>Module</Button>
            {game.manual && (
              <Button icon="folder-open" onClick={handleChangeFolder} title="Point this game at a different install folder">
                Change folder
              </Button>
            )}
            <Button className="ml-auto" icon="globe" onClick={() => setInviteOpen(true)} title="Generate or paste a multiplayer invite code">
              Invite
            </Button>
            <Button variant="danger" icon="x" onClick={handleRemove} title="Remove from library">Remove</Button>
          </div>
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

      {modsLoading ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-b-transparent" />
          <span className="text-sm text-neutral-400">Loading mods…</span>
        </div>
      ) : modError ? (
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
          {!notInstalled && !hasBepInEx && (
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
            {(notInstalled ? ['browse'] : ['installed', 'browse', 'multiplayer']).map((t) => (
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

          {tab === 'multiplayer' ? (
            <MultiplayerTab game={game} />
          ) : tab === 'installed' ? (
            <div className="flex flex-col gap-2">
              <PresetBar game={game} />
              {/* Pinned, read-only: the Unifia connector is a system component,
                  not a community mod. Manage it from the Lobby. */}
              <div className="flex items-center justify-between gap-3 rounded border border-accent/30 bg-accent/5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <ConnectorBadge />
                  {connector?.pluginInstalled ? (
                    <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs text-green-300">
                      Installed ✓
                    </span>
                  ) : (
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">
                      Not installed
                    </span>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setTab('multiplayer')}>Manage in Multiplayer →</Button>
              </div>
              <div className="my-1 border-t border-border-subtle" />

              {modsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="skeleton h-[68px] rounded" />
                ))
              ) : displayedMods.length === 0 ? (
                <div className="flex items-center gap-1 text-sm text-neutral-500">
                  No mods installed yet.
                  <Button variant="ghost" size="sm" onClick={() => setTab('browse')}>Browse mods</Button>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input
                      value={installedQuery}
                      onChange={(e) => setInstalledQuery(e.target.value)}
                      placeholder="Search installed mods…"
                      className="min-w-[180px] flex-1 rounded bg-neutral-800 px-3 py-2 text-sm outline-none"
                    />
                    <div className="flex shrink-0 overflow-hidden rounded ring-1 ring-border-default">
                      {['all', 'enabled', 'disabled'].map((f) => (
                        <button
                          key={f}
                          onClick={() => setInstalledFilter(f)}
                          className={`px-3 py-2 text-xs capitalize transition ${
                            installedFilter === f
                              ? 'bg-accent/20 text-accent'
                              : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                          }`}
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  {filteredInstalled.length === 0 ? (
                    <p className="text-sm text-neutral-500">No installed mods match your search or filter.</p>
                  ) : (
                    <div className="space-y-2">
                      {filteredInstalled.map((m) => <InstalledModRow key={m.fullName} game={game} mod={m} />)}
                    </div>
                  )}
                  <ModLoadOrderManager game={game} />
                  <ArchivedModsSection game={game} />
                </>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search mods…"
                  className="flex-1 rounded bg-neutral-800 px-3 py-2 text-sm outline-none"
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
              {modsLoading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="skeleton h-[92px] rounded" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {pageItems.map((m) => (
                    <ModBrowseCard key={m.id} game={game} mod={m} readOnly={notInstalled} />
                  ))}
                </div>
              )}
              {modsLoading ? null : browse.length === 0 ? (
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
      <InviteModal game={game} open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
