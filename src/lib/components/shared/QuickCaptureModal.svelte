<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';

  let { onclose }: { onclose: () => void } = $props();

  let inputEl = $state<HTMLInputElement | null>(null);
  let value = $state('');
  let saving = $state(false);

  $effect(() => {
    inputEl?.focus();
  });

  async function handleSubmit() {
    const text = value.trim();
    if (!text) { onclose(); return; }
    if (saving) return;
    saving = true;

    const project = $activeProject;
    if (!project) {
      showToast('No active project — thought not saved', 'warning');
      onclose();
      return;
    }

    const dir = `${project.root_path}/.soryq`;
    const inboxPath = `${project.root_path}/.soryq/inbox.md`;
    const now = new Date().toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    const entry = `\n- ${text} *(${now})*`;

    try {
      try { await invoke('fs_create_dir', { path: dir }); } catch { /* exists */ }

      let existing = '';
      try {
        existing = await invoke<string>('fs_read_file', { path: inboxPath });
      } catch {
        existing = '# Inbox\n';
      }

      await invoke('fs_write_file', { path: inboxPath, content: existing + entry });
      showToast('Captured!', 'success');
    } catch {
      showToast('Failed to save — check console', 'error');
    }

    onclose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
    if (e.key === 'Escape') onclose();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="qc-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Quick Capture"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleKeyDown}
>
  <div class="qc-card">
    <div class="qc-header">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <span>Quick Capture</span>
    </div>

    <input
      class="qc-input"
      type="text"
      placeholder="Capture a thought…"
      bind:this={inputEl}
      bind:value
      onkeydown={handleKeyDown}
      disabled={saving}
    />

    <div class="qc-footer">
      <span class="qc-hint">Enter to save · Esc to dismiss</span>
      <span class="qc-dest">.soryq/inbox.md</span>
    </div>
  </div>
</div>

<style>
  .qc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 8000;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 18vh;
    animation: qc-fade-in 0.12s ease;
  }

  @keyframes qc-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .qc-card {
    width: 480px;
    max-width: calc(100vw - 40px);
    background: rgba(var(--editor-bg-rgb, 24, 24, 30), var(--frost-chrome, 0.62));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--glass-shadow, 0 24px 60px rgba(0, 0, 0, 0.4)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    overflow: hidden;
    animation: qc-slide-in 0.14s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes qc-slide-in {
    from { transform: translateY(-12px); opacity: 0; }
    to   { transform: translateY(0);     opacity: 1; }
  }

  .qc-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px 10px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .qc-header svg {
    flex-shrink: 0;
    opacity: 0.7;
  }

  .qc-input {
    width: 100%;
    padding: 16px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 15px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    caret-color: var(--accent);
  }

  .qc-input::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
  }

  .qc-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .qc-hint {
    font-size: 10.5px;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .qc-dest {
    font-size: 10px;
    color: var(--accent);
    opacity: 0.7;
    font-family: var(--font-mono, monospace);
  }
</style>
