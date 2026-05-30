<script lang="ts">
  import { quickRuns, addQuickRun, deleteQuickRun, getPresetRuns } from '$lib/stores/runs';
  import { activeProject } from '$lib/stores/workspace';
  import {
    writeToSession,
    activeSessionId,
    createTerminalSession,
    findAvailablePaneForAgentRun,
    markSessionAgentPreset,
  } from '$lib/stores/terminal';
  import { showToast } from '$lib/stores/notification';
  import { focusTerminal } from '$lib/stores/layout';

  let projectId = $derived($activeProject?.id ?? '');
  let projectRuns = $derived(projectId ? [...getPresetRuns(projectId), ...$quickRuns.filter((r) => r.projectId === projectId)] : []);

  let newName = $state('');
  let newCommand = $state('');
  let showAddForm = $state(false);
  const presetAgentCommands = new Set(['codex', 'claude', 'aider', 'agy', 'opencode', 'pi', 'copilot']);

  function submitAdd() {
    const name = newName.trim();
    const command = newCommand.trim();
    if (!name || !command || !projectId) return;
    addQuickRun(projectId, name, command);
    newName = '';
    newCommand = '';
    showAddForm = false;
  }

  async function runCommand(command: string, isPreset = false) {
    if (presetAgentCommands.has(command)) {
      const target = findAvailablePaneForAgentRun();
      if (!target) {
        showToast('No inactive non-agent terminal pane available', 'warning');
        return;
      }

      let sessionId = target.sessionId;
      if (sessionId === null) {
        sessionId = await createTerminalSession($activeProject?.root_path, target.paneIdx);
      }

      if (sessionId === null || sessionId === undefined) {
        showToast('Failed to prepare terminal for agent command', 'error');
        return;
      }

      markSessionAgentPreset(sessionId, command);
      focusTerminal();
      writeToSession(sessionId, command + '\r');
      showToast(`Running agent in pane ${target.paneIdx + 1}: ${command}`, 'info');
      return;
    }

    const sessionId = $activeSessionId;
    if (sessionId === null || sessionId === undefined) {
      showToast('No active terminal session', 'error');
      return;
    }
    focusTerminal();
    writeToSession(sessionId, command + '\r');
    showToast(`Running: ${command}`, 'info');
  }

  function handleFormKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      showAddForm = false;
      newName = '';
      newCommand = '';
    }
  }
</script>

<div class="runs-panel">
  <div class="panel-header">
    <span class="panel-title">Quick Run</span>
    <button
      class="add-toggle-btn"
      onclick={() => { showAddForm = !showAddForm; }}
      title={showAddForm ? 'Cancel' : 'Add command'}
    >
      {showAddForm ? '×' : '+'}
    </button>
  </div>

  {#if !projectId}
    <div class="empty-state">Open a project to use Quick Run</div>
  {:else}
    {#if showAddForm}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="add-form" onkeydown={handleFormKeyDown}>
        <input
          class="form-input"
          type="text"
          placeholder="Name (e.g. Dev Server)"
          bind:value={newName}
          autofocus
        />
        <input
          class="form-input mono"
          type="text"
          placeholder="Command (e.g. npm run dev)"
          bind:value={newCommand}
        />
        <div class="form-actions">
          <button class="cancel-btn" onclick={() => { showAddForm = false; newName = ''; newCommand = ''; }}>
            Cancel
          </button>
          <button
            class="save-btn"
            onclick={submitAdd}
            disabled={!newName.trim() || !newCommand.trim()}
          >
            Save
          </button>
        </div>
      </div>
    {/if}

    {#if projectRuns.length === 0 && !showAddForm}
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>
        <span>No saved commands yet</span>
        <button class="empty-add-btn" onclick={() => { showAddForm = true; }}>Add your first command</button>
      </div>
    {:else}
      <div class="runs-list">
        {#each projectRuns as run (run.id)}
          <div class="run-card">
            <button class="play-btn" onclick={() => runCommand(run.command, !!run.isPreset)} title="Run: {run.command}">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </button>
            <div class="run-info">
              <span class="run-name">{run.name}</span>
              <span class="run-command">{run.command}</span>
            </div>
            {#if !run.isPreset}
              <button class="delete-btn" onclick={() => deleteQuickRun(run.id)} title="Remove">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            {:else}
              <span class="preset-badge" title="Built-in preset">Preset</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .runs-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--sidebar-bg);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
  }

  .add-toggle-btn {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    line-height: 1;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .add-toggle-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* Add form */
  .add-form {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
    background: var(--bg-secondary);
  }

  .form-input {
    height: 30px;
    padding: 0 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    transition: border-color 0.15s;
    width: 100%;
    box-sizing: border-box;
  }

  .form-input.mono {
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
  }

  .form-input:focus {
    border-color: var(--accent);
  }

  .form-input::placeholder {
    color: var(--text-muted);
    opacity: 0.55;
  }

  .form-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .cancel-btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 7px;
    font-size: 11.5px;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .cancel-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .save-btn {
    height: 28px;
    padding: 0 14px;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 600;
    color: #fff;
    background: var(--accent);
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .save-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .save-btn:hover:not(:disabled) {
    opacity: 0.88;
  }

  /* Empty state */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 20px;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }

  .empty-icon {
    opacity: 0.25;
    color: var(--text-muted);
  }

  .empty-add-btn {
    margin-top: 8px;
    height: 30px;
    padding: 0 14px;
    border-radius: 8px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--accent);
    background: var(--accent-light);
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }

  .empty-add-btn:hover {
    background: color-mix(in srgb, var(--accent-light) 70%, var(--accent) 30%);
  }

  /* Runs list */
  .runs-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .run-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 9px;
    transition: border-color 0.15s, background 0.15s;
  }

  .run-card:hover {
    border-color: var(--accent-light);
    background: var(--bg-hover);
  }

  .play-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-light);
    color: var(--accent);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, transform 0.1s;
  }

  .play-btn:hover {
    background: var(--accent);
    color: #fff;
  }

  .play-btn:active {
    transform: scale(0.9);
  }

  .run-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }

  .run-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .run-command {
    font-size: 10.5px;
    font-family: var(--font-mono, monospace);
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delete-btn {
    width: 22px;
    height: 22px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .run-card:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: rgba(239, 68, 68, 0.12);
    color: var(--error);
  }

  .preset-badge {
    flex-shrink: 0;
    padding: 3px 7px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--accent-light) 45%, transparent);
    color: var(--text-muted);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
