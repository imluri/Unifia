import React from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function InstalledModRow({ game, mod }) {
  const setModEnabled = useAppStore((s) => s.setModEnabled);
  const uninstallMod = useAppStore((s) => s.uninstallMod);
  const installMod = useAppStore((s) => s.installMod);
  const update = useAppStore((s) => s.modUpdates.find((u) => u.fullName === mod.fullName));

  return (
    <div className="flex items-center gap-3 rounded bg-card px-3 py-2 ring-1 ring-border-subtle">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={mod.enabled}
          onChange={(e) => setModEnabled(game.id, mod.fullName, e.target.checked)}
        />
      </label>
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm text-neutral-100">{mod.fullName}</span>
        <span className="ml-2 text-xs text-neutral-500">v{mod.version}</span>
        {mod.isDependency && <span className="ml-2 text-[10px] text-neutral-600">(dependency)</span>}
      </div>
      {update && (
        <button
          onClick={() => installMod(game.id, mod.fullName, update.latest)}
          className="rounded bg-green-900/60 px-2 py-1 text-xs text-green-300 hover:bg-green-900/80"
        >
          Update → {update.latest}
        </button>
      )}
      <button
        onClick={() => uninstallMod(game.id, mod.fullName)}
        title="Uninstall"
        className="flex items-center rounded bg-neutral-800 px-2 py-1 text-neutral-400 hover:bg-red-900/60 hover:text-red-300"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
