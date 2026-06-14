import React, { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function PresetBar({ game }) {
  const data = useAppStore((s) => s.presets[game.id]);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const createPreset = useAppStore((s) => s.createPreset);
  const renamePreset = useAppStore((s) => s.renamePreset);
  const deletePreset = useAppStore((s) => s.deletePreset);
  const updatePreset = useAppStore((s) => s.updatePreset);
  const switchPreset = useAppStore((s) => s.switchPreset);
  const exportPreset = useAppStore((s) => s.exportPreset);
  const importPreset = useAppStore((s) => s.importPreset);

  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  // Inline naming (Electron disables window.prompt): mode is 'new' | 'rename' | null.
  const [nameMode, setNameMode] = useState(null);
  const [nameVal, setNameVal] = useState('');

  useEffect(() => {
    if (!data) loadPresets(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  if (!data) return null;
  const active = data.presets.find((p) => p.id === data.activeId);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openName(mode) {
    setNameMode(mode);
    setNameVal(mode === 'rename' && active ? active.name : '');
  }

  async function submitName() {
    const name = nameVal.trim();
    if (!name) return;
    if (nameMode === 'new') await createPreset(game.id, name, true); // snapshot current
    else if (nameMode === 'rename') await renamePreset(game.id, data.activeId, name);
    setNameMode(null);
    setNameVal('');
  }

  return (
    <div className="mb-3 rounded border border-border-default bg-neutral-900/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Preset</span>
        <select
          value={data.activeId}
          disabled={busy}
          onChange={(e) => run(() => switchPreset(game.id, e.target.value, game))}
          className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        >
          {data.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.modCount})</option>
          ))}
        </select>

        <button onClick={() => openName('new')} disabled={busy} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          New
        </button>
        <button onClick={() => run(() => updatePreset(game.id, data.activeId))} disabled={busy}
          title="Save the current mods into this preset"
          className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Save
        </button>
        <button onClick={() => openName('rename')} disabled={busy} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Rename
        </button>
        <button onClick={() => run(async () => {
          if (data.presets.length <= 1) throw new Error('Cannot delete the last preset');
          if (window.confirm(`Delete preset "${active ? active.name : ''}"?`)) await deletePreset(game.id, data.activeId);
        })} disabled={busy} className="rounded bg-neutral-800 px-2 py-1 text-xs text-red-300 hover:bg-red-900/60 disabled:opacity-50">
          Delete
        </button>

        <span className="mx-1 h-4 w-px bg-border-default" />

        <button onClick={() => run(async () => {
          const c = await exportPreset(game.id, data.activeId);
          await navigator.clipboard.writeText(c);
        })} disabled={busy} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Copy code
        </button>
        <button onClick={() => setImporting((v) => !v)} disabled={busy}
          className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover disabled:opacity-50">
          Import code
        </button>
      </div>

      {nameMode && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run(submitName)}
            placeholder={nameMode === 'new' ? 'New preset name…' : 'Rename preset…'}
            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none"
          />
          <button onClick={() => run(submitName)} disabled={busy || !nameVal.trim()}
            className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast disabled:opacity-50">
            {nameMode === 'new' ? 'Create' : 'Save'}
          </button>
          <button onClick={() => setNameMode(null)} className="rounded bg-neutral-700 px-2 py-1 text-xs text-neutral-100 hover:bg-surface-hover">
            Cancel
          </button>
        </div>
      )}

      {importing && (
        <div className="mt-2 flex items-center gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="paste preset code…"
            className="flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs text-neutral-100 outline-none" />
          <button onClick={() => run(async () => {
            await importPreset(game.id, code.trim(), undefined, game);
            setCode(''); setImporting(false);
          })} disabled={busy || !code.trim()}
            className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast disabled:opacity-50">
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      )}

      {busy && <p className="mt-1 text-xs text-neutral-500"><Icon name="refresh-cw" size={11} className="inline animate-spin" /> Working…</p>}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
