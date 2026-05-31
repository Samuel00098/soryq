<script lang="ts">
  import { recentWorkspaces, activeWorkspaceId, activeWorkspace, openWorkspace, newWorkspacePromptOpen, renameWorkspace } from '$lib/stores/workspace';

  let open = $state(false);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuW = $state(200);
  let triggerEl = $state<HTMLButtonElement | null>(null);

  // Inline rename state
  let editing = $state(false);
  let tempName = $state('');

  // openWorkspace() moves the active workspace to the front of recentWorkspaces
  // (for the Welcome screen's "recent" list). Keep the popup list in a stable
  // creation order so entries don't reshuffle when you switch between them.
  // Workspace ids are `ws-${Date.now()}`, so they sort chronologically.
  const orderedWorkspaces = $derived(
    [...$recentWorkspaces].sort((a, b) => a.id.localeCompare(b.id))
  );

  function wsColor(name: string): string {
    const hash = Math.abs(name.split('').reduce((h, c) => c.charCodeAt(0) + ((h << 5) - h), 0)) % 360;
    return `hsl(${hash} 50% 55%)`;
  }

  function toggleMenu() {
    if (open) {
      open = false;
      return;
    }
    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      menuX = rect.left;
      menuY = rect.bottom + 4;
      menuW = Math.max(rect.width, 200);
    }
    open = true;
  }

  async function handleSwitch(workspaceId: string) {
    open = false;
    if (workspaceId === $activeWorkspaceId) return;
    await openWorkspace(workspaceId);
  }

  function handleNew() {
    open = false;
    newWorkspacePromptOpen.set(true);
  }

  // ── Rename ──
  function startRename(e: MouseEvent) {
    e.stopPropagation();
    if ($activeWorkspace) {
      tempName = $activeWorkspace.name;
      editing = true;
    }
  }

  function saveRename() {
    const trimmed = tempName.trim();
    if (trimmed && $activeWorkspace) {
      renameWorkspace($activeWorkspace.id, trimmed);
    }
    editing = false;
  }

  function handleRenameKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') saveRename();
    else if (e.key === 'Escape') editing = false;
  }

  // Dismiss popup on outside click / Escape
  $effect(() => {
    if (!open) return;
    function dismiss() { open = false; }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') open = false; }
    document.addEventListener('click', dismiss);
    document.addEventListener('contextmenu', dismiss);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('contextmenu', dismiss);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="ws-header">
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="ws-rename-input"
      type="text"
      bind:value={tempName}
      onkeydown={handleRenameKeyDown}
      onblur={saveRename}
      onclick={(e) => e.stopPropagation()}
      autofocus
    />
  {:else}
    <button
      bind:this={triggerEl}
      class="ws-trigger"
      class:open
      onclick={(e) => { e.stopPropagation(); toggleMenu(); }}
      title="Switch workspace"
    >
      <span class="ws-dot" style="background: {wsColor($activeWorkspace?.name ?? 'Workspace')}"></span>
      <span class="ws-trigger-name">{$activeWorkspace?.name ?? 'Workspace'}</span>
      <svg class="ws-caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <button class="ws-rename-btn" onclick={startRename} title="Rename workspace">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z"/>
      </svg>
    </button>
  {/if}
</div>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="ws-menu"
    role="menu"
    tabindex="-1"
    style="top: {menuY}px; left: {menuX}px; min-width: {menuW}px;"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="ws-menu-label">Workspaces</div>
    <div class="ws-menu-list">
      {#each orderedWorkspaces as ws (ws.id)}
        <button class="ws-menu-item" class:active={$activeWorkspaceId === ws.id} onclick={() => handleSwitch(ws.id)}>
          <span class="ws-dot" style="background: {wsColor(ws.name)}"></span>
          <span class="ws-menu-name">{ws.name}</span>
          {#if $activeWorkspaceId === ws.id}
            <svg class="ws-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          {/if}
        </button>
      {/each}
    </div>
    <div class="ws-menu-sep"></div>
    <button class="ws-menu-item ws-menu-new" onclick={handleNew}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span>New workspace</span>
    </button>
  </div>
{/if}

<style>
  .ws-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    height: 30px;
    flex-shrink: 0;
    width: 100%;
  }

  .ws-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 6px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s;
  }

  .ws-trigger:hover,
  .ws-trigger.open {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .ws-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .ws-trigger-name {
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .ws-caret {
    flex-shrink: 0;
    opacity: 0.55;
    transition: transform 0.15s;
  }

  .ws-trigger.open .ws-caret {
    transform: rotate(180deg);
  }

  .ws-rename-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    flex-shrink: 0;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
  }

  .ws-header:hover .ws-rename-btn { opacity: 0.8; }

  .ws-rename-btn:hover {
    background: var(--bg-hover);
    color: var(--accent);
    opacity: 1;
  }

  .ws-rename-input {
    background: var(--input-bg);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: 0.2px;
    padding: 2px 6px;
    border-radius: 5px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    height: 28px;
  }

  /* ── Popup menu ── */
  .ws-menu {
    position: fixed;
    z-index: 9000;
    max-width: 320px;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.88);
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--glass-shadow, 0 8px 24px rgba(0, 0, 0, 0.35)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    padding: 4px;
    animation: ws-menu-in 0.1s ease;
  }

  @keyframes ws-menu-in {
    from { opacity: 0; transform: scale(0.97) translateY(-4px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);    }
  }

  .ws-menu-label {
    padding: 6px 10px 4px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .ws-menu-list {
    max-height: 280px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .ws-menu-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 8px 11px;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-secondary);
    cursor: pointer;
    background: transparent;
    border: none;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .ws-menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .ws-menu-item.active {
    color: var(--text-primary);
  }

  .ws-menu-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .ws-check {
    flex-shrink: 0;
    color: var(--accent);
  }

  .ws-menu-sep {
    height: 1px;
    background: var(--border-subtle);
    margin: 4px 6px;
  }

  .ws-menu-new {
    color: var(--text-muted);
  }

  .ws-menu-new svg { flex-shrink: 0; opacity: 0.7; }
</style>
