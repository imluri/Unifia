import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore.js';

function TextField({ label, value, onChange, placeholder, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-300">{label}</span>
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
      />
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export default function Settings() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const dataDir = useAppStore((s) => s.dataDir);

  // Local editable copy; committed on Save.
  const [draft, setDraft] = useState(settings || {});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!settings) return <p className="text-neutral-500">Loading settings…</p>;

  const sp = draft.storePaths || {};

  function setPath(key, val) {
    setDraft((d) => ({ ...d, storePaths: { ...d.storePaths, [key]: val } }));
  }

  async function handleSave() {
    await saveSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-5 text-2xl font-bold text-neutral-100">Settings</h1>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Store paths</h2>
        <TextField label="Steam" value={sp.steam} onChange={(v) => setPath('steam', v)} />
        <TextField label="GOG" value={sp.gog} onChange={(v) => setPath('gog', v)} />
        <TextField label="Epic" value={sp.epic} onChange={(v) => setPath('epic', v)} />
        <TextField
          label="Custom paths (comma-separated)"
          value={(sp.custom || []).join(', ')}
          onChange={(v) =>
            setPath(
              'custom',
              v.split(',').map((s) => s.trim()).filter(Boolean)
            )
          }
          hint="Extra folders to scan, one game per subfolder."
        />
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Photon (REPO)</h2>
        <TextField
          label="AppId Realtime"
          value={draft.photonAppId}
          onChange={(v) => setDraft((d) => ({ ...d, photonAppId: v }))}
          hint="Written into BepInEx/config/com.photon.unity3d.cfg when patching."
        />
        <TextField
          label="AppId Voice"
          value={draft.photonVoiceAppId}
          onChange={(v) => setDraft((d) => ({ ...d, photonVoiceAppId: v }))}
        />
      </section>

      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">General</h2>
        <TextField
          label="Username"
          value={draft.username}
          onChange={(v) => setDraft((d) => ({ ...d, username: v }))}
        />
        <TextField
          label="unifia_data folder"
          value={draft.dataDir}
          onChange={(v) => setDraft((d) => ({ ...d, dataDir: v }))}
          hint={`Leave blank for default. Currently: ${dataDir}`}
        />
        <label className="flex items-center gap-3">
          <span className="text-sm text-neutral-300">Theme</span>
          <select
            value={draft.theme || 'dark'}
            onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value }))}
            className="rounded bg-neutral-800 px-2 py-1.5 text-sm"
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="rounded bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          Save settings
        </button>
        {saved && <span className="text-sm text-green-400">Saved ✓</span>}
      </div>
    </div>
  );
}
