import React from 'react';
import { useAppStore } from '../store/useAppStore.js';

// Bottom status bar: library size and the active module version. Reads straight
// from the global store so it stays in sync. (Live lobby/session state was
// removed when multiplayer moved to per-game share codes.)
export default function StatusBar() {
  const games = useAppStore((s) => s.games);
  const modules = useAppStore((s) => s.modules);

  // Surface whichever module currently has an active version.
  const activeModule = Object.entries(modules).find(([, m]) => m.active);

  return (
    <footer className="flex items-center justify-between border-t border-white/5 bg-sidebar px-4 py-1.5 text-xs text-neutral-400">
      <span>
        {games.length} game{games.length === 1 ? '' : 's'} in library
      </span>
      <span>
        {activeModule
          ? `${activeModule[1].label || activeModule[0]} ${activeModule[1].active}`
          : 'No active module'}
      </span>
    </footer>
  );
}
