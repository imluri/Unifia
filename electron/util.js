// Use the runtime's global fetch when available (Electron 30 ships Node 20+),
// and transparently fall back to the node-fetch package otherwise. Keeping this
// behind one helper means the rest of the codebase never worries about it.
async function httpFetch(...args) {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch(...args);
  }
  const mod = await import('node-fetch');
  return mod.default(...args);
}

module.exports = { httpFetch };
