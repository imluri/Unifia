// Get the app version from package.json (available via import.meta.env at build time)
export function getAppVersion() {
  // During build, Vite injects __APP_VERSION__ as a define variable
  // Fallback to a default if not available (e.g., in preview mode)
  return typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
}
