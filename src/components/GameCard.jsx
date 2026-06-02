import React from 'react';
import VersionBadge from './VersionBadge.jsx';
import Icon from './Icon.jsx';

// Per-store accent colors for the badge in the card header.
const STORE_BADGE = {
  steam: 'bg-steam text-white',
  gog: 'bg-gog text-white',
  epic: 'bg-epic text-white',
  custom: 'bg-custom text-black',
};

// Module status: green when an active module is linked, gray otherwise.
function ModuleStatus({ profile }) {
  const ready = profile && profile.activeModule && profile.moduleVersion;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${
        ready ? 'bg-green-900/60 text-green-300' : 'bg-neutral-700 text-neutral-400'
      }`}
    >
      {ready ? `BepInEx ready` : 'No module'}
    </span>
  );
}

export default function GameCard({ game, profile, onLaunch, onRemove, onConfigure }) {
  return (
    <div className="flex flex-col rounded-lg bg-card p-4 shadow-sm ring-1 ring-white/5 transition hover:ring-accent/50">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="truncate text-base font-semibold text-neutral-100" title={game.name}>
          {game.name}
        </h3>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
            STORE_BADGE[game.store] || STORE_BADGE.custom
          }`}
        >
          {game.store}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <VersionBadge version={game.version} />
        <ModuleStatus profile={profile} />
      </div>

      <p className="mb-4 truncate text-xs text-neutral-500" title={game.installPath}>
        {game.installPath}
      </p>

      <div className="mt-auto flex gap-2">
        <button
          onClick={() => onLaunch(game)}
          className="flex-1 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-600"
        >
          Launch
        </button>
        <button
          onClick={() => onConfigure(game)}
          className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-200 transition hover:bg-neutral-600"
        >
          Module
        </button>
        <button
          onClick={() => onRemove(game)}
          title="Remove from library"
          className="flex items-center rounded bg-neutral-800 px-2 py-1.5 text-neutral-400 transition hover:bg-red-900/60 hover:text-red-300"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}
