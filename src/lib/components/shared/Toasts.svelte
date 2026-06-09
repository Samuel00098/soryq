<script lang="ts">
  import { fly } from 'svelte/transition';
  import { toasts, dismissToast } from '$lib/stores/notification';
</script>

<div class="toast-container">
  {#each $toasts as toast (toast.id)}
    <div class="toast {toast.type}" role="alert" out:fly={{ y: 8, duration: 180, opacity: 0 }}>
      <div class="toast-icon">
        {#if toast.type === 'success'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        {:else if toast.type === 'error'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        {:else if toast.type === 'warning'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        {/if}
      </div>
      <div class="toast-message">{toast.message}</div>
      {#if toast.action}
        <button
          class="toast-action"
          onclick={() => { toast.action!.onClick(); dismissToast(toast.id); }}
        >{toast.action.label}</button>
      {/if}
      <button class="toast-close" onclick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  {/each}
</div>

<style>
  .toast-container {
    position: fixed;
    bottom: 32px;
    right: 24px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 380px;
    width: 100%;
    pointer-events: none;
    transition: left 0.2s ease, right 0.2s ease;
  }


  .toast {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-radius: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border);
    color: var(--text-primary);
    pointer-events: auto;
    animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    gap: 12px;
  }

  @keyframes slideIn {
    from {
      transform: translateY(12px) scale(0.95);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }

  .toast-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: 6px;
  }

  /* Success styles */
  .toast.success {
    border-left: 4px solid var(--success);
  }
  .toast.success .toast-icon {
    color: var(--success);
    background: color-mix(in srgb, var(--success) 15%, transparent);
  }

  /* Error styles */
  .toast.error {
    border-left: 4px solid var(--error);
  }
  .toast.error .toast-icon {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 15%, transparent);
  }

  /* Warning styles */
  .toast.warning {
    border-left: 4px solid var(--warning);
  }
  .toast.warning .toast-icon {
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 15%, transparent);
  }

  /* Info styles */
  .toast.info {
    border-left: 4px solid var(--accent);
  }
  .toast.info .toast-icon {
    color: var(--accent);
    background: var(--accent-light);
  }

  .toast-message {
    flex: 1;
    font-size: 13px;
    line-height: 1.4;
    font-weight: 500;
  }

  .toast-action {
    flex-shrink: 0;
    padding: 4px 10px;
    background: var(--accent);
    border: none;
    border-radius: 5px;
    color: var(--button-text, #fff);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .toast-action:hover {
    opacity: 0.85;
  }

  .toast-close {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.15s, color 0.15s;
  }

  .toast-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
