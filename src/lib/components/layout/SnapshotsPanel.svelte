<script lang="ts">
  import {
    snapshots,
    saveSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    renameSnapshot,
    type WorkspaceSnapshot,
  } from '$lib/stores/snapshot';
  import { showToast } from '$lib/stores/notification';

  let newName = $state('');
  let saving = $state(false);
  let restoring = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editingName = $state('');

  const LAYOUT_ICONS: Record<string, string> = {
    single: '▣',
    '2h': '⬛⬛',
    '2v': '⬛\n⬛',
    '3h': '⬛⬛⬛',
    '3v': '⬛\n⬛\n⬛',
    '4': '⊞',
    '9': '⊟',
  };

  const ROLE_COLORS: Record<string, string> = {
    Server: '#4ade80',
    Tests: '#60a5fa',
    Build: '#fb923c',
    Agent: '#a78bfa',
    Git: '#fbbf24',
  };

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  async function handleSave() {
    if (saving) return;
    saving = true;
    try {
      const snap = saveSnapshot(newName);
      showToast(`Saved "${snap.name}"`, 'success');
      newName = '';
    } finally {
      saving = false;
    }
  }

  async function handleRestore(snap: WorkspaceSnapshot) {
    if (restoring) return;
    restoring = snap.id;
    try {
      await restoreSnapshot(snap);
      showToast(`Restored "${snap.name}"`, 'success');
    } catch (err) {
      showToast(`Failed to restore snapshot`, 'error');
    } finally {
      restoring = null;
    }
  }

  function startEdit(snap: WorkspaceSnapshot) {
    editingId = snap.id;
    editingName = snap.name;
  }

  function commitEdit(id: string) {
    renameSnapshot(id, editingName);
    editingId = null;
  }

  function handleEditKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') { commitEdit(id); e.stopPropagation(); }
    if (e.key === 'Escape') { editingId = null; e.stopPropagation(); }
  }
</script>

<div class="snapshots-panel">
  <div class="panel-header">
    <span class="panel-title">Workspace Snapshots</span>
  </div>

  <!-- Save current state -->
  <div class="save-section">
    <input
      class="name-input"
      type="text"
      placeholder="Snapshot name…"
      bind:value={newName}
      onkeydown={(e) => e.key === 'Enter' && handleSave()}
    />
    <button class="save-btn" onclick={handleSave} disabled={saving}>
      {saving ? '…' : 'Save'}
    </button>
  </div>

  <!-- Snapshot list -->
  <div class="snap-list">
    {#if $snapshots.length === 0}
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
          <path d="M7 8h10M7 12h6"/>
        </svg>
        <p>No snapshots yet.<br/>Save your current layout<br/>to restore it later.</p>
      </div>
    {:else}
      {#each $snapshots as snap (snap.id)}
        <div class="snap-card">
          <div class="snap-top">
            <!-- Layout badge -->
            <span class="layout-badge" title="Grid layout: {snap.gridLayout}">
              {LAYOUT_ICONS[snap.gridLayout] ?? snap.gridLayout}
            </span>

            <!-- Name / edit -->
            <div class="snap-name-area">
              {#if editingId === snap.id}
                <input
                  class="snap-name-input"
                  type="text"
                  bind:value={editingName}
                  onkeydown={(e) => handleEditKey(e, snap.id)}
                  onblur={() => commitEdit(snap.id)}
                  autofocus
                />
              {:else}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span class="snap-name" ondblclick={() => startEdit(snap)}>{snap.name}</span>
              {/if}
              <span class="snap-date">{formatDate(snap.savedAt)}</span>
            </div>

            <!-- Actions -->
            <div class="snap-actions">
              <button
                class="snap-btn restore-btn"
                onclick={() => handleRestore(snap)}
                disabled={restoring === snap.id}
                title="Restore this snapshot"
              >
                {#if restoring === snap.id}
                  <svg class="spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
                  </svg>
                {:else}
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
                  </svg>
                {/if}
              </button>
              <button
                class="snap-btn edit-btn"
                onclick={() => startEdit(snap)}
                title="Rename"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z"/>
                </svg>
              </button>
              <button
                class="snap-btn delete-btn"
                onclick={() => deleteSnapshot(snap.id)}
                title="Delete snapshot"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4h6v2"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Pane preview strip -->
          {#if snap.panes.some(Boolean)}
            <div class="pane-preview">
              {#each snap.panes as pane}
                <div class="pane-chip" class:empty={pane === null}>
                  {#if pane?.role}
                    <span
                      class="pane-role-dot"
                      style="background: {ROLE_COLORS[pane.role] ?? '#9ca3af'}"
                    ></span>
                    <span class="pane-role-label">{pane.role}</span>
                  {:else if pane !== null}
                    <span class="pane-role-label muted">Terminal</span>
                  {:else}
                    <span class="pane-role-label muted">—</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          <!-- Preview URL if saved -->
          {#if snap.previewUrl && snap.previewUrl !== '/' && snap.previewUrl !== 'about:blank'}
            <div class="snap-url">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10z"/>
              </svg>
              {snap.previewUrl.length > 36 ? snap.previewUrl.slice(0, 36) + '…' : snap.previewUrl}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .snapshots-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .panel-header {
    padding: 10px 12px 6px;
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
  }

  /* ── Save bar ── */
  .save-section {
    display: flex;
    gap: 5px;
    padding: 0 10px 10px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
  }

  .name-input {
    flex: 1;
    height: 28px;
    padding: 0 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.12s;
  }

  .name-input:focus { border-color: var(--accent); }
  .name-input::placeholder { color: var(--text-muted); }

  .save-btn {
    height: 28px;
    padding: 0 12px;
    background: var(--accent);
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.12s;
  }

  .save-btn:hover:not(:disabled) { opacity: 0.85; }
  .save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── List ── */
  .snap-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 32px 16px;
    color: var(--text-muted);
    text-align: center;
  }

  .empty-state p {
    font-size: 11.5px;
    line-height: 1.6;
    margin: 0;
  }

  /* ── Snapshot card ── */
  .snap-card {
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 9px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.15s;
  }

  .snap-card:hover {
    border-color: var(--border-hover, var(--accent-light));
  }

  .snap-top {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .layout-badge {
    font-size: 13px;
    flex-shrink: 0;
    opacity: 0.5;
    line-height: 1;
    width: 18px;
    text-align: center;
  }

  .snap-name-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .snap-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  .snap-name-input {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    background: var(--bg-secondary);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 1px 5px;
    outline: none;
    width: 100%;
  }

  .snap-date {
    font-size: 10px;
    color: var(--text-muted);
  }

  .snap-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .snap-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--text-muted);
    transition: background 0.12s, color 0.12s;
  }

  .snap-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .snap-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .restore-btn:hover { color: var(--accent); background: var(--accent-light); }
  .delete-btn:hover { color: var(--error); background: rgba(239,68,68,0.12); }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spin { animation: spin 0.8s linear infinite; }

  /* ── Pane strip ── */
  .pane-preview {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .pane-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    font-size: 10px;
  }

  .pane-chip.empty {
    opacity: 0.35;
  }

  .pane-role-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .pane-role-label {
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 500;
  }

  .pane-role-label.muted {
    color: var(--text-muted);
  }

  /* ── URL preview ── */
  .snap-url {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snap-url svg {
    flex-shrink: 0;
    opacity: 0.6;
  }
</style>
