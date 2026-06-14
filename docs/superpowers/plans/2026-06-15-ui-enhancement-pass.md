# UI Enhancement Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship shared `Button`/`Modal`/`ConfirmDialog` primitives, a toast system, a clearer preset bar (New auto-switches, Save removed), and small UX fixes — refactoring the main surfaces onto the primitives.

**Architecture:** New `src/components/ui/` primitives + a `src/lib/toasts.js` pure reducer behind a store slice and `<Toaster/>`. The preset-bar fix makes `presets.create` set the new preset active and the store reload mods. Main surfaces adopt the primitives; feedback routes to toasts.

**Tech Stack:** React + Vite + zustand (renderer), Electron (main). Verify: `npm run build`, `node --test` (pure), `node --check` (main).

**Spec:** `docs/superpowers/specs/2026-06-15-ui-enhancement-pass-design.md`

---

## File Structure

- **Create** `src/assets/icons/{play,trash-2,pencil,check}.svg` — new Lucide icons.
- **Create** `src/components/ui/Button.jsx`, `src/components/ui/Modal.jsx`, `src/components/ui/ConfirmDialog.jsx`.
- **Create** `src/lib/toasts.js` (+ `src/lib/toasts.test.js`) — pure toast list reducer.
- **Create** `src/components/Toaster.jsx`.
- **Modify** `src/store/useAppStore.js` — toast slice; preset-bar reloads.
- **Modify** `electron/ipc/presets.js` — `create` sets the new preset active.
- **Modify** `src/components/PresetBar.jsx` — redesign on primitives + ConfirmDialog + toasts.
- **Modify** `src/App.jsx` — mount `<Toaster/>`.
- **Modify** `src/pages/GameDetail.jsx`, `src/components/InviteModal.jsx`, `src/components/GameModuleModal.jsx`, `src/pages/Home.jsx` — adopt Button/Modal + toasts + small fixes.

---

### Task 1: Icons + Button primitive

**Files:**
- Create: `src/assets/icons/play.svg`, `trash-2.svg`, `pencil.svg`, `check.svg`
- Create: `src/components/ui/Button.jsx`

- [ ] **Step 1: Add the icons**

Create `src/assets/icons/play.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
```

Create `src/assets/icons/trash-2.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
```

Create `src/assets/icons/pencil.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/></svg>
```

Create `src/assets/icons/check.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
```

- [ ] **Step 2: Implement Button**

Create `src/components/ui/Button.jsx`:

```jsx
import React from 'react';
import Icon from '../Icon.jsx';

const VARIANTS = {
  primary: 'bg-accent text-accent-contrast hover:opacity-90 active:scale-95',
  secondary: 'bg-neutral-700 text-neutral-100 hover:bg-surface-hover',
  danger: 'bg-neutral-800 text-red-300 hover:bg-red-900/60',
  ghost: 'bg-transparent text-neutral-300 hover:bg-surface-hover',
};

const SIZES = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
};

// Shared button. Encapsulates the repeated rounded/transition/disabled patterns
// so every call site stays consistent. Forwards onClick/title/type/etc.
export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const iconSize = size === 'sm' ? 13 : 15;
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded font-medium transition disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Icon name="refresh-cw" size={iconSize} className="animate-spin" />
      ) : (
        icon && <Icon name={icon} size={iconSize} />
      )}
      {children}
    </button>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/assets/icons/play.svg src/assets/icons/trash-2.svg src/assets/icons/pencil.svg src/assets/icons/check.svg src/components/ui/Button.jsx
git commit -m "feat(ui): Button primitive + play/trash/pencil/check icons"
```

---

### Task 2: Modal + ConfirmDialog primitives

**Files:**
- Create: `src/components/ui/Modal.jsx`, `src/components/ui/ConfirmDialog.jsx`

- [ ] **Step 1: Implement Modal**

Create `src/components/ui/Modal.jsx`:

```jsx
import React from 'react';
import Icon from '../Icon.jsx';

const SIZES = { sm: 'w-80', md: 'w-[34rem]' };

// Shared modal: overlay + click-away + header (title/close) + scrollable body +
// optional footer. Renders nothing when closed.
export default function Modal({ open, onClose, title, size = 'md', footer, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className={`flex max-h-[85vh] flex-col rounded-lg bg-card ring-1 ring-white/10 ${SIZES[size]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-start justify-between border-b border-border-subtle px-5 py-4">
            <h3 className="text-lg font-semibold text-neutral-100">{title}</h3>
            <button
              onClick={onClose}
              className="flex items-center rounded p-1 text-neutral-400 hover:bg-surface-hover hover:text-neutral-100"
            >
              <Icon name="x" size={18} />
            </button>
          </div>
        )}
        <div className="space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement ConfirmDialog**

Create `src/components/ui/ConfirmDialog.jsx`:

```jsx
import React from 'react';
import Modal from './Modal.jsx';
import Button from './Button.jsx';

// Confirmation popup built on Modal. `danger` styles the confirm button red.
export default function ConfirmDialog({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Confirm',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="text-sm text-neutral-300">{message}</p>}
    </Modal>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built` (not imported yet).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/Modal.jsx src/components/ui/ConfirmDialog.jsx
git commit -m "feat(ui): Modal + ConfirmDialog primitives"
```

---

### Task 3: Toast pure reducer

**Files:**
- Create: `src/lib/toasts.js`
- Test: `src/lib/toasts.test.js`

- [ ] **Step 1: Write the failing test**

`src/lib/toasts.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { addToast, removeToast } = require('./toasts.js');

test('addToast appends with id/type/message', () => {
  const list = addToast([], { type: 'success', message: 'done' }, 1);
  assert.deepStrictEqual(list, [{ id: 1, type: 'success', message: 'done' }]);
});

test('addToast keeps existing toasts', () => {
  const list = addToast([{ id: 1, type: 'info', message: 'a' }], { type: 'error', message: 'b' }, 2);
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[1].id, 2);
});

test('removeToast filters by id', () => {
  const list = [{ id: 1, type: 'info', message: 'a' }, { id: 2, type: 'error', message: 'b' }];
  assert.deepStrictEqual(removeToast(list, 1), [{ id: 2, type: 'error', message: 'b' }]);
});

test('addToast defaults missing type to info', () => {
  const list = addToast([], { message: 'x' }, 5);
  assert.strictEqual(list[0].type, 'info');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/lib/toasts.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`src/lib/toasts.js`:

```js
// Pure toast-list reducer. The store wraps these with id generation + state set;
// kept I/O-free so it is unit-testable with node:test (CommonJS).
function addToast(list, toast, id) {
  return [...list, { id, type: toast.type || 'info', message: String(toast.message || '') }];
}

function removeToast(list, id) {
  return list.filter((t) => t.id !== id);
}

module.exports = { addToast, removeToast };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/lib/toasts.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/toasts.js src/lib/toasts.test.js
git commit -m "feat(ui): pure toast-list reducer + tests"
```

---

### Task 4: Toast store slice + Toaster + mount

**Files:**
- Modify: `src/store/useAppStore.js`
- Create: `src/components/Toaster.jsx`
- Modify: `src/App.jsx`

The store currently imports from zustand and defines state. `src/lib/toasts.js` is CommonJS but the
renderer is ESM bundled by Vite — Vite handles `require`-style modules, but to be safe the store
imports the two functions via ESM interop. Use a tiny inline reimplementation in the store to avoid
mixing module systems (the pure versions are still unit-tested separately).

- [ ] **Step 1: Add toast state + actions**

In `src/store/useAppStore.js`, after the `bepInExOnDisk` / `connector` state block (near the other
top-level state), add:

```js
  // Toast notifications: [{ id, type, message }]
  toasts: [],
  _toastSeq: 0,
  pushToast(toast) {
    const id = get()._toastSeq + 1;
    set((s) => ({
      _toastSeq: id,
      toasts: [...s.toasts, { id, type: toast.type || 'info', message: String(toast.message || '') }],
    }));
    return id;
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
```

- [ ] **Step 2: Implement Toaster**

Create `src/components/Toaster.jsx`:

```jsx
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
```

- [ ] **Step 3: Mount in App**

In `src/App.jsx`, add the import after `import TitleBar from './components/TitleBar.jsx';`:

```jsx
import Toaster from './components/Toaster.jsx';
```

In `MainLayout`'s returned tree, add `<Toaster />` just before the closing of the outer
`word-fade …` div (after `<StatusBar />`):

```jsx
      <StatusBar />
      <Toaster />
    </div>
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/store/useAppStore.js src/components/Toaster.jsx src/App.jsx
git commit -m "feat(ui): toast store slice + Toaster mounted in app"
```

---

### Task 5: Preset bar backend + store (auto-switch on New, reloads)

**Files:**
- Modify: `electron/ipc/presets.js`
- Modify: `src/store/useAppStore.js`

- [ ] **Step 1: create() sets the new preset active**

In `electron/ipc/presets.js`, replace:

```js
function create(gameId, name, fromActive) {
  presetStore.create(gameId, name, !!fromActive);
  return presetStore.list(gameId);
}
```

with:

```js
function create(gameId, name, fromActive) {
  const id = presetStore.create(gameId, name, !!fromActive);
  presetStore.setActive(gameId, id); // newly created preset becomes active
  return presetStore.list(gameId);
}
```

- [ ] **Step 2: Verify**

Run: `node --check electron/ipc/presets.js`
Expected: OK.

- [ ] **Step 3: Store — reload mods on create/delete (switch/import already do)**

In `src/store/useAppStore.js`, the preset actions currently are `createPreset`/`deletePreset`
without a mod reload. Replace them so they take an optional `game` and reload mods like
`switchPreset`/`importPreset`. Find:

```js
  async createPreset(gameId, name, fromActive) {
    const data = await api.createPreset(gameId, name, fromActive);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
    return data;
  },
```

Replace with:

```js
  async createPreset(gameId, name, fromActive, game) {
    const data = await api.createPreset(gameId, name, fromActive);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
    if (game) await get().loadMods(game); // new preset is active — refresh list
    return data;
  },
```

Find:

```js
  async deletePreset(gameId, id) {
    const data = await api.deletePreset(gameId, id);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
  },
```

Replace with:

```js
  async deletePreset(gameId, id, game) {
    const data = await api.deletePreset(gameId, id);
    set((s) => ({ presets: { ...s.presets, [gameId]: data } }));
    if (game) await get().loadMods(game);
  },
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc/presets.js src/store/useAppStore.js
git commit -m "feat(presets): New auto-switches; create/delete refresh the installed list"
```

---

### Task 6: PresetBar redesign (primitives + ConfirmDialog + toasts)

**Files:**
- Modify: `src/components/PresetBar.jsx`

Rewrite using `Button`, `ConfirmDialog`, icon buttons, toasts, and the new `createPreset(…, game)` /
`deletePreset(…, game)` signatures. Save button removed.

- [ ] **Step 1: Replace the component**

Replace the entire contents of `src/components/PresetBar.jsx` with:

```jsx
import React, { useEffect, useState } from 'react';
import Button from './ui/Button.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';
import { useAppStore } from '../store/useAppStore.js';

export default function PresetBar({ game }) {
  const data = useAppStore((s) => s.presets[game.id]);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const createPreset = useAppStore((s) => s.createPreset);
  const renamePreset = useAppStore((s) => s.renamePreset);
  const deletePreset = useAppStore((s) => s.deletePreset);
  const switchPreset = useAppStore((s) => s.switchPreset);
  const exportPreset = useAppStore((s) => s.exportPreset);
  const importPreset = useAppStore((s) => s.importPreset);
  const pushToast = useAppStore((s) => s.pushToast);

  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [code, setCode] = useState('');
  const [nameMode, setNameMode] = useState(null); // 'new' | 'rename' | null
  const [nameVal, setNameVal] = useState('');

  useEffect(() => {
    if (!data) loadPresets(game.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  if (!data) return null;
  const active = data.presets.find((p) => p.id === data.activeId);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      pushToast({ type: 'error', message: err.message || String(err) });
    } finally {
      setBusy(false);
    }
  }

  function openName(mode) {
    setNameMode(mode);
    setNameVal(mode === 'rename' && active ? active.name : '');
  }

  async function submitName() {
    const name = nameVal.trim();
    if (!name) return;
    if (nameMode === 'new') {
      await createPreset(game.id, name, true, game);
      pushToast({ type: 'success', message: `Switched to new preset “${name}”.` });
    } else {
      await renamePreset(game.id, data.activeId, name);
      pushToast({ type: 'info', message: `Renamed to “${name}”.` });
    }
    setNameMode(null);
    setNameVal('');
  }

  return (
    <div className="mb-3 rounded border border-border-default bg-neutral-900/40 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-neutral-500">Preset</span>
        <select
          value={data.activeId}
          disabled={busy}
          onChange={(e) =>
            run(async () => {
              const name = data.presets.find((p) => p.id === e.target.value)?.name;
              await switchPreset(game.id, e.target.value, game);
              pushToast({ type: 'success', message: `Switched to “${name}”.` });
            })
          }
          className="rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100"
        >
          {data.presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.modCount})</option>
          ))}
        </select>

        <Button size="sm" icon="plus" disabled={busy} onClick={() => openName('new')} title="New preset from current mods" />
        <Button size="sm" icon="pencil" disabled={busy} onClick={() => openName('rename')} title="Rename preset" />
        <Button size="sm" variant="danger" icon="trash-2" disabled={busy} onClick={() => setConfirmDelete(true)} title="Delete preset" />

        <span className="mx-1 h-4 w-px bg-border-default" />

        <Button size="sm" icon="copy" disabled={busy}
          onClick={() => run(async () => {
            const c = await exportPreset(game.id, data.activeId);
            await navigator.clipboard.writeText(c);
            pushToast({ type: 'success', message: 'Preset code copied.' });
          })}>
          Copy code
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setImporting((v) => !v)}>Import code</Button>
        {busy && <span className="text-xs text-neutral-500">Working…</span>}
      </div>

      {nameMode && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run(submitName)}
            placeholder={nameMode === 'new' ? 'New preset name…' : 'Rename preset…'}
            className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none"
          />
          <Button size="sm" variant="primary" disabled={busy || !nameVal.trim()} onClick={() => run(submitName)}>
            {nameMode === 'new' ? 'Create' : 'Save'}
          </Button>
          <Button size="sm" onClick={() => setNameMode(null)}>Cancel</Button>
        </div>
      )}

      {importing && (
        <div className="mt-2 flex items-center gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="paste preset code…"
            className="flex-1 rounded bg-neutral-800 px-2 py-1 font-mono text-xs text-neutral-100 outline-none" />
          <Button size="sm" variant="primary" loading={busy} disabled={busy || !code.trim()}
            onClick={() => run(async () => {
              await importPreset(game.id, code.trim(), undefined, game);
              setCode(''); setImporting(false);
              pushToast({ type: 'success', message: 'Imported preset.' });
            })}>
            Import
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete preset"
        danger
        confirmLabel="Delete"
        loading={busy}
        message={`Delete “${active ? active.name : ''}”? This removes its mod set.${data.presets.length <= 1 ? ' Since this is your only preset, it resets to an empty Default.' : ''}`}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          run(async () => {
            await deletePreset(game.id, data.activeId, game);
            setConfirmDelete(false);
            pushToast({ type: 'info', message: 'Preset deleted.' });
          })
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/PresetBar.jsx
git commit -m "feat(presets): preset bar on Button/ConfirmDialog, icon actions, toasts, no Save"
```

---

### Task 7: GameDetail — header icons, toasts, empty-state + Manage buttons

**Files:**
- Modify: `src/pages/GameDetail.jsx`

- [ ] **Step 1: Imports**

After `import InviteModal from '../components/InviteModal.jsx';` add:

```jsx
import Button from '../components/ui/Button.jsx';
```

- [ ] **Step 2: Use toasts instead of the inline notice**

Add the selector near the other `useAppStore` selectors:

```jsx
  const pushToast = useAppStore((s) => s.pushToast);
```

Remove the `const [notice, setNotice] = useState(null);` line and the `{notice && (…)}` block in the
header. In `handleLaunch`, replace `setNotice(...)` calls with `pushToast`:

```jsx
  async function handleLaunch() {
    try {
      const res = await launchGame(game.id);
      pushToast({
        type: 'success',
        message: res.alreadyRunning
          ? `${game.name} is already running.`
          : `Launched ${game.name}${res.deployedModule ? ` with ${res.deployedModule.module} ${res.deployedModule.version}` : ''}.`,
      });
    } catch (err) {
      pushToast({ type: 'error', message: `Launch failed: ${err.message}` });
    }
  }
```

In `handleChangeFolder`, replace the two `setNotice(...)` calls with
`pushToast({ type: 'success', message: \`Folder updated to ${picked.path}.\` })` and
`pushToast({ type: 'error', message: \`Couldn't change folder: ${err.message}\` })`.

- [ ] **Step 3: Header buttons → Button with icons**

Replace the Launch and Module buttons in the header actions row:

```jsx
            <Button variant="primary" icon="play" onClick={handleLaunch}>Launch</Button>
            <Button icon="package" onClick={() => setModuleOpen(true)}>Module</Button>
```

Convert Change folder, Invite, Remove to `Button` too (keep their `ml-auto`/title where present):

```jsx
            {game.manual && (
              <Button icon="folder-open" onClick={handleChangeFolder} title="Point this game at a different install folder">
                Change folder
              </Button>
            )}
            <Button className="ml-auto" icon="globe" onClick={() => setInviteOpen(true)} title="Generate or paste a multiplayer invite code">
              Invite
            </Button>
            <Button variant="danger" icon="x" onClick={handleRemove} title="Remove from library">Remove</Button>
```

- [ ] **Step 4: Empty-state + connector "Manage" become buttons**

Replace the installed empty-state text:

```jsx
                <p className="text-sm text-neutral-500">No mods installed yet. Switch to Browse.</p>
```

with:

```jsx
                <div className="text-sm text-neutral-500">
                  No mods installed yet.{' '}
                  <Button variant="ghost" size="sm" onClick={() => setTab('browse')}>Browse mods</Button>
                </div>
```

Replace the connector row's `<span … >Manage in Multiplayer →</span>` with:

```jsx
                <Button variant="ghost" size="sm" onClick={() => setTab('multiplayer')}>Manage in Multiplayer →</Button>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/GameDetail.jsx
git commit -m "feat(ui): GameDetail header icons, toasts, actionable empty/manage buttons"
```

---

### Task 8: InviteModal + GameModuleModal onto Modal/Button + toasts

**Files:**
- Modify: `src/components/InviteModal.jsx`, `src/components/GameModuleModal.jsx`

- [ ] **Step 1: InviteModal — wrap in Modal, buttons → Button, copy/errors → toasts**

In `src/components/InviteModal.jsx`:
- Add imports: `import Modal from './ui/Modal.jsx';` and `import Button from './ui/Button.jsx';`, and the toast selector `const pushToast = useAppStore((s) => s.pushToast);`.
- Replace the hand-rolled overlay (`<div className="fixed inset-0 …" onClick={onClose}>` … the panel … header) with `<Modal open={open} onClose={onClose} title="Multiplayer invite" footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>` wrapping the body sections, and remove the now-duplicated header/footer/close markup. Keep the `if (!open) return null;`? No — `Modal` handles `open`, so drop the early return and pass `open` through. (Move the `useEffect`s above any early return — Modal renders null internally, so the component body always runs its hooks; this is fine.)
- Replace the Generate/Import/Copy/Sync `<button>`s with `<Button variant="primary"|"secondary" …>`.
- In `onCopy`, after writing to clipboard, `pushToast({ type: 'success', message: 'Invite copied.' })`.
- Replace `setError(...)` usages + the `{error && …}` line with `pushToast({ type: 'error', message: … })` and remove the `error` state.

- [ ] **Step 2: GameModuleModal — wrap in Modal, buttons → Button**

In `src/components/GameModuleModal.jsx`:
- Add `import Modal from './ui/Modal.jsx';` and `import Button from './ui/Button.jsx';`.
- The component returns a hand-rolled overlay (`fixed inset-0 …`) with a header (game name + close) and a footer (`Manage all versions →` + `Done`). Replace the outer overlay/panel/header/footer with `<Modal open={!!game} onClose={onClose} title={game?.name} footer={<>…footer buttons…</>}>` wrapping the existing body. Keep `if (!game) return null;` removed in favor of `open={!!game}` (move any hooks above it as needed — this file's hooks are already at the top).
- Convert the inner action buttons (loader install/use, fetch versions) to `<Button>` where straightforward; leave the `<select>`s as-is.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `✓ built`. Manually confirm both modals still open/close and act.

- [ ] **Step 4: Commit**

```bash
git add src/components/InviteModal.jsx src/components/GameModuleModal.jsx
git commit -m "feat(ui): InviteModal + GameModuleModal on Modal/Button + toasts"
```

---

### Task 9: Home — ManualAddModal on Modal/Button + control buttons

**Files:**
- Modify: `src/pages/Home.jsx`

- [ ] **Step 1: Imports**

Add `import Modal from '../components/ui/Modal.jsx';` and `import Button from '../components/ui/Button.jsx';` to `src/pages/Home.jsx`.

- [ ] **Step 2: ManualAddModal → Modal**

`ManualAddModal` returns a hand-rolled overlay (`fixed inset-0 z-20 …`) with a title and Cancel/Add
footer. Replace the overlay/panel with `<Modal open={open} onClose={onClose} title="Add game manually" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Add</Button></>}>` wrapping the existing fields (extract the inline `onClick` add handler into a `submit` function). Convert the in-modal Browse button to `<Button icon="folder-open">Browse</Button>`.

- [ ] **Step 3: Header controls → Button**

Convert the Rescan and "Add game" buttons (and, optionally, leave the list/grid segmented control as-is) to `<Button>`: Rescan → `<Button icon="refresh-cw" loading={scanning} onClick={handleScan}>{scanning ? 'Scanning…' : 'Rescan'}</Button>`; Add game → `<Button variant="primary" icon="plus" onClick={() => setModalOpen(true)}>Add game</Button>`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home.jsx
git commit -m "feat(ui): Home manual-add modal + controls on Modal/Button"
```

---

## Notes for the implementer

- `Button` forwards arbitrary props, so `title`, `type`, `className` (merged last) all work. Use
  `className="ml-auto"` etc. for layout tweaks rather than new variants.
- `Modal` owns the overlay/click-away/close; when adopting it, delete the old hand-rolled overlay
  markup entirely — don't nest one inside the other.
- The toast store actions are `pushToast({ type, message })` and `dismissToast(id)`; types are
  `success | error | info`. Keep messages short (they cap at `max-w-xs`).
- Don't change preset/mod backend behavior beyond Task 5's `create` setting the new preset active.
- After all tasks: final whole-feature review, then finish the branch (merge to main + push) per the
  standing workflow.
```
