<script lang="ts">
  import { newWorkspacePromptOpen, createNewWorkspace } from '$lib/stores/workspace';

  let nameInput = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let submitted = false;

  $effect(() => {
    inputEl?.focus();
  });

  function confirm() {
    if (submitted) return;
    submitted = true;
    createNewWorkspace(nameInput.trim() || undefined);
    newWorkspacePromptOpen.set(false);
    nameInput = '';
  }

  function cancel() {
    if (submitted) return;
    submitted = true;
    newWorkspacePromptOpen.set(false);
    nameInput = '';
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirm(); }
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) cancel();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="New Workspace"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleKeyDown}
>
  <div class="modal">
    <div class="modal-header">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span>New Workspace</span>
    </div>

    <input
      bind:this={inputEl}
      bind:value={nameInput}
      class="name-input"
      type="text"
      placeholder="Workspace name…"
      onkeydown={handleKeyDown}
    />

    <div class="modal-footer">
      <span class="hint">Enter to create · Esc to cancel</span>
    </div>
  </div>
</div>

<style>
  .backdrop {
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
    animation: fade-in 0.12s ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .modal {
    width: 380px;
    max-width: calc(100vw - 40px);
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.4), 0 8px 20px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    animation: slide-in 0.14s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes slide-in {
    from { transform: translateY(-12px); opacity: 0; }
    to   { transform: translateY(0);     opacity: 1; }
  }

  .modal-header {
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

  .modal-header svg { flex-shrink: 0; opacity: 0.7; }

  .name-input {
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

  .name-input::placeholder {
    color: var(--text-muted);
    opacity: 0.5;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    padding: 8px 16px 12px;
    border-top: 1px solid var(--border-subtle);
  }

  .hint {
    font-size: 10.5px;
    color: var(--text-muted);
    opacity: 0.6;
  }
</style>
