import React, { useEffect, useState, useRef } from 'react';
import Button from './ui/Button.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';
import { exportPreset as exportPresetToJson, importPreset as importPresetFromJson, downloadPreset } from '../lib/presetExport.js';
import { useAppStore } from '../store/useAppStore.js';

export default function PresetBar({ game }) {
  const data = useAppStore((s) => s.presets[game.id]);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const createPreset = useAppStore((s) => s.createPreset);
  const renamePreset = useAppStore((s) => s.renamePreset);
  const deletePreset = useAppStore((s) => s.deletePreset);
  const switchPreset = useAppStore((s) => s.switchPreset);
  const exportPreset = useAppStore((s) => s.exportPreset);
  const importPreset = useAppStore((s) => s.importPreset);
  const pushToast = useAppStore((s) => s.pushToast);
  const installedMods = useAppStore((s) => s.installedMods);

  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [code, setCode] = useState('');
  const [nameMode, setNameMode] = useState(null); // 'new' | 'rename' | null
  const [nameVal, setNameVal] = useState('');

  useEffect(() => {
    if (!data) loadPresets(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  if (!data) return null;
  const active = data.presets.find((p) => p.id === data.activeId);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      pushToast({ type: 'error', message: err.message || String(err) });
    } finally {
      setBusy(false);
    }
  }

  function openName(mode) {
    setNameMode(mode);
    setNameVal(mode === 'rename' && active ? active.name : '');
  }

  function handleExportFile() {
    if (!data) return;
    const activeName = data.presets.find((p) => p.id === data.activeId)?.name || 'preset';
    const mods = Object.fromEntries(installedMods.map((m) => [m.fullName, {
      version: m.version,
      enabled: m.enabled,
      loadOrder: m.loadOrder || 0,
    }]));
    const json = exportPresetToJson(activeName, mods, {
      game: game.name,
      gameId: game.id,
      modCount: installedMods.length,
    });
    const filename = `${activeName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`;
    downloadPreset(json, filename);
    pushToast({ type: 'success', message: `Preset exported as ${filename}` });
  }

  function handleImportFileClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const imported = importPresetFromJson(text);
      const name = imported.name || undefined;
      await importPreset(game.id, text, name, game);
      pushToast({ type: 'success', message: `Imported preset ${imported.name || 'file'} (${imported.mods.length} mods).` });
    } catch (err) {
      pushToast({ type: 'error', message: err.message || String(err) });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function submitName() {
    const name = nameVal.trim();
    if (!name) return;
    if (nameMode === 'new') {
      await createPreset(game.id, name, true, game);
      pushToast({ type: 'success', message: `Switched to new preset “${name}”.` });
    } else {
      await renamePreset(game.id, data.activeId, name);
      pushToast({ type: 'info', message: `Renamed to “${name}”.` });
    }
    setNameMode(null);
    setNameVal('');
  }

  return (
    <div className="mb-3 rounded border border-border-default bg-neutral-900/40 px-3 py-2.5">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleImportFile}
        className="hidden"
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Preset</span>
        <select
          value={data.activeId}
          disabled={busy}
          onChange={(e) =>
            run(async () => {
              const name = data.presets.find((p) => p.id === e.target.value)?.name;
              await switchPreset(game.id, e.target.value, game);
              pushToast({ type: 'success', message: `Switched to “${name}”.` });
            })
          }
          className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        >
          {data.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.modCount})</option>
          ))}
        </select>

        <Button size="sm" icon="plus" disabled={busy} onClick={() => openName('new')} title="New preset from current mods" />
        <Button size="sm" icon="pencil" disabled={busy} onClick={() => openName('rename')} title="Rename preset" />
        <Button size="sm" variant="danger" icon="trash-2" disabled={busy} onClick={() => setConfirmDelete(true)} title="Delete preset" />

        <span className="mx-1 h-4 w-px bg-border-default" />

        <Button size="sm" icon="download" disabled={busy} onClick={handleExportFile}>Export file</Button>
        <Button size="sm" icon="upload" disabled={busy} onClick={handleImportFileClick}>Import file</Button>
        <Button size="sm" icon="copy" disabled={busy}
          onClick={() => run(async () => {
            const c = await exportPreset(game.id, data.activeId);
            await navigator.clipboard.writeText(c);
            pushToast({ type: 'success', message: 'Preset code copied.' });
          })}>
          Copy code
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setImporting((v) => !v)}>Import code</Button>
        {busy && <span className="text-xs text-neutral-500">Working…</span>}
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
          <Button size="sm" variant="primary" disabled={busy || !nameVal.trim()} onClick={() => run(submitName)}>
            {nameMode === 'new' ? 'Create' : 'Save'}
          </Button>
          <Button size="sm" onClick={() => setNameMode(null)}>Cancel</Button>
        </div>
      )}

      {importing && (
        <div className="mt-2 flex items-center gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="paste preset code…"
            className="flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs text-neutral-100 outline-none" />
          <Button size="sm" variant="primary" loading={busy} disabled={busy || !code.trim()}
            onClick={() => run(async () => {
              await importPreset(game.id, code.trim(), undefined, game);
              setCode(''); setImporting(false);
              pushToast({ type: 'success', message: 'Imported preset.' });
            })}>
            Import
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete preset"
        danger
        confirmLabel="Delete"
        loading={busy}
        message={`Delete “${active ? active.name : ''}”? This removes its mod set.${data.presets.length <= 1 ? ' Since this is your only preset, it resets to an empty Default.' : ''}`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(async () => {
            await deletePreset(game.id, data.activeId, game);
            setConfirmDelete(false);
            pushToast({ type: 'info', message: 'Preset deleted.' });
          })
        }
      />
    </div>
  );
}
