# UI Enhancement Pass — Design Spec

**Date:** 2026-06-15
**Status:** Approved (pending spec review)

## Goal

A consolidated UI quality pass: a clearer preset bar (New auto-switches, no dead "Save"),
shared `Button`/`Modal` primitives adopted on the main surfaces, a toast feedback system, and a set
of small UX fixes. Build consistency without an app-wide rewrite.

## Scope

In: preset bar overhaul, shared UI primitives applied to **main surfaces only**, toast system, small
UX fixes. Out: app-wide button/modal refactor; the parked mod config editor; any backend/mod-system
behavior change beyond what the preset-bar fix needs.

## Foundation — shared primitives (`src/components/ui/`)

### `Button.jsx`
`<Button variant size icon loading disabled onClick className>children</Button>`
- `variant`: `primary` (accent fill), `secondary` (neutral-700), `danger` (red), `ghost`
  (transparent, hover surface). Default `secondary`.
- `size`: `sm` (`px-2 py-1 text-xs`), `md` (`px-3 py-1.5 text-sm`). Default `md`.
- `icon`: optional Icon name rendered left of children at a size matched to `size`.
- `loading`: shows a spinning `refresh-cw` and disables the button.
- Forwards remaining props (`title`, `type`, etc.). Encapsulates the repeated
  `rounded … transition hover:… disabled:opacity-50` patterns.

### `Modal.jsx`
`<Modal open onClose title size footer>children</Modal>`
- Renders nothing when `!open`. Fixed overlay (`bg-black/60`), click-away to `onClose`, panel stops
  propagation. Header with `title` + close (`x`) button; scrollable body; optional `footer`.
- `size`: `sm` (`w-80`), `md` (`w-[34rem]`). Default `md`.

### `ConfirmDialog.jsx`
`<ConfirmDialog open title message confirmLabel danger onConfirm onClose loading>` — built on
`Modal size="sm"`. Cancel + confirm buttons (confirm uses `danger` variant when `danger`).

### Icons
Add Lucide SVGs (stroke="currentColor") to `src/assets/icons/`: `play`, `trash-2`, `pencil`,
`check`. The existing `Icon` component auto-discovers them.

## Cluster 1 — Preset bar overhaul

- **New auto-switches.** `electron/ipc/presets.js create(gameId, name, fromActive)` sets the new
  preset active before returning the list. The store `createPreset` then reloads presets and the
  installed list (so the Installed tab reflects the new active preset). "New" duplicates the current
  loadout (`fromActive: true`) into a new named preset and switches to it.
- **Remove "Save".** Mods write straight to the active preset (`modManager.saveModsState` →
  `presetStore.setActiveMods`), so there is no separate working copy and nothing to save. The Save
  button and the `updatePreset` store action / `presets.updateFromActive` op become unused; remove
  the button (leave the backend op in place — harmless, but no UI calls it).
- **Layout.** `PresetBar` becomes: `Preset [▾ dropdown]` then icon `Button`s — New (`plus`), Rename
  (`pencil`), Delete (`trash-2`) — a thin divider, then `Copy code` / `Import code`. Inline rename
  and import rows stay (inline naming, since Electron disables `window.prompt`). Delete uses the new
  `ConfirmDialog`.
- **Count↔list consistency.** `switchPreset`, `createPreset`, `deletePreset`, `importPreset` all
  reload both `presets[gameId]` and `installedMods` (via `loadMods`). This removes the `(N)` vs
  "No mods installed" drift.

## Cluster 2 — Shared Button + Modal on main surfaces

Refactor these onto the primitives (no behavior change, just consistent markup):
`src/pages/GameDetail.jsx` (header actions), `src/components/PresetBar.jsx`,
`src/components/InviteModal.jsx`, `src/components/GameModuleModal.jsx`,
`src/pages/Home.jsx` (ManualAddModal + the Rescan/Add/segmented/search controls). Each hand-rolled
overlay becomes `<Modal>`; each ad-hoc button becomes `<Button>`. Other files keep their current
buttons and can adopt the primitives later.

## Cluster 3 — Toast feedback system

- **Store slice** (`useAppStore`): `toasts: []`, `pushToast({ type, message })` →
  appends `{ id, type, message }` (id = incrementing/`Date.now()`); `dismissToast(id)` removes it.
  `type`: `success | error | info`.
- **`<Toaster/>`** (`src/components/Toaster.jsx`): fixed bottom-right stack; each toast auto-dismisses
  after 3500ms (timer in the toast item, cleared on unmount) and has a manual close. Mounted once in
  `App.jsx`'s `MainLayout`.
- **Pure helper** (`src/lib/toasts.js`): `addToast(list, toast, id)` and `removeToast(list, id)`
  operate on a plain array and are unit-tested; the store actions wrap them with id generation +
  state set.
- **Routing feedback to toasts:** mod installed / updated (success), "Copied invite"/"Copied code"
  (success), preset switched/created/deleted (success/info), and caught errors on the refactored
  surfaces (error). GameDetail's inline `notice` banner is replaced by toasts; launch result + folder
  change become toasts.

## Cluster 4 — Small UX fixes

- **Installed empty state** → a "Browse mods" `Button` (ghost) that calls `setTab('browse')` instead
  of the plain "Switch to Browse." text.
- **Connector row "Manage in Multiplayer →"** → a `ghost` `Button` that calls `setTab('multiplayer')`.
  Requires the connector row to receive an `onManage` callback from GameDetail (the pinned row lives
  in GameDetail, so it already has `setTab`).
- **Header icons:** Launch gets `play`, Module gets `package`, for parity with Change folder / Invite
  / Remove.

## Data flow (preset bar)

```
New:    createPreset(name, fromActive:true) ─▶ presets.create sets active ─▶ store reloads presets + mods
Switch: switchPreset(id) ─▶ verify+install ─▶ store reloads presets + mods
Delete: ConfirmDialog ─▶ deletePreset ─▶ store reloads presets + mods
Any feedback ─▶ pushToast(...) ─▶ <Toaster/> shows + auto-dismisses
```

## Error handling

- Button `loading` prevents double-submit on async actions.
- Toast errors carry the caught `err.message`; never throw into render.
- ConfirmDialog `loading` disables confirm while the delete runs.
- Preset reloads tolerate transient IPC failure (keep the previous list).

## Testing

- **Pure unit tests:** the toast list reducer (`addToast` appends with id; `removeToast` filters).
- **Build + manual:** primitives render across the refactored surfaces; New switches and the
  Installed list updates; Delete confirm popup; toasts appear and auto-dismiss; empty-state and
  "Manage in Multiplayer" buttons switch tabs.

## Build order (informs the plan)

1. Icons + `Button` + `Modal` + `ConfirmDialog` primitives.
2. Toast store slice (+ pure reducer test) + `<Toaster/>` + mount in App.
3. Preset bar overhaul (backend `create` sets active; store reloads; PresetBar redesign on primitives
   + ConfirmDialog; route preset feedback to toasts).
4. Refactor remaining main surfaces (GameDetail header, InviteModal, GameModuleModal, Home) onto
   Button/Modal; route their feedback to toasts.
5. Small UX fixes (empty-state button, Manage-in-Multiplayer button, header icons).
