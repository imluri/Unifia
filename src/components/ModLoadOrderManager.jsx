import React, { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function ModLoadOrderManager({ game }) {
  const modLoadOrder = useAppStore((s) => s.modLoadOrder);
  const setModLoadOrder = useAppStore((s) => s.setModLoadOrder);
  const installedMods = useAppStore((s) => s.installedMods);
  const [draggedFrom, setDraggedFrom] = useState(null);
  const [showManager, setShowManager] = useState(false);

  // Filter to enabled mods for load order (disabled mods don't load)
  const enabledMods = modLoadOrder.filter((m) => m.enabled).sort((a, b) => a.loadOrder - b.loadOrder);

  function handleDragStart(e, index) {
    setDraggedFrom(index);
    e.dataTransfer.effectAllowed = 'move';
  }

  async function handleDrop(e, targetIndex) {
    e.preventDefault();
    if (draggedFrom === null || draggedFrom === targetIndex) {
      setDraggedFrom(null);
      return;
    }

    const newOrder = [...enabledMods];
    const [dragged] = newOrder.splice(draggedFrom, 1);
    newOrder.splice(targetIndex, 0, dragged);

    const orderedNames = newOrder.map((m) => m.fullName);
    await setModLoadOrder(game.id, orderedNames);
    setDraggedFrom(null);
  }

  if (enabledMods.length === 0) return null;

  return (
    <div className="rounded bg-card ring-1 ring-border-subtle">
      <button
        onClick={() => setShowManager(!showManager)}
        className="flex w-full items-center gap-2 px-3 py-2.5 hover:bg-surface-hover"
      >
        <Icon name={showManager ? 'chevron-down' : 'chevron-right'} size={16} />
        <span className="text-sm font-semibold text-neutral-300">
          Mod Load Order <span className="ml-2 text-xs text-neutral-500">({enabledMods.length} active)</span>
        </span>
      </button>

      {showManager && (
        <div className="border-t border-border-subtle px-3 py-2">
          <p className="mb-2 text-xs text-neutral-400">Drag mods to reorder (affects load priority)</p>
          <div className="space-y-1">
            {enabledMods.map((mod, index) => (
              <div
                key={mod.fullName}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, index)}
                className={`flex items-center gap-2 rounded px-2 py-1.5 cursor-move transition ${
                  draggedFrom === index
                    ? 'bg-accent/30 opacity-50'
                    : 'bg-neutral-800/50 hover:bg-neutral-800'
                }`}
              >
                <Icon name="grip-vertical" size={14} className="text-neutral-500" />
                <span className="text-xs font-mono text-neutral-300 flex-1">{mod.fullName}</span>
                <span className="text-[10px] text-neutral-500">#{index + 1}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-neutral-500">
            💡 Lower numbers load first. Some mods require specific order to function.
          </p>
        </div>
      )}
    </div>
  );
}
