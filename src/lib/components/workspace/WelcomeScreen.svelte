<script lang="ts">
  import { createNewWorkspace, openWorkspace, recentWorkspaces, clearAllApplicationState, renameWorkspace } from '$lib/stores/workspace';
  import { derived } from 'svelte/store';
  import { search as paletteSearch } from '$lib/stores/commandpalette';
  import { userShortcuts } from '$lib/stores/settings';

  function getShortcutKeys(id: string, defaultKeys = ''): string {
    const found = ($userShortcuts || []).find(s => s && s.id === id);
    if (found) return found.keys || 'None';
    return defaultKeys;
  }

  // Filter workspaces by search query
  const filteredWorkspaces = derived([recentWorkspaces, paletteSearch], ([$recentWorkspaces, $search]) => {
    const list = $recentWorkspaces || [];
    if (!$search) return list;
    const query = $search.toLowerCase();
    return list.filter(
      (w) =>
        w.name.toLowerCase().includes(query) ||
        (w.project_paths || []).some((path) => path.toLowerCase().includes(query))
    );
  });

  function removeRecent(e: MouseEvent, id: string) {
    e.stopPropagation();
    recentWorkspaces.update((r) => r.filter((w) => w.id !== id));
  }

  let renamingWorkspaceId = $state<string | null>(null);
  let renamingWorkspaceName = $state('');

  function startRename(e: MouseEvent, id: string, currentName: string) {
    e.stopPropagation();
    renamingWorkspaceId = id;
    renamingWorkspaceName = currentName;
  }

  function saveRename(id: string) {
    const trimmed = renamingWorkspaceName.trim();
    if (trimmed) {
      renameWorkspace(id, trimmed);
    }
    cancelRename();
  }

  function cancelRename() {
    renamingWorkspaceId = null;
    renamingWorkspaceName = '';
  }

  function handleRenameKeyDown(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') {
      saveRename(id);
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  }

  function clearAllRecents(e: MouseEvent) {
    clearAllApplicationState();
  }

  function formatRelativeTime(timestampStr: string): string {
    try {
      const ts = parseInt(timestampStr, 10);
      if (isNaN(ts)) return '';
      const diff = Date.now() - ts;
      const mins = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (mins < 1) return 'just now';
      if (mins < 60) return `${mins}m ago`;
      if (hours < 24) return `${hours}h ago`;
      if (days < 7) return `${days}d ago`;
      return new Date(ts).toLocaleDateString();
    } catch { return ''; }
  }

  function getShortPath(path: string) {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.length <= 3) return normalized;
    return '…/' + parts.slice(-2).join('/');
  }



  function getProjectHue(name: string) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return Math.abs(hash) % 360;
  }

  let iconError = $state(false);
</script>

<div class="welcome">
  <!-- Hero Section -->
  <div class="hero">
    <div class="hero-logo">
      {#if !iconError}
        <img
          src="/icon.png?v=2"
          alt="Forge"
          class="app-icon-svg"
          onerror={() => iconError = true}
        />
      {:else}
        <!-- Fallback SVG if icon.png fails to load -->
        <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" class="app-icon-svg" aria-label="Forge">
          <circle cx="9" cy="12" r="6" stroke-opacity="0.9" />
          <circle cx="15" cy="12" r="6" stroke-opacity="0.6" />
        </svg>
      {/if}
    </div>
    <h1 class="hero-title">Forge</h1>
    <p class="hero-sub">Your developer workspace</p>
  </div>

  <!-- Actions Row -->
  <div class="actions-row">
    <!-- New Workspace Button -->
    <div class="action-section">
      <button class="open-btn" onclick={createNewWorkspace}>
        <span class="open-btn-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </span>
        <span>New Workspace</span>
        <kbd>Ctrl+N</kbd>
      </button>
    </div>

    <!-- Divider -->
    <div class="section-divider"></div>

    <!-- Recent Workspaces -->
    <div class="recent-section">
      <div class="recent-header">
        <span class="recent-label">Recent Workspaces</span>
        {#if $filteredWorkspaces.length > 0}
          <button class="clear-btn" onclick={clearAllRecents} title="Clear all recent workspaces">
            Clear all
          </button>
        {/if}
      </div>

      <div class="recent-list">
        {#if $filteredWorkspaces.length > 0}
          {#each $filteredWorkspaces as w (w.id)}
            {@const hue = getProjectHue(w.name)}
            <!-- svelte-ignore a11y_interactive_supports_focus -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="recent-card"
              onclick={() => openWorkspace(w.id)}
              role="button"
            >
              <div class="recent-avatar" style="--hue:{hue}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div class="recent-info">
                {#if renamingWorkspaceId === w.id}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    class="rename-ws-input"
                    type="text"
                    bind:value={renamingWorkspaceName}
                    onkeydown={(e) => handleRenameKeyDown(e, w.id)}
                    onblur={() => saveRename(w.id)}
                    onclick={(e) => e.stopPropagation()}
                    autofocus
                  />
                {:else}
                  <span class="recent-name">{w.name}</span>
                {/if}
                <span class="recent-path" title={w.project_paths.join(', ')}>
                  {w.project_paths.length === 0 
                    ? 'Empty workspace' 
                    : `${w.project_paths.length} folder${w.project_paths.length > 1 ? 's' : ''}: ${w.project_paths.map(getShortPath).join(', ')}`}
                </span>
              </div>
              <div class="recent-meta">
                {#if w.last_opened}
                  <span class="recent-time">{formatRelativeTime(w.last_opened)}</span>
                {/if}
                <button
                  class="rename-btn"
                  onclick={(e) => startRename(e, w.id, w.name)}
                  title="Rename workspace"
                  aria-label="Rename workspace {w.name}"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z"/>
                  </svg>
                </button>
                <button
                  class="remove-btn"
                  onclick={(e) => removeRecent(e, w.id)}
                  title="Remove from recent"
                  aria-label="Remove {w.name} from recent"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>
          {/each}
        {:else}
          <div class="empty-recent">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3">
              <path d="M12 8v4l3 3"/>
              <circle cx="12" cy="12" r="10"/>
            </svg>
            <p>No recent workspaces</p>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Shortcuts -->
  <div class="shortcuts-card">
    <h3 class="shortcuts-heading">Keyboard Shortcuts</h3>
    <div class="shortcut-grid">
      {#each [
        ['Command Palette', 'commandPalette', 'Ctrl+Shift+P'],
        ['Go to Terminal', 'goToTerminal', 'Ctrl+`'],
        ['Go to Editor', 'goToEditor', 'Ctrl+E'],
        ['Toggle Sidebar', 'toggleSidebar', 'Ctrl+B'],
        ['Save File', 'saveFile', 'Ctrl+S'],
        ['Start Preview Proxy', 'startProxy', 'Ctrl+Alt+P'],
        ['Stop Preview Proxy', 'stopProxy', 'Ctrl+Alt+O'],
        ['Zoom In', 'zoomIn', 'Ctrl+='],
        ['Zoom Out', 'zoomOut', 'Ctrl+-'],
        ['Reset Zoom', 'resetZoom', 'Ctrl+0'],
      ] as [label, id, defaultKeys]}
        <div class="shortcut-row">
          <span class="sc-label">{label}</span>
          <kbd class="sc-key">{getShortcutKeys(id, defaultKeys)}</kbd>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: radial-gradient(circle at 50% 35%, var(--accent-glow) 0%, transparent 60%), var(--editor-bg);
    align-items: center;
    justify-content: center;
    gap: 32px;
    overflow-y: auto;
    padding: 40px 20px;
  }

  /* ── Hero ─────────────────────────────── */
  .hero {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .hero-logo {
    width: 80px;
    height: 80px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.015);
    border: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.1) inset;
    margin-bottom: 8px;
    overflow: hidden;
  }

  .app-icon-svg {
    width: 56px;
    height: 56px;
    border-radius: 12px;
  }

  .hero-title {
    font-size: 36px;
    font-weight: 300;
    color: var(--text-primary);
    letter-spacing: -0.5px;
  }

  .hero-sub {
    font-size: 13px;
    color: var(--text-muted);
  }

  /* ── Actions Row ──────────────────────── */
  .actions-row {
    display: flex;
    align-items: flex-start;
    gap: 0;
    background: var(--bg-glass);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    width: 100%;
    max-width: 680px;
  }

  .action-section {
    padding: 24px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .section-divider {
    width: 1px;
    background: var(--border);
    align-self: stretch;
  }

  /* ── Open Button ──────────────────────── */
  .open-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 24px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-size: 13px;
    font-weight: 500;
    transition: background 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.15s;
    box-shadow: var(--shadow-sm);
    white-space: nowrap;
    cursor: pointer;
  }

  .open-btn:hover {
    background: var(--accent-light);
    border-color: var(--accent);
    box-shadow: 0 0 16px var(--accent-glow), var(--shadow-md);
    transform: translateY(-2px);
    color: var(--text-primary);
  }

  .open-btn:active {
    transform: translateY(-0.5px);
  }

  .open-btn-icon {
    display: flex;
    align-items: center;
    opacity: 0.85;
  }

  .open-btn kbd {
    margin-left: 6px;
    font-size: 10px;
    background: var(--bg-secondary);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: inherit;
    letter-spacing: 0.3px;
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  .open-btn:hover kbd {
    background: var(--bg-primary);
    border-color: var(--border);
    color: var(--text-primary);
  }

  /* ── Recent Section ───────────────────── */
  .recent-section {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding: 16px 0;
  }

  .recent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 20px 10px;
  }

  .recent-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    color: var(--text-muted);
  }

  .clear-btn {
    font-size: 10px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
  }
  .clear-btn:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 230px;
    overflow-y: auto;
    padding: 2px 12px 8px;
  }

  .recent-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background-color 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    box-shadow: var(--shadow-sm);
  }

  .recent-card:hover {
    background: var(--bg-hover);
    border-color: var(--accent);
    box-shadow: var(--shadow-md), 0 0 8px var(--accent-glow);
    transform: translateY(-2px);
  }

  .recent-avatar {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    background: hsl(var(--hue) 35% 20% / 0.4);
    border: 1px solid hsl(var(--hue) 35% 30% / 0.4);
    color: hsl(var(--hue) 60% 70%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .recent-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .recent-name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-path {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .recent-time {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
  }
  .recent-card:hover .remove-btn { opacity: 1; }
  .remove-btn:hover {
    background: color-mix(in srgb, var(--error) 18%, transparent);
    color: var(--error);
  }

  .rename-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    margin-right: 4px;
  }
  .recent-card:hover .rename-btn { opacity: 1; }
  .rename-btn:hover {
    background: var(--bg-hover);
    color: var(--accent);
  }

  .rename-ws-input {
    background: var(--input-bg);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    padding: 1px 4px;
    border-radius: 4px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
    height: 20px;
  }

  .empty-recent {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 24px 16px;
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
  }

  /* ── Shortcuts ────────────────────────── */
  .shortcuts-card {
    width: 100%;
    max-width: 680px;
    background: var(--bg-glass);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
  }

  .shortcuts-heading {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
    margin-bottom: 16px;
  }

  .shortcut-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 24px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sc-label {
    font-size: 11.5px;
    color: var(--text-secondary);
  }

  .sc-key {
    font-size: 10px;
    font-family: var(--editor-font-family, monospace);
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-bottom: 2px solid var(--text-muted);
    border-radius: 4px;
    padding: 2px 7px;
    color: var(--text-primary);
    letter-spacing: 0.3px;
    box-shadow: 0 1px 0 var(--border) inset, var(--shadow-sm);
  }

  @media (max-width: 640px) {
    .welcome {
      gap: 20px;
      padding: 20px 12px;
    }
    .hero-title {
      font-size: 26px;
    }
    .actions-row {
      flex-direction: column;
      max-width: 100%;
    }
    .action-section {
      padding: 16px;
      width: 100%;
    }
    .section-divider {
      width: 100%;
      height: 1px;
      align-self: auto;
    }
    .shortcut-grid {
      grid-template-columns: 1fr;
    }
    .shortcuts-card {
      padding: 14px;
    }
  }
</style>
