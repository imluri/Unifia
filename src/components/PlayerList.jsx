import React from 'react';

// Color the ping value by latency band for a quick read on connection quality.
function pingColor(ping) {
  if (ping == null) return 'text-neutral-500';
  if (ping < 60) return 'text-green-400';
  if (ping < 150) return 'text-yellow-400';
  return 'text-red-400';
}

export default function PlayerList({ players = [] }) {
  if (players.length === 0) {
    return <p className="text-sm text-neutral-500">No players connected yet.</p>;
  }
  return (
    <ul className="divide-y divide-white/5 rounded-lg bg-card ring-1 ring-white/5">
      {players.map((p) => (
        <li key={p.id || p.name} className="flex items-center justify-between px-4 py-2">
          <span className="flex items-center gap-2 text-sm text-neutral-200">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            {p.name}
          </span>
          <span className={`text-xs font-mono ${pingColor(p.ping)}`}>
            {p.ping != null ? `${p.ping} ms` : '—'}
          </span>
        </li>
      ))}
    </ul>
  );
}
