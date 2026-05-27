<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { activeProject, activeProjectId } from '$lib/stores/workspace';
  import { openFile } from '$lib/stores/editor';
  import { showToast } from '$lib/stores/notification';
  import FileIcon from './FileIcon.svelte';
  import { branchInfo, branchLoading, refreshBranches, checkoutBranch, createBranch, deleteBranch } from '$lib/stores/gitBranch';

  interface GitLogEntry {
    graph: string;
    hash: string | null;
    author: string | null;
    date: string | null;
    refs: string | null;
    subject: string | null;
  }

  let gitStatus = $state<{ modified: string[]; added: string[]; deleted: string[]; untracked: string[] } | null>(null);
  let gitHistory = $state<GitLogEntry[] | null>(null);
  let isFetchingStatus = $state(false);
  let isFetchingHistory = $state(false);
  let commitMessage = $state('');
  let isCommitting = $state(false);
  let isPushing = $state(false);
  let isFetching = $state(false);
  let errorMsg = $state<string | null>(null);

  let changesExpanded = $state(true);
  let commitsExpanded = $state(true);

  let branchPickerOpen = $state(false);
  let newBranchMode = $state(false);
  let newBranchName = $state('');
  let newBranchFrom = $state('');
  let branchSearch = $state('');
  let deleteConfirmBranch = $state<string | null>(null);
  let branchError = $state<string | null>(null);

  const graphColors = [
    '#22d3ee', // Cyan
    '#a78bfa', // Purple
    '#fb7185', // Rose
    '#34d399', // Emerald
    '#fbbf24', // Amber
    '#60a5fa', // Blue
    '#f472b6', // Pink
  ];

  function getGraphColor(idx: number) {
    return graphColors[idx % graphColors.length];
  }

  // Watch project changes to refresh status, history, and branches
  $effect(() => {
    const projectId = $activeProjectId;
    if (projectId) {
      refreshAll();
      refreshBranches(projectId);
    } else {
      gitStatus = null;
      gitHistory = null;
      errorMsg = null;
      branchInfo.set(null);
    }
  });

  async function refreshAll() {
    errorMsg = null;
    await Promise.all([
      fetchStatus(),
      fetchHistory()
    ]);
  }

  async function fetchStatus() {
    const id = $activeProjectId;
    if (!id) return;

    isFetchingStatus = true;
    try {
      const status = await invoke<any>('workspace_git_status', { projectId: id });
      gitStatus = status;

      // Auto-generate commit message if empty
      if (!commitMessage.trim()) {
        const totalChanges = [
          ...status.modified,
          ...status.added,
          ...status.deleted,
          ...status.untracked
        ];

        if (totalChanges.length > 0) {
          const filenames = totalChanges.map(filePath => {
            const parts = filePath.split(/[/\\]/);
            return parts[parts.length - 1];
          });

          const uniqueFilenames = Array.from(new Set(filenames));

          if (uniqueFilenames.length === 1) {
            commitMessage = `Update ${uniqueFilenames[0]}`;
          } else if (uniqueFilenames.length === 2) {
            commitMessage = `Update ${uniqueFilenames[0]} and ${uniqueFilenames[1]}`;
          } else if (uniqueFilenames.length > 2) {
            commitMessage = `Update ${uniqueFilenames[0]}, ${uniqueFilenames[1]} and ${uniqueFilenames.length - 2} other files`;
          } else {
            commitMessage = 'Auto-update from Forge';
          }
        }
      }
    } catch (err) {
      console.error('Failed to get git status:', err);
      errorMsg = String(err);
      gitStatus = null;
    } finally {
      isFetchingStatus = false;
    }
  }

  async function fetchHistory() {
    const id = $activeProjectId;
    if (!id) return;

    isFetchingHistory = true;
    try {
      const history = await invoke<GitLogEntry[]>('workspace_git_log', { projectId: id });
      gitHistory = history;
    } catch (err) {
      console.error('Failed to get git history:', err);
    } finally {
      isFetchingHistory = false;
    }
  }

  async function triggerGitCommit() {
    const id = $activeProjectId;
    if (!id || !commitMessage.trim()) return;

    isCommitting = true;
    showToast('Committing changes...', 'info');
    try {
      const response = await invoke<string>('workspace_git_commit', {
        projectId: id,
        message: commitMessage.trim()
      });
      showToast('Successfully committed changes!', 'success');
      commitMessage = ''; // Clear message after success
      await refreshAll(); // Reload status and history
    } catch (err) {
      console.error(err);
      showToast(String(err) || 'Git commit failed.', 'error');
    } finally {
      isCommitting = false;
    }
  }

  async function triggerGitPush() {
    const id = $activeProjectId;
    if (!id) return;

    isPushing = true;
    showToast('Pushing to GitHub...', 'info');
    try {
      const response = await invoke<string>('workspace_git_push', {
        projectId: id
      });
      showToast(response || 'Successfully pushed to GitHub!', 'success');
      await refreshAll(); // Reload status and history
    } catch (err) {
      console.error(err);
      showToast(String(err) || 'Git push failed.', 'error');
    } finally {
      isPushing = false;
    }
  }

  async function triggerGitFetch() {
    const id = $activeProjectId;
    if (!id) return;

    isFetching = true;
    showToast('Fetching from GitHub...', 'info');
    try {
      const response = await invoke<string>('workspace_git_fetch', {
        projectId: id
      });
      showToast(response || 'Successfully fetched from GitHub!', 'success');
      await refreshAll(); // Reload status and history
    } catch (err) {
      console.error(err);
      showToast(String(err) || 'Git fetch failed.', 'error');
    } finally {
      isFetching = false;
    }
  }


  async function handleFileClick(relativePath: string) {
    if (!$activeProject) return;
    const absolutePath = $activeProject.root_path + '/' + relativePath;
    try {
      await openFile(absolutePath);
    } catch (err) {
      console.error('Failed to open file:', err);
      showToast('Failed to open file', 'error');
    }
  }

  function handleInputKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      triggerGitCommit();
    }
  }

  async function createBranchSubmit() {
    if (!newBranchName.trim() || !$activeProject) return;
    try {
      await createBranch($activeProject.id, newBranchName.trim(), newBranchFrom || undefined);
      newBranchMode = false;
      branchError = null;
    } catch (e) {
      branchError = String(e);
    }
  }
</script>

<div class="source-control">
  <div class="sc-header">
    <span class="sc-title">Source Control</span>
    <div class="sc-header-actions">
      <button class="header-btn" onclick={triggerGitFetch} title="Fetch from Remote" disabled={isFetching}>
        <svg class:spin={isFetching} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
      <button class="header-btn" onclick={refreshAll} title="Refresh Status & History" disabled={isFetchingStatus || isFetchingHistory}>
        <svg class:spin={isFetchingStatus || isFetchingHistory} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23,4 23,10 17,10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- Branch Bar -->
  {#if $activeProject}
    <div class="branch-bar">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="branch-icon">
        <line x1="6" y1="3" x2="6" y2="15"/>
        <circle cx="18" cy="6" r="3"/>
        <circle cx="6" cy="18" r="3"/>
        <path d="M18 9a9 9 0 01-9 9"/>
      </svg>
      <button class="branch-name-btn" onclick={() => { branchPickerOpen = !branchPickerOpen; branchSearch = ''; }} title="Switch branch">
        {$branchInfo?.current || 'no branch'}
      </button>
      <button class="branch-new-btn" onclick={() => { newBranchMode = true; newBranchName = ''; newBranchFrom = $branchInfo?.current || ''; branchPickerOpen = false; }} title="New branch">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>

    <!-- Branch picker dropdown -->
    {#if branchPickerOpen}
      <div class="branch-picker">
        <input class="branch-search" type="text" placeholder="Filter branches…" bind:value={branchSearch} />
        <div class="branch-list">
          {#each ($branchInfo?.local ?? []).filter(b => b.toLowerCase().includes(branchSearch.toLowerCase())) as branch}
            <div class="branch-item" class:current={branch === $branchInfo?.current}>
              <button class="branch-item-name" onclick={async () => {
                try { await checkoutBranch($activeProject!.id, branch); branchPickerOpen = false; branchError = null; }
                catch (e) { branchError = String(e); }
              }}>
                {#if branch === $branchInfo?.current}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                {/if}
                {branch}
              </button>
              {#if branch !== $branchInfo?.current}
                {#if deleteConfirmBranch === branch}
                  <span class="delete-confirm-row">
                    <button class="delete-yes" onclick={async () => {
                      try { await deleteBranch($activeProject!.id, branch); deleteConfirmBranch = null; }
                      catch (e) { branchError = String(e); deleteConfirmBranch = null; }
                    }}>Delete</button>
                    <button class="delete-no" onclick={() => deleteConfirmBranch = null}>Cancel</button>
                  </span>
                {:else}
                  <button class="branch-delete-btn" onclick={() => deleteConfirmBranch = branch} title="Delete branch">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                {/if}
              {/if}
            </div>
          {/each}
          {#if ($branchInfo?.remote ?? []).length > 0}
            <div class="branch-section-label">Remote</div>
            {#each ($branchInfo?.remote ?? []).filter(b => b.toLowerCase().includes(branchSearch.toLowerCase())) as branch}
              <div class="branch-item remote">
                <button class="branch-item-name" onclick={async () => {
                  const localName = branch.split('/').slice(1).join('/');
                  try { await createBranch($activeProject!.id, localName, branch); branchPickerOpen = false; }
                  catch (e) { branchError = String(e); }
                }}>{branch}</button>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/if}

    <!-- New branch form -->
    {#if newBranchMode}
      <div class="new-branch-form">
        <input class="branch-input" type="text" placeholder="Branch name…" bind:value={newBranchName} onkeydown={(e) => { if (e.key === 'Enter') createBranchSubmit(); if (e.key === 'Escape') newBranchMode = false; }} />
        <div class="new-branch-actions">
          <button class="branch-create-btn" onclick={createBranchSubmit}>Create</button>
          <button class="branch-cancel-btn" onclick={() => newBranchMode = false}>Cancel</button>
        </div>
      </div>
    {/if}

    {#if branchError}
      <div class="branch-error">{branchError} <button onclick={() => branchError = null}>✕</button></div>
    {/if}
  {/if}

  <div class="sc-content">
    {#if errorMsg}
      <div class="sc-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>{errorMsg}</p>
      </div>
    {:else if (isFetchingStatus && !gitStatus) || (isFetchingHistory && !gitHistory)}
      <div class="sc-loading">
        <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
          <polyline points="21 3 21 8 16 8"/>
        </svg>
        <span>Loading repository status...</span>
      </div>
    {:else}
      {@const totalChanges = gitStatus ? (gitStatus.modified.length + gitStatus.added.length + gitStatus.deleted.length + gitStatus.untracked.length) : 0}

      <!-- Commit Input and Action Buttons -->
      <div class="sc-commit-section">
        <textarea
          class="sc-commit-input"
          placeholder="Commit message (Ctrl+Enter to commit)..."
          bind:value={commitMessage}
          onkeydown={handleInputKeyDown}
          rows="3"
        ></textarea>

        <button
          class="sc-action-btn commit-btn"
          onclick={triggerGitCommit}
          disabled={isCommitting || !commitMessage.trim()}
          title="Commit changes locally (Ctrl+Enter)"
        >
          {#if isCommitting}
            <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <polyline points="21 3 21 8 16 8"/>
            </svg>
            <span>Committing...</span>
          {:else}
            <span>Commit</span>
          {/if}
        </button>

        <button
          class="sc-action-btn push-btn"
          onclick={triggerGitPush}
          disabled={isPushing}
          title="Push committed changes to remote repository"
        >
          {#if isPushing}
            <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <polyline points="21 3 21 8 16 8"/>
            </svg>
            <span>Pushing...</span>
          {:else}
            <span>Push</span>
          {/if}
        </button>
      </div>

      <div class="sc-scrollable">
        <button class="sc-section-header" onclick={() => changesExpanded = !changesExpanded} aria-expanded={changesExpanded}>
          <svg class="chevron" class:expanded={changesExpanded} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span class="sc-section-title">Changes ({totalChanges})</span>
        </button>

        {#if changesExpanded}
          {#if gitStatus && totalChanges > 0}
            <div class="sc-files">
              {#each gitStatus.modified as file}
                <button class="sc-file-item modified" onclick={() => handleFileClick(file)}>
                  <FileIcon name={file.split('/').pop() || ''} isDir={false} />
                  <span class="file-path" title={file}>{file}</span>
                  <span class="status-badge modified">M</span>
                </button>
              {/each}

              {#each gitStatus.added as file}
                <button class="sc-file-item added" onclick={() => handleFileClick(file)}>
                  <FileIcon name={file.split('/').pop() || ''} isDir={false} />
                  <span class="file-path" title={file}>{file}</span>
                  <span class="status-badge added">A</span>
                </button>
              {/each}

              {#each gitStatus.deleted as file}
                <button class="sc-file-item deleted" disabled title="Deleted file cannot be opened">
                  <FileIcon name={file.split('/').pop() || ''} isDir={false} />
                  <span class="file-path" title={file}>{file}</span>
                  <span class="status-badge deleted">D</span>
                </button>
              {/each}

              {#each gitStatus.untracked as file}
                <button class="sc-file-item untracked" onclick={() => handleFileClick(file)}>
                  <FileIcon name={file.split('/').pop() || ''} isDir={false} />
                  <span class="file-path" title={file}>{file}</span>
                  <span class="status-badge untracked">U</span>
                </button>
              {/each}
            </div>
          {:else}
            <div class="sc-clean">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <p>No changes detected.</p>
              <p class="sub">Your working tree is clean.</p>
            </div>
          {/if}
        {/if}

        <button class="sc-section-header" onclick={() => commitsExpanded = !commitsExpanded} aria-expanded={commitsExpanded}>
          <svg class="chevron" class:expanded={commitsExpanded} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span class="sc-section-title">Commits (Graph)</span>
        </button>

        {#if commitsExpanded}
          <div class="sc-commits-list">
            {#if gitHistory && gitHistory.length > 0}
              {#each gitHistory as entry}
                <div class="history-row" class:graph-only={!entry.hash}>
                  <span class="graph-col">
                    {#each entry.graph.split('') as char, idx}
                      {#if char === '*'}
                        <span class="graph-node" style="color: {getGraphColor(idx)}">●</span>
                      {:else if char === '|'}
                        <span class="graph-line" style="color: {getGraphColor(idx)}">│</span>
                      {:else if char === '/'}
                        <span class="graph-line" style="color: {getGraphColor(idx)}">/</span>
                      {:else if char === '\\'}
                        <span class="graph-line" style="color: {getGraphColor(idx)}">\</span>
                      {:else if char === '_'}
                        <span class="graph-line" style="color: {getGraphColor(idx)}">─</span>
                      {:else}
                        <span class="graph-space">{char}</span>
                      {/if}
                    {/each}
                  </span>
                  {#if entry.hash}
                    <div class="commit-info">
                      <div class="commit-meta">
                        <span class="commit-hash" title={entry.hash}>{entry.hash}</span>
                        {#if entry.refs}
                          <span class="commit-ref-badge" title={entry.refs}>{entry.refs}</span>
                        {/if}
                        <span class="commit-date" title="Author: {entry.author || ''}">{entry.date}</span>
                      </div>
                      <span class="commit-subject" title={entry.subject}>{entry.subject}</span>
                    </div>
                  {/if}
                </div>
              {/each}
            {:else if isFetchingHistory}
              <div class="sc-section-empty">Loading history...</div>
            {:else}
              <div class="sc-section-empty">No commit history found.</div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .source-control {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--sidebar-bg);
    overflow: hidden;
    container-type: inline-size;
    container-name: sourcecontrol;
  }

  .sc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .sc-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .header-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .header-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .header-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .sc-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    overscroll-behavior: none;
  }

  .sc-loading, .sc-error, .sc-clean {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 12px;
    gap: 8px;
    user-select: none;
  }

  .sc-error p {
    color: var(--error);
    font-size: 11px;
    word-break: break-word;
  }

  .sc-clean p {
    font-weight: 500;
  }
  .sc-clean .sub {
    font-size: 11px;
    color: var(--text-muted);
  }

  .sc-scrollable {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    overscroll-behavior: none;
  }

  /* Collapsible Sections */
  .sc-section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    width: 100%;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
    background: var(--sidebar-bg);
    flex-shrink: 0;
    border-bottom: 1px solid var(--border-subtle);
    position: sticky;
    top: 0;
    z-index: 5;
  }

  .sc-section-header:hover {
    background: var(--bg-hover);
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 0.15s ease;
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .sc-section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
  }

  .sc-files {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-bottom: 8px;
  }

  .sc-file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 12px 6px 20px;
    background: transparent;
    border: none;
    font-size: 12.5px;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .sc-file-item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .sc-file-item:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .file-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-badge {
    font-size: 10px;
    font-weight: bold;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .status-badge.modified {
    background: rgba(20, 184, 166, 0.15);
    color: var(--accent);
  }

  .status-badge.added {
    background: rgba(74, 222, 128, 0.15);
    color: var(--success);
  }

  .status-badge.deleted {
    background: rgba(248, 113, 113, 0.15);
    color: var(--error);
  }

  .status-badge.untracked {
    background: rgba(148, 148, 166, 0.15);
    color: var(--text-secondary);
  }

  /* Commits history list styles */
  .sc-commits-list {
    display: flex;
    flex-direction: column;
    font-size: 11px;
    padding: 6px 0 12px 0;
    user-select: none;
  }

  .history-row {
    display: flex;
    align-items: stretch;
    min-height: 24px;
    line-height: 1.35;
    padding: 2px 12px;
  }

  .history-row.graph-only {
    min-height: 14px;
    padding-top: 0;
    padding-bottom: 0;
  }

  .graph-col {
    font-family: var(--editor-font-family, monospace);
    font-size: 11.5px;
    white-space: pre;
    color: var(--text-muted);
    flex-shrink: 0;
    letter-spacing: 0.5px;
    user-select: none;
    font-weight: bold;
  }

  .commit-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    padding-left: 8px;
  }

  .commit-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  .commit-hash {
    font-family: var(--editor-font-family, monospace);
    color: var(--accent);
    font-weight: 600;
  }

  .commit-ref-badge {
    background: rgba(74, 222, 128, 0.15);
    color: var(--success);
    font-size: 9.5px;
    padding: 0px 4px;
    border-radius: 3px;
    font-weight: 500;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .commit-date {
    color: var(--text-muted);
    font-size: 9.5px;
    margin-left: auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }

  .commit-subject {
    color: var(--text-primary);
    font-weight: 450;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sc-section-empty {
    padding: 16px 12px;
    color: var(--text-muted);
    font-size: 11px;
    text-align: center;
  }

  /* Commit and push header */
  .sc-commit-section {
    padding: 12px;
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--sidebar-bg);
    flex-shrink: 0;
  }

  .sc-commit-input {
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-primary);
    font-family: inherit;
    outline: none;
    resize: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .sc-commit-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.2);
  }

  .sc-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sc-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    user-select: none;
    width: 100%;
  }

  .commit-btn {
    background: var(--button-bg);
    color: var(--button-text);
  }

  .commit-btn:hover:not(:disabled) {
    background: var(--button-hover-bg);
  }

  .push-btn {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .push-btn:hover:not(:disabled) {
    background: var(--bg-active);
    border-color: var(--text-muted);
  }

  .sc-action-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .sc-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .graph-node {
    font-weight: bold;
    font-size: 13px;
    line-height: 1;
    display: inline-block;
  }

  .graph-line {
    font-weight: bold;
    opacity: 0.85;
  }

  .graph-space {
    display: inline-block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  .branch-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .branch-icon { color: var(--text-muted); flex-shrink: 0; }
  .branch-name-btn {
    flex: 1;
    text-align: left;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-primary);
    background: transparent;
    border: none;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
    transition: color 0.15s;
  }
  .branch-name-btn:hover { color: var(--accent); }
  .branch-new-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }
  .branch-new-btn:hover { background: var(--bg-hover); color: var(--accent); }
  .branch-picker {
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .branch-search {
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-primary);
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 11px;
    outline: none;
    box-sizing: border-box;
  }
  .branch-list { max-height: 180px; overflow-y: auto; scrollbar-width: thin; }
  .branch-item {
    display: flex;
    align-items: center;
    padding: 1px 4px;
  }
  .branch-item.current { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .branch-item-name {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    font-size: 11.5px;
    color: var(--text-secondary);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    border-radius: 4px;
    transition: background 0.12s, color 0.12s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch-item-name:hover { background: var(--bg-hover); color: var(--text-primary); }
  .branch-item.current .branch-item-name { color: var(--accent); font-weight: 500; }
  .branch-delete-btn {
    display: flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; border-radius: 4px;
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted); opacity: 0;
    transition: opacity 0.12s, background 0.12s, color 0.12s;
  }
  .branch-item:hover .branch-delete-btn { opacity: 1; }
  .branch-delete-btn:hover { background: rgba(239,68,68,0.12); color: var(--error); }
  .delete-confirm-row { display: flex; gap: 4px; padding-right: 6px; }
  .delete-yes, .delete-no {
    font-size: 10px; padding: 2px 7px; border-radius: 4px;
    border: 1px solid var(--border); cursor: pointer; font-weight: 500;
  }
  .delete-yes { background: var(--error); color: #fff; border-color: var(--error); }
  .delete-no { background: transparent; color: var(--text-muted); }
  .branch-section-label {
    font-size: 9.5px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.8px; color: var(--text-muted);
    padding: 6px 10px 2px; opacity: 0.7;
  }
  .branch-item.remote .branch-item-name { color: var(--text-muted); font-style: italic; }
  .new-branch-form {
    padding: 8px 10px; background: var(--bg-secondary);
    border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 6px;
  }
  .branch-input {
    width: 100%; padding: 5px 8px; background: var(--bg-primary);
    border: 1px solid var(--border); border-radius: 5px;
    color: var(--text-primary); font-size: 11px; outline: none;
    box-sizing: border-box; transition: border-color 0.12s;
  }
  .branch-input:focus { border-color: var(--accent); }
  .new-branch-actions { display: flex; gap: 4px; }
  .branch-create-btn {
    flex: 1; padding: 4px; background: var(--accent); color: #fff;
    border: none; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer;
    transition: opacity 0.12s;
  }
  .branch-create-btn:hover { opacity: 0.85; }
  .branch-cancel-btn {
    padding: 4px 10px; background: transparent; color: var(--text-muted);
    border: 1px solid var(--border); border-radius: 5px; font-size: 11px; cursor: pointer;
  }
  .branch-error {
    padding: 6px 10px; background: color-mix(in srgb, var(--error) 10%, transparent);
    border-bottom: 1px solid var(--error); color: var(--error); font-size: 11px;
    display: flex; align-items: center; justify-content: space-between;
  }
  .branch-error button { background: none; border: none; color: var(--error); cursor: pointer; font-size: 12px; }

  @container sourcecontrol (max-width: 290px) {
    .commit-meta {
      flex-wrap: wrap;
      gap: 2px 6px;
    }
    .commit-date {
      margin-left: 0;
      width: 100%;
      font-size: 9px;
      max-width: 100%;
    }
    .commit-info {
      padding-left: 6px;
    }
  }
</style>
