// EnvManager.tsx — per-project environment variable vault.
// Values are stored in the OS keychain (the same secrets backend as API keys),
// usable as {{VAR}} in the HTTP client and injectable into the terminal.
import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { get } from '$lib/stores/storeCompat';
import { closeEnvManager } from '$lib/stores/layout';
import { activeProjectId } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { activeSessionId, writeToSession } from '$lib/stores/terminal';
import './EnvManager.css';

interface Row {
  id: string;
  key: string;
  value: string;
  reveal: boolean;
}

let rowSeq = 0;
function makeRow(key = '', value = ''): Row {
  return { id: `r${rowSeq++}`, key, value, reveal: false };
}

export default function EnvManager({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const pid = get(activeProjectId);
    if (!pid) {
      setRows([]);
      setLoading(false);
      return;
    }
    try {
      const vars = await invoke<{ key: string; value: string }[]>('env_vault_get', { projectId: pid });
      setRows(vars.map((v) => makeRow(v.key, v.value)));
    } catch (err) {
      showToast(String(err), 'error');
      setRows([]);
    } finally {
      setDirty(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Mirrors the `finally` block which seeded an empty row whenever the
  // row list ended up empty after a load/import/remove.
  useEffect(() => {
    if (!loading && rows.length === 0) {
      setRows([makeRow()]);
    }
  }, [loading, rows]);

  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
    setDirty(true);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
  }

  function updateRowKey(id: string, key: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, key } : r)));
    setDirty(true);
  }

  function updateRowValue(id: string, value: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
    setDirty(true);
  }

  function toggleReveal(id: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, reveal: !r.reveal } : r)));
  }

  async function save() {
    const pid = get(activeProjectId);
    if (!pid) {
      showToast('Open a project first', 'error');
      return;
    }
    setSaving(true);
    try {
      const vars = rows
        .map((r) => ({ key: r.key.trim(), value: r.value }))
        .filter((v) => v.key.length > 0);
      await invoke('env_vault_set', { projectId: pid, vars });
      showToast('Environment saved', 'success');
      setDirty(false);
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function importDotenv() {
    const pid = get(activeProjectId);
    if (!pid) return;
    setImporting(true);
    try {
      const vars = await invoke<{ key: string; value: string }[]>('env_vault_import_dotenv', { projectId: pid });
      setRows(vars.map((v) => makeRow(v.key, v.value)));
      setDirty(false);
      showToast('Imported from .env', 'success');
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setImporting(false);
    }
  }

  // Build shell-appropriate assignment lines and write them to the active
  // terminal. PowerShell on Windows, POSIX export elsewhere.
  function injectToTerminal() {
    const sid = get(activeSessionId);
    if (sid == null) {
      showToast('Open a terminal first', 'error');
      return;
    }
    const vars = rows.filter((r) => r.key.trim());
    if (vars.length === 0) return;

    const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent);
    const lines = vars.map((r) => {
      const key = r.key.trim();
      if (isWindows) {
        return `$env:${key} = '${r.value.replace(/'/g, "''")}'`;
      }
      return `export ${key}='${r.value.replace(/'/g, "'\\''")}'`;
    });
    writeToSession(sid, lines.join('\r') + '\r');
    showToast(`Injected ${vars.length} variable${vars.length === 1 ? '' : 's'} into the terminal`, 'success');
  }

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      // Embedded in the utility drawer it's a docked panel, not a modal, so
      // Escape shouldn't dismiss it (the drawer owns close).
      if (e.key === 'Escape' && !embedded) closeEnvManager();
      else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, embedded]);

  return (
    <div
      className={`env-overlay${embedded ? ' embedded' : ''}`}
      role="presentation"
      onClick={embedded ? undefined : closeEnvManager}
    >
      <div
        className="env-modal"
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : 'true'}
        aria-label="Environment manager"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="env-header">
          <div className="env-titles">
            <h2 className="env-title">Environment</h2>
            <p className="env-sub">
              Stored securely in your OS keychain. Use <code>{'{{VAR}}'}</code> in the HTTP client.
            </p>
          </div>
          {!embedded && (
            <button className="close-btn" onClick={closeEnvManager} title="Close (Esc)" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="env-body scrollable">
          {loading ? (
            <div className="env-message">Loading…</div>
          ) : (
            <>
              <div className="env-table">
                <div className="env-row env-row-head">
                  <span className="col-key">Name</span>
                  <span className="col-val">Value</span>
                  <span className="col-act"></span>
                </div>
                {rows.map((row) => (
                  <div className="env-row" key={row.id}>
                    <input
                      className="env-input key"
                      placeholder="API_KEY"
                      spellCheck={false}
                      autoComplete="off"
                      value={row.key}
                      onChange={(e) => updateRowKey(row.id, e.target.value)}
                    />
                    <div className="val-wrap">
                      <input
                        className="env-input val"
                        type={row.reveal ? 'text' : 'password'}
                        placeholder="value"
                        spellCheck={false}
                        autoComplete="off"
                        value={row.value}
                        onChange={(e) => updateRowValue(row.id, e.target.value)}
                      />
                      <button
                        className="reveal-btn"
                        onClick={() => toggleReveal(row.id)}
                        title={row.reveal ? 'Hide' : 'Reveal'}
                        aria-label={row.reveal ? 'Hide value' : 'Reveal value'}
                      >
                        {row.reveal ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <button className="row-del" onClick={() => removeRow(row.id)} title="Remove" aria-label="Remove variable">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button className="add-row" onClick={addRow}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add variable
              </button>
            </>
          )}
        </div>

        <div className="env-footer">
          <div className="footer-left">
            <button className="ghost-btn" onClick={importDotenv} disabled={importing}>
              {importing ? 'Importing…' : 'Import .env'}
            </button>
            <button className="ghost-btn" onClick={injectToTerminal}>
              Inject to terminal
            </button>
          </div>
          <div className="footer-right">
            {!embedded && (
              <button className="ghost-btn" onClick={closeEnvManager}>
                Close
              </button>
            )}
            <button className="save-btn" onClick={save} disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
