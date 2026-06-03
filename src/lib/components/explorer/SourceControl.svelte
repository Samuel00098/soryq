<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { activeProject, activeProjectId } from '$lib/stores/workspace';
  import { openFile } from '$lib/stores/editor';
  import { showToast } from '$lib/stores/notification';
  import FileIcon from './FileIcon.svelte';
  import { branchInfo, refreshBranches, checkoutBranch, createBranch, deleteBranch } from '$lib/stores/gitBranch';
  import { aiProvider, currentAiModel, getProviderDef, isLocalProvider, getProviderBaseUrl } from '$lib/stores/settings';
  import { getProviderApiKeyLocal } from '$lib/services/ai-keychain';
  import { githubTokenExists, saveGithubToken, createGithubRepo } from '$lib/services/github';

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
  let isGeneratingMsg = $state(false);
  let errorMsg = $state<string | null>(null);

  let changesExpanded = $state(true);
  let commitsExpanded = $state(true);

  // "Publish to GitHub" — shown when the project has no remote (or isn't a git
  // repo yet). Creates a repo on the user's account and pushes the first commit.
  let publishOpen = $state(false);
  let publishName = $state('');
  let publishDesc = $state('');
  let publishPrivate = $state(true);
  let isPublishing = $state(false);
  let githubTokenSaved = $state(false);
  let tokenInput = $state('');
  let publishError = $state<string | null>(null);

  // True when the status error specifically means "no .git here yet".
  let notAGitRepo = $derived(!!errorMsg && errorMsg.toLowerCase().includes('not a git repository'));
  // Offer publishing when there's no remote configured, or no repo at all.
  let needsPublish = $derived(notAGitRepo || (!!$branchInfo && $branchInfo.has_remote === false));

  async function openPublish() {
    publishError = null;
    // Default the repo name to the project folder, sanitised to GitHub's rules.
    const base = ($activeProject?.name ?? '').trim();
    publishName = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'my-project';
    githubTokenSaved = await githubTokenExists();
    publishOpen = true;
  }

  async function doPublish() {
    const id = $activeProjectId;
    const name = publishName.trim();
    if (!id || !name) return;
    publishError = null;
    isPublishing = true;
    try {
      if (!githubTokenSaved) {
        const token = tokenInput.trim();
        if (!token) {
          publishError = 'Enter a GitHub personal access token first.';
          return;
        }
        await saveGithubToken(token);
        githubTokenSaved = true;
        tokenInput = '';
      }

      const result = await createGithubRepo(id, name, publishDesc.trim(), publishPrivate);
      showToast(
        result.pushed
          ? `Published to ${result.full_name}!`
          : `Created ${result.full_name} — commit some files, then push.`,
        'success'
      );
      publishOpen = false;
      publishDesc = '';
      if (result.html_url) {
        invoke('preview_open_in_browser', { url: result.html_url }).catch(() => {});
      }
      await refreshAll();
    } catch (err) {
      publishError = String(err);
    } finally {
      isPublishing = false;
    }
  }

  // Per-file commit selection. Files appear checked by default; unchecking one
  // excludes it from the next commit. `knownFiles` tracks which paths we've seen
  // so newly-appeared changes default to selected while existing choices persist.
  let selectedFiles = $state<Set<string>>(new Set());
  let knownFiles = new Set<string>();

  let allChangedFiles = $derived(
    gitStatus
      ? [...gitStatus.modified, ...gitStatus.added, ...gitStatus.deleted, ...gitStatus.untracked]
      : []
  );
  let selectedCount = $derived(allChangedFiles.filter((f) => selectedFiles.has(f)).length);
  let allSelected = $derived(allChangedFiles.length > 0 && selectedCount === allChangedFiles.length);

  // Unpushed-commit state, surfaced in the branch bar and on the Push button so
  // local-only commits are obvious at a glance.
  let aheadCount = $derived($branchInfo?.ahead ?? 0);
  let behindCount = $derived($branchInfo?.behind ?? 0);
  // A branch with no upstream yet may still have local commits to publish.
  let isUnpublished = $derived(!!$branchInfo && $branchInfo.has_remote && $branchInfo.upstream === null);
  let hasUnpushed = $derived(aheadCount > 0 || isUnpublished);

  function toggleFile(file: string) {
    const next = new Set(selectedFiles);
    if (next.has(file)) next.delete(file);
    else next.add(file);
    selectedFiles = next;
  }

  function toggleAllFiles() {
    selectedFiles = allSelected ? new Set() : new Set(allChangedFiles);
  }

  // `indeterminate` is a DOM property, not an attribute, so set it directly.
  function setIndeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value;
    return {
      update(next: boolean) {
        node.indeterminate = next;
      },
    };
  }

  let branchPickerOpen = $state(false);
  let newBranchMode = $state(false);
  let newBranchName = $state('');
  let newBranchFrom = $state('');
  let branchSearch = $state('');
  let deleteConfirmBranch = $state<string | null>(null);
  let branchError = $state<string | null>(null);
  let refreshGeneration = 0;
  let statusRequestGeneration = 0;
  let historyRequestGeneration = 0;

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
      gitStatus = null;
      gitHistory = null;
      errorMsg = null;
      branchPickerOpen = false;
      newBranchMode = false;
      deleteConfirmBranch = null;
      branchError = null;
      commitMessage = '';
      selectedFiles = new Set();
      knownFiles = new Set();
      refreshAll();
      refreshBranches(projectId);
    } else {
      gitStatus = null;
      gitHistory = null;
      errorMsg = null;
    }
  });

  async function refreshAll() {
    const generation = ++refreshGeneration;
    errorMsg = null;
    const id = $activeProjectId;
    await Promise.all([
      fetchStatus(generation),
      fetchHistory(generation),
      // Keep ahead/behind counts in sync after commit/push/fetch too.
      id ? refreshBranches(id) : Promise.resolve()
    ]);
  }

  async function fetchStatus(generation: number) {
    const id = $activeProjectId;
    if (!id) return;

    const requestGeneration = ++statusRequestGeneration;
    isFetchingStatus = true;
    try {
      const status = await invoke<any>('workspace_git_status', { projectId: id });
      if (generation !== refreshGeneration || requestGeneration !== statusRequestGeneration) return;
      gitStatus = status;

      // Reconcile commit selection: keep choices for files we've already seen,
      // default newly-appeared changes to selected, and drop vanished ones.
      const files: string[] = [
        ...status.modified,
        ...status.added,
        ...status.deleted,
        ...status.untracked,
      ];
      const nextSelection = new Set<string>();
      for (const f of files) {
        if (!knownFiles.has(f) || selectedFiles.has(f)) nextSelection.add(f);
      }
      selectedFiles = nextSelection;
      knownFiles = new Set(files);

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
      if (generation !== refreshGeneration || requestGeneration !== statusRequestGeneration) return;
      console.error('Failed to get git status:', err);
      errorMsg = String(err);
      gitStatus = null;
    } finally {
      if (generation === refreshGeneration && requestGeneration === statusRequestGeneration) {
        isFetchingStatus = false;
      }
    }
  }

  async function fetchHistory(generation: number) {
    const id = $activeProjectId;
    if (!id) return;

    const requestGeneration = ++historyRequestGeneration;
    isFetchingHistory = true;
    try {
      const history = await invoke<GitLogEntry[]>('workspace_git_log', { projectId: id });
      if (generation !== refreshGeneration || requestGeneration !== historyRequestGeneration) return;
      gitHistory = history;
    } catch (err) {
      if (generation !== refreshGeneration || requestGeneration !== historyRequestGeneration) return;
      console.error('Failed to get git history:', err);
    } finally {
      if (generation === refreshGeneration && requestGeneration === historyRequestGeneration) {
        isFetchingHistory = false;
      }
    }
  }

  async function triggerGitCommit() {
    const id = $activeProjectId;
    if (!id || !commitMessage.trim()) return;
    if (allChangedFiles.length > 0 && selectedCount === 0) {
      showToast('Select at least one file to commit.', 'warning');
      return;
    }

    // Commit only the chosen files. When everything is selected, send null so the
    // backend stages all changes (handles edge cases like submodules cleanly).
    const files = allSelected ? null : allChangedFiles.filter((f) => selectedFiles.has(f));

    isCommitting = true;
    showToast('Committing changes...', 'info');
    try {
      const response = await invoke<string>('workspace_git_commit', {
        projectId: id,
        message: commitMessage.trim(),
        files
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

  async function generateCommitMessage() {
    const id = $activeProjectId;
    if (!id) return;

    isGeneratingMsg = true;
    try {
      const diff = await invoke<string>('workspace_git_diff', { projectId: id, filePath: null });
      const untrackedSection = gitStatus?.untracked.length
        ? `\n\nNew untracked files:\n${gitStatus.untracked.join('\n')}`
        : '';
      const context = (diff || '') + untrackedSection;

      if (!context.trim()) {
        showToast('No changes to summarize.', 'info');
        return;
      }

      const provider = $aiProvider;
      const local = isLocalProvider(provider);
      const apiKey = getProviderApiKeyLocal(provider) ?? '';
      const baseUrl = local ? getProviderBaseUrl(provider) : '';
      const message = await invoke<string>('ai_generate_commit_message', {
        diff: context,
        provider,
        model: $currentAiModel,
        apiKey,
        baseUrl: baseUrl || undefined,
      });
      commitMessage = message;
    } catch (err) {
      const msg = String(err);
      if (msg.includes('API key is not set')) {
        showToast(`Add your ${getProviderDef($aiProvider).label} API key in Settings → Models to generate commit messages.`, 'warning');
      } else if (msg.includes('Server URL is not set')) {
        showToast(`Set your ${getProviderDef($aiProvider).label} server URL in Settings → Models to generate commit messages.`, 'warning');
      } else {
        showToast(msg || 'Failed to generate commit message.', 'error');
      }
    } finally {
      isGeneratingMsg = false;
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
      {#if $branchInfo?.has_remote}
        {#if isUnpublished}
          <span class="sync-badge unpublished" title="This branch isn't on the remote yet — Push to publish it">unpublished</span>
        {:else if aheadCount > 0 || behindCount > 0}
          <span class="sync-badge" title="{aheadCount} ahead / {behindCount} behind {$branchInfo?.upstream}">
            {#if aheadCount > 0}<span class="ahead">↑{aheadCount}</span>{/if}
            {#if behindCount > 0}<span class="behind">↓{behindCount}</span>{/if}
          </span>
        {/if}
      {/if}
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

  {#snippet publishForm()}
    <div class="publish-form">
      <div class="publish-title">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.5.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.6 9.6 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 22 12c0-5.52-4.48-10-10-10z"/></svg>
        Publish to GitHub
      </div>
      {#if !githubTokenSaved}
        <input
          class="publish-input"
          type="password"
          placeholder="Personal access token (ghp_…)"
          bind:value={tokenInput}
          autocomplete="off"
        />
        <button
          class="publish-help"
          onclick={() => invoke('preview_open_in_browser', { url: 'https://github.com/settings/tokens/new?scopes=repo&description=Soryq' }).catch(() => {})}
        >Create a token with 'repo' scope →</button>
      {/if}
      <input class="publish-input" type="text" placeholder="repository-name" bind:value={publishName} autocomplete="off" />
      <input class="publish-input" type="text" placeholder="Description (optional)" bind:value={publishDesc} autocomplete="off" />
      <label class="publish-checkbox">
        <input type="checkbox" bind:checked={publishPrivate} />
        <span>Private repository</span>
      </label>
      {#if publishError}
        <div class="publish-err-msg">{publishError}</div>
      {/if}
      <div class="publish-actions">
        <button
          class="publish-create-btn"
          onclick={doPublish}
          disabled={isPublishing || !publishName.trim() || (!githubTokenSaved && !tokenInput.trim())}
        >
          {#if isPublishing}
            <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <polyline points="21 3 21 8 16 8"/>
            </svg>
            <span>Publishing…</span>
          {:else}
            <span>Create &amp; Push</span>
          {/if}
        </button>
        <button class="publish-cancel-btn" onclick={() => { publishOpen = false; publishError = null; }}>Cancel</button>
      </div>
    </div>
  {/snippet}

  <div class="sc-content">
    {#if errorMsg && notAGitRepo}
      <div class="sc-clean">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom: 6px;">
          <line x1="6" y1="3" x2="6" y2="15"/>
          <circle cx="18" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <path d="M18 9a9 9 0 01-9 9"/>
        </svg>
        <p>Not on GitHub yet</p>
        <p class="sub">This folder isn't a Git repository. Publish it to create a repo and push your files.</p>
        {#if publishOpen}
          {@render publishForm()}
        {:else}
          <button class="publish-cta" onclick={openPublish}>Publish to GitHub</button>
        {/if}
      </div>
    {:else if errorMsg}
      <div class="sc-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>{errorMsg}</p>
      </div>
    {:else if (isFetchingStatus && !gitStatus) || (isFetchingHistory && !gitHistory)}
      <div class="sc-loading-skeleton-container">
        <div class="skeleton-header">
          <div class="skeleton-bar" style="width: 50%; height: 18px; margin-bottom: 8px;"></div>
          <div class="skeleton-bar" style="width: 100%; height: 32px; margin-bottom: 12px;"></div>
        </div>
        <div class="skeleton-list">
          {#each Array(3) as _}
            <div class="skeleton-list-item">
              <div class="skeleton-bar" style="width: 14px; height: 14px; border-radius: 4px; margin-right: 8px;"></div>
              <div class="skeleton-bar" style="width: 60%; height: 12px;"></div>
            </div>
          {/each}
        </div>
      </div>
    {:else}
      {@const totalChanges = gitStatus ? (gitStatus.modified.length + gitStatus.added.length + gitStatus.deleted.length + gitStatus.untracked.length) : 0}

      {#if needsPublish}
        <div class="publish-banner">
          {#if publishOpen}
            {@render publishForm()}
          {:else}
            <div class="publish-banner-row">
              <span class="publish-banner-text">This repo isn't on GitHub yet.</span>
              <button class="publish-cta small" onclick={openPublish}>Publish to GitHub</button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Commit Input and Action Buttons -->
      <div class="sc-commit-section">
        <div class="sc-commit-input-wrap">
          <textarea
            class="sc-commit-input"
            placeholder="Commit message (Ctrl+Enter to commit)..."
            bind:value={commitMessage}
            onkeydown={handleInputKeyDown}
            rows="5"
          ></textarea>
          <button
            class="ai-gen-btn"
            onclick={generateCommitMessage}
            disabled={isGeneratingMsg}
            title="Generate commit message with AI"
          >
            {#if isGeneratingMsg}
              <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <polyline points="21 3 21 8 16 8"/>
              </svg>
            {:else}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/>
                <path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z"/>
              </svg>
            {/if}
          </button>
        </div>

        <button
          class="sc-action-btn commit-btn"
          onclick={triggerGitCommit}
          disabled={isCommitting || !commitMessage.trim() || (totalChanges > 0 && selectedCount === 0)}
          title={totalChanges > 0 && selectedCount === 0 ? 'Select at least one file to commit' : 'Commit changes locally (Ctrl+Enter)'}
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
          class:has-unpushed={hasUnpushed}
          onclick={triggerGitPush}
          disabled={isPushing}
          title={hasUnpushed
            ? (isUnpublished
                ? 'Publish this branch to the remote'
                : `Push ${aheadCount} local commit${aheadCount === 1 ? '' : 's'} to remote`)
            : 'Push committed changes to remote repository'}
        >
          {#if isPushing}
            <svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              <polyline points="21 3 21 8 16 8"/>
            </svg>
            <span>Pushing...</span>
          {:else}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"/>
              <polyline points="5 12 12 5 19 12"/>
            </svg>
            <span>Push{aheadCount > 0 ? ` (${aheadCount})` : ''}</span>
          {/if}
        </button>
      </div>

      {#snippet fileRow(file: string, kind: 'modified' | 'added' | 'deleted' | 'untracked', badge: string, openable: boolean)}
        <div class="sc-file-item {kind}" class:unselected={!selectedFiles.has(file)}>
          <input
            type="checkbox"
            class="sc-file-check"
            checked={selectedFiles.has(file)}
            onchange={() => toggleFile(file)}
            title={selectedFiles.has(file) ? 'Exclude from commit' : 'Include in commit'}
            aria-label="Include {file} in commit"
          />
          <button
            class="sc-file-open"
            onclick={() => openable && handleFileClick(file)}
            disabled={!openable}
            title={openable ? file : 'Deleted file cannot be opened'}
          >
            <FileIcon name={file.split('/').pop() || ''} isDir={false} />
            <span class="file-path">{file}</span>
            <span class="status-badge {kind}">{badge}</span>
          </button>
        </div>
      {/snippet}

      <div class="sc-scrollable">
        <div class="sc-section-head-row">
          <button class="sc-section-header" onclick={() => changesExpanded = !changesExpanded} aria-expanded={changesExpanded}>
            <svg class="chevron" class:expanded={changesExpanded} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span class="sc-section-title">Changes ({totalChanges})</span>
          </button>
          {#if totalChanges > 0}
            <label class="sc-select-all" title="Select all / none">
              <input
                type="checkbox"
                checked={allSelected}
                use:setIndeterminate={selectedCount > 0 && !allSelected}
                onchange={toggleAllFiles}
                aria-label="Select all files for commit"
              />
              <span>{selectedCount}/{totalChanges}</span>
            </label>
          {/if}
        </div>

        {#if changesExpanded}
          {#if gitStatus && totalChanges > 0}
            <div class="sc-files">
              {#each gitStatus.modified as file}
                {@render fileRow(file, 'modified', 'M', true)}
              {/each}

              {#each gitStatus.added as file}
                {@render fileRow(file, 'added', 'A', true)}
              {/each}

              {#each gitStatus.deleted as file}
                {@render fileRow(file, 'deleted', 'D', false)}
              {/each}

              {#each gitStatus.untracked as file}
                {@render fileRow(file, 'untracked', 'U', true)}
              {/each}
            </div>
          {:else}
            <div class="sc-clean">
              <svg width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="currentColor" class="animated-svg-floating" style="margin-bottom: 8px;">
                <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" stroke-width="1" />
                <circle cx="32" cy="32" r="20" fill="rgba(74, 222, 128, 0.08)" stroke="rgba(74, 222, 128, 0.2)" stroke-width="1.5" />
                <path d="M22 18 L 32,28 M 32,28 L 32,46" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" />
                <circle cx="22" cy="18" r="4" fill="var(--bg-secondary)" stroke="var(--text-muted)" stroke-width="2" />
                <circle cx="32" cy="46" r="4" fill="var(--bg-secondary)" stroke="var(--text-muted)" stroke-width="2" />
                <circle cx="42" cy="22" r="8" fill="var(--success)" stroke="var(--bg-secondary)" stroke-width="2" />
                <polyline points="39 22 41 24 45 20" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <p>Workspace is Clean</p>
              <p class="sub">No modifications detected in your git working tree.</p>
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
              <div class="sc-loading-skeleton">
                {#each Array(4) as _}
                  <div class="skeleton-item">
                    <div class="skeleton-dot"></div>
                    <div class="skeleton-col">
                      <div class="skeleton-bar" style="width: 30%; height: 10px; margin-bottom: 6px;"></div>
                      <div class="skeleton-bar" style="width: 85%; height: 12px;"></div>
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <div class="sc-clean">
                <svg width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="currentColor" class="animated-svg-floating" style="margin-bottom: 8px;">
                  <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" stroke-width="1" />
                  <path d="M32 14v36" stroke="var(--text-muted)" stroke-dasharray="3,3" stroke-width="2" />
                  <circle cx="32" cy="20" r="4" fill="var(--text-muted)" />
                  <circle cx="32" cy="32" r="4" fill="var(--text-muted)" />
                  <circle cx="32" cy="44" r="4" fill="var(--text-muted)" />
                  <circle cx="44" cy="32" r="7" fill="var(--warning)" stroke="var(--bg-secondary)" stroke-width="1.5" />
                  <line x1="44" y1="29" x2="44" y2="33" stroke="#fff" stroke-width="2" stroke-linecap="round" />
                  <circle cx="44" cy="36" r="0.75" fill="#fff" />
                </svg>
                <p>No Commit History</p>
                <p class="sub">This branch has no commits recorded yet.</p>
              </div>
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
    /* Transparent so the frosted glass sidebar shows through (premium look) */
    background: transparent;
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

  .sc-error, .sc-clean {
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
    padding: 0 12px 0 16px;
    transition: background 0.1s;
  }

  .sc-file-item:hover {
    background: var(--bg-hover);
  }

  .sc-file-item.unselected .sc-file-open {
    opacity: 0.5;
  }

  .sc-file-check {
    flex-shrink: 0;
    width: 13px;
    height: 13px;
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent);
  }

  .sc-file-open {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
    padding: 6px 0;
    background: transparent;
    border: none;
    font-size: 12.5px;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
  }

  .sc-file-item:hover .sc-file-open:not(:disabled) {
    color: var(--text-primary);
  }

  .sc-file-open:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .sc-section-head-row {
    display: flex;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--sidebar-bg);
  }

  .sc-section-head-row .sc-section-header {
    position: static;
    flex: 1;
  }

  .sc-select-all {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border-subtle);
    align-self: stretch;
    cursor: pointer;
    user-select: none;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .sc-select-all input {
    width: 13px;
    height: 13px;
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent);
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

  .sc-commit-input-wrap {
    position: relative;
  }

  .sc-commit-input {
    width: 100%;
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
    box-sizing: border-box;
  }

  .sc-commit-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(20, 184, 166, 0.2);
  }

  .ai-gen-btn {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .ai-gen-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
    color: var(--accent);
    border-color: var(--accent);
  }

  .ai-gen-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  /* Local commits not yet on the remote: draw attention to the Push button. */
  .push-btn.has-unpushed {
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-hover));
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    color: var(--text-primary);
  }
  .push-btn.has-unpushed:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 26%, var(--bg-hover));
    border-color: var(--accent);
  }

  /* Publish to GitHub */
  .publish-cta {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 14px;
    margin-top: 6px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    transition: background 0.15s;
  }
  .publish-cta:hover { background: var(--button-hover-bg); }
  .publish-cta.small { padding: 5px 10px; font-size: 11px; margin-top: 0; }

  .publish-banner {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--sidebar-bg);
    flex-shrink: 0;
  }
  .publish-banner-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .publish-banner-text { font-size: 11.5px; color: var(--text-secondary); }

  .publish-form {
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: 100%;
    text-align: left;
  }
  .publish-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 2px;
  }
  .publish-input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 9px;
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: 5px;
    color: var(--text-primary);
    font-size: 12px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }
  .publish-input:focus { border-color: var(--accent); }
  .publish-help {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    margin: -2px 0 2px;
    color: var(--accent);
    font-size: 10.5px;
    cursor: pointer;
  }
  .publish-help:hover { text-decoration: underline; }
  .publish-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }
  .publish-checkbox input { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .publish-err-msg {
    font-size: 11px;
    color: var(--error);
    background: color-mix(in srgb, var(--error) 10%, transparent);
    border-radius: 5px;
    padding: 5px 8px;
    word-break: break-word;
  }
  .publish-actions { display: flex; gap: 6px; margin-top: 2px; }
  .publish-create-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 1;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .publish-create-btn:hover:not(:disabled) { opacity: 0.88; }
  .publish-create-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .publish-cancel-btn {
    padding: 0 12px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-muted);
    font-size: 11.5px;
    cursor: pointer;
  }
  .publish-cancel-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

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
  .sync-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    line-height: 1;
    padding: 2px 6px;
    border-radius: 10px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    font-family: var(--editor-font-family, monospace);
  }
  .sync-badge .ahead { color: var(--accent); }
  .sync-badge .behind { color: var(--warning); }
  .sync-badge.unpublished {
    color: var(--warning);
    border-color: color-mix(in srgb, var(--warning) 45%, transparent);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.4px;
    font-size: 9px;
  }
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

  /* Shimmer Skeletons & Floating Animations */
  .sc-loading-skeleton-container {
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }
  .skeleton-header {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 12px;
    width: 100%;
  }
  .skeleton-list-item {
    display: flex;
    align-items: center;
    width: 100%;
    height: 24px;
  }
  .sc-loading-skeleton {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    width: 100%;
  }
  .skeleton-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
  }
  .skeleton-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--bg-hover);
    flex-shrink: 0;
    margin-top: 4px;
  }
  .skeleton-col {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .skeleton-bar {
    background: linear-gradient(90deg, var(--bg-hover) 25%, var(--bg-active) 50%, var(--bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer-swipe 1.5s infinite linear;
    border-radius: 4px;
  }
  .animated-svg-floating {
    animation: floating 4s ease-in-out infinite;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
  }
  @keyframes shimmer-swipe {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @keyframes floating {
    0% { transform: translateY(0px); }
    50% { transform: translateY(-4px); }
    100% { transform: translateY(0px); }
  }
</style>
