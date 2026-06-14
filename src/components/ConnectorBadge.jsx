import React from 'react';
import logo from '../assets/unifia_logo_notext.png';

// Identity chip for the Unifia connector plugin — distinguishes it from community
// Thunderstore mods wherever it appears (Lobby status, Installed-tab row).
export default function ConnectorBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <img src={logo} alt="" className="h-4 w-4 rounded-sm object-contain" />
      <span className="text-sm font-medium text-neutral-100">Unifia</span>
      <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
        connector
      </span>
    </span>
  );
}
