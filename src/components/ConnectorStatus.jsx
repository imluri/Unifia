import React, { useEffect, useState } from 'react';
import ConnectorBadge from './ConnectorBadge.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Connector install/status surface for a single game, used by both Lobby tabs.
// The connector is what repoints Photon at the shared room, so the Lobby is its
// home. Renders nothing until a game is selected.
export default function ConnectorStatus({ gameId }) {
  const status = useAppStore((s) => s.connector[gameId]);
  const refreshConnector = useAppStore((s) => s.refreshConnector);
  const installConnector = useAppStore((s) => s.installConnector);
  const uninstallConnector = useAppStore((s) => s.uninstallConnector);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (gameId) refreshConnector(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  if (!gameId) return null;

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn(gameId);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const installed = status?.pluginInstalled;
  const available = status?.available;

  return (
    <div className="rounded border border-border-default bg-neutral-900/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ConnectorBadge />
          {installed && (
            <span className="rounded bg-green-900/60 px-2 py-0.5 text-xs text-green-300">
              Installed ✓
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status === undefined ? (
            <span className="text-xs text-neutral-500">Checking…</span>
          ) : !available ? (
            <span className="text-xs text-yellow-500/80">Not built</span>
          ) : !installed ? (
            <button
              onClick={() => act(installConnector)}
              disabled={busy}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95 disabled:opacity-50"
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
          ) : (
            <>
              <button
                onClick={() => act(installConnector)}
                disabled={busy}
                title="Copy the latest built DLL over the installed one"
                className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover disabled:opacity-50"
              >
                Reinstall
              </button>
              <button
                onClick={() => act(uninstallConnector)}
                disabled={busy}
                className="rounded bg-neutral-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/60 disabled:opacity-50"
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">
        {!available
          ? 'Plugin not built — run dotnet build in mod/UnifiaPun.'
          : !installed
            ? 'Required for Unifia multiplayer — repoints the game at the shared room.'
            : status && !status.bepinexInstalled
              ? "BepInEx isn't in the game folder yet — it deploys on launch and the plugin loads then."
              : 'Repoints the game at the shared Unifia room on launch.'}
      </p>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
