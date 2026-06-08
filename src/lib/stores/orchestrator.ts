import { writable, get, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { showToast } from '$lib/stores/notification';
import { getPresetRuns } from '$lib/stores/runs';
import { loadJson } from '$lib/utils/storage';
import {
  routeOrchestratorRequest,
  type AgentChoice,
  type RouteResult,
  type RouteLlmConfig,
  type RunningAgentRef,
} from '$lib/services/orchestrator-brain';
import { detectAgentAccess, getAgentAccessBlockedMessage } from '$lib/services/agent-access';
import { reconnoiter } from '$lib/services/orchestrator/recon';
import {
  aiProvider,
  currentAiModel,
  voiceConversationAiProvider,
  currentVoiceConversationAiModel,
  isLocalProvider,
  getProviderBaseUrl,
} from '$lib/stores/settings';
import { getProviderApiKeyLocal } from '$lib/services/ai-keychain';
import {
  createTaskRecord,
  inferExecutionMode,
  transitionTask,
  approveTask,
  requestTaskChanges,
  cancelTask,
  type ExecutionMode,
  type OrchestratorTask,
} from '$lib/services/orchestrator/task-lifecycle';
import { classifyTaskAfterExecution } from '$lib/services/orchestrator/review-gate';
import {
  makeActivityEvent,
  appendActivity,
  captureTranscript,
  MAX_ACTIVITY_EVENTS,
  MAX_TRANSCRIPT_CHARS,
  type ActivityKind,
  type ActivityEvent,
} from '$lib/services/orchestrator/activity-log';
import { watchLeasedAgentTurn, type AgentTurnOutcome } from '$lib/services/orchestrator/agent-turn-watch';
import {
  leaseOrchestratorTerminal,
  releaseOrchestratorTerminal,
  resendOrchestratorGoal as resendLeasedOrchestratorGoal,
  sendOrchestratorGoalWhenReady,
  sendOrchestratorFollowUpWhenReady,
  applyOrchestratorAgentName,
} from '$lib/services/orchestrator/terminal-lease';
import { createTaskWorktree, removeTaskWorktree } from '$lib/services/orchestrator/worktree-manager';
import { pickAssistantName, isGenericAgentName } from '$lib/services/orchestrator/agent-names';
import {
  sessions,
  getAgentDisplayName,
  promptBarInput,
  focusPromptBar,
  summarizeTerminalTask,
  getTerminalProjectState,
  getSessionOutputBuffer,
  killSession,
} from '$lib/stores/terminal';

export type {
  ExecutionMode,
  OrchestratorTask,
  OrchestratorTaskStatus,
} from '$lib/services/orchestrator/task-lifecycle';
export type { ActivityEvent, ActivityKind } from '$lib/services/orchestrator/activity-log';

// ─── Model ──────────────────────────────────────────────────────────────────
// Slice 1 of the agent orchestrator: one task owns one terminal (single-agent
// lease). Lifecycle state now lives in the shared orchestrator domain model so
// later slices (review gates, worktrees, swarms) can reuse the same semantics.

// All loaded orchestrator tasks across projects (active project's are kept fresh).
export const orchestratorTasks = writable<OrchestratorTask[]>([]);

export function getProjectOrchestratorTasks(projectId: string) {
  return derived(orchestratorTasks, ($all) => $all.filter((t) => t.projectId === projectId));
}

// projectId → root_path so flushes can write without the full project object.
const projectPaths = new Map<string, string>();

function storePath(rootPath: string): string {
  return `${rootPath}/.soryq/orchestrator.json`;
}

type PersistedTask = Omit<Partial<OrchestratorTask>, 'status'> & {
  id: string;
  projectId: string;
  goal: string;
  title?: string;
  status?: OrchestratorTask['status'] | 'pending' | 'running' | 'done';
  executionMode?: ExecutionMode;
};

function normalizeLoadedTask(raw: Partial<PersistedTask> | null | undefined): OrchestratorTask | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.projectId !== 'string') return null;

  const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
  let status: OrchestratorTask['status'];
  switch (raw.status) {
    case 'pending':
      status = 'todo';
      break;
    case 'running':
      status = 'in-progress';
      break;
    case 'done':
      status = 'complete';
      break;
    case 'todo':
    case 'in-progress':
    case 'complete':
    case 'blocked':
    case 'failed':
    case 'cancelled':
      status = raw.status;
      break;
    case 'in-review':
      status = 'in-review';
      break;
    default:
      status = 'todo';
      break;
  }

  return {
    id: raw.id,
    projectId: raw.projectId,
    goal,
    title:
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title
        : summarizeTerminalTask(goal) || goal.slice(0, 72) || 'Untitled task',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : null,
    status,
    executionMode:
      raw.executionMode === 'direct' || raw.executionMode === 'worktree'
        ? raw.executionMode
        : inferExecutionMode(goal),
    agentPreset: raw.agentPreset ?? null,
    assignedSessionId: status === 'in-progress' ? raw.assignedSessionId ?? null : null,
    worktree: raw.worktree ?? null,
    review: raw.review ?? null,
    blockedReason: raw.blockedReason ?? null,
    failureReason: raw.failureReason ?? null,
    promptSentAt: status === 'in-progress' && typeof raw.promptSentAt === 'number' ? raw.promptSentAt : null,
    activity: Array.isArray(raw.activity) ? raw.activity.slice(-MAX_ACTIVITY_EVENTS) : [],
    transcript:
      typeof raw.transcript === 'string' && raw.transcript
        ? raw.transcript.slice(-MAX_TRANSCRIPT_CHARS)
        : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,
  };
}

type LaunchState = {
  generation: number;
  cancelled: boolean;
};

const launchStateByTaskId = new Map<string, LaunchState>();

function nextLaunchGeneration(taskId: string): number {
  const generation = (launchStateByTaskId.get(taskId)?.generation ?? 0) + 1;
  launchStateByTaskId.set(taskId, { generation, cancelled: false });
  return generation;
}

function cancelPendingLaunch(taskId: string): void {
  const current = launchStateByTaskId.get(taskId);
  if (current) current.cancelled = true;
}

function clearLaunchGeneration(taskId: string, generation: number): void {
  const current = launchStateByTaskId.get(taskId);
  if (current?.generation === generation) {
    launchStateByTaskId.delete(taskId);
  }
}

function releaseTaskLease(task: OrchestratorTask): void {
  const liveSession = getTerminalProjectState(task.projectId).sessions.find((session) => session.ownerTaskId === task.id);
  if (!liveSession) return;
  releaseOrchestratorTerminal(liveSession.id);
}

// Worktree paths are deterministic per task, so a delete racing a launch's
// finalizer can both try to remove the same worktree. Track in-flight removals
// by path so cleanup is idempotent; the path is cleared when a fresh worktree is
// created at it (see launchOrchestratorTask) so later re-runs can clean up again.
const cleanedWorktreePaths = new Set<string>();

async function cleanupTaskWorktree(task: OrchestratorTask): Promise<void> {
  if (task.executionMode !== 'worktree' || !task.worktree) return;
  if (cleanedWorktreePaths.has(task.worktree.path)) return;
  cleanedWorktreePaths.add(task.worktree.path);
  try {
    await removeTaskWorktree({ projectId: task.projectId, taskId: task.id });
  } catch (err) {
    console.error('Failed to remove worktree:', err);
    showToast('Failed to remove worktree', 'error');
  }
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function loadProjectOrchestratorTasks(project: { id: string; root_path: string }): Promise<void> {
  projectPaths.set(project.id, project.root_path);
  let rawPersistedTasks: Array<Partial<PersistedTask> | null | undefined> = [];
  try {
    const raw = await invoke<string>('fs_read_file', { path: storePath(project.root_path) });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      rawPersistedTasks = parsed as Array<Partial<PersistedTask> | null | undefined>;
    }
  } catch {
    // No file yet — start empty.
  }

  // Reconcile persisted state with live terminals. A task can only still be
  // "in-progress" if its leased terminal is actually alive in this project's
  // terminal state; otherwise (app restart, terminal closed) reset to todo.
  const liveSessions = getTerminalProjectState(project.id).sessions;
  let needsFlush = false;
  const reconciledTasks: OrchestratorTask[] = [];

  for (const rawTask of rawPersistedTasks) {
    const task = normalizeLoadedTask(rawTask);
    if (!task) {
      needsFlush = true;
      continue;
    }

    let reconciledTask = task;

    if (task.status === 'in-progress') {
      const ownedSession = liveSessions.find((s) => s.ownerTaskId === task.id);
      const assignedSession =
        task.assignedSessionId != null
          ? liveSessions.find((s) => s.id === task.assignedSessionId)
          : undefined;
      const session = ownedSession ?? assignedSession;
      if (!session?.isRunning || session.ownerTaskId !== task.id) {
        reconciledTask = { ...transitionTask(task, 'todo'), assignedSessionId: null, startedAt: null, completedAt: null };
      } else if (reconciledTask.assignedSessionId !== session.id) {
        reconciledTask = { ...reconciledTask, assignedSessionId: session.id };
      }
    } else if (task.status === 'todo') {
      // A todo task with a live terminal still owned by it (e.g. the agent was
      // re-attached, or status was reset while the terminal kept running) is
      // actually in progress — reclaim it instead of stranding the session.
      const ownedSession = liveSessions.find((s) => s.ownerTaskId === task.id && s.isRunning);
      if (ownedSession) {
        reconciledTask = { ...transitionTask(task, 'in-progress'), assignedSessionId: ownedSession.id };
      } else if (task.assignedSessionId != null || task.startedAt != null || task.completedAt != null) {
        reconciledTask = { ...task, assignedSessionId: null, startedAt: null, completedAt: null };
      }
    } else if (task.assignedSessionId != null) {
      reconciledTask = { ...task, assignedSessionId: null };
    }

    if (
      rawTask?.goal !== reconciledTask.goal ||
      rawTask?.title !== reconciledTask.title ||
      (rawTask?.name ?? null) !== reconciledTask.name ||
      rawTask?.status !== reconciledTask.status ||
      rawTask?.executionMode !== reconciledTask.executionMode ||
      (rawTask?.agentPreset ?? null) !== reconciledTask.agentPreset ||
      (rawTask?.assignedSessionId ?? null) !== reconciledTask.assignedSessionId ||
      (rawTask?.worktree ?? null) !== reconciledTask.worktree ||
      (rawTask?.review ?? null) !== reconciledTask.review ||
      (rawTask?.blockedReason ?? null) !== reconciledTask.blockedReason ||
      (rawTask?.failureReason ?? null) !== reconciledTask.failureReason ||
      (rawTask?.promptSentAt ?? null) !== reconciledTask.promptSentAt ||
      rawTask?.createdAt !== reconciledTask.createdAt ||
      (rawTask?.startedAt ?? null) !== reconciledTask.startedAt ||
      (rawTask?.completedAt ?? null) !== reconciledTask.completedAt
    ) {
      needsFlush = true;
    }

    reconciledTasks.push(reconciledTask);
  }

  orchestratorTasks.update((all) => [
    ...all.filter((t) => t.projectId !== project.id),
    ...reconciledTasks,
  ]);
  if (needsFlush) await flush(project.id);
}

async function flush(projectId: string): Promise<void> {
  const rootPath = projectPaths.get(projectId);
  if (!rootPath) return;
  const projectTasks = get(orchestratorTasks).filter((t) => t.projectId === projectId);
  try {
    try { await invoke('fs_create_dir', { path: `${rootPath}/.soryq` }); } catch { /* exists */ }
    await invoke('fs_write_file', { path: storePath(rootPath), content: JSON.stringify(projectTasks, null, 2) });
  } catch (err) {
    console.error('Failed to save orchestrator tasks:', err);
    showToast('Task state could not be saved — changes may be lost on restart', 'error', 8000);
  }
}

function patchTask(id: string, patch: (t: OrchestratorTask) => OrchestratorTask): OrchestratorTask | null {
  let projectId = '';
  let updated: OrchestratorTask | null = null;
  orchestratorTasks.update((all) =>
    all.map((t) => {
      if (t.id !== id) return t;
      projectId = t.projectId;
      updated = patch(t);
      return updated;
    })
  );
  if (projectId) void flush(projectId);
  return updated;
}

// ─── Activity log ─────────────────────────────────────────────────────────────
// A durable record of what each agent did: a structured event timeline plus a
// verbatim (ANSI-stripped) snapshot of its terminal output. Both are persisted
// on the task so the record survives restarts and terminal close.

/** Record one timeline event onto a task (capped + persisted). */
export function logTaskActivity(taskId: string, kind: ActivityKind, text: string): void {
  if (!text.trim()) return;
  patchTask(taskId, (t) => ({
    ...t,
    activity: appendActivity(t.activity, makeActivityEvent(kind, text)),
  }));
}

/**
 * Snapshot the agent's live terminal output onto the task as a readable
 * transcript. Reads the session's rolling output buffer, strips control codes,
 * and stores the most recent tail. No-op when there's nothing captured.
 */
export function captureTaskTranscript(taskId: string, sessionId?: number | null): void {
  const task = get(orchestratorTasks).find((t) => t.id === taskId);
  if (!task) return;
  const sid = sessionId ?? task.assignedSessionId;
  if (sid == null) return;
  const transcript = captureTranscript(getSessionOutputBuffer(sid));
  if (!transcript) return;
  patchTask(taskId, (t) => ({ ...t, transcript }));
}

/** Read a task's live transcript while it runs, else its stored snapshot. */
export function getTaskTranscript(task: OrchestratorTask): string {
  if (task.status === 'in-progress' && task.assignedSessionId != null) {
    const live = captureTranscript(getSessionOutputBuffer(task.assignedSessionId));
    if (live) return live;
  }
  return task.transcript ?? '';
}

// ─── Turn completion ──────────────────────────────────────────────────────────
// A leased agent finishing a turn isn't a process exit (the REPL stays alive),
// so we detect it from output signals and reconcile the task here.

function isAiAvailable(): boolean {
  const p = get(aiProvider);
  const local = isLocalProvider(p);
  const key = getProviderApiKeyLocal(p) ?? '';
  const base = local ? getProviderBaseUrl(p) : '';
  return (!local || !!base) && (local || !!key);
}

function getConversationLlmConfig(useVoiceConversation = false): RouteLlmConfig {
  const provider = get(useVoiceConversation ? voiceConversationAiProvider : aiProvider);
  const local = isLocalProvider(provider);
  const apiKey = getProviderApiKeyLocal(provider) ?? '';
  const baseUrl = local ? getProviderBaseUrl(provider) : '';
  const model = get(useVoiceConversation ? currentVoiceConversationAiModel : currentAiModel);
  return { provider, model, apiKey, baseUrl };
}

const SUMMARY_TRANSCRIPT_CHARS = 3000;

async function generateTranscriptSummary(
  transcript: string,
  status: CompletionSummary['status']
): Promise<string> {
  const tail = transcript.length > SUMMARY_TRANSCRIPT_CHARS
    ? transcript.slice(-SUMMARY_TRANSCRIPT_CHARS)
    : transcript;
  const outcome =
    status === 'failed' ? 'The agent did not complete the task successfully.' :
    status === 'blocked' ? 'The agent stopped and needs human input to continue.' :
    'The agent completed the task.';
  const systemPrompt =
    `Summarize what a coding agent just did based on its terminal output. ${outcome}\n` +
    `Write 1–2 concise sentences. Name specific files created or modified, commands run, and what was accomplished. Be factual and direct.`;
  const p = get(aiProvider);
  const local = isLocalProvider(p);
  const key = getProviderApiKeyLocal(p) ?? '';
  const base = local ? getProviderBaseUrl(p) : '';
  const model = get(currentAiModel);
  return await invoke<string>('ai_complete', {
    systemPrompt,
    userText: `Terminal output:\n\n${tail}`,
    provider: p,
    model,
    apiKey: key,
    baseUrl: base || undefined,
  });
}

/** True while `sessionId` is the live, running terminal still leased to `taskId`. */
function leasedSessionLive(taskId: string, sessionId: number): boolean {
  const task = get(orchestratorTasks).find((t) => t.id === taskId);
  if (!task || task.status !== 'in-progress' || task.assignedSessionId !== sessionId) return false;
  const live = getTerminalProjectState(task.projectId).sessions.find((s) => s.id === sessionId);
  return Boolean(live?.isRunning && live.ownerTaskId === task.id);
}

/**
 * Reconcile a leased task once its agent turn ends (detected by the turn watcher
 * or by terminal exit). Idempotent: only acts while the task is still the
 * in-progress owner of `sessionId`, so the watcher and the exit handler can't
 * double-complete it. `notify` is suppressed on process exit, where the terminal
 * layer already raises its own "finished" notification.
 */
function completeLeasedTask(
  taskId: string,
  sessionId: number,
  outcome: AgentTurnOutcome,
  opts?: { notify?: boolean; exitCode?: number | null }
): void {
  const task = get(orchestratorTasks).find((t) => t.id === taskId);
  if (!task || task.status !== 'in-progress' || task.assignedSessionId !== sessionId) return;

  const blocked = outcome.kind === 'blocked';
  // Snapshot the agent's terminal output before we release the lease, so the
  // durable record captures exactly what it did this turn.
  captureTaskTranscript(taskId, sessionId);
  const updated = patchTask(taskId, (t) =>
    classifyTaskAfterExecution(t, {
      exitCode: opts?.exitCode ?? 0,
      needsHumanInput: blocked,
      note: blocked ? outcome.reason : undefined,
    })
  );
  releaseOrchestratorTerminal(sessionId);

  if (updated) {
    if (updated.status === 'blocked') {
      logTaskActivity(taskId, 'blocked', outcome.kind === 'blocked' ? outcome.reason : 'Agent needs your input.');
    } else if (updated.status === 'failed') {
      logTaskActivity(taskId, 'failed', updated.failureReason ?? 'Agent exited with errors.');
    } else if (updated.status === 'in-review') {
      logTaskActivity(taskId, 'finished', 'Finished its turn and is ready for review.');
    } else {
      logTaskActivity(taskId, 'finished', 'Finished its turn.');
    }
  }

  if (opts?.notify === false || !updated) return;
  const name = (task.agentPreset ? getAgentDisplayName(task.agentPreset) : null) ?? task.agentPreset ?? 'Agent';
  if (updated.status === 'blocked') {
    showToast(`${name} needs your input — ${task.title}`, 'warning', 9000, true);
  } else if (updated.status === 'failed') {
    showToast(`${name} failed — ${task.title}`, 'error', 8000, true);
  } else if (updated.status === 'in-review') {
    showToast(`${name} finished — ready to review`, 'success', 6000, true);
  } else {
    showToast(`${name} finished — ${task.title}`, 'success', 6000, true);
  }

  // Post a completion summary to the chat panel so the user sees what happened.
  const elapsed = task.startedAt ? Math.max(0, Math.floor((Date.now() - task.startedAt) / 1000)) : null;
  const completionStatus: CompletionSummary['status'] =
    updated.status === 'blocked' ? 'blocked' : updated.status === 'failed' ? 'failed' : 'done';
  const completionReason =
    updated.status === 'blocked' && outcome.kind === 'blocked' ? outcome.reason
    : updated.status === 'failed' ? updated.failureReason
    : null;

  const chatMsgId = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const willSummarize = !!(updated.transcript?.trim()) && isAiAvailable();
  const completionData: CompletionSummary = {
    status: completionStatus,
    agentName: name,
    taskTitle: task.title,
    elapsedSec: elapsed,
    reason: completionReason ?? null,
    summary: null,
    summaryPending: willSummarize,
  };

  appendChat(task.projectId, {
    id: chatMsgId,
    role: 'assistant',
    text: '',
    ts: Date.now(),
    completion: completionData,
  });

  if (willSummarize) {
    const projectId = task.projectId;
    const transcript = updated.transcript!;
    void (async () => {
      try {
        const raw = await generateTranscriptSummary(transcript, completionStatus);
        patchChat(projectId, chatMsgId, {
          completion: { ...completionData, summary: raw.trim(), summaryPending: false },
        });
      } catch {
        patchChat(projectId, chatMsgId, {
          completion: { ...completionData, summaryPending: false },
        });
      }
    })();
  }
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function createOrchestratorTask(
  projectId: string,
  goal: string,
  executionMode?: ExecutionMode,
  agentPreset?: string | null,
  name?: string | null
): OrchestratorTask {
  const task = createTaskRecord(
    projectId,
    goal,
    executionMode ?? inferExecutionMode(goal),
    agentPreset,
    name
  );
  const titledTask = {
    ...task,
    title: summarizeTerminalTask(task.goal) || task.title || 'Untitled task',
  };
  orchestratorTasks.update((all) => [...all, titledTask]);
  void flush(projectId);
  return titledTask;
}

export function deleteOrchestratorTask(id: string) {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (task) {
    cancelPendingLaunch(task.id);
    releaseTaskLease(task);
    void cleanupTaskWorktree(task);
  }
  let projectId = '';
  orchestratorTasks.update((all) => {
    const found = all.find((t) => t.id === id);
    if (found) projectId = found.projectId;
    return all.filter((t) => t.id !== id);
  });
  if (projectId) void flush(projectId);
}

/** Give a running agent a name (or rename it). Persisted, shown on its pill, and
 * reflected on its terminal pane. */
export function renameOrchestratorAgent(id: string, name: string): void {
  const trimmed = name.trim();
  const updated = patchTask(id, (t) => ({ ...t, name: trimmed ? trimmed : null }));
  if (!updated || updated.assignedSessionId == null) return;
  const live = getTerminalProjectState(updated.projectId).sessions.find((s) => s.id === updated.assignedSessionId);
  if (live?.ownerTaskId === updated.id) applyOrchestratorAgentName(updated.assignedSessionId, updated.name);
}

/** Release the terminal lease without killing the terminal; task returns to todo. */
export function unlinkOrchestratorTask(id: string) {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (task) {
    // Snapshot the terminal output while the session is still alive.
    captureTaskTranscript(id, task.assignedSessionId);
    cancelPendingLaunch(task.id);
    releaseTaskLease(task);
  }
  patchTask(id, (t) => {
    const reset = t.status === 'in-progress' ? transitionTask(t, 'todo') : { ...t, status: 'todo' as const };
    return { ...reset, assignedSessionId: null, startedAt: null, completedAt: null };
  });
  logTaskActivity(id, 'released', 'Released terminal.');
}

// ─── Launch ───────────────────────────────────────────────────────────────────

function sendGoalToLeasedTask(
  id: string,
  sessionId: number,
  goal: string,
  agentCommand: string,
  watchTurn: boolean,
): void {
  void (async () => {
    try {
      const sent = await sendOrchestratorGoalWhenReady(sessionId, goal, {
        shouldContinue: () => leasedSessionLive(id, sessionId),
      });
      if (!sent) return;
      patchTask(id, (current) =>
        current.status === 'in-progress' ? { ...current, promptSentAt: Date.now() } : current
      );
      logTaskActivity(id, 'goal', goal);
      showToast('Sent goal to ' + (getAgentDisplayName(agentCommand) ?? agentCommand), 'info', 3000);
      if (!watchTurn) return;
      const outcome = await watchLeasedAgentTurn(sessionId, {
        shouldContinue: () => leasedSessionLive(id, sessionId),
      });
      if (outcome.kind !== 'aborted') completeLeasedTask(id, sessionId, outcome);
    } catch (err) {
      console.error('Failed to auto-send orchestrator goal:', err);
      showToast('Failed to send goal to agent', 'error');
    }
  })();
}

export async function launchOrchestratorTask(
  id: string,
  agentCommand: string,
  cwd: string,
  autoRunOrOpts: boolean | { autoRun?: boolean; watchTurn?: boolean; activate?: boolean; holdGoal?: boolean } = true
): Promise<number | null> {
  // 4th arg stays boolean-compatible (= autoRun). Persistent agents pass
  // `{ watchTurn: false }` so they don't auto-complete after one turn — they
  // remain in-progress/leased and addressable until released or the process exits.
  // `activate: false` launches in the background (keeps the primary stationary).
  // `holdGoal: true` spawns the terminal but defers goal sending to the caller —
  // used by sendChatMessage to overlap terminal startup with reconnaissance.
  const opts = typeof autoRunOrOpts === 'boolean' ? { autoRun: autoRunOrOpts } : autoRunOrOpts;
  const autoRun = opts.autoRun ?? true;
  const watchTurn = opts.watchTurn ?? true;
  const activate = opts.activate ?? true;
  const holdGoal = opts.holdGoal ?? false;

  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (!task) return null;

  const launchGeneration = nextLaunchGeneration(task.id);
  let createdLaunchWorktree = false;
  let launchCommitted = false;
  let worktree = task.worktree ?? null;
  try {
    let launchCwd = cwd;

    if (task.executionMode === 'worktree' && !worktree) {
      worktree = await createTaskWorktree({
        projectId: task.projectId,
        taskId: task.id,
        title: task.title,
      });
      // A fresh worktree exists at this path again — allow it to be cleaned up.
      cleanedWorktreePaths.delete(worktree.path);
      createdLaunchWorktree = true;
      patchTask(task.id, (current) => ({ ...current, worktree }));
      launchCwd = worktree.path;
    } else if (worktree) {
      launchCwd = worktree.path;
    }

    const sessionId = await leaseOrchestratorTerminal({
      agentCommand,
      cwd: launchCwd,
      taskId: task.id,
      taskTitle: task.title,
      name: task.name,
      activate,
    });
    if (sessionId == null) {
      showToast('No free terminal pane to launch the agent', 'error');
      return null;
    }

    const currentTask = get(orchestratorTasks).find((entry) => entry.id === task.id);
    const launchState = launchStateByTaskId.get(task.id);
    if (!currentTask || !launchState || launchState.generation !== launchGeneration || launchState.cancelled) {
      if (!currentTask && task.executionMode === 'worktree' && worktree) {
        void cleanupTaskWorktree({ ...task, worktree });
      }
      releaseOrchestratorTerminal(sessionId);
      return null;
    }

    patchTask(task.id, (current) =>
      transitionTask({ ...current, agentPreset: agentCommand, assignedSessionId: sessionId, promptSentAt: null }, 'in-progress')
    );
    launchCommitted = true;
    {
      const agentName = getAgentDisplayName(agentCommand) ?? agentCommand;
      const where = worktree ? ` in worktree ${worktree.branchName}` : '';
      logTaskActivity(task.id, 'dispatch', `Launched ${agentName}${where}.`);
    }

    if (!holdGoal) {
      if (autoRun && task.goal) {
        sendGoalToLeasedTask(task.id, sessionId, task.goal, agentCommand, watchTurn);
      } else if (task.goal) {
        promptBarInput.set(task.goal);
        focusPromptBar();
      }
    }
    return sessionId;
  } finally {
    if (createdLaunchWorktree && !launchCommitted && worktree) {
      const createdWorktree = worktree;
      await cleanupTaskWorktree({ ...task, worktree: createdWorktree });
      const liveTask = get(orchestratorTasks).find((entry) => entry.id === task.id);
      if (liveTask?.worktree?.path === createdWorktree.path) {
        patchTask(task.id, (current) =>
          current.worktree?.path === createdWorktree.path ? { ...current, worktree: null } : current
        );
        // Don't resolve the launch until the cleared worktree is persisted, so a
        // caller awaiting launch sees durable state (not an in-memory-only undo).
        await flush(task.projectId);
      }
    }
    clearLaunchGeneration(task.id, launchGeneration);
  }
}

/** Re-deliver an in-progress task's goal to its agent (e.g. if the first send missed). */
export function resendOrchestratorGoal(id: string): void {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (!task || task.assignedSessionId == null || !task.goal || task.status !== 'in-progress') return;
  const live = getTerminalProjectState(task.projectId).sessions.find((s) => s.id === task.assignedSessionId);
  if (!live?.isRunning || live.ownerTaskId !== task.id) return;
  resendLeasedOrchestratorGoal(task.assignedSessionId, task.goal);
  patchTask(id, (current) => (current.status === 'in-progress' ? { ...current, promptSentAt: Date.now() } : current));
  logTaskActivity(id, 'follow-up', `Re-sent goal: ${task.goal}`);
  showToast('Re-sent goal to agent', 'info', 2500);
}

export async function resumeBlockedOrchestratorTask(id: string, prompt: string, rootPath: string): Promise<boolean> {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (!task || task.status !== 'blocked' || !task.agentPreset) return false;
  const message = prompt.trim() || 'Please continue.';
  const resumed = await sendFollowUpToAgent(task, message, rootPath);
  if (!resumed) {
    showToast('Failed to resume blocked task', 'error');
    return false;
  }
  showToast('Resumed blocked task', 'info', 2500);
  return true;
}

// ─── Review gate actions ──────────────────────────────────────────────────────
// A finished worktree task sits in `in-review` until the human decides. These
// are the explicit gates; the worktree is preserved across all of them so the
// branch/diff stays available (cleanup happens on delete).

/** Approve an in-review task → complete. Keeps the worktree for inspection/merge. */
export function approveOrchestratorTask(id: string): void {
  patchTask(id, (task) => approveTask(task));
  logTaskActivity(id, 'approved', 'Approved.');
  showToast('Task approved', 'success', 2500);
}

/**
 * Send an in-review task back for more work. Returns it to `todo` with the note
 * recorded, releasing the (already-exited) lease but keeping its worktree so the
 * next launch resumes on the same branch.
 */
export function requestOrchestratorTaskChanges(id: string, note: string): void {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (task) releaseTaskLease(task);
  patchTask(id, (t) => requestTaskChanges(t, note));
  logTaskActivity(id, 'changes', note.trim() ? `Changes requested: ${note.trim()}` : 'Changes requested.');
  showToast('Requested changes', 'info', 2500);
}

/** Cancel a task outright, releasing its lease. The worktree is removed on delete. */
export function cancelOrchestratorTask(id: string, note?: string): void {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (task) {
    cancelPendingLaunch(task.id);
    releaseTaskLease(task);
  }
  patchTask(id, (t) => cancelTask(t, note));
  logTaskActivity(id, 'cancelled', note?.trim() ? `Cancelled: ${note.trim()}` : 'Cancelled.');
}

/**
 * Close a running agent: snapshot its output, kill its terminal pane, and mark
 * the task cancelled. This is the conversational opposite of "open" — unlike
 * unlink/cancel (which leave the terminal alive), it actually shuts the agent
 * down. Wired to the chat `close` action; safe to call on any task.
 */
export async function closeOrchestratorAgent(id: string, note?: string): Promise<void> {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (!task) return;
  cancelPendingLaunch(task.id);
  // Snapshot the terminal output while the session is still alive.
  captureTaskTranscript(id, task.assignedSessionId);
  const sessionId =
    task.assignedSessionId ??
    getTerminalProjectState(task.projectId).sessions.find((s) => s.ownerTaskId === task.id)?.id ??
    null;
  // killSession removes the session synchronously, so the `sessions` subscriber
  // sees no session for this task and won't race us to a "finished" completion.
  if (sessionId != null) await killSession(sessionId);
  patchTask(id, (t) => ({ ...cancelTask(t, note), assignedSessionId: null }));
  logTaskActivity(id, 'cancelled', note?.trim() ? `Closed: ${note.trim()}` : 'Closed.');
}
// The orchestrator is something you talk to: you send a natural-language
// message, the "brain" decides which agent should handle it and crafts the
// prompt, and the work is dispatched into a terminal automatically.

export interface DispatchRef {
  taskId: string;
  agent: string;
  name?: string | null;
  /** 'spawn' opened a new agent; 'send' pushed to an existing one. */
  via: 'spawn' | 'send';
}

export interface CompletionSummary {
  /** 'done' | 'failed' | 'blocked' */
  status: 'done' | 'failed' | 'blocked';
  agentName: string;
  taskTitle: string;
  elapsedSec: number | null;
  reason?: string | null;
  /** AI-generated plain-English summary of what the agent did this turn. */
  summary?: string | null;
  /** True while the summary LLM call is in flight. */
  summaryPending?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  pending?: boolean;
  /** Agents this turn touched. Newer field; legacy single fields kept for old chats. */
  dispatched?: DispatchRef[];
  dispatchedTaskId?: string | null;
  dispatchedAgent?: string | null;
  /** Reconnaissance findings shown before dispatch. */
  reconSummary?: string | null;
  /** Structured agent completion summary card. */
  completion?: CompletionSummary | null;
}

const CHAT_STORAGE_KEY = 'soryq_orchestrator_chat';
const MAX_CHAT_PER_PROJECT = 80;

function loadChat(): Record<string, ChatMessage[]> {
  return loadJson<Record<string, ChatMessage[]>>(CHAT_STORAGE_KEY, {});
}

export const chatMessages = writable<Record<string, ChatMessage[]>>(loadChat());

// ── Agent Command Center UI state ────────────────────────────────────────────
export const agentCenterOpen = writable(false);
export const agentForcedAgent = writable('auto');
export const agentVoiceModeActive = writable(false);

chatMessages.subscribe((val) => {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(val)); } catch { /* quota */ }
});

export function getProjectChat(projectId: string) {
  return derived(chatMessages, ($all) => $all[projectId] ?? []);
}

function appendChat(projectId: string, msg: ChatMessage) {
  chatMessages.update((all) => {
    const list = [...(all[projectId] ?? []), msg].slice(-MAX_CHAT_PER_PROJECT);
    return { ...all, [projectId]: list };
  });
}

function patchChat(projectId: string, id: string, patch: Partial<ChatMessage>) {
  chatMessages.update((all) => {
    const list = (all[projectId] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m));
    return { ...all, [projectId]: list };
  });
}

export function clearProjectChat(projectId: string) {
  chatMessages.update((all) => ({ ...all, [projectId]: [] }));
}

/** Agents the orchestrator may dispatch to (the project's launchable presets). */
export function getDispatchableAgents(projectId: string): AgentChoice[] {
  return getPresetRuns(projectId)
    .filter((p) => p.command !== 'npm run dev')
    .map((p) => ({ command: p.command, name: p.name }));
}

const BRAIN_OUTPUT_TAIL = 600;

/** In-progress agents the brain can address by name (most-recent first). */
export function getRunningAgentRefs(projectId: string): RunningAgentRef[] {
  return get(orchestratorTasks)
    .filter((t) => t.projectId === projectId && t.status === 'in-progress' && t.assignedSessionId != null)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .map((t) => {
      const full = getTaskTranscript(t);
      const recentOutput = full ? full.slice(-BRAIN_OUTPUT_TAIL) : null;
      return { name: t.name ?? null, agent: t.agentPreset ?? 'agent', title: t.goal ? t.title : 'idle', recentOutput };
    });
}

/** Paused agents that the assistant can resume naturally in chat. */
export function getReviewableAgentRefs(projectId: string): RunningAgentRef[] {
  return get(orchestratorTasks)
    .filter((t) => t.projectId === projectId && (t.status === 'blocked' || t.status === 'in-review'))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .map((t) => ({
      name: t.name ?? null,
      agent: t.agentPreset ?? 'agent',
      title: `${t.title} (${t.status === 'blocked' ? 'waiting on you' : 'ready for another pass'})`,
    }));
}


/**
 * Resolve an agent the user referred to. Matches in-progress tasks by
 * name (case-insensitive), then by agent command / display name, and also
 * considers paused tasks so they can be resumed conversationally.
 */
function resolveRunningTaskByName(projectId: string, target: string): OrchestratorTask | null {
  const wanted = target.trim().toLowerCase();
  const tasks = get(orchestratorTasks)
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt));
  const running = tasks.filter((t) => t.status === 'in-progress' && t.assignedSessionId != null);
  const resumable = tasks.filter((t) => t.status === 'blocked' || t.status === 'in-review');
  const candidates = [...running, ...resumable];
  if (candidates.length === 0) return null;

  const byName = candidates.find((t) => t.name && t.name.toLowerCase() === wanted);
  if (byName) return byName;

  if (wanted === 'last' || wanted === 'it' || wanted === 'that agent' || wanted === 'that one') {
    return candidates[0];
  }

  const byAgent = candidates.find(
    (t) =>
      (t.agentPreset && t.agentPreset.toLowerCase() === wanted) ||
      (getAgentDisplayName(t.agentPreset)?.toLowerCase() === wanted)
  );
  return byAgent ?? null;
}

/** Push a prompt to a running agent's live terminal; if the task is paused, reopen it and send automatically. */
async function sendFollowUpToAgent(task: OrchestratorTask, prompt: string, rootPath: string): Promise<boolean> {
  if (task.assignedSessionId != null) {
    const live = getTerminalProjectState(task.projectId).sessions.find((s) => s.id === task.assignedSessionId);
    if (!live?.isRunning || live.ownerTaskId !== task.id) return false;
    const sent = await sendOrchestratorFollowUpWhenReady(task.assignedSessionId, prompt, {
      shouldContinue: () => leasedSessionLive(task.id, task.assignedSessionId!),
    });
    if (!sent) return false;
    patchTask(task.id, (current) => (current.status === 'in-progress' ? { ...current, promptSentAt: Date.now() } : current));
    logTaskActivity(task.id, 'follow-up', prompt);
    return true;
  }

  if ((task.status !== 'blocked' && task.status !== 'in-review') || !task.agentPreset) return false;

  const cwd = task.worktree?.path ?? rootPath;
  const sessionId = await leaseOrchestratorTerminal({
    agentCommand: task.agentPreset,
    cwd,
    taskId: task.id,
    taskTitle: task.title,
    name: task.name,
  });
  if (sessionId == null) return false;

  patchTask(task.id, (current) => ({
    ...current,
    status: 'in-progress',
    agentPreset: task.agentPreset,
    assignedSessionId: sessionId,
    startedAt: current.startedAt ?? Date.now(),
    completedAt: null,
    review: null,
    blockedReason: null,
    failureReason: null,
    promptSentAt: null,
  }));

  const agentName = getAgentDisplayName(task.agentPreset) ?? task.agentPreset;
  const where = task.worktree ? ` in worktree ${task.worktree.branchName}` : '';
  logTaskActivity(task.id, 'dispatch', `Resumed ${agentName}${where}.`);

  const sent = await sendOrchestratorFollowUpWhenReady(sessionId, prompt, {
    shouldContinue: () => leasedSessionLive(task.id, sessionId),
  });
  if (!sent) return false;
  patchTask(task.id, (current) => (current.status === 'in-progress' ? { ...current, promptSentAt: Date.now() } : current));
  logTaskActivity(task.id, 'follow-up', prompt);

  void (async () => {
    const outcome = await watchLeasedAgentTurn(sessionId, {
      shouldContinue: () => leasedSessionLive(task.id, sessionId),
    });
    if (outcome.kind !== 'aborted') completeLeasedTask(task.id, sessionId, outcome);
  })();

  return true;
}

function compactInlineText(raw: string, maxChars: number): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function formatTaskActivity(event: ActivityEvent): string {
  return `${event.kind}: ${compactInlineText(event.text, 90)}`;
}

function buildProjectTaskMemory(projectId: string): string[] {
  return get(orchestratorTasks)
    .filter((task) => task.projectId === projectId)
    .filter((task) => (task.activity?.length ?? 0) > 0 || task.status !== 'todo')
    .map((task) => {
      const lastEvent = task.activity?.[task.activity.length - 1];
      const recency = lastEvent?.ts ?? task.completedAt ?? task.startedAt ?? task.createdAt;
      return { task, recency };
    })
    .sort((a, b) => (b.recency - a.recency) || a.task.id.localeCompare(b.task.id))
    .slice(0, 5)
    .map(({ task }) => {
      const activities = task.activity ?? [];
      const label = compactInlineText(task.name ?? task.title ?? task.goal, 64);
      const agent = compactInlineText(task.agentPreset ?? 'agent', 48);
      const head = label ? `${label} [${agent}, ${task.status}]` : `[${agent}, ${task.status}]`;
      const activity = activities.slice(-2).map(formatTaskActivity).filter((line) => line.length > 0);
      if (activity.length) return `${head} — ${activity.join('; ')}`;
      const goal = compactInlineText(task.goal, 120);
      return goal ? `${head} — goal: ${goal}` : head;
    });
}

function msgId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Talk to the orchestrator. Appends the user message, asks the brain how to
 * route it (LLM when configured, heuristic otherwise), replies, and — when the
 * brain decides to act — creates a task and launches the chosen agent.
 *
 * `forcedAgent` (a preset command, or 'auto') lets the user override routing.
 */
export async function sendChatMessage(
  projectId: string,
  rootPath: string,
  text: string,
  opts?: { projectName?: string; forcedAgent?: string; voiceConversation?: boolean }
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || !projectId) return;

  const access = await detectAgentAccess();
  if (!access.ready) {
    appendChat(projectId, { id: msgId(), role: 'user', text: trimmed, ts: Date.now() });
    appendChat(projectId, {
      id: msgId(),
      role: 'assistant',
      text: getAgentAccessBlockedMessage(),
      ts: Date.now(),
    });
    return;
  }

  const agents = getDispatchableAgents(projectId);
  const recentUserMessages = (get(chatMessages)[projectId] ?? [])
    .filter((m) => !m.pending && m.role === 'user')
    .map((m) => m.text)
    .slice(-6);
  const taskMemory = buildProjectTaskMemory(projectId);
  const llmConfig = getConversationLlmConfig(!!opts?.voiceConversation);

  appendChat(projectId, { id: msgId(), role: 'user', text: trimmed, ts: Date.now() });
  const assistantId = msgId();
  appendChat(projectId, { id: assistantId, role: 'assistant', text: '', ts: Date.now(), pending: true });

  let result: RouteResult;
  const forced = opts?.forcedAgent && opts.forcedAgent !== 'auto'
    ? agents.find((a) => a.command === opts.forcedAgent)
    : null;
  if (forced) {
    result = {
      reply: `Handing this to ${forced.name}.`,
      actions: [{ kind: 'spawn', agent: forced.command, prompt: trimmed }],
      viaLLM: false,
    };
  } else {
    try {
      result = await routeOrchestratorRequest(trimmed, agents, {
        projectName: opts?.projectName,
        recentUserMessages,
        taskMemory,
        runningAgents: getRunningAgentRefs(projectId),
        reviewingAgents: getReviewableAgentRefs(projectId),
        llmConfig,
      });
    } catch (err) {
      console.error('Orchestrator routing error:', err);
      result = { reply: 'Something went wrong routing that. Try again.', actions: [], viaLLM: false };
    }
  }

  patchChat(projectId, assistantId, { text: result.reply, pending: false });

  // ── Pre-spawn: start agent terminals before reconnaissance ────────────────
  // Terminals begin initializing (PTY, shell, CLAUDE.md load) while the recon
  // LLM calls run, so agent startup time overlaps with codebase analysis.
  const multiSpawn = result.actions.filter((a) => a.kind === 'spawn').length > 1;
  const usedNames = getRunningAgentRefs(projectId)
    .map((r) => r.name)
    .filter((n): n is string => !!n);
  let spawnIndex = 0;

  interface SpawnEntry {
    task: ReturnType<typeof createOrchestratorTask>;
    sessionId: number | null;
    rawPrompt: string;
    agent: string;
    persistent: boolean;
    watchTurn: boolean;
    name: string;
  }
  const spawnEntries: SpawnEntry[] = [];

  for (const action of result.actions) {
    if (action.kind !== 'spawn') continue;
    // The brain sometimes labels a spawn generically ("claude-1") instead of
    // leaving it unnamed; treat those as unnamed so the agent still gets a
    // friendly human name the user can address ("ask Iris…").
    const explicitName =
      action.name && !isGenericAgentName(action.name, action.agent, getAgentDisplayName(action.agent))
        ? action.name
        : null;
    // A *meaningfully* named or task-less spawn is a *persistent* agent: launch
    // it direct (no throwaway worktree) and skip the turn watcher so it stays
    // addressable. Persistence keys off a real name, before we apply an
    // auto-name below — an auto-name must not make a one-shot task persistent.
    const persistent = !!explicitName || !action.prompt;
    // Every spawned agent gets a friendly human name so it's easy to address.
    const name = explicitName ?? pickAssistantName(usedNames);
    usedNames.push(name);
    const isPrimary = spawnIndex === 0;
    spawnIndex++;

    const task = createOrchestratorTask(
      projectId,
      action.prompt ?? '',
      persistent ? 'direct' : undefined,
      action.agent,
      name
    );

    // Spawn terminal now but hold the goal — recon will enrich it before sending.
    const sessionId = await launchOrchestratorTask(task.id, action.agent, rootPath, {
      autoRun: false,
      holdGoal: true,
      activate: !multiSpawn || isPrimary,
    });

    if (sessionId == null) {
      // Launch failed (no free terminal pane) — remove the orphaned task record.
      deleteOrchestratorTask(task.id);
      showToast(`Could not start ${getAgentDisplayName(action.agent) ?? action.agent} — no terminal available`, 'error', 5000);
    }

    spawnEntries.push({ task, sessionId, rawPrompt: action.prompt ?? '', agent: action.agent, persistent, watchTurn: !persistent, name });
  }

  // ── Reconnaissance ──────────────────────────────────────────────────────────
  // Gather codebase context to enrich each spawn prompt. Terminals are already
  // spinning up in parallel, so agent startup overlaps with these LLM calls.
  let reconSummary: string | null = null;
  let enrichedPrompt: string | null = null;

  const actionableSpawns = spawnEntries.filter(
    (e) => e.sessionId != null && e.rawPrompt.trim().length > 10
  );
  if (actionableSpawns.length > 0 && rootPath) {
    try {
      patchChat(projectId, assistantId, {
        text: result.reply + '\n\n🔍 Analyzing codebase…',
      });

      const recon = await reconnoiter(
        actionableSpawns.map((e) => e.rawPrompt).filter(Boolean).join('; '),
        rootPath,
        opts?.projectName ?? 'project',
        async (sysPrompt, userText) => {
          const { provider, model, apiKey, baseUrl } = llmConfig;
          const local = isLocalProvider(provider);
          if ((!local || baseUrl) && (local || apiKey)) {
            return await invoke<string>('ai_complete', {
              systemPrompt: sysPrompt,
              userText,
              provider,
              model,
              apiKey,
              baseUrl: baseUrl || undefined,
            });
          }
          throw new Error('No AI provider configured');
        },
        projectId
      );

      reconSummary = recon.summary;
      enrichedPrompt = recon.enrichedPrompt || null;

      patchChat(projectId, assistantId, {
        text: result.reply,
        reconSummary: recon.findings.length > 0
          ? `🧠 Gathered context:\n${recon.summary}`
          : null,
      });
    } catch (err) {
      console.warn('Reconnaissance failed (dispatching with raw prompt):', err);
      patchChat(projectId, assistantId, { text: result.reply, reconSummary: null });
    }
  }

  // ── Send goals to pre-spawned agents + handle non-spawn actions ─────────────
  const dispatched: DispatchRef[] = [];

  for (const { task, sessionId, rawPrompt, agent, persistent, watchTurn, name } of spawnEntries) {
    if (sessionId == null) continue;
    const goal = enrichedPrompt ?? rawPrompt;
    if (goal !== rawPrompt) {
      patchTask(task.id, (t) => ({ ...t, goal }));
    }
    if (rawPrompt) {
      sendGoalToLeasedTask(task.id, sessionId, goal, agent, watchTurn);
    } else if (!persistent) {
      promptBarInput.set(goal);
      focusPromptBar();
    }
    dispatched.push({ taskId: task.id, agent, name, via: 'spawn' });
  }

  for (const action of result.actions) {
    if (action.kind === 'send') {
      const target = resolveRunningTaskByName(projectId, action.target);
      if (target && (await sendFollowUpToAgent(target, action.prompt, rootPath))) {
        dispatched.push({ taskId: target.id, agent: target.agentPreset ?? 'agent', name: target.name ?? null, via: 'send' });
      } else {
        showToast(`No running agent named "${action.target}"`, 'warning', 4000);
      }
    } else if (action.kind === 'name') {
      const target = resolveRunningTaskByName(projectId, action.target);
      if (target) renameOrchestratorAgent(target.id, action.name);
      else showToast(`No running agent named "${action.target}"`, 'warning', 4000);
    } else if (action.kind === 'close') {
      const wanted = action.target.trim().toLowerCase();
      if (wanted === 'all' || wanted === 'everything') {
        const running = get(orchestratorTasks).filter(
          (t) => t.projectId === projectId && t.status === 'in-progress' && t.assignedSessionId != null
        );
        if (running.length === 0) showToast('No running agents to close', 'info', 3000);
        for (const t of running) await closeOrchestratorAgent(t.id);
      } else {
        const target = resolveRunningTaskByName(projectId, action.target);
        if (target) await closeOrchestratorAgent(target.id);
        else showToast(`No running agent named "${action.target}"`, 'warning', 4000);
      }
    }
  }

  if (dispatched.length) {
    const patch: Partial<ChatMessage> = { dispatched };
    if (reconSummary != null) patch.reconSummary = reconSummary;
    patchChat(projectId, assistantId, patch);
  }
}

if (typeof window !== 'undefined') {
  sessions.subscribe(($sessions) => {
    const inProgress = get(orchestratorTasks).filter(
      (t) => t.status === 'in-progress' && t.assignedSessionId != null
    );
    for (const t of inProgress) {
      const session = $sessions.find((s) => s.id === t.assignedSessionId);
      if (!session) continue; // not in the current project view — leave it alone
      if (!session.isRunning) {
        // Process exit is the fallback completion path (covers agents that do
        // exit, crashes, and turns the watcher missed). The terminal layer
        // already raises its own exit notification, so suppress ours here.
        //
        // Distinguish clean exit (code 0 or unknown) from crash (non-zero code)
        // so the task ends up in the right terminal state rather than always
        // showing "complete" for both success and crashes.
        const exitCode = session.lastExitCode ?? null;
        const outcome: AgentTurnOutcome =
          exitCode !== null && exitCode !== 0
            ? { kind: 'blocked', reason: `Agent process exited with code ${exitCode}.` }
            : { kind: 'finished' };
        completeLeasedTask(t.id, session.id, outcome, { notify: false, exitCode });
      }
    }
  });
}
