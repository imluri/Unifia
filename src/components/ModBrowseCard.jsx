import React, { useState } from 'react';
import { useAppStore } from '../store/useAppStore.js';

function fmtCount(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n || 0);
}

export default function ModBrowseCard({ game, mod }) {
  const installMod = useAppStore((s) => s.installMod);
  const installed = useAppStore((s) => s.installedMods.find((m) => m.fullName === mod.fullName));
  const progress = useAppStore((s) => s.modProgress[mod.fullName]);

  const [version, setVersion] = useState(mod.latest ? mod.latest.version_number : '');
  const [busy, setBusy] = useState(false);
  const [iconOk, setIconOk] = useState(true);

  async function doInstall() {
    setBusy(true);
    try {
      await installMod(game.id, mod.fullName, version);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-3 rounded bg-card p-3 ring-1 ring-border-subtle">
      {iconOk && mod.icon ? (
        <img src={mod.icon} alt="" onError={() => setIconOk(false)} className="h-14 w-14 shrink-0 rounded object-cover" />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded bg-neutral-700" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-neutral-100">{mod.name}</span>
          <span className="shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 ring-1 ring-border-default">
            {mod.hubLabel}
          </span>
          {mod.deprecated && (
            <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] text-red-300">deprecated</span>
          )}
        </div>
        <div className="text-xs text-neutral-500">
          by {mod.owner} · ▲ {mod.rating} · {fmtCount(mod.totalDownloads)} downloads
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-neutral-400">
          {mod.latest ? mod.latest.description : ''}
        </p>

        <div className="mt-2 flex items-center gap-2">
          {mod.canInstall ? (
            <>
              <select
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="rounded bg-neutral-800 px-2 py-1 text-xs"
              >
                {mod.versions.map((v) => (
                  <option key={v.version_number} value={v.version_number}>
                    {v.version_number}
                  </option>
                ))}
              </select>
              <button
                onClick={doInstall}
                disabled={busy}
                className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {installed ? 'Reinstall' : busy ? 'Installing…' : 'Install'}
              </button>
              {progress && busy && <span className="text-[11px] text-neutral-500">{progress.percent}%</span>}
            </>
          ) : (
            <button
              onClick={() => mod.pageUrl && window.unifia.openExternal(mod.pageUrl)}
              disabled={!mod.pageUrl}
              className="rounded bg-neutral-700 px-3 py-1 text-xs text-neutral-100 transition hover:bg-surface-hover disabled:opacity-50"
            >
              View on {mod.hubLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
