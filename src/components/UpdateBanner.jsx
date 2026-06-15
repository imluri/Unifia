import React from 'react';
import Button from './ui/Button.jsx';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Persistent banner shown once an update has finished downloading. Unlike a toast
// it doesn't auto-dismiss — "restart to update" should stay until acted on.
export default function UpdateBanner() {
  const update = useAppStore((s) => s.update);
  const installUpdate = useAppStore((s) => s.installUpdate);

  if (update.status !== 'ready') return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-accent/40 bg-card px-4 py-2.5 shadow-lg ring-1 ring-white/10">
      <Icon name="refresh-cw" size={16} className="text-accent" />
      <span className="text-sm text-neutral-200">
        Update <span className="font-medium text-neutral-100">v{update.version}</span> ready.
      </span>
      <Button variant="primary" size="sm" onClick={() => installUpdate()}>Restart to update</Button>
    </div>
  );
}
