import React from 'react';

export default function About() {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-bold text-neutral-100">Unifia</h1>
      <p className="mb-6 text-sm text-neutral-400">
        Cross-store multiplayer game launcher · Open source under the MIT license.
      </p>

      <div className="space-y-4 text-sm leading-relaxed text-neutral-300">
        <p>
          Unifia lets players who own the same game from different stores — Steam, GOG, Epic and
          others — play multiplayer together over a direct IP connection, bypassing platform-specific
          lobby systems.
        </p>
        <p>
          External tools like BepInEx are never bundled. They are downloaded on demand from their
          official GitHub releases through the Modules page, so you always control exactly what runs
          and which version is installed.
        </p>

        <div className="rounded-lg bg-card p-4 ring-1 ring-white/5">
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">How it works</h2>
          <ul className="list-inside list-disc space-y-1 text-neutral-400">
            <li>Scan your installed games across stores.</li>
            <li>Install a loader module (e.g. BepInEx) per game profile.</li>
            <li>Host opens a TCP port; clients connect by IP.</li>
            <li>Versions are exchanged on connect and checked for a match.</li>
          </ul>
        </div>

        <p className="text-neutral-500">
          Contributions welcome on GitHub. Unifia is not affiliated with Valve, GOG, Epic Games, or
          the BepInEx project.
        </p>
      </div>
    </div>
  );
}
