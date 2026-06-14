import React, { useEffect, useState } from 'react';
import ConnectorStatus from '../components/ConnectorStatus.jsx';
import { useAppStore } from '../store/useAppStore.js';

// In-room status for a game: connector install state, the optional official-AppId
// used for edition labels, and the live player list. Generating/pasting invite
// codes lives in the header's InviteModal.
export default function MultiplayerTab({ game }) {
  const profile = useAppStore((s) => s.gameProfiles[game.id]) || {};
  const saveGameProfile = useAppStore((s) => s.saveGameProfile);
  const players = useAppStore((s) => s.connectorPlayers[game.id]);
  const refreshConnectorPlayers = useAppStore((s) => s.refreshConnectorPlayers);

  const [officialAppId, setOfficialAppId] = useState(profile.officialAppId || '');

  // Poll the connector status file while the tab is open (populated once the
  // game is running and the connector has joined).
  useEffect(() => {
    refreshConnectorPlayers(game.id);
    const t = setInterval(() => refreshConnectorPlayers(game.id), 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  async function saveOfficialAppId() {
    await saveGameProfile(game.id, { officialAppId: officialAppId.trim() });
  }

  return (
    <div className="flex flex-col gap-5">
      <ConnectorStatus gameId={game.id} />

      <p className="text-xs text-neutral-500">
        Generate or paste an invite code from the <span className="text-neutral-300">Invite</span>{' '}
        button in the header.
      </p>

      {/* Edition labeling */}
      <section className="rounded border border-border-subtle bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold text-neutral-200">Edition labeling</h3>
        <label className="block text-xs text-neutral-400">
          Official AppId (optional — labels players official vs modded)
          <input
            value={officialAppId}
            onChange={(e) => setOfficialAppId(e.target.value)}
            onBlur={saveOfficialAppId}
            placeholder="leave blank to group by raw AppId"
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none"
          />
        </label>
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
    </div>
  );
}
