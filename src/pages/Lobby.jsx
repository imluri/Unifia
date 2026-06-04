import React, { useEffect, useState } from 'react';
import PlayerList from '../components/PlayerList.jsx';
import VersionBadge from '../components/VersionBadge.jsx';
import Icon from '../components/Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

function GamePicker({ games, value, onChange }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-400">Game</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
      >
        <option value="">— select a game —</option>
        {games.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name} (v{String(g.version).replace(/^v/, '')})
          </option>
        ))}
      </select>
    </label>
  );
}

function HostTab() {
  const games = useAppStore((s) => s.games);
  const gameProfiles = useAppStore((s) => s.gameProfiles);
  const session = useAppStore((s) => s.session);
  const players = useAppStore((s) => s.players);
  const hostSession = useAppStore((s) => s.hostSession);
  const stopSession = useAppStore((s) => s.stopSession);
  const launchGame = useAppStore((s) => s.launchGame);

  const [gameId, setGameId] = useState('');
  const [port, setPort] = useState(7777);
  const [localIP, setLocalIP] = useState('…');
  const [error, setError] = useState(null);
  const [revealIP, setRevealIP] = useState(false); // keep the IP hidden by default
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.unifia?.getLocalIP().then(setLocalIP).catch(() => setLocalIP('unknown'));
  }, []);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(`${localIP}:${port}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable */
    }
  }

  const profile = gameProfiles[gameId];
  const hasModule = profile && profile.activeModule && profile.moduleVersion;
  const hosting = session && session.role === 'host';

  async function start() {
    setError(null);
    try {
      await hostSession(gameId, Number(port));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <GamePicker games={games} value={gameId} onChange={setGameId} />
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Port</span>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="rounded bg-neutral-900/40 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">Your local IP:</span>
          <span
            className={`font-mono text-neutral-100 transition ${
              revealIP ? '' : 'select-none blur-sm'
            }`}
          >
            {localIP}:{port}
          </span>
          <button
            onClick={() => setRevealIP((v) => !v)}
            title={revealIP ? 'Hide IP' : 'Show IP'}
            className="flex items-center rounded p-1 text-neutral-400 hover:bg-surface-hover hover:text-neutral-100"
          >
            <Icon name={revealIP ? 'eye-off' : 'eye'} size={15} />
          </button>
          <button
            onClick={copyAddress}
            title="Copy address"
            className="flex items-center rounded p-1 text-neutral-400 hover:bg-surface-hover hover:text-neutral-100"
          >
            <Icon name="copy" size={15} />
          </button>
          {copied && <span className="text-xs text-green-400">Copied</span>}
        </div>
        <p className="mt-1 text-xs text-neutral-500">Share this with friends so they can join.</p>
      </div>

      {gameId && !hasModule && (
        <div className="flex items-center gap-2 rounded bg-yellow-900/40 px-4 py-2 text-sm text-yellow-300">
          <Icon name="triangle-alert" size={16} />
          No module is active for this game. Set one on the Modules page if it needs BepInEx.
        </div>
      )}

      <div className="flex gap-2">
        {!hosting ? (
          <button
            onClick={start}
            disabled={!gameId}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
          >
            Start Hosting
          </button>
        ) : (
          <button
            onClick={stopSession}
            className="rounded bg-red-900/70 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-800"
          >
            Stop Hosting
          </button>
        )}
        {hosting && (
          <button
            onClick={() => launchGame(gameId)}
            className="rounded bg-neutral-700 px-4 py-2 text-sm hover:bg-neutral-600"
          >
            Launch Game
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Room descriptor — the shared room everyone converges on. */}
      {hosting && session?.room && (
        <div className="rounded border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Room code:</span>
            <span className="font-mono font-semibold text-neutral-100">{session.room.roomCode}</span>
          </div>

          {session.room.connectionMode === 'self-hosted' ? (
            <>
              <p className="mt-1 text-xs text-neutral-500">
                Players join this room on your hosted server ({session.room.serverIP}:
                {session.room.port}). Launch the game to connect.
              </p>
              {/* Port-forward (UPnP) status for internet play. */}
              {session.upnp && (
                <div className="mt-2 text-xs">
                  {session.upnp.available && session.upnp.photon?.ok ? (
                    <p className="text-green-400">
                      ✓ Ports auto-forwarded via UPnP (UDP {session.room.port}, TCP {session.port}).
                    </p>
                  ) : (
                    <p className="text-yellow-500">
                      ⚠ Couldn&apos;t auto-forward ports. LAN works as-is; for internet play, forward
                      UDP {session.room.port} and TCP {session.port} on your router.
                    </p>
                  )}
                  {session.room.publicIP && (
                    <p className="mt-1 text-neutral-400">
                      Public IP:{' '}
                      <span className="font-mono text-neutral-200">{session.room.publicIP}</span>{' '}
                      <span className="text-neutral-600">(share for internet play)</span>
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">
              Cloud mode · region <span className="font-mono">{session.room.region}</span>. Friends
              on any store join this room over Photon Cloud — no port-forwarding needed. Launch the
              game to connect.
            </p>
          )}
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-neutral-300">Players</h4>
        <PlayerList players={players} />
      </div>
    </div>
  );
}

function JoinTab() {
  const games = useAppStore((s) => s.games);
  const session = useAppStore((s) => s.session);
  const players = useAppStore((s) => s.players);
  const versionMismatch = useAppStore((s) => s.versionMismatch);
  const joinSession = useAppStore((s) => s.joinSession);
  const stopSession = useAppStore((s) => s.stopSession);
  const launchGame = useAppStore((s) => s.launchGame);

  const [gameId, setGameId] = useState('');
  const [address, setAddress] = useState('');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const connected = session && session.role === 'client';

  async function connect() {
    setError(null);
    setResult(null);
    const [ip, port] = address.split(':');
    if (!ip) {
      setError('Enter an address like 192.168.1.10:7777');
      return;
    }
    try {
      const res = await joinSession(gameId, ip.trim(), Number(port) || 7777);
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <GamePicker games={games} value={gameId} onChange={setGameId} />
        <label className="block text-sm">
          <span className="mb-1 block text-neutral-400">Host IP:PORT</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="192.168.1.10:7777"
            className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        {!connected ? (
          <button
            onClick={connect}
            disabled={!gameId || !address}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
          >
            Connect
          </button>
        ) : (
          <button
            onClick={stopSession}
            className="rounded bg-red-900/70 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-800"
          >
            Disconnect
          </button>
        )}
        {connected && (
          <button
            onClick={() => launchGame(gameId)}
            className="rounded bg-neutral-700 px-4 py-2 text-sm hover:bg-neutral-600"
          >
            Launch Game
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} />
          Ready
        </label>
      </div>

      {/* Version check result */}
      {result && (
        <div className="slide-down rounded bg-neutral-900/40 px-4 py-3 text-sm">
          <span className="text-neutral-400">Version check: </span>
          <VersionBadge version={result.clientVersion} match={result.versionMatch} />
          <span className="mx-2 text-neutral-600">vs host</span>
          <VersionBadge version={result.hostVersion} match={result.versionMatch} />
          {!result.versionMatch && (
            <p className="mt-1 text-xs text-red-400">
              Versions differ — multiplayer may not work until both sides match.
            </p>
          )}
          {result.room && (
            <p className="mt-2 text-xs text-neutral-400">
              Joining room <span className="font-mono text-neutral-200">{result.room.roomCode}</span>{' '}
              on <span className="font-mono">{result.room.serverIP}:{result.room.port}</span>. Launch
              the game to connect.
            </p>
          )}
        </div>
      )}

      {versionMismatch && (
        <div className="slide-down rounded bg-red-900/40 px-4 py-2 text-sm text-red-300">
          Version mismatch reported by host: host {versionMismatch.hostVersion}, you{' '}
          {versionMismatch.clientVersion}.
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <h4 className="mb-2 text-sm font-semibold text-neutral-300">Players</h4>
        <PlayerList players={players} />
      </div>
    </div>
  );
}

export default function Lobby() {
  const [tab, setTab] = useState('host');
  return (
    <div>
      <h1 className="mb-5 text-2xl font-bold text-neutral-100">Lobby</h1>
      <div className="mb-5 inline-flex rounded-lg bg-neutral-800 p-1">
        {['host', 'join'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-4 py-1.5 text-sm font-medium capitalize transition ${
              tab === t
                ? 'bg-accent text-accent-contrast'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {/* Keep both tabs mounted so switching doesn't reset their inputs. */}
      <div className={tab === 'host' ? '' : 'hidden'}>
        <HostTab />
      </div>
      <div className={tab === 'join' ? '' : 'hidden'}>
        <JoinTab />
      </div>
    </div>
  );
}
