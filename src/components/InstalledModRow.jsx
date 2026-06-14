import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function InstalledModRow({ game, mod }) {
  const setModEnabled = useAppStore((s) => s.setModEnabled);
  const uninstallMod = useAppStore((s) => s.uninstallMod);
  const installMod = useAppStore((s) => s.installMod);
  const update = useAppStore((s) => s.modUpdates.find((u) => u.fullName === mod.fullName));
  // Thunderstore metadata (icon / display name / author / description) for this
  // installed mod, matched from the browse list by fullName. Undefined if the
  // list hasn't loaded or the mod is no longer published — we fall back to the
  // raw fullName + a placeholder icon.
  const pkg = useAppStore((s) => s.modList.find((m) => m.fullName === mod.fullName));
  const [iconOk, setIconOk] = useState(true);

  const name = pkg?.name || mod.fullName;
  const description = pkg?.latest?.description;
  const icon = iconOk ? pkg?.icon : null;

  return (
    <div
      className={`flex items-center gap-3 rounded bg-card px-3 py-2.5 ring-1 ring-border-subtle ${
        mod.enabled ? '' : 'opacity-60'
      }`}
    >
      <input
        type="checkbox"
        checked={mod.enabled}
        onChange={(e) => setModEnabled(game.id, mod.fullName, e.target.checked)}
        title={mod.enabled ? 'Enabled — uncheck to disable' : 'Disabled — check to enable'}
        className="shrink-0"
      />

      {icon ? (
        <img
          src={icon}
          alt=""
          onError={() => setIconOk(false)}
          className="h-12 w-12 shrink-0 rounded object-cover ring-1 ring-border-default"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-neutral-700 text-neutral-500">
          <Icon name="package" size={18} />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-neutral-100" title={name}>
            {name}
          </span>
          <span className="shrink-0 text-xs text-neutral-500">v{mod.version}</span>
          {mod.isDependency && (
            <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 ring-1 ring-border-default">
              dependency
            </span>
          )}
        </div>
        {pkg?.owner && <div className="truncate text-xs text-neutral-500">by {pkg.owner}</div>}
        {description && <p className="mt-0.5 line-clamp-1 text-xs text-neutral-400">{description}</p>}
      </div>

      {update && (
        <button
          onClick={() => installMod(game.id, mod.fullName, update.latest)}
          className="shrink-0 rounded bg-green-900/60 px-2 py-1 text-xs text-green-300 hover:bg-green-900/80"
        >
          Update → {update.latest}
        </button>
      )}
      <button
        onClick={() => uninstallMod(game.id, mod.fullName)}
        title="Uninstall"
        className="flex shrink-0 items-center rounded bg-neutral-800 px-2 py-1 text-neutral-400 hover:bg-red-900/60 hover:text-red-300"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
