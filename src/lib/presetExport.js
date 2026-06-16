// Preset export/import utilities
export function exportPreset(presetName, mods, metadata = {}) {
  const preset = {
    version: 1,
    name: presetName,
    exportedAt: new Date().toISOString(),
    metadata,
    mods: Object.entries(mods).map(([fullName, data]) => ({
      fullName,
      version: data.version,
      enabled: data.enabled,
      loadOrder: data.loadOrder || 0,
    })),
  };
  return JSON.stringify(preset, null, 2);
}

export function importPreset(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (data.version !== 1) {
      throw new Error(`Unsupported preset version: ${data.version}`);
    }
    if (!data.mods || !Array.isArray(data.mods)) {
      throw new Error('Invalid preset format: missing mods array');
    }
    return data;
  } catch (err) {
    throw new Error(`Failed to parse preset: ${err.message}`);
  }
}

export function downloadPreset(presetJson, filename = 'preset.json') {
  const blob = new Blob([presetJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
