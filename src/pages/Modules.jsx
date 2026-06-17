import React from 'react';

export default function Modules() {
  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-neutral-100">Modules</h1>
        <p className="text-sm text-neutral-500">
          The module system has been disabled. BepInEx is now exclusively installed via Thunderstore mods.
        </p>
      </div>

      <div className="rounded-lg border border-yellow-900/50 bg-yellow-900/20 p-6 text-center text-sm text-yellow-300">
        <p className="mb-3">To use BepInEx with your games, install the BepInExPack mod from Thunderstore.</p>
        <button
          onClick={() => window.unifia.openExternal('https://thunderstore.io/')}
          className="rounded bg-accent px-3 py-1.5 text-accent-contrast hover:opacity-90"
        >
          Visit Thunderstore
        </button>
      </div>
    </div>
  );
}
