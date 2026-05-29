<script lang="ts">
  import { resolvePermission, pendingPermissionRequest, type PermissionKind } from '$lib/stores/permissions';

  let { onclose }: { onclose?: () => void } = $props();

  const LABELS: Record<PermissionKind, { title: string; description: string }> = {
    microphone: {
      title: 'wants to use your microphone',
      description: 'Required for voice input in the prompt bar. Your audio is processed locally and never stored.',
    },
  };

  const info = $derived(
    $pendingPermissionRequest ? (LABELS[$pendingPermissionRequest.kind] ?? LABELS.microphone) : LABELS.microphone
  );

  function allow() {
    resolvePermission(true);
    onclose?.();
  }

  function deny() {
    resolvePermission(false);
    onclose?.();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') deny();
    if (e.key === 'Enter') allow();
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) deny();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Microphone permission request"
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleKeyDown}
>
  <div class="dialog">
    <div class="icon-ring">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    </div>

    <div class="body">
      <p class="app-name">Soryq</p>
      <h2 class="title">{info.title}</h2>
      <p class="description">{info.description}</p>
    </div>

    <div class="actions">
      <button class="btn-deny" onclick={deny}>Don't Allow</button>
      <button class="btn-allow" onclick={allow}>Allow</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 9500;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade-in 0.12s ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .dialog {
    width: 360px;
    max-width: calc(100vw - 48px);
    background: var(--bg-primary);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.04) inset,
      0 32px 80px rgba(0, 0, 0, 0.6),
      0 8px 24px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    animation: slide-up 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 32px 28px 24px;
    gap: 0;
    text-align: center;
  }

  @keyframes slide-up {
    from { transform: translateY(10px) scale(0.97); opacity: 0; }
    to   { transform: translateY(0) scale(1);       opacity: 1; }
  }

  .icon-ring {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--accent-light, rgba(6, 182, 212, 0.12));
    border: 1px solid rgba(6, 182, 212, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent, #06b6d4);
    margin-bottom: 20px;
    flex-shrink: 0;
  }

  .body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    margin-bottom: 28px;
  }

  .app-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary, #9494a6);
    margin: 0;
    letter-spacing: 0.01em;
  }

  .title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary, #f3f3f6);
    margin: 0 0 10px;
    line-height: 1.3;
  }

  .description {
    font-size: 12px;
    color: var(--text-muted, #555566);
    margin: 0;
    line-height: 1.55;
    max-width: 280px;
  }

  .actions {
    display: flex;
    gap: 10px;
    width: 100%;
  }

  .btn-deny,
  .btn-allow {
    flex: 1;
    padding: 9px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    border: none;
    transition: opacity 0.12s, background 0.12s;
  }

  .btn-deny {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-secondary, #9494a6);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .btn-deny:hover {
    background: rgba(255, 255, 255, 0.09);
    color: var(--text-primary, #f3f3f6);
  }

  .btn-allow {
    background: var(--accent, #06b6d4);
    color: #000;
  }

  .btn-allow:hover {
    opacity: 0.88;
  }

  .btn-deny:active,
  .btn-allow:active {
    opacity: 0.7;
  }
</style>
