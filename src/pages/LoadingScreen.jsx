import React, { useEffect, useRef, useState } from 'react';
import { api, applyTheme, useAppStore } from '../store/useAppStore.js';
import logo from '../assets/unifia_logo.png';

// Minimum time the loading screen stays up, even if everything loads instantly.
const MIN_DISPLAY_MS = 1200;
const FADE_MS = 400;

// Sequenced bootstrap. Each step gathers a slice of app data into `acc`, which
// is handed to the store via hydrate() at the end. The loader is intentionally
// theme-independent (pure black) so it looks identical on first ever launch.
export default function LoadingScreen({ onDone }) {
  const [label, setLabel] = useState('INITIALIZING');
  const [progress, setProgress] = useState(0);
  const [fading, setFading] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // guard React 18 StrictMode double-invoke
    started.current = true;

    const acc = { art: {} };
    const steps = [
      {
        label: 'INITIALIZING',
        run: async () => {
          if (!api) return;
          acc.settings = await api.getSettings();
          acc.moduleSources = await api.listModuleSources();
          acc.dataDir = await api.getDataDir();
          // Apply the saved theme now so the app behind the crossfade is correct.
          applyTheme(acc.settings?.theme);
        },
      },
      {
        label: 'SCANNING GAMES',
        run: async () => {
          if (!api) return;
          acc.games = await api.scanGames();
        },
      },
      {
        label: 'LOADING MODULES',
        run: async () => {
          if (!api) return;
          acc.modules = await api.getInstalledModules();
          acc.gameProfiles = await api.getGameProfiles();
        },
      },
      {
        label: 'FETCHING ART',
        run: async () => {
          // Skip entirely when there's no SteamGridDB key configured.
          if (!api || !acc.settings?.steamGridDbKey || !acc.games?.length) return;
          const subset = acc.games.slice(0, 12);
          await Promise.all(
            subset.map(async (g) => {
              try {
                acc.art[g.id] = await api.fetchGameArt(g.id, g.name, g.steamAppId);
              } catch {
                acc.art[g.id] = null;
              }
            })
          );
        },
      },
      { label: 'READY', run: async () => {} },
    ];

    const startedAt = Date.now();

    (async () => {
      for (let i = 0; i < steps.length; i += 1) {
        setLabel(steps[i].label);
        try {
          await steps[i].run();
        } catch (err) {
          // A failed step shouldn't trap the user on the loader.
          useAppStore.setState({ error: err.message });
        }
        setProgress(Math.round(((i + 1) / steps.length) * 100));
      }

      // Hold for the minimum display time so the loader never flashes.
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_DISPLAY_MS) {
        await new Promise((r) => setTimeout(r, MIN_DISPLAY_MS - elapsed));
      }

      // Go live (mounts the app behind us), then crossfade out and unmount.
      useAppStore.getState().hydrate({
        settings: acc.settings,
        games: acc.games || [],
        modules: acc.modules || {},
        moduleSources: acc.moduleSources || [],
        gameProfiles: acc.gameProfiles || {},
        dataDir: acc.dataDir || '',
        art: acc.art || {},
      });
      setFading(true);
      setTimeout(() => onDone?.(), FADE_MS);
    })();
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: '#000000',
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      <img src={logo} alt="" className="word-fade mb-5 h-14 w-14 rounded-lg" />

      <div
        className="word-fade text-[18px] font-medium uppercase tracking-[0.35em] text-white"
        style={{ fontFamily: "'Geist', 'Inter', sans-serif" }}
      >
        UNIFIA
      </div>

      {/* Thin progress track + eased fill. */}
      <div
        className="mt-6 overflow-hidden"
        style={{ width: 120, height: 1, background: '#2a2a2a' }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: '#ffffff',
            transition: 'width 300ms ease-out',
          }}
        />
      </div>

      <div
        className="mt-4 text-[11px] uppercase tracking-[0.2em]"
        style={{ color: '#444444' }}
      >
        {label}
      </div>
    </div>
  );
}
