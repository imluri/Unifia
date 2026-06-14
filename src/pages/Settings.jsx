import React, { useEffect, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useAppStore } from '../store/useAppStore.js';

function TextField({ label, value, onChange, placeholder, hint, type = 'text', onBlur, onBrowse }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-300">{label}</span>
      <div className="flex gap-2">
        <input
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className="w-full rounded bg-neutral-800 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-accent"
        />
        {/* Optional folder picker: replaces the field value with the chosen path. */}
        {onBrowse && (
          <button
            type="button"
            onClick={onBrowse}
            title="Choose folder"
            className="flex shrink-0 items-center rounded bg-neutral-700 px-3 text-neutral-100 hover:bg-surface-hover"
          >
            <Icon name="folder-open" size={15} />
          </button>
        )}
      </div>
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

// Fixed swatches for each theme's preview card (these don't depend on the
// active theme — they always show what each option looks like).
const THEME_PREVIEWS = [
  {
    id: 'mono',
    name: 'Mono',
    desc: 'Vercel-inspired pure black',
    bg: '#000000',
    surface: '#1a1a1a',
    border: '#2a2a2a',
    text: '#ffffff',
    accent: '#ffffff',
  },
  {
    id: 'slate',
    name: 'Slate',
    desc: 'Cool blue-grey, softer edges',
    bg: '#0f0f13',
    surface: '#1e1e28',
    border: '#32323f',
    text: '#e8e8f0',
    accent: '#3b82f6',
  },
];

// A clickable mini mock-up of a theme. Activating it persists immediately so
// the change is visible the moment you click.
function ThemeCard({ theme, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(theme.id)}
      className={`flex-1 rounded border p-3 text-left transition ${
        active ? 'border-accent ring-1 ring-accent' : 'border-border-default hover:border-border-strong'
      }`}
      style={{ background: theme.bg }}
    >
      <div className="mb-3 space-y-1.5">
        <div className="h-2 w-1/2 rounded" style={{ background: theme.text }} />
        <div className="h-6 rounded" style={{ background: theme.surface, border: `1px solid ${theme.border}` }} />
        <div className="flex gap-1.5">
          <div className="h-4 w-10 rounded" style={{ background: theme.accent }} />
          <div className="h-4 flex-1 rounded" style={{ background: theme.surface, border: `1px solid ${theme.border}` }} />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: theme.text }}>
          {theme.name}
        </span>
        {active && <Icon name="info" size={14} className="text-accent" />}
      </div>
      <span className="text-[11px]" style={{ color: theme.border === '#2a2a2a' ? '#888' : '#7878a0' }}>
        {theme.desc}
      </span>
    </button>
  );
}

export default function Settings() {
  const settings = useAppStore((s) => s.settings);
  const saveSettings = useAppStore((s) => s.saveSettings);
  const dataDir = useAppStore((s) => s.dataDir);

  const [draft, setDraft] = useState(settings || {});
  const [saved, setSaved] = useState(false);
  const [keyTest, setKeyTest] = useState(null); // { ok } | { error }
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!settings) return <p className="text-neutral-500">Loading settings…</p>;

  const sp = draft.storePaths || {};

  function setPath(key, val) {
    setDraft((d) => ({ ...d, storePaths: { ...d.storePaths, [key]: val } }));
  }

  // Open the native folder picker and feed the chosen path into a setter.
  async function browseFolder(apply) {
    const picked = await window.unifia?.pickDirectory();
    if (picked) apply(picked.path);
  }

  // Persist just the SteamGridDB key (so it sticks without a full Save).
  async function saveKey() {
    await saveSettings({ steamGridDbKey: draft.steamGridDbKey });
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1500);
  }

  async function handleSave() {
    await saveSettings(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  // Theme cards activate live — persist immediately and reflect in the draft.
  async function selectTheme(theme) {
    setDraft((d) => ({ ...d, theme }));
    await saveSettings({ theme });
  }

  async function testKey() {
    setKeyTest({ pending: true });
    try {
      await window.unifia.testSteamGridKey(draft.steamGridDbKey);
      // A valid key is worth keeping — persist it so it survives a reload.
      await saveSettings({ steamGridDbKey: draft.steamGridDbKey });
      setKeyTest({ ok: true });
    } catch (err) {
      setKeyTest({ error: err.message });
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-5 text-2xl font-bold text-neutral-100">Settings</h1>

      {/* Appearance */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">Appearance</h2>
        <div className="flex gap-3">
          {THEME_PREVIEWS.map((t) => (
            <ThemeCard key={t.id} theme={t} active={draft.theme === t.id} onSelect={selectTheme} />
          ))}
        </div>
      </section>

      {/* Integrations */}
      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Integrations</h2>
        <div>
          <TextField
            label="SteamGridDB API key"
            value={draft.steamGridDbKey}
            onChange={(v) => {
              setDraft((d) => ({ ...d, steamGridDbKey: v }));
              setKeyTest(null);
            }}
            placeholder="Paste your free key from steamgriddb.com"
            hint="Used to fetch game banners and icons. Get a free key from steamgriddb.com/profile/preferences/api."
            type="password"
            onBlur={saveKey}
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={saveKey}
              disabled={!draft.steamGridDbKey}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:opacity-90 disabled:opacity-50"
            >
              Save key
            </button>
            <button
              type="button"
              onClick={testKey}
              disabled={!draft.steamGridDbKey || keyTest?.pending}
              className="rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover disabled:opacity-50"
            >
              {keyTest?.pending ? 'Testing…' : 'Test Key'}
            </button>
            {keySaved && <span className="text-sm text-green-400">Saved ✓</span>}
            {keyTest?.ok && <span className="text-sm text-green-400">Valid key ✓</span>}
            {keyTest?.error && <span className="text-sm text-red-400">{keyTest.error}</span>}
            <button
              type="button"
              onClick={() => window.unifia?.clearArtCache()}
              className="ml-auto text-xs text-neutral-500 underline hover:text-neutral-300"
            >
              Clear art cache
            </button>
          </div>
        </div>
      </section>

      {/* Store paths */}
      <section className="mb-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Store paths</h2>
        <TextField
          label="Steam"
          value={sp.steam}
          onChange={(v) => setPath('steam', v)}
          onBrowse={() => browseFolder((p) => setPath('steam', p))}
        />
        <TextField
          label="GOG"
          value={sp.gog}
          onChange={(v) => setPath('gog', v)}
          onBrowse={() => browseFolder((p) => setPath('gog', p))}
        />
        <TextField
          label="Epic"
          value={sp.epic}
          onChange={(v) => setPath('epic', v)}
          onBrowse={() => browseFolder((p) => setPath('epic', p))}
        />
        <div>
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
          <button
            type="button"
            onClick={async () => {
              const picked = await window.unifia?.pickDirectory();
              if (!picked) return;
              const existing = sp.custom || [];
              if (!existing.includes(picked.path)) setPath('custom', [...existing, picked.path]);
            }}
            className="mt-2 flex items-center gap-1.5 rounded bg-neutral-700 px-3 py-1.5 text-sm text-neutral-100 hover:bg-surface-hover"
          >
            <Icon name="folder-open" size={15} />
            Add folder
          </button>
        </div>
      </section>


      {/* General */}
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
          onBrowse={() => browseFolder((p) => setDraft((d) => ({ ...d, dataDir: p })))}
          hint={`Leave blank for default. Currently: ${dataDir}`}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="rounded bg-accent px-5 py-2 text-sm font-medium text-accent-contrast transition hover:opacity-90"
        >
          Save settings
        </button>
        {saved && <span className="text-sm text-green-400">Saved ✓</span>}
      </div>
    </div>
  );
}
