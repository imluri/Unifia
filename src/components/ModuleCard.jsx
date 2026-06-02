import React, { useState } from 'react';
import DownloadProgress from './DownloadProgress.jsx';
import { useAppStore } from '../store/useAppStore.js';

const DESCRIPTIONS = {
  bepinex_mono:
    'BepInEx loader for Unity games built on the Mono runtime. The most common target — use this for the majority of Unity titles.',
  bepinex_il2cpp:
    'BepInEx loader for Unity games compiled with IL2CPP. Use the bleeding-edge builds for newer Unity games.',
};

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

// One card per supported module. Handles fetching versions from GitHub, the
// pre-release toggle, installing a selected version (with live progress) and
// managing already-installed versions.
export default function ModuleCard({ moduleId, label }) {
  const installed = useAppStore((s) => s.modules[moduleId]) || { installed: [], active: null };
  const downloads = useAppStore((s) => s.downloads);
  const installModule = useAppStore((s) => s.installModule);
  const uninstallModule = useAppStore((s) => s.uninstallModule);
  const setActiveModule = useAppStore((s) => s.setActiveModule);

  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState('');
  const [showPrerelease, setShowPrerelease] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [error, setError] = useState(null);

  async function fetchVersions(prerelease = showPrerelease) {
    setFetching(true);
    setError(null);
    try {
      const list = await window.unifia.fetchModuleVersions(moduleId, {
        includePrerelease: prerelease,
      });
      setVersions(list);
      // Default to the latest stable (first non-prerelease), else the first.
      const def = list.find((v) => !v.prerelease) || list[0];
      setSelected(def ? def.tag : '');
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  }

  function togglePrerelease(e) {
    const next = e.target.checked;
    setShowPrerelease(next);
    if (versions.length) fetchVersions(next);
  }

  async function doInstall() {
    const v = versions.find((x) => x.tag === selected);
    if (!v) return;
    setInstalling(v.tag);
    setError(null);
    try {
      await installModule(moduleId, v.tag, v.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setInstalling(null);
    }
  }

  const isInstalled = (tag) => installed.installed.some((i) => i.version === tag);
  const progressKey = installing ? `${moduleId}@${installing}` : null;

  return (
    <div className="rounded-lg bg-card p-5 ring-1 ring-white/5">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-lg font-semibold text-neutral-100">{label}</h3>
        {installed.active && (
          <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs text-green-300">
            active {installed.active}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-neutral-400">{DESCRIPTIONS[moduleId]}</p>

      {/* Fetch + version selection */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => fetchVersions()}
          disabled={fetching}
          className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 transition hover:bg-neutral-600 disabled:opacity-50"
        >
          {fetching ? 'Fetching…' : 'Fetch versions'}
        </button>

        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!versions.length}
          className="min-w-[14rem] rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 disabled:opacity-50"
        >
          {!versions.length && <option>— fetch versions first —</option>}
          {versions.map((v) => (
            <option key={v.tag} value={v.tag}>
              {v.tag} · {fmtDate(v.date)}
              {v.prerelease ? ' (pre-release)' : ''}
            </option>
          ))}
        </select>

        <button
          onClick={doInstall}
          disabled={!selected || !!installing}
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
        >
          {isInstalled(selected) ? 'Installed ✓' : installing ? 'Installing…' : 'Install'}
        </button>

        <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
          <input type="checkbox" checked={showPrerelease} onChange={togglePrerelease} />
          Show pre-releases
        </label>
      </div>

      {progressKey && <DownloadProgress progress={downloads[progressKey]} />}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      {/* Installed versions */}
      {installed.installed.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Installed versions
          </h4>
          <ul className="divide-y divide-white/5 rounded bg-neutral-900/40">
            {installed.installed.map((entry) => (
              <li
                key={entry.version}
                className="flex items-center justify-between px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-neutral-200">{entry.version}</span>
                  <span className="text-xs text-neutral-500">{fmtDate(entry.installedAt)}</span>
                  {installed.active === entry.version && (
                    <span className="rounded bg-green-900/60 px-1.5 py-0.5 text-[10px] text-green-300">
                      default
                    </span>
                  )}
                </span>
                <span className="flex gap-2">
                  {installed.active !== entry.version && (
                    <button
                      onClick={() => setActiveModule(null, moduleId, entry.version)}
                      className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-neutral-600"
                    >
                      Set as default
                    </button>
                  )}
                  <button
                    onClick={() => uninstallModule(moduleId, entry.version)}
                    className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-red-900/60"
                  >
                    Uninstall
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
