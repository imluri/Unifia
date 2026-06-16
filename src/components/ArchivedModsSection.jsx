import React, { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function ArchivedModsSection({ game }) {
  const listArchivedMods = useAppStore((s) => s.listArchivedMods);
  const restoreArchivedMod = useAppStore((s) => s.restoreArchivedMod);
  const [archived, setArchived] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (expanded && archived.length === 0) {
      loadArchived();
    }
  }, [expanded]);

  async function loadArchived() {
    setLoading(true);
    try {
      const list = await listArchivedMods(game.id);
      setArchived(list || []);
    } catch (err) {
      console.error('Failed to list archived mods:', err);
      setArchived([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(fullName) {
    try {
      await restoreArchivedMod(game.id, fullName);
      setArchived(archived.filter((m) => m.fullName !== fullName));
    } catch (err) {
      console.error('Failed to restore mod:', err);
    }
  }

  return (
    <div className="rounded bg-card ring-1 ring-border-subtle">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-surface-hover"
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={16} />
        <span className="text-sm font-semibold text-neutral-300">
          Archived Mods {archived.length > 0 && <span className="ml-2 text-xs text-neutral-500">({archived.length})</span>}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border-subtle px-3 py-2">
          {loading ? (
            <p className="text-xs text-neutral-500">Loading archived mods…</p>
          ) : archived.length === 0 ? (
            <p className="text-xs text-neutral-500">No archived mods. Disabled or deleted mods will appear here.</p>
          ) : (
            <div className="space-y-2">
              {archived.map((mod) => (
                <div
                  key={mod.fullName}
                  className="flex items-center justify-between gap-2 rounded bg-neutral-800/50 px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-neutral-300">{mod.fullName}</p>
                    <p className="text-[10px] text-neutral-500">Archived — safe to restore</p>
                  </div>
                  <button
                    onClick={() => handleRestore(mod.fullName)}
                    className="shrink-0 rounded bg-blue-900/60 px-2 py-0.5 text-xs text-blue-300 hover:bg-blue-900/80"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
