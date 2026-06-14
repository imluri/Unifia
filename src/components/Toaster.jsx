import React, { useEffect } from 'react';
import Icon from './Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

const STYLES = {
  success: 'border-green-900/50 bg-green-900/30 text-green-200',
  error: 'border-red-900/50 bg-red-900/30 text-red-200',
  info: 'border-border-default bg-card text-neutral-200',
};
const ICONS = { success: 'check', error: 'triangle-alert', info: 'info' };

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 3500);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div className={`slide-down flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg ${STYLES[toast.type] || STYLES.info}`}>
      <Icon name={ICONS[toast.type] || 'info'} size={15} />
      <span className="max-w-xs">{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)} className="ml-1 text-neutral-400 hover:text-neutral-100">
        <Icon name="x" size={13} />
      </button>
    </div>
  );
}

export default function Toaster() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={dismissToast} />
        </div>
      ))}
    </div>
  );
}
