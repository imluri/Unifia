import React, { useEffect, useState } from 'react';
import VersionBadge from './VersionBadge.jsx';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

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
      {ready ? 'BepInEx ready' : 'No module'}
    </span>
  );
}

// Shared 40x40 game icon (or placeholder) used by both layouts.
function GameIcon({ src, onError }) {
  return src ? (
    <img
      src={src}
      alt=""
      onError={onError}
      className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-border-default"
    />
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-700 text-neutral-500">
      <Icon name="package" size={18} />
    </div>
  );
}

function StoreBadge({ store }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
        STORE_BADGE[store] || STORE_BADGE.custom
      }`}
    >
      {store}
    </span>
  );
}

// Detected game engine (Unity/Unreal/Godot/…). Hidden when undetectable.
function EngineBadge({ game }) {
  if (!game.engine || game.engine === 'unknown' || !game.engineName) return null;
  return (
    <span className="inline-flex items-center rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300 ring-1 ring-border-default">
      {game.engineName}
    </span>
  );
}

export default function GameCard({ game, profile, onOpen, index = 0, view = 'list' }) {
  const art = useAppStore((s) => s.art[game.id]);
  const fetchArt = useAppStore((s) => s.fetchArt);
  const [loadingArt, setLoadingArt] = useState(art === undefined);
  const [bannerOk, setBannerOk] = useState(true);
  const [iconOk, setIconOk] = useState(true);

  // Resolve art on mount and whenever the memo is cleared (e.g. after a rescan
  // following a SteamGridDB key change). When art is undefined we (re)fetch and
  // reset the per-image error flags so freshly resolved URLs get a clean try.
  useEffect(() => {
    let active = true;
    if (art === undefined) {
      setLoadingArt(true);
      setBannerOk(true);
      setIconOk(true);
      fetchArt(game).finally(() => active && setLoadingArt(false));
    } else {
      setLoadingArt(false);
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, art]);

  const banner = bannerOk ? art?.banner : null;
  const icon = iconOk ? art?.icon : null;

  // Stagger the mount animation by index, capped so later items appear instantly.
  const delay = index < 8 ? index * 40 : 0;

  // ---- List view: compact horizontal row ---------------------------------
  if (view === 'list') {
    return (
      <div
        onClick={onOpen}
        className="card-mount flex cursor-pointer items-center gap-3 rounded bg-card px-3 py-2.5 ring-1 ring-border-subtle transition-all duration-150 hover:ring-accent/40"
        style={{ animationDelay: `${delay}ms` }}
      >
        {loadingArt ? <div className="skeleton h-10 w-10 shrink-0 rounded" /> : (
          <GameIcon src={icon} onError={() => setIconOk(false)} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-neutral-100" title={game.name}>{game.name}</h3>
            <StoreBadge store={game.store} />
          </div>
          <p className="truncate text-xs text-neutral-500" title={game.installPath}>
            {game.installPath}
          </p>
        </div>

        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <EngineBadge game={game} />
          <VersionBadge version={game.version} buildId={game.buildId} />
          <ModuleStatus profile={profile} />
        </div>
      </div>
    );
  }

  // ---- Grid view: art card -----------------------------------------------
  return (
    <div
      onClick={onOpen}
      className="card-mount group relative flex min-h-[150px] cursor-pointer flex-col overflow-hidden rounded bg-card p-4 shadow-sm ring-1 ring-border-subtle transition-all duration-150 hover:-translate-y-px hover:ring-accent/40"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Art / skeleton layer behind the content. */}
      {loadingArt && <div className="skeleton absolute inset-0" />}
      {!loadingArt && banner && (
        <>
          {/* Slightly blurred + scaled so it reads as ambient art, not detail
              the eye fights with. scale hides blur bleed at the edges. */}
          <img
            src={banner}
            alt=""
            onError={() => setBannerOk(false)}
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-[2px]"
          />
          {/* Strong gradient scrim — darkest toward the bottom where the path
              and buttons sit, so everything stays legible over busy banners. */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/80 to-black/95" />
        </>
      )}

      {/* Foreground content. */}
      <div className={`relative flex h-full flex-col ${banner ? 'text-legible' : ''}`}>
        <div className="mb-2 flex items-start gap-3">
          <GameIcon src={icon} onError={() => setIconOk(false)} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-neutral-100" title={game.name}>{game.name}</h3>
            <span className="mt-0.5 inline-block">
              <StoreBadge store={game.store} />
            </span>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <EngineBadge game={game} />
          <VersionBadge version={game.version} buildId={game.buildId} />
          <ModuleStatus profile={profile} />
        </div>

        <p
          className={`mb-4 truncate text-xs ${banner ? 'text-neutral-300' : 'text-neutral-500'}`}
          title={game.installPath}
        >
          {game.installPath}
        </p>

      </div>
    </div>
  );
}
