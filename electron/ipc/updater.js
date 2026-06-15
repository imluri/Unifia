const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

// Auto-update against GitHub Releases. Downloads in the background and tells the
// renderer when an update is ready; the user chooses when to restart. No-ops in
// dev (autoUpdater needs a packaged app + a published latest.yml).
function initUpdater(emit) {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => emit('update-available', { version: info.version }));
  autoUpdater.on('update-downloaded', (info) => emit('update-downloaded', { version: info.version }));
  // Never nag on transient failures (offline, no release yet, etc.) — log only.
  autoUpdater.on('error', (err) => console.error('[updater]', (err && err.message) || err));

  autoUpdater.checkForUpdates().catch(() => {});
}

// Quit and install the downloaded update (relaunches into the new version).
function installUpdate() {
  autoUpdater.quitAndInstall();
  return true;
}

module.exports = { initUpdater, installUpdate };
