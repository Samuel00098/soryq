<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { activeSessionId, sendPromptToSession } from '$lib/stores/terminal';
  import {
    snippets,
    addSnippet,
    updateSnippet,
    deleteSnippet,
    loadGlobalSnippets,
    loadProjectSnippets
  } from '$lib/stores/snippets';
  import type { ShellSnippet } from '$lib/stores/snippets';

  onMount(() => {
    loadGlobalSnippets();
  });

  $effect(() => {
    const proj = $activeProject;
    if (proj) {
      void loadProjectSnippets(proj);
    }
  });

  // UI state
  let searchQuery = $state('');
  let currentScope = $state<'global' | 'project'>('global');
  let showForm = $state(false);
  let editingId = $state<string | null>(null);

  // Form fields
  let formName = $state('');
  let formCommand = $state('');
  let formDescription = $state('');

  // Derived filter list
  let filteredSnippets = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    const isProjectScope = currentScope === 'project';
    const proj = $activeProject;
    
    return $snippets.filter(s => {
      // Filter by scope
      if (isProjectScope) {
        if (!proj || s.projectId !== proj.id) return false;
      } else {
        if (s.projectId !== undefined) return false;
      }
      
      // Filter by query
      if (!query) return true;
      return (
        s.name.toLowerCase().includes(query) ||
        s.command.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query)
      );
    });
  });

  function resetForm() {
    formName = '';
    formCommand = '';
    formDescription = '';
    editingId = null;
    showForm = false;
  }

  function handleSave() {
    const name = formName.trim();
    const command = formCommand.trim();
    const desc = formDescription.trim();

    if (!name || !command) {
      showToast('Name and Command are required', 'warning');
      return;
    }

    const proj = $activeProject;
    const projectId = currentScope === 'project' && proj ? proj.id : undefined;

    if (editingId) {
      updateSnippet(editingId, name, command, desc);
      showToast('Snippet updated', 'success');
    } else {
      addSnippet(name, command, desc, projectId);
      showToast('Snippet created', 'success');
    }

    resetForm();
  }

  function handleEdit(snippet: ShellSnippet) {
    formName = snippet.name;
    formCommand = snippet.command;
    formDescription = snippet.description;
    editingId = snippet.id;
    currentScope = snippet.projectId ? 'project' : 'global';
    showForm = true;
  }

  function handleDelete(id: string) {
    if (confirm('Are you sure you want to delete this snippet?')) {
      deleteSnippet(id);
      showToast('Snippet deleted', 'info');
    }
  }

  function runSnippet(command: string) {
    const session = $activeSessionId;
    if (session === null) {
      showToast('No active terminal session focused', 'warning');
      return;
    }
    sendPromptToSession(session, command);
    showToast('Command sent to terminal', 'success');
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Command copied to clipboard', 'info');
    });
  }

  // Force project scope on load if a project is active, otherwise force global
  $effect(() => {
    if (currentScope === 'project' && !$activeProject) {
      currentScope = 'global';
    }
  });
</script>

<div class="snippets-panel">
  <!-- Panel Header -->
  <div class="panel-header">
    <h3 class="panel-title">Shell Snippets</h3>
    <button 
      class="add-btn" 
      onclick={() => { showForm = !showForm; if (showForm) editingId = null; }}
      title={showForm ? 'Cancel' : 'Add Snippet'}
    >
      {#if showForm}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      {/if}
    </button>
  </div>

  <!-- Form Creator / Editor Toggle -->
  {#if showForm}
    <div class="creator-form bento-card">
      <div class="form-title">{editingId ? 'Edit Snippet' : 'Create Snippet'}</div>
      
      <div class="input-wrap">
        <label for="sn-name" class="field-label">Name</label>
        <input 
          id="sn-name"
          type="text" 
          class="input-box" 
          bind:value={formName} 
          placeholder="e.g. Run Build" 
        />
      </div>

      <div class="input-wrap">
        <label for="sn-desc" class="field-label">Description</label>
        <input 
          id="sn-desc"
          type="text" 
          class="input-box" 
          bind:value={formDescription} 
          placeholder="What this command does..." 
        />
      </div>

      <div class="input-wrap">
        <label for="sn-command" class="field-label">Command</label>
        <textarea 
          id="sn-command"
          class="input-box command-area" 
          bind:value={formCommand} 
          placeholder="e.g. npm run build"
        ></textarea>
      </div>

      {#if $activeProject}
        <div class="input-wrap scope-wrap">
          <label class="field-label">Scope</label>
          <div class="scope-toggle-group">
            <button 
              type="button"
              class="toggle-opt" 
              class:active={currentScope === 'global'}
              onclick={() => currentScope = 'global'}
            >
              Global
            </button>
            <button 
              type="button"
              class="toggle-opt" 
              class:active={currentScope === 'project'}
              onclick={() => currentScope = 'project'}
            >
              Project
            </button>
          </div>
        </div>
      {/if}

      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick={resetForm}>Cancel</button>
        <button type="button" class="btn-save" onclick={handleSave}>Save</button>
      </div>
    </div>
  {/if}

  <!-- Tab Scope Selector (Global vs Project) -->
  {#if $activeProject && !showForm}
    <div class="scope-tabs">
      <button 
        class="scope-tab" 
        class:active={currentScope === 'global'}
        onclick={() => currentScope = 'global'}
      >
        Global
      </button>
      <button 
        class="scope-tab" 
        class:active={currentScope === 'project'}
        onclick={() => currentScope = 'project'}
      >
        Project ({$activeProject.name})
      </button>
    </div>
  {/if}

  <!-- Search Input Bar -->
  {#if !showForm}
    <div class="search-bar">
      <input 
        type="text" 
        class="search-input" 
        placeholder="Search snippets..." 
        bind:value={searchQuery}
      />
    </div>
  {/if}

  <!-- Snippet List -->
  <div class="snippet-list scrollable">
    {#if filteredSnippets.length === 0}
      <div class="empty-state">
        <span class="empty-icon">📂</span>
        <span>No snippets found</span>
        {#if !showForm}
          <button class="empty-action" onclick={() => showForm = true}>Create one now</button>
        {/if}
      </div>
    {:else}
      {#each filteredSnippets as snippet (snippet.id)}
        <div class="snippet-card bento-card">
          <div class="card-top">
            <div class="card-info">
              <div class="snippet-name">{snippet.name}</div>
              {#if snippet.description}
                <div class="snippet-desc">{snippet.description}</div>
              {/if}
            </div>
            <div class="card-actions">
              <button class="icon-btn edit-btn" onclick={() => handleEdit(snippet)} title="Edit">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="icon-btn delete-btn" onclick={() => handleDelete(snippet.id)} title="Delete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="card-body">
            <code class="command-box">{snippet.command}</code>
          </div>
          <div class="card-footer">
            <button class="action-btn copy-btn" onclick={() => copyToClipboard(snippet.command)} title="Copy Command">
              Copy
            </button>
            <button class="action-btn run-btn" onclick={() => runSnippet(snippet.command)} title="Run in active terminal">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Run
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .snippets-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    color: var(--text-primary);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .panel-title {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    letter-spacing: 0.1px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-secondary);
    transition: all 0.15s ease;
  }

  .add-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  /* Creator Form */
  .creator-form {
    padding: 14px;
    margin: 12px;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.35);
    border: 1px solid var(--border);
    border-radius: var(--bento-radius, 10px);
  }

  .form-title {
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 12px;
    color: var(--accent);
  }

  .input-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .field-label {
    font-size: 10.5px;
    font-weight: 550;
    color: var(--text-secondary);
  }

  .input-box {
    background: var(--input-bg, rgba(20, 20, 25, 0.4));
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 11.5px;
    padding: 6px 10px;
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s ease;
    font-family: inherit;
  }

  .input-box:focus {
    border-color: var(--accent);
  }

  .command-area {
    min-height: 50px;
    resize: vertical;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }

  /* Scope Select */
  .scope-wrap {
    margin-bottom: 14px;
  }

  .scope-toggle-group {
    display: flex;
    background: var(--bg-active, rgba(0, 0, 0, 0.15));
    padding: 2px;
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .toggle-opt {
    flex: 1;
    font-size: 10.5px;
    font-weight: 550;
    padding: 4px 0;
    text-align: center;
    border-radius: 4px;
    color: var(--text-secondary);
    transition: all 0.15s;
  }

  .toggle-opt.active {
    background-color: var(--accent-light, rgba(6, 182, 212, 0.12));
    color: var(--accent);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-cancel, .btn-save {
    font-size: 11px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 6px;
    transition: all 0.15s;
  }

  .btn-cancel {
    color: var(--text-secondary);
  }

  .btn-cancel:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .btn-save {
    background-color: var(--accent);
    color: #ffffff;
  }

  .btn-save:hover {
    background-color: var(--accent-dark, #0891b2);
  }

  /* Tabs */
  .scope-tabs {
    display: flex;
    padding: 8px 12px 0 12px;
    gap: 6px;
    border-bottom: 1px solid var(--border);
  }

  .scope-tab {
    font-size: 11px;
    font-weight: 600;
    padding: 6px 10px;
    color: var(--text-secondary);
    border-bottom: 2px solid transparent;
    transition: all 0.15s ease;
  }

  .scope-tab:hover {
    color: var(--text-primary);
  }

  .scope-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* Search */
  .search-bar {
    padding: 10px 12px;
  }

  .search-input {
    width: 100%;
    background: var(--input-bg, rgba(20, 20, 25, 0.4));
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 11.5px;
    padding: 6px 10px;
    border-radius: 6px;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .search-input:focus {
    border-color: var(--accent);
  }

  /* List */
  .snippet-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 12px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 40px 10px;
    color: var(--text-secondary);
    font-size: 11.5px;
    text-align: center;
  }

  .empty-icon {
    font-size: 20px;
  }

  .empty-action {
    font-size: 11px;
    color: var(--accent);
    font-weight: 600;
    text-decoration: underline;
    margin-top: 4px;
  }

  /* Card */
  .snippet-card {
    padding: 10px 12px;
    border: 1px solid var(--border);
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.22);
    border-radius: var(--bento-radius, 10px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s ease, background-color 0.15s;
  }

  .snippet-card:hover {
    border-color: rgba(var(--accent-rgb, 6, 182, 212), 0.3);
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.32);
  }

  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
  }

  .card-info {
    flex: 1;
    min-width: 0;
  }

  .snippet-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .snippet-desc {
    font-size: 10.5px;
    color: var(--text-secondary);
    margin-top: 2px;
    line-height: 1.3;
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .snippet-card:hover .card-actions {
    opacity: 1;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: var(--text-secondary);
    transition: all 0.15s;
  }

  .icon-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .delete-btn:hover {
    color: var(--error);
    background-color: rgba(248, 113, 113, 0.1);
  }

  .card-body {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    padding: 6px 8px;
    border: 1px solid rgba(255, 255, 255, 0.03);
    overflow-x: auto;
  }

  :root.light-theme .card-body {
    background: rgba(0, 0, 0, 0.04);
  }

  .command-box {
    font-family: var(--font-mono, monospace);
    font-size: 10.5px;
    color: var(--accent);
    white-space: pre-wrap;
    word-break: break-all;
  }

  .card-footer {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 2px;
  }

  .action-btn {
    font-size: 10.5px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
  }

  .copy-btn {
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .copy-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
    border-color: var(--text-secondary);
  }

  .run-btn {
    background-color: var(--accent-light, rgba(6, 182, 212, 0.12));
    color: var(--accent);
    border: 1px solid rgba(var(--accent-rgb, 6, 182, 212), 0.2);
  }

  .run-btn:hover {
    background-color: var(--accent);
    color: #ffffff;
    border-color: var(--accent);
  }
</style>
