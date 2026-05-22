<script lang="ts">
  import { activeSessionId, killSession, setActiveSession, type TerminalSessionInfo } from '$lib/stores/terminal';

  export let session: TerminalSessionInfo;

  $: isActive = $activeSessionId === session.id;

  function handleClick() {
    setActiveSession(session.id);
  }

  function handleClose(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    killSession(session.id);
  }
</script>

<button
  class="terminal-tab"
  class:active={isActive}
  onclick={handleClick}
  role="tab"
  aria-selected={isActive}
>
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="4,17 10,11 4,5"/>
    <line x1="12" y1="19" x2="20" y2="19"/>
  </svg>
  <span class="tab-title">{session.title}</span>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span class="tab-close" role="button" tabindex="0" onclick={handleClose} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClose(e); }} aria-label="Close terminal">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  </span>
</button>

<style>
  .terminal-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 32px;
    font-size: 12px;
    color: var(--text-secondary);
    background: var(--tab-inactive-bg);
    border-right: 1px solid var(--tab-border);
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .terminal-tab:hover {
    background: var(--bg-hover);
  }

  .terminal-tab.active {
    background: var(--tab-active-bg);
    color: var(--text-primary);
    border-bottom: 2px solid var(--accent);
  }

  .tab-title {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 3px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.1s;
  }

  .terminal-tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
