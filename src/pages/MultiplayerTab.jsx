import React, { useEffect, useState } from 'react';
import ConnectorStatus from '../components/ConnectorStatus.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function MultiplayerTab({ game }) {
  const profile = useAppStore((s) => s.gameProfiles[game.id]) || {};
  const settings = useAppStore((s) => s.settings);
  const saveGameProfile = useAppStore((s) => s.saveGameProfile);
  const buildInvite = useAppStore((s) => s.buildInvite);
  const applyInvite = useAppStore((s) => s.applyInvite);
  const installMod = useAppStore((s) => s.installMod);
  const loadMods = useAppStore((s) => s.loadMods);
  const players = useAppStore((s) => s.connectorPlayers[game.id]);
  const refreshConnectorPlayers = useAppStore((s) => s.refreshConnectorPlayers);

  // Migration: fall back to the old global Settings AppId if this game has none yet.
  const [appId, setAppId] = useState(profile.photonAppId || settings?.photonAppId || '');
  const [officialAppId, setOfficialAppId] = useState(profile.officialAppId || '');
  const [room, setRoom] = useState('');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState('');
  const [diff, setDiff] = useState(null);
  const [importInfo, setImportInfo] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  // Poll the connector status file while the tab is open (populated once the
  // game is running and the connector has joined).
  useEffect(() => {
    refreshConnectorPlayers(game.id);
    const t = setInterval(() => refreshConnectorPlayers(game.id), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  async function saveIds() {
    await saveGameProfile(game.id, { photonAppId: appId.trim(), officialAppId: officialAppId.trim() });
  }

  async function onGenerate() {
    setError(null);
    try {
      await saveIds();
      const res = await buildInvite(game.id, { appId: appId.trim(), room: room.trim() });
      setCode(res.code);
      setRoom(res.room);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  async function onImport() {
    setError(null);
    setDiff(null);
    setImportInfo(null);
    try {
      const res = await applyInvite(game.id, paste.trim());
      setDiff(res.diff);
      setImportInfo(res);
      setAppId(res.descriptor.appId);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onSync() {
    if (!diff) return;
    setSyncing(true);
    setError(null);
    try {
      for (const m of [...diff.toInstall, ...diff.toUpdate]) {
        await installMod(game.id, m.fullName, m.to || m.version);
      }
      await loadMods(game);
      setDiff({ toInstall: [], toUpdate: [], ok: [...diff.ok, ...diff.toInstall, ...diff.toUpdate] });
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const pendingCount = diff ? diff.toInstall.length + diff.toUpdate.length : 0;

  return (
    <div className="flex flex-col gap-5">
      <ConnectorStatus gameId={game.id} />

      {/* Photon identity */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Photon</h3>
        <label className="mb-2 block text-xs text-neutral-400">
          AppId (the Photon app everyone shares)
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            onBlur={saveIds}
            placeholder="xxxxxxxx-xxxx-…"
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <label className="block text-xs text-neutral-400">
          Official AppId (optional — labels players official vs modded)
          <input
            value={officialAppId}
            onChange={(e) => setOfficialAppId(e.target.value)}
            onBlur={saveIds}
            placeholder="leave blank to group by raw AppId"
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
      </section>

      {/* Your invite */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Your invite</h3>
        <div className="flex items-center gap-2">
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="room code (auto)"
            className="w-40 rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={onGenerate}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 active:scale-95"
          >
            Generate
          </button>
        </div>
        {code && (
          <div className="mt-3">
            <textarea
              readOnly
              value={code}
              rows={3}
              className="w-full resize-none rounded bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-300"
            />
            <button
              onClick={onCopy}
              className="mt-2 rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover"
            >
              {copied ? 'Copied ✓' : 'Copy invite'}
            </button>
            <p className="mt-1 text-xs text-neutral-500">
              Share this string. Friends paste it below, sync mods, and launch.
            </p>
          </div>
        )}
      </section>

      {/* Join a friend */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Join a friend</h3>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder="paste a friend's invite code…"
          className="w-full resize-none rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-neutral-100 outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          onClick={onImport}
          disabled={!paste.trim()}
          className="mt-2 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
        >
          Import
        </button>

        {importInfo && diff && (
          <div className="mt-3 rounded bg-neutral-900/40 px-3 py-2 text-sm">
            <p className="text-neutral-300">
              Room <span className="font-mono text-neutral-100">{importInfo.descriptor.room}</span> ·
              host v{importInfo.hostVersion}
              {importInfo.hostVersion !== importInfo.localVersion && (
                <span className="ml-1 text-yellow-400">(you have v{importInfo.localVersion})</span>
              )}
            </p>
            <p className="mt-1 text-neutral-400">
              Mods: {diff.toInstall.length} to install, {diff.toUpdate.length} to update,{' '}
              {diff.ok.length} match.
            </p>
            {pendingCount > 0 ? (
              <button
                onClick={onSync}
                disabled={syncing}
                className="mt-2 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : `Sync ${pendingCount} mod${pendingCount === 1 ? '' : 's'}`}
              </button>
            ) : (
              <p className="mt-2 text-green-400">Ready — launch from the header.</p>
            )}
          </div>
        )}
      </section>

      {/* Players (from the connector status file, when running) */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Players in room</h3>
        {!players || !players.joined ? (
          <p className="text-xs text-neutral-500">Launch the game to see who&apos;s in the room.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[players.self, ...players.players].filter(Boolean).map((p, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span className="text-neutral-200">{p.nick || 'Player'}</span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] ${
                    p.edition === 'official'
                      ? 'bg-green-900/60 text-green-300'
                      : p.edition === 'modded'
                        ? 'bg-yellow-900/50 text-yellow-300'
                        : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {p.edition}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
