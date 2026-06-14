import React, { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';
import { useAppStore } from '../store/useAppStore.js';

// Multiplayer invite hub, opened from the game header. Generate a code to share
// (Photon room + your active preset's mods) or paste a friend's to join + sync.
export default function InviteModal({ game, open, onClose }) {
  const profile = useAppStore((s) => s.gameProfiles[game.id]) || {};
  const settings = useAppStore((s) => s.settings);
  const saveGameProfile = useAppStore((s) => s.saveGameProfile);
  const buildInvite = useAppStore((s) => s.buildInvite);
  const applyInvite = useAppStore((s) => s.applyInvite);
  const installMod = useAppStore((s) => s.installMod);
  const loadMods = useAppStore((s) => s.loadMods);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const presetData = useAppStore((s) => s.presets[game.id]);
  const pushToast = useAppStore((s) => s.pushToast);

  const activePresetName =
    presetData?.presets.find((p) => p.id === presetData.activeId)?.name || '';

  // Migration: fall back to the old global Settings AppId if this game has none yet.
  const [appId, setAppId] = useState(profile.photonAppId || settings?.photonAppId || '');
  const [voiceAppId, setVoiceAppId] = useState(profile.photonVoiceAppId || settings?.photonVoiceAppId || '');
  const [presetName, setPresetName] = useState('');
  const [room, setRoom] = useState('');
  const [code, setCode] = useState('');
  const [paste, setPaste] = useState('');
  const [diff, setDiff] = useState(null);
  const [importInfo, setImportInfo] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Load presets so we can prefill the preset-name field, and default the name
  // to the active preset once it's known.
  useEffect(() => {
    if (open && !presetData) loadPresets(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (open && activePresetName && !presetName) setPresetName(activePresetName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activePresetName]);

  async function saveIds() {
    await saveGameProfile(game.id, { photonAppId: appId.trim(), photonVoiceAppId: voiceAppId.trim() });
  }

  async function onGenerate() {
    if (!presetName.trim()) {
      pushToast({ type: 'error', message: 'Name your preset before sharing the code.' });
      return;
    }
    try {
      await saveIds();
      const res = await buildInvite(game.id, {
        appId: appId.trim(),
        voiceAppId: voiceAppId.trim(),
        room: room.trim(),
        presetName: presetName.trim(),
      });
      setCode(res.code);
      setRoom(res.room);
      await loadPresets(game.id); // reflect the preset rename
    } catch (err) {
      pushToast({ type: 'error', message: err.message });
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      pushToast({ type: 'success', message: 'Invite copied.' });
    } catch {
      /* clipboard unavailable */
    }
  }

  async function onImport() {
    setDiff(null);
    setImportInfo(null);
    try {
      const res = await applyInvite(game.id, paste.trim());
      setDiff(res.diff);
      setImportInfo(res);
      setAppId(res.descriptor.appId);
      setVoiceAppId(res.descriptor.voiceAppId || '');
      if (res.descriptor.presetName) setPresetName(res.descriptor.presetName);
      await loadPresets(game.id); // surface the imported preset
    } catch (err) {
      pushToast({ type: 'error', message: err.message });
    }
  }

  async function onSync() {
    if (!diff) return;
    setSyncing(true);
    try {
      for (const m of [...diff.toInstall, ...diff.toUpdate]) {
        await installMod(game.id, m.fullName, m.to || m.version);
      }
      await loadMods(game);
      setDiff({ toInstall: [], toUpdate: [], ok: [...diff.ok, ...diff.toInstall, ...diff.toUpdate] });
      pushToast({ type: 'success', message: 'Mods synced — launch from the header.' });
    } catch (err) {
      pushToast({ type: 'error', message: err.message });
    } finally {
      setSyncing(false);
    }
  }

  const pendingCount = diff ? diff.toInstall.length + diff.toUpdate.length : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Multiplayer invite"
      footer={<Button variant="secondary" onClick={onClose}>Done</Button>}
    >
      {/* Photon AppIds — some games (e.g. REPO) need Realtime + Voice. */}
      <label className="block text-xs text-neutral-400">
        Photon AppId — Realtime (the app everyone shares)
        <input
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          onBlur={saveIds}
          placeholder="xxxxxxxx-xxxx-…"
          className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none"
        />
      </label>
      <label className="block text-xs text-neutral-400">
        Photon AppId — Voice (optional; required by some games like REPO)
        <input
          value={voiceAppId}
          onChange={(e) => setVoiceAppId(e.target.value)}
          onBlur={saveIds}
          placeholder="leave blank if the game has no voice chat"
          className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none"
        />
      </label>

      {/* Your invite */}
      <section className="rounded border border-border-subtle bg-neutral-900/40 p-3">
        <h4 className="mb-2 text-sm font-semibold text-neutral-200">Your invite</h4>
        <label className="mb-2 block text-xs text-neutral-400">
          Preset name (required — shared with your friends)
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="e.g. Vanilla+ or Chaos Night"
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none"
          />
        </label>
        <div className="flex items-center gap-2">
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="room code (auto)"
            className="w-40 rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-100 outline-none"
          />
          <Button variant="primary" onClick={onGenerate} disabled={!presetName.trim()} title={!presetName.trim() ? 'Name your preset first' : undefined}>
            Generate
          </Button>
        </div>
        {code && (
          <div className="mt-3">
            <textarea
              readOnly
              value={code}
              rows={3}
              className="w-full resize-none rounded bg-neutral-900 px-2 py-1.5 font-mono text-xs text-neutral-300"
            />
            <Button className="mt-2" icon="copy" onClick={onCopy}>Copy invite</Button>
            <p className="mt-1 text-xs text-neutral-500">
              Share this string. Friends paste it below, sync mods, and launch.
            </p>
          </div>
        )}
      </section>

      {/* Join a friend */}
      <section className="rounded border border-border-subtle bg-neutral-900/40 p-3">
        <h4 className="mb-2 text-sm font-semibold text-neutral-200">Join a friend</h4>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          placeholder="paste a friend's invite code…"
          className="w-full resize-none rounded bg-neutral-800 px-2 py-1.5 font-mono text-xs text-neutral-100 outline-none"
        />
        <Button className="mt-2" variant="primary" onClick={onImport} disabled={!paste.trim()}>Import</Button>

        {importInfo && diff && (
          <div className="mt-3 rounded bg-neutral-900/60 px-3 py-2 text-sm">
            <p className="text-neutral-300">
              Room <span className="font-mono text-neutral-100">{importInfo.descriptor.room}</span> ·
              host v{importInfo.hostVersion}
              {importInfo.hostVersion !== importInfo.localVersion && (
                <span className="ml-1 text-yellow-400">(you have v{importInfo.localVersion})</span>
              )}
            </p>
            <p className="mt-1 text-neutral-400">
              Mods: {diff.toInstall.length} to install, {diff.toUpdate.length} to update,{' '}
              {diff.ok.length} match.
            </p>
            {pendingCount > 0 ? (
              <Button className="mt-2" variant="primary" loading={syncing} onClick={onSync}>
                {syncing ? 'Syncing…' : `Sync ${pendingCount} mod${pendingCount === 1 ? '' : 's'}`}
              </Button>
            ) : (
              <p className="mt-2 text-green-400">Ready — launch from the header.</p>
            )}
          </div>
        )}
      </section>
    </Modal>
  );
}
