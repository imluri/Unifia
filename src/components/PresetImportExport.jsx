import React, { useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Button from './ui/Button.jsx';
import { exportPreset, importPreset, downloadPreset } from '../lib/presetExport.js';
import { useAppStore } from '../store/useAppStore.js';

export default function PresetImportExport({ game, presetName, mods }) {
  const pushToast = useAppStore((s) => s.pushToast);
  const fileInputRef = useRef(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  function handleExport() {
    try {
      const json = exportPreset(presetName, mods, {
        game: game.name,
        gameId: game.id,
        modCount: Object.keys(mods).length,
      });
      const filename = `${presetName.replace(/\s+/g, '-')}-${Date.now()}.json`;
      downloadPreset(json, filename);
      pushToast({ type: 'success', message: `Preset exported as ${filename}` });
      setShowMenu(false);
    } catch (err) {
      pushToast({ type: 'error', message: `Export failed: ${err.message}` });
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const imported = importPreset(text);
      
      // Return the imported preset data to parent
      pushToast({ 
        type: 'success', 
        message: `Preset loaded: ${imported.mods.length} mods ready to import` 
      });
      
      // Store in a way parent can access
      window.unifia?.importedPreset?.(imported);
    } catch (err) {
      pushToast({ type: 'error', message: `Import failed: ${err.message}` });
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImportFile}
        className="hidden"
        disabled={isImporting}
      />

      <button
        onClick={() => setShowMenu(!showMenu)}
        className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
        title="Export or import preset"
      >
        <Icon name="download" size={14} className="inline mr-1" />
        Preset
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full mt-1 z-10 rounded bg-surface ring-1 ring-border-subtle shadow-lg">
          <button
            onClick={handleExport}
            className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-hover"
          >
            <Icon name="download" size={12} className="inline mr-2" />
            Export
          </button>
          <button
            onClick={handleImportClick}
            disabled={isImporting}
            className="block w-full px-3 py-2 text-left text-xs hover:bg-surface-hover disabled:opacity-50"
          >
            <Icon name="upload" size={12} className="inline mr-2" />
            Import
          </button>
        </div>
      )}
    </div>
  );
}
