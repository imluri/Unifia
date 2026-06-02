import React from 'react';
import ModuleCard from '../components/ModuleCard.jsx';
import { useAppStore } from '../store/useAppStore.js';

// The module manager page. Lists every supported module source as a card; the
// card handles its own fetch/install/uninstall lifecycle.
export default function Modules() {
  const sources = useAppStore((s) => s.moduleSources);
  const dataDir = useAppStore((s) => s.dataDir);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-100">Modules</h1>
        <p className="text-sm text-neutral-500">
          External tools are downloaded on demand from their official sources — nothing is bundled.
        </p>
      </div>

      <div className="space-y-5">
        {sources.map((src) => (
          <ModuleCard key={src.id} moduleId={src.id} label={src.label} />
        ))}
      </div>

      <p className="mt-6 text-xs text-neutral-600">
        Installed to: <span className="font-mono">{dataDir}/modules</span>
      </p>
    </div>
  );
}
