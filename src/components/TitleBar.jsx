import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

// Custom window chrome for the frameless BrowserWindow. The whole bar is a drag
// region (-webkit-app-region: drag via the `drag` class) except the interactive
// window controls, which opt out with `no-drag`.
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = window.unifia;
    if (!win?.window) return;
    win.window.isMaximized().then(setMaximized).catch(() => {});
    // Keep the maximize/restore icon in sync when the OS changes window state.
    return win.window.onMaximizeChange((isMax) => setMaximized(isMax));
  }, []);

  const ctl = window.unifia?.window;

  return (
    <header
      className="drag flex h-9 shrink-0 select-none items-center justify-between border-b border-white/5 bg-sidebar pl-3"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold tracking-tight text-neutral-300">
        <span className="text-accent">●</span>
        <span>Unifia</span>
      </div>

      {/* Window controls — must not be draggable so clicks register. */}
      <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' }}>
        <button
          onClick={() => ctl?.minimize()}
          title="Minimize"
          className="flex h-full w-12 items-center justify-center text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"
        >
          <Icon name="minus" size={16} />
        </button>
        <button
          onClick={() => ctl?.toggleMaximize()}
          title={maximized ? 'Restore' : 'Maximize'}
          className="flex h-full w-12 items-center justify-center text-neutral-400 transition hover:bg-white/10 hover:text-neutral-100"
        >
          <Icon name={maximized ? 'copy' : 'square'} size={maximized ? 14 : 13} />
        </button>
        <button
          onClick={() => ctl?.close()}
          title="Close"
          className="flex h-full w-12 items-center justify-center text-neutral-400 transition hover:bg-red-600 hover:text-white"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </header>
  );
}
