<!-- EnvManager.svelte — per-project environment variable vault.
     Values are stored in the OS keychain (the same secrets backend as API keys),
     usable as {{VAR}} in the HTTP client and injectable into the terminal. -->
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { closeEnvManager } from '$lib/stores/layout';
  import { activeProjectId } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { activeSessionId, writeToSession } from '$lib/stores/terminal';
  import { get } from 'svelte/store';

  interface Row {
    id: string;
    key: string;
    value: string;
    reveal: boolean;
  }

  let rows = $state<Row[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let importing = $state(false);
  let dirty = $state(false);

  let rowSeq = 0;
  function makeRow(key = '', value = ''): Row {
    return { id: `r${rowSeq++}`, key, value, reveal: false };
  }

  async function load() {
    loading = true;
    const pid = get(activeProjectId);
    if (!pid) {
      rows = [];
      loading = false;
      return;
    }
    try {
      const vars = await invoke<{ key: string; value: string }[]>('env_vault_get', { projectId: pid });
      rows = vars.map((v) => makeRow(v.key, v.value));
    } catch (err) {
      showToast(String(err), 'error');
      rows = [];
    } finally {
      if (rows.length === 0) rows = [makeRow()];
      dirty = false;
      loading = false;
    }
  }

  function addRow() {
    rows = [...rows, makeRow()];
    dirty = true;
  }

  function removeRow(id: string) {
    rows = rows.filter((r) => r.id !== id);
    if (rows.length === 0) rows = [makeRow()];
    dirty = true;
  }

  function markDirty() {
    dirty = true;
  }

  async function save() {
    const pid = get(activeProjectId);
    if (!pid) {
      showToast('Open a project first', 'error');
      return;
    }
    saving = true;
    try {
      const vars = rows
        .map((r) => ({ key: r.key.trim(), value: r.value }))
        .filter((v) => v.key.length > 0);
      await invoke('env_vault_set', { projectId: pid, vars });
      showToast('Environment saved', 'success');
      dirty = false;
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      saving = false;
    }
  }

  async function importDotenv() {
    const pid = get(activeProjectId);
    if (!pid) return;
    importing = true;
    try {
      const vars = await invoke<{ key: string; value: string }[]>('env_vault_import_dotenv', { projectId: pid });
      rows = vars.map((v) => makeRow(v.key, v.value));
      if (rows.length === 0) rows = [makeRow()];
      dirty = false;
      showToast('Imported from .env', 'success');
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      importing = false;
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

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeEnvManager();
    else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      void save();
    }
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="env-overlay" role="presentation" onclick={closeEnvManager}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="env-modal" role="dialog" aria-modal="true" aria-label="Environment manager" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <div class="env-header">
      <div class="env-titles">
        <h2 class="env-title">Environment</h2>
        <p class="env-sub">Stored securely in your OS keychain. Use <code>{'{{VAR}}'}</code> in the HTTP client.</p>
      </div>
      <button class="close-btn" onclick={closeEnvManager} title="Close (Esc)" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>

    <div class="env-body scrollable">
      {#if loading}
        <div class="env-message">Loading…</div>
      {:else}
        <div class="env-table">
          <div class="env-row env-row-head">
            <span class="col-key">Name</span>
            <span class="col-val">Value</span>
            <span class="col-act"></span>
          </div>
          {#each rows as row (row.id)}
            <div class="env-row">
              <input
                class="env-input key"
                placeholder="API_KEY"
                spellcheck="false"
                autocomplete="off"
                bind:value={row.key}
                oninput={markDirty}
              />
              <div class="val-wrap">
                <input
                  class="env-input val"
                  type={row.reveal ? 'text' : 'password'}
                  placeholder="value"
                  spellcheck="false"
                  autocomplete="off"
                  bind:value={row.value}
                  oninput={markDirty}
                />
                <button
                  class="reveal-btn"
                  onclick={() => (row.reveal = !row.reveal)}
                  title={row.reveal ? 'Hide' : 'Reveal'}
                  aria-label={row.reveal ? 'Hide value' : 'Reveal value'}
                >
                  {#if row.reveal}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  {:else}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  {/if}
                </button>
              </div>
              <button class="row-del" onclick={() => removeRow(row.id)} title="Remove" aria-label="Remove variable">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          {/each}
        </div>
        <button class="add-row" onclick={addRow}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add variable
        </button>
      {/if}
    </div>

    <div class="env-footer">
      <div class="footer-left">
        <button class="ghost-btn" onclick={importDotenv} disabled={importing}>
          {importing ? 'Importing…' : 'Import .env'}
        </button>
        <button class="ghost-btn" onclick={injectToTerminal}>Inject to terminal</button>
      </div>
      <div class="footer-right">
        <button class="ghost-btn" onclick={closeEnvManager}>Close</button>
        <button class="save-btn" onclick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .env-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-glass, rgba(4, 4, 6, 0.62));
    backdrop-filter: blur(10px);
    z-index: 9997;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(12px, 5vh, 60px) clamp(12px, 5vw, 60px);
  }

  .env-modal {
    width: 100%;
    max-width: 640px;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    background: rgba(var(--editor-bg-rgb, 24, 24, 30), var(--frost-chrome, 0.72));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--glass-shadow, var(--shadow-lg)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    overflow: hidden;
  }

  .env-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 18px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .env-title {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
    color: var(--text-primary);
  }

  .env-sub {
    margin: 3px 0 0;
    font-size: 11px;
    color: var(--text-muted);
  }

  .env-sub code {
    font-family: var(--font-mono, ui-monospace, monospace);
    background: var(--bg-hover);
    padding: 1px 4px;
    border-radius: 4px;
    font-size: 10.5px;
    color: var(--accent);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .env-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px 18px;
  }

  .env-message {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }

  .env-table {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .env-row {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.4fr) 28px;
    gap: 8px;
    align-items: center;
  }

  .env-row-head {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-muted);
    padding: 0 2px 2px;
  }

  .env-input {
    width: 100%;
    min-width: 0;
    background: var(--input-bg, color-mix(in srgb, var(--bg-secondary) 60%, transparent));
    border: 1px solid var(--input-border, var(--border));
    border-radius: 7px;
    padding: 7px 9px;
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    font-family: var(--font-mono, ui-monospace, monospace);
    transition: border-color 0.15s;
  }
  .env-input:focus {
    border-color: var(--input-focus-border, var(--accent));
  }
  .env-input.key {
    font-weight: 600;
  }

  .val-wrap {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .val-wrap .val {
    padding-right: 30px;
  }

  .reveal-btn {
    position: absolute;
    right: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .reveal-btn:hover {
    color: var(--text-primary);
  }

  .row-del {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .row-del:hover {
    background: color-mix(in srgb, var(--error) 14%, transparent);
    color: var(--error);
  }

  .add-row {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding: 6px 10px;
    font-size: 11.5px;
    color: var(--text-secondary);
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 7px;
    cursor: pointer;
  }
  .add-row:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .env-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .footer-left,
  .footer-right {
    display: flex;
    gap: 8px;
  }

  .ghost-btn {
    font-size: 11.5px;
    padding: 6px 12px;
    border-radius: 7px;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ghost-btn:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .ghost-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .save-btn {
    font-size: 11.5px;
    font-weight: 600;
    padding: 6px 16px;
    border-radius: 7px;
    border: 1px solid color-mix(in srgb, var(--accent) 70%, transparent);
    background: var(--accent);
    color: var(--button-text, #fff);
    cursor: pointer;
  }
  .save-btn:hover:not(:disabled) {
    background: var(--accent-hover, var(--accent));
  }
  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .scrollable::-webkit-scrollbar {
    width: 6px;
  }
  .scrollable::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.15));
    border-radius: 3px;
  }
</style>
