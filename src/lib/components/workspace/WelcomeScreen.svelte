<script lang="ts">
  import {
    createNewWorkspace,
    openProject,
    openWorkspace,
    recentWorkspaces,
    clearAllApplicationState,
    renameWorkspace,
  } from '$lib/stores/workspace';
  import { derived } from 'svelte/store';
  import { search as paletteSearch } from '$lib/stores/commandpalette';

  const filteredWorkspaces = derived(
    [recentWorkspaces, paletteSearch],
    ([$recentWorkspaces, $search]) => {
      const list = $recentWorkspaces || [];
      if (!$search) return list;
      const q = $search.toLowerCase();
      return list.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.project_paths || []).some((p) => p.toLowerCase().includes(q))
      );
    }
  );

  function removeRecent(e: MouseEvent, id: string) {
    e.stopPropagation();
    recentWorkspaces.update((r) => r.filter((w) => w.id !== id));
  }

  let renamingId = $state<string | null>(null);
  let renamingName = $state('');

  function startRename(e: MouseEvent, id: string, name: string) {
    e.stopPropagation();
    renamingId = id;
    renamingName = name;
  }

  function saveRename(id: string) {
    const t = renamingName.trim();
    if (t) renameWorkspace(id, t);
    renamingId = null;
    renamingName = '';
  }

  function handleRenameKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') saveRename(id);
    else if (e.key === 'Escape') { renamingId = null; renamingName = ''; }
  }

  function formatTime(ts: string): string {
    try {
      const n = parseInt(ts, 10);
      if (isNaN(n)) return '';
      const diff = Date.now() - n;
      const m = Math.floor(diff / 60000);
      const h = Math.floor(diff / 3600000);
      const d = Math.floor(diff / 86400000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      if (h < 24) return `${h}h ago`;
      if (d < 7) return `${d}d ago`;
      return new Date(n).toLocaleDateString();
    } catch { return ''; }
  }

  function shortPath(path: string) {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts.length <= 2 ? path.replace(/\\/g, '/') : '…/' + parts.slice(-2).join('/');
  }

  function projectHue(name: string) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
  }

  let iconError = $state(false);
  let hasRecents = $derived($recentWorkspaces.length > 0);
</script>

<div class="welcome">
  <!-- Header -->
  <header class="header">
    <div class="logo-wrap">
      {#if !iconError}
        <img src="/icon.png?v=2" alt="Soryq" class="logo-img" onerror={() => iconError = true} />
      {:else}
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" class="logo-fallback">
          <rect width="36" height="36" rx="8" fill="#1e1b4b"/>
          <polyline points="6,22 10,18 6,14" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="12" y="16.5" width="11" height="2.5" rx="1.25" fill="rgba(255,255,255,0.55)"/>
          <rect x="12" y="21" width="8" height="2" rx="1" fill="rgba(255,255,255,0.2)"/>
        </svg>
      {/if}
    </div>
    <div class="header-text">
      <h1 class="app-name">Soryq</h1>
      <p class="app-tagline">Terminal-first developer workspace</p>
    </div>
  </header>

  <!-- Main content -->
  <div class="content">
    <!-- Left: actions + recents -->
    <div class="left-col">
      <!-- Primary actions -->
      <div class="action-group">
        <button class="action-btn primary" onclick={createNewWorkspace}>
          <span class="action-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
          <span class="action-label">New Workspace</span>
          <kbd>Ctrl+N</kbd>
        </button>

        <button class="action-btn secondary" onclick={openProject}>
          <span class="action-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span class="action-label">Open Folder</span>
          <kbd>Ctrl+O</kbd>
        </button>
      </div>

      <!-- Recents -->
      <div class="recents">
        <div class="recents-header">
          <span class="section-label">Recent</span>
          {#if hasRecents}
            <button class="text-btn danger" onclick={clearAllApplicationState}>Clear all</button>
          {/if}
        </div>

        {#if $filteredWorkspaces.length > 0}
          <div class="recent-list">
            {#each $filteredWorkspaces as w (w.id)}
              {@const hue = projectHue(w.name)}
              <!-- svelte-ignore a11y_interactive_supports_focus a11y_click_events_have_key_events -->
              <div class="recent-item" onclick={() => openWorkspace(w.id)} role="button">
                <div class="recent-avatar" style="--hue:{hue}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div class="recent-info">
                  {#if renamingId === w.id}
                    <!-- svelte-ignore a11y_autofocus a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <input
                      class="rename-input"
                      bind:value={renamingName}
                      onkeydown={(e) => handleRenameKey(e, w.id)}
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
                      : w.project_paths.map(shortPath).join(', ')}
                  </span>
                </div>
                <div class="recent-actions">
                  {#if w.last_opened}
                    <span class="recent-time">{formatTime(w.last_opened)}</span>
                  {/if}
                  <button
                    class="icon-btn"
                    onclick={(e) => startRename(e, w.id, w.name)}
                    title="Rename"
                    aria-label="Rename {w.name}"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z"/>
                    </svg>
                  </button>
                  <button
                    class="icon-btn danger"
                    onclick={(e) => removeRecent(e, w.id)}
                    title="Remove"
                    aria-label="Remove {w.name}"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <p>No recent workspaces</p>
            <span>Create one or open an existing folder to get started.</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Right: getting started tips -->
    <div class="right-col">
      <span class="section-label">Getting started</span>
      <div class="tips">
        <div class="tip">
          <div class="tip-icon green">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </div>
          <div class="tip-body">
            <strong>Multi-pane terminal</strong>
            <p>Split your workspace into up to 4 terminal panes. Drag to resize.</p>
          </div>
        </div>
        <div class="tip">
          <div class="tip-icon purple">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
          <div class="tip-body">
            <strong>Quick Run panel</strong>
            <p>Launch AI agents (Claude, Codex, Aider) or dev commands instantly from the Run panel in the sidebar.</p>
          </div>
        </div>
        <div class="tip">
          <div class="tip-icon blue">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <div class="tip-body">
            <strong>Built-in preview</strong>
            <p>Switch to the Preview tab to browse the web or preview your local dev server.</p>
          </div>
        </div>
        <div class="tip">
          <div class="tip-icon orange">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <div class="tip-body">
            <strong>Workspace snapshots</strong>
            <p>Save your current layout and restore it anytime from the sidebar.</p>
          </div>
        </div>
      </div>

      <div class="shortcuts-row">
        <span class="section-label" style="margin-bottom: 10px;">Quick shortcuts</span>
        <div class="shortcut-grid">
          {#each [
            ['Command palette', 'Ctrl+Shift+P'],
            ['Toggle sidebar', 'Ctrl+B'],
            ['Focus terminal', 'Ctrl+`'],
            ['Open preview', 'Ctrl+Alt+P'],
          ] as [label, keys]}
            <div class="shortcut-item">
              <span>{label}</span>
              <kbd>{keys}</kbd>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
    background-image: radial-gradient(ellipse 60% 40% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent);
    overflow-y: auto;
    padding: 48px 32px 40px;
    gap: 36px;
  }

  /* ── Header ── */
  .header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    width: 100%;
    max-width: 760px;
  }

  .logo-wrap {
    width: 80px;
    height: 80px;
    border-radius: 20px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  }

  .logo-img {
    width: 62px;
    height: 62px;
    border-radius: 12px;
  }

  .logo-fallback { opacity: 0.8; }

  .header-text { display: flex; flex-direction: column; gap: 2px; align-items: center; }

  .app-name {
    font-size: 34px;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.6px;
    line-height: 1;
  }

  .app-tagline {
    font-size: 13px;
    color: var(--text-secondary);
    margin-top: 3px;
  }

  /* ── Content grid ── */
  .content {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 24px;
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: 760px;
  }

  /* ── Left column ── */
  .left-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 0;
  }

  /* ── Action buttons ── */
  .action-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 13.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, transform 0.1s, box-shadow 0.15s;
    text-align: left;
    width: 100%;
    border: 1px solid var(--border);
  }

  .action-btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .action-btn.primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--accent) 40%, transparent);
    transform: translateY(-1px);
  }

  .action-btn.secondary {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .action-btn.secondary:hover {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    transform: translateY(-1px);
  }

  .action-btn:active { transform: translateY(0); }

  .action-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .action-label { flex: 1; }

  .action-btn kbd {
    font-size: 10px;
    font-family: inherit;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.7);
    letter-spacing: 0.2px;
  }

  .action-btn.secondary kbd {
    background: var(--bg-tertiary);
    border-color: var(--border);
    color: var(--text-muted);
  }

  /* ── Recents ── */
  .recents {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    flex: 1;
  }

  .recents-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .text-btn {
    font-size: 10.5px;
    color: var(--text-muted);
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    background: transparent;
    border: none;
  }

  .text-btn.danger:hover {
    background: color-mix(in srgb, var(--error) 12%, transparent);
    color: var(--error);
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    flex: 1;
  }

  .recent-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, transform 0.1s;
  }

  .recent-item:hover {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    transform: translateX(2px);
  }

  .recent-avatar {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: hsl(var(--hue) 35% 20% / 0.45);
    border: 1px solid hsl(var(--hue) 35% 30% / 0.4);
    color: hsl(var(--hue) 60% 70%);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .recent-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex: 1;
    min-width: 0;
  }

  .recent-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-path {
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
  }

  .recent-item:hover .recent-actions { opacity: 1; }

  .recent-time {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    margin-right: 4px;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: var(--text-muted);
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--accent);
  }

  .icon-btn.danger:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }

  .rename-input {
    background: var(--bg-primary);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    padding: 1px 6px;
    border-radius: 4px;
    outline: none;
    width: 100%;
    height: 22px;
    box-sizing: border-box;
  }

  /* ── Empty state ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 32px 16px;
    color: var(--text-muted);
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: 10px;
    opacity: 0.7;
  }

  .empty-state p {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text-secondary);
    margin-top: 4px;
  }

  .empty-state span {
    font-size: 11px;
    color: var(--text-muted);
  }

  /* ── Right column ── */
  .right-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
    min-height: 0;
  }

  /* ── Tips ── */
  .tips {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tip {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
  }

  .tip-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .tip-icon.green  { background: rgba(74,222,128,0.12); color: #4ade80; }
  .tip-icon.purple { background: rgba(167,139,250,0.12); color: #a78bfa; }
  .tip-icon.blue   { background: rgba(56,189,248,0.12);  color: #38bdf8; }
  .tip-icon.orange { background: rgba(251,146,60,0.12);  color: #fb923c; }

  .tip-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tip-body strong {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .tip-body p {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .tip-body kbd {
    display: inline-block;
    font-size: 9.5px;
    font-family: inherit;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
  }

  /* ── Shortcuts ── */
  .shortcuts-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
  }

  .shortcut-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
  }

  .shortcut-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .shortcut-item kbd {
    font-size: 9.5px;
    font-family: inherit;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-bottom: 2px solid var(--border);
    color: var(--text-primary);
    white-space: nowrap;
  }

  /* ── Responsive ── */
  @media (max-width: 720px) {
    .welcome { padding: 28px 16px 32px; gap: 24px; }
    .content { grid-template-columns: 1fr; max-width: 100%; }
    .right-col { display: none; }
  }
</style>
