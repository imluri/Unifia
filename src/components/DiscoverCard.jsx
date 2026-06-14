import React from 'react';
import Icon from './Icon.jsx';

// Lightweight tile for a not-installed Thunderstore catalog game. Whole card
// opens the browse-only GameDetail.
export default function DiscoverCard({ game, onOpen }) {
  return (
    <div
      onClick={onOpen}
      className="card-mount flex cursor-pointer items-center gap-3 rounded bg-card px-3 py-2.5 ring-1 ring-border-subtle transition-all duration-150 hover:ring-accent/40"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-700 text-neutral-500">
        <Icon name="package" size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-neutral-100" title={game.name}>
          {game.name}
        </h3>
        <p className="truncate text-xs text-neutral-500">{game.community}</p>
      </div>
      <span className="shrink-0 rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 ring-1 ring-border-default">
        Thunderstore
      </span>
    </div>
  );
}
