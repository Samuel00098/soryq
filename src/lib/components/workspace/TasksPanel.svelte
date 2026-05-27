<script lang="ts">
  import { tasks, addTask, updateTaskStatus, deleteTask, type TaskStatus } from '$lib/stores/tasks';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { createVoiceInputSession } from '$lib/services/voice-input';

  let panelEl = $state<HTMLDivElement | null>(null);
  let newTaskInputs = $state({ todo: '', doing: '', done: '' });
  let listeningStatus = $state<{ todo: boolean; doing: boolean; done: boolean }>({ todo: false, doing: false, done: false });
  let projectId = $derived($activeProject?.id ?? '');

  let projectTasks = $derived(
    $tasks.filter((t) => t.projectId === projectId)
  );

  let columns: { id: TaskStatus; label: string; color: string }[] = [
    { id: 'todo',  label: 'To Do',       color: 'var(--text-muted)' },
    { id: 'doing', label: 'In Progress',  color: 'var(--warning)' },
    { id: 'done',  label: 'Done',         color: 'var(--success)' },
  ];

  function getColumnTasks(status: TaskStatus) {
    return projectTasks.filter((t) => t.status === status);
  }

  function submitTask(status: TaskStatus) {
    const title = newTaskInputs[status].trim();
    if (!title || !projectId) return;
    addTask(projectId, title, status);
    newTaskInputs[status] = '';
  }

  function handleInputKeyDown(e: KeyboardEvent, status: TaskStatus) {
    if (e.key === 'Enter') submitTask(status);
  }

  const voiceSessions: Record<TaskStatus, ReturnType<typeof createVoiceInputSession>> = {
    todo: createVoiceInputSession({
      onStart: () => {
        listeningStatus.todo = true;
        showToast('Listening for To Do task...', 'info');
      },
      onResult: (transcript) => {
        newTaskInputs.todo = newTaskInputs.todo ? `${newTaskInputs.todo} ${transcript}` : transcript;
      },
      onEnd: () => {
        listeningStatus.todo = false;
      },
      onError: (message) => {
        listeningStatus.todo = false;
        showToast(message, 'error');
      },
    }),
    doing: createVoiceInputSession({
      onStart: () => {
        listeningStatus.doing = true;
        showToast('Listening for In Progress task...', 'info');
      },
      onResult: (transcript) => {
        newTaskInputs.doing = newTaskInputs.doing ? `${newTaskInputs.doing} ${transcript}` : transcript;
      },
      onEnd: () => {
        listeningStatus.doing = false;
      },
      onError: (message) => {
        listeningStatus.doing = false;
        showToast(message, 'error');
      },
    }),
    done: createVoiceInputSession({
      onStart: () => {
        listeningStatus.done = true;
        showToast('Listening for Done task...', 'info');
      },
      onResult: (transcript) => {
        newTaskInputs.done = newTaskInputs.done ? `${newTaskInputs.done} ${transcript}` : transcript;
      },
      onEnd: () => {
        listeningStatus.done = false;
      },
      onError: (message) => {
        listeningStatus.done = false;
        showToast(message, 'error');
      },
    }),
  };

  async function toggleVoiceInput(status: TaskStatus) {
    if (listeningStatus[status]) {
      voiceSessions[status].stop();
      return;
    }
    await voiceSessions[status].start();
  }

  function handleGlobalVoiceShortcut(event: KeyboardEvent) {
    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat) return;
    const activeElement = document.activeElement;
    if (!panelEl || !activeElement || !panelEl.contains(activeElement)) return;
    event.preventDefault();
    const taskInput = (activeElement as HTMLElement).closest('.add-task-row')?.querySelector('.add-task-input');
    const taskInputIndex = taskInput
      ? Array.from(panelEl.querySelectorAll('.add-task-input')).indexOf(taskInput as HTMLInputElement)
      : -1;
    const preferredStatus = taskInputIndex >= 0 ? columns[taskInputIndex]?.id : null;
    toggleVoiceInput(preferredStatus ?? 'todo');
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    return () => {
      document.removeEventListener('keydown', handleGlobalVoiceShortcut);
    };
  });

  const statusOrder: TaskStatus[] = ['todo', 'doing', 'done'];

  function moveTask(taskId: string, currentStatus: TaskStatus, dir: 1 | -1) {
    const idx = statusOrder.indexOf(currentStatus);
    const next = statusOrder[idx + dir];
    if (next) updateTaskStatus(taskId, next);
  }
</script>

<div class="tasks-panel" bind:this={panelEl}>
  <div class="panel-header">
    <span class="panel-title">Tasks</span>
    <span class="task-count">{projectTasks.length} total</span>
  </div>

  {#if !projectId}
    <div class="empty-state">Open a project to use tasks</div>
  {:else}
    <div class="columns">
      {#each columns as col}
        {@const colTasks = getColumnTasks(col.id)}
        <div class="column">
          <div class="col-header">
            <span class="col-dot" style="background: {col.color}"></span>
            <span class="col-label">{col.label}</span>
            <span class="col-count">{colTasks.length}</span>
          </div>

          <div class="task-list">
            {#each colTasks as task (task.id)}
              <div class="task-card">
                <span class="task-title">{task.title}</span>
                <div class="task-actions">
                  {#if col.id !== 'todo'}
                    <button class="task-btn" onclick={() => moveTask(task.id, col.id, -1)} title="Move back">←</button>
                  {/if}
                  {#if col.id !== 'done'}
                    <button class="task-btn" onclick={() => moveTask(task.id, col.id, 1)} title="Move forward">→</button>
                  {/if}
                  <button class="task-btn delete-btn" onclick={() => deleteTask(task.id)} title="Delete">×</button>
                </div>
              </div>
            {/each}
          </div>

          <div class="add-task-row">
            <input
              class="add-task-input"
              type="text"
              placeholder="Add task…"
              bind:value={newTaskInputs[col.id]}
              onkeydown={(e) => handleInputKeyDown(e, col.id)}
            />
            <button
              class="voice-btn"
              class:listening={listeningStatus[col.id]}
              onclick={() => toggleVoiceInput(col.id)}
              title={listeningStatus[col.id] ? 'Stop voice input' : 'Start voice input'}
              aria-label={listeningStatus[col.id] ? 'Stop voice input' : 'Start voice input'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
            </button>
            <button
              class="add-btn"
              onclick={() => submitTask(col.id)}
              disabled={!newTaskInputs[col.id].trim()}
            >+</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tasks-panel {
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

  .task-count {
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .columns {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .col-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
  }

  .col-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .col-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    flex: 1;
  }

  .col-count {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-hover);
    border-radius: 8px;
    padding: 1px 6px;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 4px;
  }

  .task-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: border-color 0.15s, background 0.15s;
  }

  .task-card:hover {
    border-color: var(--accent-light);
    background: var(--bg-hover);
  }

  .task-title {
    flex: 1;
    font-size: 12px;
    color: var(--text-primary);
    line-height: 1.35;
    word-break: break-word;
  }

  .task-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .task-card:hover .task-actions {
    opacity: 1;
  }

  .task-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    font-size: 12px;
    line-height: 1;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .task-btn:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .delete-btn:hover {
    background: rgba(239, 68, 68, 0.12);
    color: var(--error);
  }

  .add-task-row {
    display: flex;
    gap: 5px;
    align-items: center;
  }

  .add-task-input {
    flex: 1;
    height: 30px;
    padding: 0 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text-primary);
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.15s;
  }

  .add-task-input:focus {
    border-color: var(--accent);
  }

  .add-task-input::placeholder {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .add-btn {
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: var(--accent-light);
    color: var(--accent);
    font-size: 18px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .voice-btn {
    width: 30px;
    height: 30px;
    border-radius: 7px;
    background: var(--bg-secondary);
    color: var(--text-muted);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .voice-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .voice-btn.listening {
    background: rgba(239, 68, 68, 0.14);
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.28);
  }

  .add-btn:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .add-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
</style>
