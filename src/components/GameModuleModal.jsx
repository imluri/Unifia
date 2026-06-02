import React, { useState } from 'react';
import Icon from './Icon.jsx';
import DownloadProgress from './DownloadProgress.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Map a game's detected Unity backend to the module it needs.
const BACKEND_TO_MODULE = { mono: 'bepinex_mono', il2cpp: 'bepinex_il2cpp' };
const MODULE_LABEL = {
  bepinex_mono: 'BepInEx (Mono)',
  bepinex_il2cpp: 'BepInEx (IL2CPP)',
};

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

// Per-game module configuration. A module has to be activated for each game
// individually (it's written into that game's profile), so this lives in a
// modal launched from the game card rather than on the global Modules page.
export default function GameModuleModal({ game, onClose, onManageAll }) {
  const modules = useAppStore((s) => s.modules);
  const profiles = useAppStore((s) => s.gameProfiles);
  const downloads = useAppStore((s) => s.downloads);
  const installModule = useAppStore((s) => s.installModule);
  const setActiveModule = useAppStore((s) => s.setActiveModule);

  const recommended = BACKEND_TO_MODULE[game?.unityBackend] || 'bepinex_mono';
  const [moduleId, setModuleId] = useState(recommended);
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState('');
  const [showPrerelease, setShowPrerelease] = useState(recommended === 'bepinex_il2cpp');
  const [fetching, setFetching] = useState(false);
  const [installing, setInstalling] = useState(null);
  const [error, setError] = useState(null);

  if (!game) return null;

  const profile = profiles[game.id] || {};
  const installed = modules[moduleId] || { installed: [], active: null };
  // What's currently active for THIS game (may be a different module type).
  const gameActive =
    profile.activeModule && profile.moduleVersion
      ? { module: profile.activeModule, version: profile.moduleVersion }
      : null;

  function switchModule(id) {
    setModuleId(id);
    setVersions([]);
    setSelected('');
    setError(null);
    setShowPrerelease(id === 'bepinex_il2cpp');
  }

  async function fetchVersions(prerelease = showPrerelease) {
    setFetching(true);
    setError(null);
    try {
      const list = await window.unifia.fetchModuleVersions(moduleId, {
        includePrerelease: prerelease,
      });
      setVersions(list);
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

  // Install a version, then immediately activate it for this game.
  async function installForGame() {
    const v = versions.find((x) => x.tag === selected);
    if (!v) return;
    setInstalling(v.tag);
    setError(null);
    try {
      await installModule(moduleId, v.tag, v.url);
      await setActiveModule(game.id, moduleId, v.tag);
    } catch (err) {
      setError(err.message);
    } finally {
      setInstalling(null);
    }
  }

  async function useForGame(version) {
    setError(null);
    try {
      await setActiveModule(game.id, moduleId, version);
    } catch (err) {
      setError(err.message);
    }
  }

  const progressKey = installing ? `${moduleId}@${installing}` : null;
  const knownBackend = game.unityBackend && game.unityBackend !== 'unknown';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-[34rem] flex-col rounded-lg bg-card ring-1 ring-white/10">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-neutral-100">{game.name}</h3>
            <p className="text-xs text-neutral-500">Configure mod loader for this game</p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center rounded p-1 text-neutral-400 hover:bg-surface-hover hover:text-neutral-100"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          {/* Active-for-this-game status */}
          <div className="rounded bg-neutral-900/40 px-3 py-2 text-sm">
            <span className="text-neutral-400">Active for this game: </span>
            {gameActive ? (
              <span className="font-medium text-green-400">
                {MODULE_LABEL[gameActive.module] || gameActive.module} {gameActive.version}
              </span>
            ) : (
              <span className="text-neutral-500">None</span>
            )}
          </div>

          {/* Module type selector (recommended by detected backend) */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Loader type
              </span>
              {game.engineName && game.engine !== 'unknown' && (
                <span className="text-[11px] text-neutral-500">Engine: {game.engineName}</span>
              )}
            </div>
            <div className="flex gap-2">
              {['bepinex_mono', 'bepinex_il2cpp'].map((id) => (
                <button
                  key={id}
                  onClick={() => switchModule(id)}
                  className={`flex-1 rounded border px-3 py-2 text-sm transition ${
                    moduleId === id
                      ? 'border-accent bg-accent/10 text-neutral-100'
                      : 'border-border-default text-neutral-400 hover:border-border-strong'
                  }`}
                >
                  {MODULE_LABEL[id]}
                  {recommended === id && knownBackend && (
                    <span className="ml-1 text-[10px] text-green-400">• recommended</span>
                  )}
                </button>
              ))}
            </div>
            {game.engine && game.engine !== 'unity' && game.engine !== 'unknown' && (
              <p className="mt-1.5 text-[11px] text-yellow-500/80">
                This looks like a {game.engineName} game — BepInEx targets Unity, so it may not apply
                here.
              </p>
            )}
          </div>

          {/* Already-installed versions: activate one for this game */}
          {installed.installed.length > 0 && (
            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Installed versions
              </span>
              <ul className="divide-y divide-white/5 rounded bg-neutral-900/40">
                {installed.installed.map((entry) => {
                  const activeHere =
                    gameActive &&
                    gameActive.module === moduleId &&
                    gameActive.version === entry.version;
                  return (
                    <li
                      key={entry.version}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-neutral-200">{entry.version}</span>
                        <span className="text-xs text-neutral-500">{fmtDate(entry.installedAt)}</span>
                      </span>
                      {activeHere ? (
                        <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs text-green-300">
                          active ✓
                        </span>
                      ) : (
                        <button
                          onClick={() => useForGame(entry.version)}
                          className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover"
                        >
                          Use for this game
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Install a new version (downloaded on demand, then activated here) */}
          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Install a version
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => fetchVersions()}
                disabled={fetching}
                className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover disabled:opacity-50"
              >
                {fetching ? 'Fetching…' : 'Fetch versions'}
              </button>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={!versions.length}
                className="min-w-[12rem] flex-1 rounded bg-neutral-800 px-2 py-1.5 text-sm disabled:opacity-50"
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
                onClick={installForGame}
                disabled={!selected || !!installing}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
              >
                {installing ? 'Installing…' : 'Install & use'}
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
              <input type="checkbox" checked={showPrerelease} onChange={togglePrerelease} />
              Show pre-releases {moduleId === 'bepinex_il2cpp' && '(needed for most IL2CPP builds)'}
            </label>
            {progressKey && <DownloadProgress progress={downloads[progressKey]} />}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-3">
          {onManageAll ? (
            <button
              onClick={() => {
                onClose();
                onManageAll();
              }}
              className="text-xs text-neutral-500 underline hover:text-neutral-300"
            >
              Manage all versions →
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            className="rounded bg-neutral-700 px-4 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
