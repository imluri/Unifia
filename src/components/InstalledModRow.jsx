import React, { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import DownloadProgress from './DownloadProgress.jsx';
import { getDeploymentTargetLabel } from '../lib/modDeployment.js';
import { useAppStore } from '../store/useAppStore.js';

export default function InstalledModRow({ game, mod }) {
  const setModEnabled = useAppStore((s) => s.setModEnabled);
  const uninstallMod = useAppStore((s) => s.uninstallMod);
  const installMod = useAppStore((s) => s.installMod);
  const refreshModUpdates = useAppStore((s) => s.refreshModUpdates);
  const getModDependents = useAppStore((s) => s.getModDependents);
  const getModConflicts = useAppStore((s) => s.getModConflicts);
  const modDependents = useAppStore((s) => s.modDependents[mod.fullName] || []);
  const modConflicts = useAppStore((s) => s.modConflicts[mod.fullName] || []);
  const progress = useAppStore((s) => s.modProgress[mod.fullName]);
  const update = useAppStore((s) => s.modUpdates.find((u) => u.fullName === mod.fullName));
  const [updating, setUpdating] = useState(false);
  const [showDependents, setShowDependents] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);

  const isInstalling = mod.version === 'installing';

  async function doUpdate() {
    if (!update) return;
    setUpdating(true);
    try {
      await installMod(game.id, mod.fullName, update.latest);
      await refreshModUpdates(game.id); // clear the now-satisfied "Update →" badge
    } finally {
      setUpdating(false);
    }
  }

  // Lazy-load dependents and conflicts on first show
  useEffect(() => {
    if (!isInstalling && (showDependents || showConflicts)) {
      if (modDependents.length === 0 && showDependents) {
        getModDependents(game.id, mod.fullName).catch(() => {});
      }
      if (modConflicts.length === 0 && showConflicts) {
        getModConflicts(game.id, mod.fullName).catch(() => {});
      }
    }
  }, [showDependents, showConflicts, isInstalling, mod.fullName, game.id]);
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
      className={`relative flex flex-col rounded bg-card ring-1 ring-border-subtle ${
        mod.enabled ? '' : 'opacity-60'
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={mod.enabled}
          onChange={(e) => setModEnabled(game.id, mod.fullName, e.target.checked)}
          title={mod.enabled ? 'Enabled — uncheck to disable' : 'Disabled — check to enable'}
          className="shrink-0"
          disabled={isInstalling}
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
            {isInstalling ? (
              <span className="shrink-0 rounded bg-blue-900/60 px-1.5 py-0.5 text-[10px] text-blue-300">
                Installing…
              </span>
            ) : (
              <span className="shrink-0 text-xs text-neutral-500">v{mod.version}</span>
            )}
            {mod.isDependency && !isInstalling && (
              <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 ring-1 ring-border-default">
                dependency
              </span>
            )}
            {!isInstalling && (
              <span title={`Deploys to: ${getDeploymentTargetLabel(mod.fullName)}`} className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                {getDeploymentTargetLabel(mod.fullName)}
              </span>
            )}
          </div>
          {pkg?.owner && <div className="truncate text-xs text-neutral-500">by {pkg.owner}</div>}
          {description && <p className="mt-0.5 line-clamp-1 text-xs text-neutral-400">{description}</p>}
          {!isInstalling && (
            <div className="mt-2 flex flex-wrap gap-2">
              {modConflicts.length > 0 && (
                <button
                  onClick={() => setShowConflicts(!showConflicts)}
                  className="rounded bg-red-900/40 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/60"
                  title={`${modConflicts.length} conflict(s) detected`}
                >
                  ⚠️ {modConflicts.length} Conflict{modConflicts.length !== 1 ? 's' : ''}
                </button>
              )}
              {modDependents.length > 0 && (
                <button
                  onClick={() => setShowDependents(!showDependents)}
                  className="rounded bg-blue-900/40 px-2 py-0.5 text-[10px] text-blue-300 hover:bg-blue-900/60"
                  title={`${modDependents.length} mod(s) depend on this`}
                >
                  🔗 {modDependents.length} Dependent{modDependents.length !== 1 ? 's' : ''}
                </button>
              )}
            </div>
          )}
        </div>

        {update && !isInstalling && (
          <button
            onClick={doUpdate}
            disabled={updating}
            className="shrink-0 rounded bg-green-900/60 px-2 py-1 text-xs text-green-300 transition hover:bg-green-900/80 disabled:opacity-60"
          >
            {updating ? `Updating… ${progress ? `${progress.percent}%` : ''}` : `Update → ${update.latest}`}
          </button>
        )}
        <button
          onClick={() => uninstallMod(game.id, mod.fullName)}
          title="Uninstall"
          disabled={isInstalling}
          className="flex shrink-0 items-center rounded bg-neutral-800 px-2 py-1 text-neutral-400 hover:bg-red-900/60 hover:text-red-300 disabled:opacity-50 disabled:hover:bg-neutral-800 disabled:hover:text-neutral-400"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      {isInstalling && progress && (
        <div className="border-t border-border-subtle px-3 py-2">
          <DownloadProgress progress={progress} />
        </div>
      )}
      {showConflicts && modConflicts.length > 0 && (
        <div className="border-t border-border-subtle bg-red-900/20 px-3 py-2">
          <p className="mb-1 text-xs font-semibold text-red-300">Conflicts:</p>
          {modConflicts.map((conflict) => (
            <div key={conflict.fullName} className="text-xs text-red-200">
              <span className="font-mono">{conflict.fullName}</span>
              <span className="ml-2 text-red-300">({conflict.reason})</span>
            </div>
          ))}
        </div>
      )}
      {showDependents && modDependents.length > 0 && (
        <div className="border-t border-border-subtle bg-blue-900/20 px-3 py-2">
          <p className="mb-1 text-xs font-semibold text-blue-300">Required by:</p>
          {modDependents.map((dependent) => (
            <div key={dependent} className="text-xs text-blue-200">
              <span className="font-mono">{dependent}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
