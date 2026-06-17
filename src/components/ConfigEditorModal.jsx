import React, { useEffect, useState } from 'react';
import Modal from './ui/Modal.jsx';
import Button from './ui/Button.jsx';

function parseConfigLines(text) {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => {
    if (/^\s*(?:;|#)/.test(line) || /^\s*\[.*\]\s*$/.test(line) || !line.includes('=')) {
      return { type: 'meta', raw: line };
    }
    const match = line.match(/^(\s*)([^=]+?)(\s*=\s*)(.*)$/);
    if (!match) return { type: 'meta', raw: line };
    const [, leading, key, separator, rest] = match;
    const commentMatch = rest.match(/^(.*?)(\s*[;#].*)$/);
    const value = commentMatch ? commentMatch[1] : rest;
    const comment = commentMatch ? commentMatch[2] : '';
    return {
      type: 'kv',
      raw: line,
      leading,
      key: key.trimEnd(),
      separator,
      value,
      comment,
    };
  });
}

function formatConfigLines(lines, trailingNewline) {
  const text = lines
    .map((line) => {
      if (line.type !== 'kv') return line.raw;
      return `${line.leading}${line.key}${line.separator}${line.value}${line.comment}`;
    })
    .join('\r\n');
  return trailingNewline ? `${text}\r\n` : text;
}

export default function ConfigEditorModal({ game, open, onClose, configFile }) {
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [lines, setLines] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [trailingNewline, setTrailingNewline] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFiles([]);
    setSelected(null);
    setLines([]);
    setDirty(false);
    setTrailingNewline(false);
    if (configFile) {
      (async () => {
        setLoading(true);
        try {
          const inferred = await window.unifia.inferConfigFile(game.id, configFile);
          if (inferred) {
            await openFile(inferred);
          } else {
            setSelected(null);
          }
        } catch (err) {
          alert('Failed to infer config file: ' + (err.message || err));
        } finally {
          setLoading(false);
        }
      })();
      return;
    }
    window.unifia.listConfigs(game.id).then((list) => setFiles(list)).catch(() => setFiles([]));
  }, [open, game, configFile]);

  async function openFile(name) {
    setLoading(true);
    try {
      const text = await window.unifia.readConfig(game.id, name);
      setSelected(name);
      setLines(parseConfigLines(text));
      setTrailingNewline(/\r?\n$/.test(text));
      setDirty(false);
    } catch (err) {
      alert('Failed to read config: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!selected) return;
    setLoading(true);
    try {
      const text = formatConfigLines(lines, trailingNewline);
      await window.unifia.writeConfig(game.id, selected, text);
      setDirty(false);
    } catch (err) {
      alert('Failed to save config: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  }

  function updateLineValue(index, value) {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], value };
      return next;
    });
    setDirty(true);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Config — ${game.name}`} size="lg" footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex gap-4">
        {!configFile && (
          <div className="w-64 overflow-auto rounded bg-neutral-900/40 p-2">
            {files.length === 0 ? (
              <div className="text-sm text-neutral-500">No config files found.</div>
            ) : (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f.name}>
                    <button
                      onClick={() => openFile(f.name)}
                      className={`w-full text-left rounded px-2 py-1 text-sm ${selected === f.name ? 'bg-accent/10 text-accent' : 'text-neutral-300 hover:bg-surface-hover'}`}
                    >
                      {f.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex-1">
          {selected ? (
            <div className="flex h-[60vh] flex-col gap-2">
              <div className="overflow-auto rounded bg-neutral-900/40 p-3 text-sm text-neutral-300">
                {loading ? (
                  <div>Loading…</div>
                ) : lines.filter((line) => line.type === 'kv').length === 0 ? (
                  <div>No editable entries in this file.</div>
                ) : (
                  <div className="space-y-2">
                    {lines.map((line, index) => (
                      line.type === 'kv' ? (
                        <div key={index} className="grid gap-2 rounded border border-white/5 bg-neutral-950/50 p-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                            <span className="font-mono text-neutral-300">{line.leading || ''}{line.key}{line.separator}</span>
                            {line.comment && <span>{line.comment}</span>}
                          </div>
                          <input
                            value={line.value}
                            onChange={(e) => updateLineValue(index, e.target.value)}
                            className="w-full rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-100 outline-none ring-1 ring-border-default focus:ring-accent/50"
                          />
                        </div>
                      ) : null
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button variant="primary" onClick={save} disabled={!dirty || loading}>
                  Save
                </Button>
                <Button onClick={() => openFile(selected)} disabled={loading}>Reload</Button>
                <span className="ml-auto text-xs text-neutral-500">{loading ? 'Working…' : dirty ? 'Unsaved changes' : 'Saved'}</span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-neutral-500">Select a config file to view and edit.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}
