import React, { useEffect, useRef, useState } from 'react';
import GameIcon from './GameIcon.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Tile for a not-installed Thunderstore catalog game. Mirrors GameCard's list
// row (shared GameIcon + container styling) so Library and Discover read the
// same; the whole card opens the browse-only GameDetail.
export default function DiscoverCard({ game, onOpen }) {
  const art = useAppStore((s) => s.art[game.id]);
  const fetchArt = useAppStore((s) => s.fetchArt);
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [iconOk, setIconOk] = useState(true);

  // The catalog can list hundreds of games at once and each art lookup is
  // several SteamGridDB calls, so only resolve art for cards the user actually
  // scrolls near — keeps us well under the API's rate limits.
  useEffect(() => {
    if (!ref.current || art !== undefined) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [art]);

  useEffect(() => {
    if (visible && art === undefined) fetchArt(game);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const loadingArt = visible && art === undefined;
  const icon = iconOk ? art?.icon : null;

  return (
    <div
      ref={ref}
      onClick={onOpen}
      className="card-mount flex cursor-pointer items-center gap-3 rounded bg-card px-3 py-2.5 ring-1 ring-border-subtle transition-all duration-150 hover:ring-accent/40"
    >
      {loadingArt ? (
        <div className="skeleton h-10 w-10 shrink-0 rounded" />
      ) : (
        <GameIcon src={icon} onError={() => setIconOk(false)} />
      )}
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
