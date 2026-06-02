import React from 'react';
import { useAppStore } from '../store/useAppStore.js';

// Bottom status bar: connection state, player count and the active module
// version. Reads straight from the global store so it stays in sync.
export default function StatusBar() {
  const session = useAppStore((s) => s.session);
  const players = useAppStore((s) => s.players);
  const modules = useAppStore((s) => s.modules);

  const connection = session
    ? session.role === 'host'
      ? `Hosting · ${session.ip}:${session.port}`
      : `Connected · ${session.host}:${session.port}`
    : 'Offline';

  // Surface whichever module currently has an active version.
  const activeModule = Object.entries(modules).find(([, m]) => m.active);

  return (
    <footer className="flex items-center justify-between border-t border-white/5 bg-sidebar px-4 py-1.5 text-xs text-neutral-400">
      <span className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${session ? 'bg-green-500' : 'bg-neutral-600'}`}
        />
        {connection}
      </span>
      <span>{players.length} player{players.length === 1 ? '' : 's'}</span>
      <span>
        {activeModule
          ? `${activeModule[1].label || activeModule[0]} ${activeModule[1].active}`
          : 'No active module'}
      </span>
    </footer>
  );
}
