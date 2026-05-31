<script lang="ts">
  import { tasks, addTask, updateTaskStatus, deleteTask, loadProjectTasks, type TaskStatus } from '$lib/stores/tasks';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { createVoiceInputSession, mergeVoiceTranscript } from '$lib/services/voice-input';
  import { refineVoicePrompt } from '$lib/services/voice-refinement';

  let panelEl = $state<HTMLDivElement | null>(null);
  let isNarrow = $state(false);
  let newTaskInputs = $state({ todo: '', doing: '', done: '' });
  let listeningStatus = $state<{ todo: boolean; doing: boolean; done: boolean }>({ todo: false, doing: false, done: false });
  let refiningStatus = $state<{ todo: boolean; doing: boolean; done: boolean }>({ todo: false, doing: false, done: false });
  let voiceBaseInputs = $state<{ todo: string; doing: string; done: string }>({ todo: '', doing: '', done: '' });
  let voiceDraftInputs = $state<{ todo: string; doing: string; done: string }>({ todo: '', doing: '', done: '' });
  let projectId = $derived($activeProject?.id ?? '');

  let projectTasks = $derived(
    $tasks.filter((t) => t.projectId === projectId)
  );

  let columns: { id: TaskStatus; label: string; color: string; borderColor: string; badgeBg: string; badgeColor: string }[] = [
    { id: 'todo',  label: 'To Do',       color: 'var(--text-muted)',  borderColor: 'rgba(148,148,166,0.4)',  badgeBg: 'rgba(148,148,166,0.1)',  badgeColor: 'var(--text-muted)' },
    { id: 'doing', label: 'In Progress', color: 'var(--warning)',     borderColor: 'rgba(251,191,36,0.45)', badgeBg: 'rgba(251,191,36,0.12)', badgeColor: 'var(--warning)' },
    { id: 'done',  label: 'Done',        color: 'var(--success)',     borderColor: 'rgba(74,222,128,0.45)', badgeBg: 'rgba(74,222,128,0.12)', badgeColor: 'var(--success)' },
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
        refiningStatus.todo = false;
        voiceBaseInputs.todo = newTaskInputs.todo;
        voiceDraftInputs.todo = '';
        showToast('Listening for To Do task...', 'info');
      },
      onResult: (transcript) => { voiceDraftInputs.todo = transcript; },
      onEnd: () => {
        listeningStatus.todo = false;
        refiningStatus.todo = true;
        void (async () => {
          try {
            const { text: refined } = await refineVoicePrompt(voiceDraftInputs.todo);
            newTaskInputs.todo = mergeVoiceTranscript(voiceBaseInputs.todo, refined);
          } catch (e) {
            console.error('Failed to refine voice input:', e);
          } finally {
            refiningStatus.todo = false;
            voiceBaseInputs.todo = '';
            voiceDraftInputs.todo = '';
          }
        })();
      },
      onError: (message) => {
        listeningStatus.todo = false; refiningStatus.todo = false;
        voiceBaseInputs.todo = ''; voiceDraftInputs.todo = '';
        showToast(message, 'error');
      },
    }),
    doing: createVoiceInputSession({
      onStart: () => {
        listeningStatus.doing = true;
        refiningStatus.doing = false;
        voiceBaseInputs.doing = newTaskInputs.doing;
        voiceDraftInputs.doing = '';
        showToast('Listening for In Progress task...', 'info');
      },
      onResult: (transcript) => { voiceDraftInputs.doing = transcript; },
      onEnd: () => {
        listeningStatus.doing = false;
        refiningStatus.doing = true;
        void (async () => {
          try {
            const { text: refined } = await refineVoicePrompt(voiceDraftInputs.doing);
            newTaskInputs.doing = mergeVoiceTranscript(voiceBaseInputs.doing, refined);
          } catch (e) {
            console.error('Failed to refine voice input:', e);
          } finally {
            refiningStatus.doing = false;
            voiceBaseInputs.doing = '';
            voiceDraftInputs.doing = '';
          }
        })();
      },
      onError: (message) => {
        listeningStatus.doing = false; refiningStatus.doing = false;
        voiceBaseInputs.doing = ''; voiceDraftInputs.doing = '';
        showToast(message, 'error');
      },
    }),
    done: createVoiceInputSession({
      onStart: () => {
        listeningStatus.done = true;
        refiningStatus.done = false;
        voiceBaseInputs.done = newTaskInputs.done;
        voiceDraftInputs.done = '';
        showToast('Listening for Done task...', 'info');
      },
      onResult: (transcript) => { voiceDraftInputs.done = transcript; },
      onEnd: () => {
        listeningStatus.done = false;
        refiningStatus.done = true;
        void (async () => {
          try {
            const { text: refined } = await refineVoicePrompt(voiceDraftInputs.done);
            newTaskInputs.done = mergeVoiceTranscript(voiceBaseInputs.done, refined);
          } catch (e) {
            console.error('Failed to refine voice input:', e);
          } finally {
            refiningStatus.done = false;
            voiceBaseInputs.done = '';
            voiceDraftInputs.done = '';
          }
        })();
      },
      onError: (message) => {
        listeningStatus.done = false; refiningStatus.done = false;
        voiceBaseInputs.done = ''; voiceDraftInputs.done = '';
        showToast(message, 'error');
      },
    }),
  };

  async function toggleVoiceInput(status: TaskStatus) {
    if (refiningStatus[status]) return;
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
    const taskInput = (activeElement as HTMLElement).closest('.kanban-col')?.querySelector('.add-task-input');
    const taskInputIndex = taskInput
      ? Array.from(panelEl.querySelectorAll('.add-task-input')).indexOf(taskInput as HTMLInputElement)
      : -1;
    const preferredStatus = taskInputIndex >= 0 ? columns[taskInputIndex]?.id : null;
    toggleVoiceInput(preferredStatus ?? 'todo');
  }

  // Load tasks from .soryq/tasks.json when project changes
  $effect(() => {
    const project = $activeProject;
    if (project) void loadProjectTasks(project);
  });

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    return () => document.removeEventListener('keydown', handleGlobalVoiceShortcut);
  });

  $effect(() => {
    if (!panelEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        isNarrow = entry.contentRect.width < 520;
      }
    });
    ro.observe(panelEl);
    return () => ro.disconnect();
  });

  const statusOrder: TaskStatus[] = ['todo', 'doing', 'done'];

  function moveTask(taskId: string, currentStatus: TaskStatus, dir: 1 | -1) {
    const idx = statusOrder.indexOf(currentStatus);
    const next = statusOrder[idx + dir];
    if (next) updateTaskStatus(taskId, next);
  }
</script>

<div class="tasks-panel" bind:this={panelEl}>
  {#if !projectId}
    <div class="empty-state">
      <svg width="52" height="52" viewBox="0 0 64 64" fill="none" stroke="currentColor" class="animated-svg-floating" style="margin-bottom: 10px;">
        <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" stroke-width="1" />
        <rect x="22" y="18" width="20" height="28" rx="2" stroke="var(--text-secondary)" stroke-width="1.5" />
        <circle cx="27" cy="24" r="2" fill="var(--accent)" />
        <line x1="32" y1="24" x2="38" y2="24" stroke="var(--text-secondary)" stroke-width="1.2" />
        <circle cx="27" cy="32" r="2" fill="var(--text-muted)" />
        <line x1="32" y1="32" x2="38" y2="32" stroke="var(--text-muted)" stroke-width="1.2" />
        <circle cx="27" cy="40" r="2" fill="var(--text-muted)" />
        <line x1="32" y1="40" x2="36" y2="40" stroke="var(--text-muted)" stroke-width="1.2" />
        <circle cx="44" cy="22" r="7" fill="rgba(74, 222, 128, 0.15)" stroke="var(--success)" stroke-width="1.2" />
        <polyline points="41 22 43 24 47 20" fill="none" stroke="var(--success)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <p class="empty-title">No Active Project</p>
      <p class="empty-desc">Open a project folder to track and organize your tasks.</p>
    </div>
  {:else}
    <div class="panel-meta">
      <span class="meta-project">{$activeProject?.name ?? 'Project'}</span>
      <span class="meta-count">{projectTasks.length} {projectTasks.length === 1 ? 'task' : 'tasks'}</span>
    </div>

    <div class="kanban-board" class:kanban-board--stacked={isNarrow}>
      {#each columns as col}
        {@const colTasks = getColumnTasks(col.id)}
        <div class="kanban-col">
          <div class="col-header">
            <span class="col-accent-bar" style="background: {col.color};"></span>
            <span class="col-label">{col.label}</span>
            <span class="col-badge" style="background: {col.badgeBg}; color: {col.badgeColor};">{colTasks.length}</span>
          </div>

          <div class="task-list">
            {#each colTasks as task (task.id)}
              <div class="task-card" class:is-done={col.id === 'done'} style="border-left-color: {col.borderColor};">
                <span class="task-title">{task.title}</span>
                <div class="task-actions">
                  {#if col.id !== 'todo'}
                    <button class="task-btn" onclick={() => moveTask(task.id, col.id, -1)} title="Move back">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6"/>
                      </svg>
                    </button>
                  {/if}
                  {#if col.id !== 'done'}
                    <button class="task-btn" onclick={() => moveTask(task.id, col.id, 1)} title="Move forward">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  {/if}
                  <button class="task-btn delete-btn" onclick={() => deleteTask(task.id)} title="Delete">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>

          <div class="add-task-row">
            {#if refiningStatus[col.id]}
              <div class="refining-label">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-icon">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                </svg>
                Refining…
              </div>
            {/if}
            <div class="add-task-input-wrap">
              <input
                class="add-task-input"
                type="text"
                placeholder="New task…"
                bind:value={newTaskInputs[col.id]}
                onkeydown={(e) => handleInputKeyDown(e, col.id)}
                style="--col-color: {col.color};"
              />
              <div class="add-task-actions">
                <button
                  class="voice-btn"
                  class:listening={listeningStatus[col.id]}
                  class:refining={refiningStatus[col.id]}
                  onclick={() => toggleVoiceInput(col.id)}
                  title={listeningStatus[col.id] ? 'Stop listening' : refiningStatus[col.id] ? 'Refining with AI…' : 'Voice input'}
                  aria-label="Voice input"
                  disabled={refiningStatus[col.id]}
                >
                  {#if refiningStatus[col.id]}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-icon">
                      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                    </svg>
                  {:else}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                      <line x1="12" x2="12" y1="19" y2="22"/>
                    </svg>
                  {/if}
                </button>
                <button
                  class="add-btn"
                  onclick={() => submitTask(col.id)}
                  disabled={!newTaskInputs[col.id].trim()}
                  title="Add task"
                  aria-label="Add task"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              </div>
            </div>
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
    /* Transparent so the frosted glass aux panel shows through (premium look) */
    background: transparent;
  }

  /* ─── Empty state ─── */
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
    color: var(--text-muted);
    user-select: none;
  }

  .empty-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 6px;
  }

  .empty-desc {
    color: var(--text-muted);
    font-size: 11.5px;
    margin: 0;
    line-height: 1.5;
    text-align: center;
    max-width: 220px;
  }

  .animated-svg-floating {
    animation: floating 4s ease-in-out infinite;
    filter: drop-shadow(0 4px 10px rgba(0,0,0,0.2));
  }

  @keyframes floating {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(-5px); }
  }

  /* ─── Project meta bar ─── */
  .panel-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px 8px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .meta-project {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta-count {
    font-size: 10.5px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  /* ─── Kanban board ─── */
  .kanban-board {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }

  .kanban-board--stacked {
    flex-direction: column;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  /* ─── Column ─── */
  .kanban-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    border-right: 1px solid var(--border-subtle);
    padding: 12px 10px 0;
  }

  .kanban-col:last-child {
    border-right: none;
  }

  .kanban-board--stacked .kanban-col {
    flex: none;
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
    min-height: 160px;
    padding-bottom: 10px;
  }

  .kanban-board--stacked .kanban-col:last-child {
    border-bottom: none;
  }

  /* ─── Column header ─── */
  .col-header {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 10px;
    flex-shrink: 0;
  }

  .col-accent-bar {
    width: 3px;
    height: 13px;
    border-radius: 2px;
    flex-shrink: 0;
    opacity: 0.85;
  }

  .col-label {
    font-size: 11px;
    font-weight: 650;
    color: var(--text-secondary);
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .col-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 10px;
    flex-shrink: 0;
  }

  /* ─── Task list ─── */
  .task-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-bottom: 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
    min-height: 0;
  }

  /* ─── Task card ─── */
  .task-card {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 9px 9px 9px 11px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.45);
    border: 1px solid var(--border);
    border-left-width: 3px;
    border-radius: 7px;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
    cursor: default;
  }

  .task-card:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  }

  .task-card.is-done .task-title {
    text-decoration: line-through;
    opacity: 0.5;
  }

  .task-title {
    flex: 1;
    font-size: 12px;
    color: var(--text-primary);
    line-height: 1.4;
    word-break: break-word;
    min-width: 0;
  }

  .task-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
    align-self: flex-start;
    margin-top: 1px;
  }

  .task-card:hover .task-actions {
    opacity: 1;
  }

  .task-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .task-btn:hover {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .delete-btn:hover {
    background: rgba(239, 68, 68, 0.12);
    color: var(--error);
  }

  /* ─── Add task row ─── */
  .add-task-row {
    flex-shrink: 0;
    padding: 8px 0 12px;
    border-top: 1px dashed var(--border-subtle);
    margin-top: 2px;
  }

  .add-task-input-wrap {
    position: relative;
    width: 100%;
  }

  .add-task-input {
    width: 100%;
    height: 30px;
    padding: 0 58px 0 9px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.5);
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--text-primary);
    font-size: 11.5px;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .add-task-input:focus {
    border-color: var(--col-color, var(--accent));
  }

  .add-task-input::placeholder {
    color: var(--text-muted);
    opacity: 0.55;
  }

  .add-task-actions {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 2px;
    align-items: center;
  }

  .voice-btn {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .voice-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .voice-btn.listening {
    color: var(--error);
    animation: mic-pulse 1s ease-in-out infinite;
  }

  .voice-btn.refining {
    background: rgba(139, 92, 246, 0.14);
    color: #a78bfa;
    cursor: default;
    animation: refine-glow 1.4s ease-in-out infinite;
  }

  @keyframes mic-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }

  @keyframes refine-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); }
    50%       { box-shadow: 0 0 5px 2px rgba(139, 92, 246, 0.2); }
  }

  .spin-icon {
    animation: sparkle-spin 1.6s linear infinite;
    flex-shrink: 0;
  }

  @keyframes sparkle-spin {
    0%   { transform: rotate(0deg) scale(1);     opacity: 1; }
    50%  { transform: rotate(180deg) scale(1.15); opacity: 0.7; }
    100% { transform: rotate(360deg) scale(1);   opacity: 1; }
  }

  .refining-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: #a78bfa;
    padding: 3px 0 5px;
    animation: refine-fade 1.2s ease-in-out infinite;
  }

  @keyframes refine-fade {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1; }
  }

  .add-btn {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    background: var(--accent-light);
    color: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .add-btn:hover:not(:disabled) {
    background: var(--accent);
    color: var(--button-text, #fff);
  }

  .add-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
</style>
