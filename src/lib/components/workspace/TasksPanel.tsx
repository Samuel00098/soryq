import { useEffect, useMemo, useRef, useState } from 'react';
import { tasks, addTask, updateTaskStatus, deleteTask, loadProjectTasks, type TaskStatus } from '$lib/stores/tasks';
import { activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { createVoiceInputSession, mergeVoiceTranscript } from '$lib/services/voice-input';
import { refineVoicePrompt } from '$lib/services/voice-refinement';
import { useStore } from '$lib/react/useStore';
import './TasksPanel.css';

type StatusRecord<T> = { todo: T; doing: T; done: T };

const columns: { id: TaskStatus; label: string; color: string; borderColor: string; badgeBg: string; badgeColor: string }[] = [
  { id: 'todo',  label: 'To Do',       color: 'var(--text-muted)',  borderColor: 'rgba(148,148,166,0.4)',  badgeBg: 'rgba(148,148,166,0.1)',  badgeColor: 'var(--text-muted)' },
  { id: 'doing', label: 'In Progress', color: 'var(--warning)',     borderColor: 'rgba(251,191,36,0.45)', badgeBg: 'rgba(251,191,36,0.12)', badgeColor: 'var(--warning)' },
  { id: 'done',  label: 'Done',        color: 'var(--success)',     borderColor: 'rgba(74,222,128,0.45)', badgeBg: 'rgba(74,222,128,0.12)', badgeColor: 'var(--success)' },
];

const statusOrder: TaskStatus[] = ['todo', 'doing', 'done'];

export default function TasksPanel() {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [newTaskInputs, setNewTaskInputs] = useState<StatusRecord<string>>({ todo: '', doing: '', done: '' });
  const [listeningStatus, setListeningStatus] = useState<StatusRecord<boolean>>({ todo: false, doing: false, done: false });
  const [refiningStatus, setRefiningStatus] = useState<StatusRecord<boolean>>({ todo: false, doing: false, done: false });

  const allTasks = useStore(tasks);
  const project = useStore(activeProject);
  const projectId = project?.id ?? '';

  const projectTasks = useMemo(
    () => allTasks.filter((t) => t.projectId === projectId),
    [allTasks, projectId],
  );

  function getColumnTasks(status: TaskStatus) {
    return projectTasks.filter((t) => t.status === status);
  }

  // Mirrors latest input text so the voice-session callbacks (created once,
  // below) always read the current value without needing to be recreated.
  const newTaskInputsRef = useRef(newTaskInputs);
  useEffect(() => {
    newTaskInputsRef.current = newTaskInputs;
  }, [newTaskInputs]);

  function submitTask(status: TaskStatus) {
    const title = newTaskInputsRef.current[status].trim();
    if (!title || !projectId) return;
    addTask(projectId, title, status);
    setNewTaskInputs((prev) => ({ ...prev, [status]: '' }));
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>, status: TaskStatus) {
    if (e.key === 'Enter') submitTask(status);
  }

  // voiceBaseInputs/voiceDraftInputs are write-mostly bookkeeping used inside
  // the voice session callbacks — never rendered directly — so plain refs
  // (not state) match their original non-reactive role.
  const voiceBaseInputsRef = useRef<StatusRecord<string>>({ todo: '', doing: '', done: '' });
  const voiceDraftInputsRef = useRef<StatusRecord<string>>({ todo: '', doing: '', done: '' });

  const voiceSessionsRef = useRef<StatusRecord<ReturnType<typeof createVoiceInputSession>> | null>(null);
  if (!voiceSessionsRef.current) {
    const makeSession = (status: TaskStatus, label: string) =>
      createVoiceInputSession({
        onStart: () => {
          setListeningStatus((prev) => ({ ...prev, [status]: true }));
          setRefiningStatus((prev) => ({ ...prev, [status]: false }));
          voiceBaseInputsRef.current[status] = newTaskInputsRef.current[status];
          voiceDraftInputsRef.current[status] = '';
          showToast(`Listening for ${label} task...`, 'info');
        },
        onResult: (transcript) => {
          voiceDraftInputsRef.current[status] = transcript;
        },
        onProcessingStart: () => {
          setListeningStatus((prev) => ({ ...prev, [status]: false }));
          setRefiningStatus((prev) => ({ ...prev, [status]: true }));
        },
        onEnd: () => {
          setListeningStatus((prev) => ({ ...prev, [status]: false }));
          setRefiningStatus((prev) => ({ ...prev, [status]: true }));
          void (async () => {
            try {
              const { text: refined } = await refineVoicePrompt(voiceDraftInputsRef.current[status]);
              setNewTaskInputs((prev) => ({
                ...prev,
                [status]: mergeVoiceTranscript(voiceBaseInputsRef.current[status], refined),
              }));
            } catch (e) {
              console.error('Failed to refine voice input:', e);
            } finally {
              setRefiningStatus((prev) => ({ ...prev, [status]: false }));
              voiceBaseInputsRef.current[status] = '';
              voiceDraftInputsRef.current[status] = '';
            }
          })();
        },
        onError: (message) => {
          setListeningStatus((prev) => ({ ...prev, [status]: false }));
          setRefiningStatus((prev) => ({ ...prev, [status]: false }));
          voiceBaseInputsRef.current[status] = '';
          voiceDraftInputsRef.current[status] = '';
          showToast(message, 'error');
        },
      });

    voiceSessionsRef.current = {
      todo: makeSession('todo', 'To Do'),
      doing: makeSession('doing', 'In Progress'),
      done: makeSession('done', 'Done'),
    };
  }

  async function toggleVoiceInput(status: TaskStatus) {
    const sessions = voiceSessionsRef.current!;
    if (refiningStatus[status]) return;
    if (listeningStatus[status]) {
      sessions[status].stop();
      return;
    }
    await sessions[status].start();
  }

  // Load tasks from .soryq/tasks.json when project changes
  useEffect(() => {
    if (project) void loadProjectTasks(project);
  }, [project]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    function handleGlobalVoiceShortcut(event: KeyboardEvent) {
      if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat) return;
      const panelEl = panelRef.current;
      const activeElement = document.activeElement;
      if (!panelEl || !activeElement || !panelEl.contains(activeElement)) return;
      event.preventDefault();
      const taskInput = (activeElement as HTMLElement).closest('.kanban-col')?.querySelector('.add-task-input');
      const taskInputIndex = taskInput
        ? Array.from(panelEl.querySelectorAll('.add-task-input')).indexOf(taskInput as HTMLInputElement)
        : -1;
      const preferredStatus = taskInputIndex >= 0 ? columns[taskInputIndex]?.id : null;
      void toggleVoiceInput(preferredStatus ?? 'todo');
    }
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    return () => document.removeEventListener('keydown', handleGlobalVoiceShortcut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const panelEl = panelRef.current;
    if (!panelEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsNarrow(entry.contentRect.width < 520);
      }
    });
    ro.observe(panelEl);
    return () => ro.disconnect();
  }, []);

  function moveTask(taskId: string, currentStatus: TaskStatus, dir: 1 | -1) {
    const idx = statusOrder.indexOf(currentStatus);
    const next = statusOrder[idx + dir];
    if (next) updateTaskStatus(taskId, next);
  }

  return (
    <div className="tasks-panel" ref={panelRef}>
      {!projectId ? (
        <div className="empty-state">
          <svg width="52" height="52" viewBox="0 0 64 64" fill="none" stroke="currentColor" className="animated-svg-floating" style={{ marginBottom: 10 }}>
            <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" strokeWidth="1" />
            <rect x="22" y="18" width="20" height="28" rx="2" stroke="var(--text-secondary)" strokeWidth="1.5" />
            <circle cx="27" cy="24" r="2" fill="var(--accent)" />
            <line x1="32" y1="24" x2="38" y2="24" stroke="var(--text-secondary)" strokeWidth="1.2" />
            <circle cx="27" cy="32" r="2" fill="var(--text-muted)" />
            <line x1="32" y1="32" x2="38" y2="32" stroke="var(--text-muted)" strokeWidth="1.2" />
            <circle cx="27" cy="40" r="2" fill="var(--text-muted)" />
            <line x1="32" y1="40" x2="36" y2="40" stroke="var(--text-muted)" strokeWidth="1.2" />
            <circle cx="44" cy="22" r="7" fill="rgba(74, 222, 128, 0.15)" stroke="var(--success)" strokeWidth="1.2" />
            <polyline points="41 22 43 24 47 20" fill="none" stroke="var(--success)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="empty-title">No Active Project</p>
          <p className="empty-desc">Open a project folder to track and organize your tasks.</p>
        </div>
      ) : (
        <>
          <div className="panel-meta">
            <span className="meta-project">{project?.name ?? 'Project'}</span>
            <span className="meta-count">{projectTasks.length} {projectTasks.length === 1 ? 'task' : 'tasks'}</span>
          </div>

          <div className={`kanban-board${isNarrow ? ' kanban-board--stacked' : ''}`}>
            {columns.map((col) => {
              const colTasks = getColumnTasks(col.id);
              return (
                <div className="kanban-col" key={col.id}>
                  <div className="col-header">
                    <span className="col-accent-bar" style={{ background: col.color }}></span>
                    <span className="col-label">{col.label}</span>
                    <span className="col-badge" style={{ background: col.badgeBg, color: col.badgeColor }}>{colTasks.length}</span>
                  </div>

                  <div className="task-list">
                    {colTasks.map((task) => (
                      <div className={`task-card${col.id === 'done' ? ' is-done' : ''}`} style={{ borderLeftColor: col.borderColor }} key={task.id}>
                        <span className="task-title">{task.title}</span>
                        <div className="task-actions">
                          {col.id !== 'todo' && (
                            <button className="task-btn" onClick={() => moveTask(task.id, col.id, -1)} title="Move back">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="15 18 9 12 15 6"/>
                              </svg>
                            </button>
                          )}
                          {col.id !== 'done' && (
                            <button className="task-btn" onClick={() => moveTask(task.id, col.id, 1)} title="Move forward">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"/>
                              </svg>
                            </button>
                          )}
                          <button className="task-btn delete-btn" onClick={() => deleteTask(task.id)} title="Delete">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="add-task-row">
                    {refiningStatus[col.id] && (
                      <div className="refining-label">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin-icon">
                          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                        </svg>
                        Refining…
                      </div>
                    )}
                    <div className="add-task-input-wrap">
                      <input
                        className="add-task-input"
                        type="text"
                        placeholder="New task…"
                        value={newTaskInputs[col.id]}
                        onChange={(e) => setNewTaskInputs((prev) => ({ ...prev, [col.id]: e.target.value }))}
                        onKeyDown={(e) => handleInputKeyDown(e, col.id)}
                        style={{ '--col-color': col.color } as React.CSSProperties}
                      />
                      <div className="add-task-actions">
                        <button
                          className={`voice-btn${listeningStatus[col.id] ? ' listening' : ''}${refiningStatus[col.id] ? ' refining' : ''}`}
                          onClick={() => toggleVoiceInput(col.id)}
                          title={listeningStatus[col.id] ? 'Stop listening' : refiningStatus[col.id] ? 'Refining with AI…' : 'Voice input'}
                          aria-label="Voice input"
                          disabled={refiningStatus[col.id]}
                        >
                          {refiningStatus[col.id] ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin-icon">
                              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                              <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                              <line x1="12" x2="12" y1="19" y2="22"/>
                            </svg>
                          )}
                        </button>
                        <button
                          className="add-btn"
                          onClick={() => submitTask(col.id)}
                          disabled={!newTaskInputs[col.id].trim()}
                          title="Add task"
                          aria-label="Add task"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
