import React, { useEffect, useState } from 'react';
import Button from './ui/Button.jsx';
import { useAppStore } from '../store/useAppStore.js';

const FEASIBILITY = {
  supported: { label: 'Supported', cls: 'bg-green-900/60 text-green-300' },
  'needs-reroute': { label: 'Needs reroute', cls: 'bg-yellow-900/50 text-yellow-300' },
  unsupported: { label: 'Unsupported', cls: 'bg-red-900/50 text-red-300' },
  unknown: { label: 'Unknown', cls: 'bg-neutral-800 text-neutral-400' },
};
const EXPLAIN = {
  supported: 'Plain Photon rooms — the connector can join by code directly.',
  'needs-reroute': 'Photon + Steam lobbies — hook points found, but a game-specific reroute is still required.',
  unsupported: 'Not a Photon game (or IL2CPP) — the connector can’t drive this netcode.',
  unknown: 'Couldn’t analyze this game’s assembly.',
};

export default function NetcodeCard({ game }) {
  const report = useAppStore((s) => s.analysis[game.id]);
  const analyzeGame = useAppStore((s) => s.analyzeGame);
  const pushToast = useAppStore((s) => s.pushToast);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await analyzeGame(game.id);
    } catch (err) {
      pushToast({ type: 'error', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Auto-run once when the tab opens, if we have no cached report.
  useEffect(() => {
    if (!report && !busy) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const feas = FEASIBILITY[report?.feasibility] || FEASIBILITY.unknown;

  return (
    <section className="rounded border border-border-subtle bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-200">Netcode analysis</h3>
        <Button size="sm" loading={busy} onClick={run}>Analyze</Button>
      </div>
      {!report ? (
        <p className="text-xs text-neutral-500">{busy ? 'Analyzing…' : 'Not analyzed yet.'}</p>
      ) : (
        <div className="space-y-1 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-neutral-300">Netcode: <span className="font-mono">{report.netcode}</span></span>
            {report.usesSteamLobbies && <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">Steam lobbies</span>}
            {report.usesSteamAuth && <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">Steam auth</span>}
            <span className={`rounded px-2 py-0.5 text-[10px] ${feas.cls}`}>{feas.label}</span>
          </div>
          <p className="text-xs text-neutral-500">{EXPLAIN[report?.feasibility] || EXPLAIN.unknown}</p>
          {report.hooks?.join && (
            <p className="text-xs text-neutral-400">
              Join hook: <span className="font-mono text-neutral-300">{report.hooks.join.type}.{report.hooks.join.method}</span>
            </p>
          )}
          {report.reason && <p className="text-xs text-neutral-500">{report.reason}</p>}
        </div>
      )}
    </section>
  );
}
