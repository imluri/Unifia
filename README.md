# Unifia

**Cross-store multiplayer game launcher.** Play with friends regardless of which store they bought the game on — Steam, GOG, Epic, or anywhere else — over a direct IP connection, bypassing platform-specific lobby systems.

Unifia is free and open source under the [MIT License](#license).

---

## What Unifia is

Many multiplayer games tie their lobbies to the store you bought them from. If your friend owns the Steam copy and you own the GOG copy, the built-in matchmaking often won't let you play together — even though it's literally the same game.

Unifia gets around that by:

- **No platform lock-in** — it doesn't care which store a game came from. It scans your installed games across stores and treats them uniformly.
- **Direct IP connection** — one player hosts and opens a port; everyone else connects by `IP:PORT`. No external lobby service in between.
- **A module system** — loaders and patchers (like BepInEx) that some games need are *downloaded on demand* from their official sources. Nothing is bundled with Unifia; you choose exactly what gets installed and which version.

## How it works

1. **Scan** your library. Unifia looks in the default install folder for each store and lists what it finds. You can also add games manually.
2. **Install a module** (optional). On the **Modules** page, fetch available BepInEx versions straight from GitHub Releases, pick one, and install it. Multiple versions can live side by side; one is marked active per game.
3. **Patch** (game-specific). For games that use Photon (e.g. *REPO*), Unifia writes a shared Photon AppId into the BepInEx config so cross-store players land in the same session.
4. **Host or Join** from the **Lobby** page. The host opens a TCP port; clients connect by IP. On connect, both sides exchange game id, version, and username, and Unifia flags any version mismatch.
5. **Launch.** Before launching, Unifia copies the active module's files into the game directory, then starts the game.

## Tech stack

- **Electron** — desktop shell / main process
- **React + Vite** — renderer UI
- **Tailwind CSS** — styling
- **zustand** — renderer state
- **electron-store** — persistent config
- Node's built-in `net` module for lobby networking

## Project structure

```
unifia/
├── electron/            # Main process
│   ├── main.js          # Window + IPC wiring
│   ├── preload.js       # contextBridge → window.unifia
│   ├── store.js         # electron-store schema
│   ├── paths.js         # unifia_data layout
│   └── ipc/
│       ├── gameScanner.js
│       ├── launcher.js
│       ├── patcher.js
│       ├── network.js
│       └── moduleManager.js
├── src/                 # Renderer (React)
│   ├── App.jsx
│   ├── pages/           # Home, Lobby, Modules, Settings, About
│   ├── components/
│   └── store/useAppStore.js
├── index.html
└── package.json
```

## Setup

Requires **Node.js 18+**.

```bash
# install dependencies
npm install

# run in development (Vite dev server + Electron with hot reload)
npm run dev

# build the renderer for production
npm run build

# run the production build in Electron
npm start

# package a distributable installer (electron-builder)
npm run dist
```

`npm run dev` starts the Vite dev server on port 5173 and launches Electron once it's ready.

## Adding games manually

If a game isn't auto-detected (custom install location, portable copy, etc.):

1. Go to **Home → + Add game**.
2. Enter the game name and the full path to its executable.
3. Optionally set a version and pick the store it belongs to.
4. Click **Add** — it now appears in your library and behaves like a detected game.

You can also add extra scan folders under **Settings → Store paths → Custom paths**.

## Installing BepInEx via the module manager

1. Open the **Modules** page.
2. On the **BepInEx (Unity Mono)** or **BepInEx (Unity IL2CPP)** card, click **Fetch versions** — Unifia queries the official BepInEx GitHub releases.
3. Pick a version from the dropdown. Stable releases are shown by default; tick **Show pre-releases** to include bleeding-edge builds (needed for most IL2CPP versions).
4. Click **Install**. A progress bar tracks the download and extraction. Files land in `unifia_data/modules/<module>/<version>/`.
5. Multiple versions can be installed at once. Use **Set as default** to choose the active one, and **Uninstall** to remove a version.

The active module is copied into a game's folder automatically the next time you launch it.

## Data on disk

Unifia keeps everything it downloads under a `unifia_data/` folder (location configurable in Settings):

```
unifia_data/
├── modules/            # installed loaders, one folder per version
├── downloads/          # temporary zips during install
└── logs/
```

Persistent config (your games, settings, and module/profile links) is stored via `electron-store`.

## Disclaimer

Unifia is an independent, community project. It is **not affiliated with** Valve, GOG, Epic Games, or the BepInEx project. Only use it with games and tools you own and are licensed to use. Respect each game's terms of service.

## License

```
MIT License

Copyright (c) 2026 Unifia Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```

See [LICENSE](LICENSE) for the full text.
