import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import ModBrowseCard from '../components/ModBrowseCard.jsx';
import InstalledModRow from '../components/InstalledModRow.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function GameDetail({ game, onBack }) {
  const loadMods = useAppStore((s) => s.loadMods);
  const modsLoading = useAppStore((s) => s.modsLoading);
  const modCommunity = useAppStore((s) => s.modCommunity);
  const modList = useAppStore((s) => s.modList);
  const installedMods = useAppStore((s) => s.installedMods);

  const [tab, setTab] = useState('installed');

  useEffect(() => {
    if (game) loadMods(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id]);

  if (!game) return null;

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

      {!modCommunity ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          This game isn&apos;t mapped to a Thunderstore community, so there are no mods to browse.
        </div>
      ) : (
        <>
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {modList.map((m) => (
                <ModBrowseCard key={m.fullName} game={game} mod={m} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
