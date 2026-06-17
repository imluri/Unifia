import React from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import DownloadProgress from './DownloadProgress.jsx';

export default function ModDetailModal({ game, mod, open, onClose, onInstall, installing, progress }) {
  if (!open || !mod) return null;

  return (
    <Modal open onClose={onClose} title={mod.name} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {mod.icon ? <img src={mod.icon} alt="" className="h-16 w-16 rounded object-cover" /> : <div className="h-16 w-16 rounded bg-neutral-800" />}
          <div>
            <div className="text-sm text-neutral-400">by {mod.owner} · {mod.hubLabel}</div>
            <div className="mt-1 text-xs text-neutral-300">{mod.latest ? mod.latest.description : ''}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onInstall && (
            <Button variant="primary" onClick={() => onInstall()} loading={!!installing}>
              {installing ? 'Installing…' : 'Install'}
            </Button>
          )}
          <Button onClick={() => mod.pageUrl && window.unifia.openExternal(mod.pageUrl)} disabled={!mod.pageUrl}>Open on {mod.hubLabel}</Button>
        </div>

        {progress && <DownloadProgress progress={progress} />}

        <div className="text-xs text-neutral-500">
          <div>Versions:</div>
          <ul className="mt-1 list-disc pl-4">
            {(mod.versions || []).slice(0, 8).map((v) => (
              <li key={v.version_number} className="text-xs">{v.version_number} {v.prerelease ? '(pre)' : ''}</li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
