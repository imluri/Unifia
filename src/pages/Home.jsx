import React, { useState } from 'react';
import GameCard from '../components/GameCard.jsx';
import Icon from '../components/Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Simple modal for manually adding a game by name + executable path.
function ManualAddModal({ open, onClose, onAdd }) {
  const [name, setName] = useState('');
  const [executablePath, setExecutablePath] = useState('');
  const [version, setVersion] = useState('');
  const [store, setStore] = useState('custom');

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60">
      <div className="w-[28rem] rounded-lg bg-card p-5 ring-1 ring-white/10">
        <h3 className="mb-4 text-lg font-semibold">Add game manually</h3>
        <div className="space-y-3">
          <Field label="Name" value={name} onChange={setName} placeholder="REPO" />
          <Field
            label="Executable path"
            value={executablePath}
            onChange={setExecutablePath}
            placeholder="C:/Games/REPO/REPO.exe"
          />
          <Field label="Version (optional)" value={version} onChange={setVersion} placeholder="auto-detect" />
          <label className="block text-sm">
            <span className="mb-1 block text-neutral-400">Store</span>
            <select
              value={store}
              onChange={(e) => setStore(e.target.value)}
              className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm"
            >
              <option value="steam">Steam</option>
              <option value="gog">GOG</option>
              <option value="epic">Epic</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded bg-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-600">
            Cancel
          </button>
          <button
            onClick={() => {
              if (!name || !executablePath) return;
              onAdd({ name, executablePath, version, store });
              setName('');
              setExecutablePath('');
              setVersion('');
            }}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-600"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-neutral-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded bg-neutral-800 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-accent"
      />
    </label>
  );
}

export default function Home({ goToModules }) {
  const games = useAppStore((s) => s.games);
  const gameProfiles = useAppStore((s) => s.gameProfiles);
  const rescan = useAppStore((s) => s.rescan);
  const addManualGame = useAppStore((s) => s.addManualGame);
  const removeGame = useAppStore((s) => s.removeGame);
  const launchGame = useAppStore((s) => s.launchGame);

  const [scanning, setScanning] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState(null);

  async function handleScan() {
    setScanning(true);
    try {
      await rescan();
    } finally {
      setScanning(false);
    }
  }

  async function handleLaunch(game) {
    try {
      const res = await launchGame(game.id);
      setNotice(
        res.alreadyRunning
          ? `${game.name} is already running.`
          : `Launched ${game.name}${res.deployedModule ? ` with ${res.deployedModule.module} ${res.deployedModule.version}` : ''}.`
      );
    } catch (err) {
      setNotice(`Launch failed: ${err.message}`);
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100">Library</h1>
          <p className="text-sm text-neutral-500">{games.length} games detected</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="flex items-center gap-2 rounded bg-neutral-700 px-4 py-2 text-sm text-neutral-100 hover:bg-neutral-600 disabled:opacity-50"
          >
            <Icon name="refresh-cw" size={15} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning…' : 'Rescan'}
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            <Icon name="plus" size={16} />
            Add game
          </button>
        </div>
      </div>

      {notice && (
        <div className="mb-4 rounded bg-neutral-800 px-4 py-2 text-sm text-neutral-200">
          {notice}
        </div>
      )}

      {games.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-10 text-center text-neutral-500">
          No games found. Try <button onClick={handleScan} className="text-accent underline">rescanning</button> or add one manually.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              profile={gameProfiles[game.id]}
              onLaunch={handleLaunch}
              onRemove={(g) => removeGame(g.id)}
              onConfigure={goToModules}
            />
          ))}
        </div>
      )}

      <ManualAddModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onAdd={async (game) => {
          await addManualGame(game);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
