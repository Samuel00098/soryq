import { writable, get, derived } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { showToast } from '$lib/stores/notification';
import { getPresetRuns } from '$lib/stores/runs';
import { getProjectTaskPanelLines, loadProjectTasks, tasks } from '$lib/stores/tasks';
import { loadJson } from '$lib/utils/storage';
import {
  routeOrchestratorRequest,
  type AgentChoice,
  type RouteResult,
  type RouteLlmConfig,
  type AgentOutputRef,
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
import { isProviderApiKeyConfiguredLocal } from '$lib/services/ai-keychain';
import {
  createTaskRecord,
  transitionTask,
  cancelTask,
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
import { pickAssistantName, isGenericAgentName } from '$lib/services/orchestrator/agent-names';
import { buildAgentCharter, buildAgentTaskMessage } from '$lib/services/orchestrator/agent-charter';
import { agentReadsRulesFile } from '$lib/services/orchestrator/agent-rules-file';
import {
  getProjectMemoryLines,
  loadProjectMemory,
  rememberTask,
} from '$lib/services/orchestrator/memory';
import {
  onSessionExit,
  getAgentDisplayName,
  promptBarInput,
  focusPromptBar,
  summarizeTerminalTask,
  getTerminalProjectState,
  getSessionOutputBuffer,
  killSession,
} from '$lib/stores/terminal';

export type {
  OrchestratorTask,
  OrchestratorTaskStatus,
} from '$lib/services/orchestrator/task-lifecycle';
export type { ActivityEvent, ActivityKind } from '$lib/services/orchestrator/activity-log';

// ─── Model ──────────────────────────────────────────────────────────────────
// Agent orchestrator: one task owns one terminal (single-agent lease).
// Multiple agents share the workspace and can exchange information via
// the orchestrator brain's `send` action.

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
    // Legacy 'in-review' status is handled via the default case below.
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
    agentPreset: raw.agentPreset ?? null,
    assignedSessionId: status === 'in-progress' ? raw.assignedSessionId ?? null : null,
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


// ─── Persistence ──────────────────────────────────────────────────────────────

export async function loadProjectOrchestratorTasks(project: { id: string; root_path: string }): Promise<void> {
  projectPaths.set(project.id, project.root_path);
  await loadProjectMemory(project.id, project.root_path);
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
      (rawTask?.agentPreset ?? null) !== reconciledTask.agentPreset ||
      (rawTask?.assignedSessionId ?? null) !== reconciledTask.assignedSessionId ||
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
  const base = local ? getProviderBaseUrl(p) : '';
  return (!local || !!base) && (local || isProviderApiKeyConfiguredLocal(p));
}

function getConversationLlmConfig(useVoiceConversation = false): RouteLlmConfig {
  const provider = get(useVoiceConversation ? voiceConversationAiProvider : aiProvider);
  const local = isLocalProvider(provider);
  const baseUrl = local ? getProviderBaseUrl(provider) : '';
  const model = get(useVoiceConversation ? currentVoiceConversationAiModel : currentAiModel);
  return { provider, model, hasApiKey: isProviderApiKeyConfiguredLocal(provider), baseUrl };
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
  const base = local ? getProviderBaseUrl(p) : '';
  const model = get(currentAiModel);
  return await invoke<string>('ai_complete', {
    systemPrompt,
    userText: `Terminal output:\n\n${tail}`,
    provider: p,
    model,
    apiKey: '',
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
    } else {
      logTaskActivity(taskId, 'finished', 'Finished its turn.');
    }
    const rememberedTask = get(orchestratorTasks).find((t) => t.id === updated.id) ?? updated;
    void rememberTask(updated.projectId, projectPaths.get(updated.projectId), rememberedTask);
  }

  if (opts?.notify === false || !updated) return;
  const name = (task.agentPreset ? getAgentDisplayName(task.agentPreset) : null) ?? task.agentPreset ?? 'Agent';
  if (updated.status === 'blocked') {
    showToast(`${name} needs your input — ${task.title}`, 'warning', 9000, true);
  } else if (updated.status === 'failed') {
    showToast(`${name} failed — ${task.title}`, 'error', 8000, true);
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
  agentPreset?: string | null,
  name?: string | null
): OrchestratorTask {
  const task = createTaskRecord(
    projectId,
    goal,
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

/**
 * The message delivered LIVE to a leased agent's REPL. Agents that read a rules
 * file (Claude Code, Codex, Cursor, OpenCode, Antigravity) already loaded the
 * standing brief from CLAUDE.md / AGENTS.md when the CLI booted — see
 * agent-rules-file.ts — so they receive only the task. Every other agent gets the
 * brief wrapped around the goal (the legacy paste channel). This is the single
 * decision point so dispatch, resend, and resume stay consistent.
 */
function buildAgentTaskPanelContext(projectId: string): string {
  const lines = getProjectTaskPanelLines(projectId);
  if (!lines.length) return '';
  return [
    'PROJECT TASK PANEL CONTEXT',
    'Use this as situational context. Do not edit task records unless the user explicitly asks.',
    ...lines.map((line) => `- ${line}`),
  ].join('\n');
}

function withAgentTaskPanelContext(goal: string, projectId: string): string {
  const panelContext = buildAgentTaskPanelContext(projectId);
  if (!panelContext) return goal;
  return `${goal.trim()}\n\n${panelContext}`;
}

function buildLeasedAgentMessage(goal: string, agentCommand: string | null | undefined, name?: string | null, projectId?: string): string {
  const contextualGoal = projectId ? withAgentTaskPanelContext(goal, projectId) : goal;
  return agentReadsRulesFile(agentCommand)
    ? buildAgentTaskMessage(contextualGoal, { name: name ?? null })
    : buildAgentCharter(contextualGoal, { name: name ?? null });
}

function sendGoalToLeasedTask(
  id: string,
  sessionId: number,
  goal: string,
  agentCommand: string,
  watchTurn: boolean,
): void {
  void (async () => {
    try {
      // Brief delivery is the guardrail that replaced git-worktree isolation.
      // Rules-file agents already have it from CLAUDE.md / AGENTS.md, so they get
      // only the task; the rest get the charter-wrapped goal. The stored goal and
      // the activity log keep the clean task text either way.
      const task = get(orchestratorTasks).find((t) => t.id === id);
      const message = buildLeasedAgentMessage(goal, agentCommand, task?.name ?? null, task?.projectId);
      const sent = await sendOrchestratorGoalWhenReady(sessionId, message, {
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

/**
 * Deliver the standing brief alone to a leased agent that was spawned WITHOUT a
 * task yet (a persistent/named agent the user will drive later). Without this,
 * such agents never receive the charter — they have no goal to wrap it around.
 */
function sendBriefToLeasedTask(id: string, sessionId: number, agentCommand: string, name?: string | null): void {
  // Rules-file agents are already briefed by their CLAUDE.md / AGENTS.md the
  // moment the CLI boots, so there is nothing to paste — sending the charter here
  // would just re-deliver the brief they already hold (and into the fragile REPL).
  if (agentReadsRulesFile(agentCommand)) return;
  void (async () => {
    try {
      const success = await sendOrchestratorGoalWhenReady(sessionId, buildAgentCharter('', { name: name ?? null }), {
        shouldContinue: () => leasedSessionLive(id, sessionId),
      });
      if (!success) {
        showToast('Could not brief the spawned agent — session was lost', 'warning', 4000);
      }
    } catch (err) {
      console.error('Failed to send agent brief:', err);
      showToast('Failed to brief the spawned agent', 'error', 4000);
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
  let launchCommitted = false;
  try {
    const sessionId = await leaseOrchestratorTerminal({
      agentCommand,
      cwd,
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
      releaseOrchestratorTerminal(sessionId);
      return null;
    }

    patchTask(task.id, (current) =>
      transitionTask({ ...current, agentPreset: agentCommand, assignedSessionId: sessionId, promptSentAt: null }, 'in-progress')
    );
    launchCommitted = true;
    logTaskActivity(task.id, 'dispatch', `Launched ${getAgentDisplayName(agentCommand) ?? agentCommand}.`);

    if (!holdGoal) {
      if (autoRun && task.goal) {
        sendGoalToLeasedTask(task.id, sessionId, task.goal, agentCommand, watchTurn);
      } else {
        // Manually launched (no auto-run) or spawned without a goal yet — still
        // deliver the standing brief so EVERY freshly-opened agent CLI is briefed,
        // then hand the goal (if any) to the prompt bar for the user to send.
        sendBriefToLeasedTask(task.id, sessionId, agentCommand, task.name);
        if (task.goal) {
          promptBarInput.set(task.goal);
          focusPromptBar();
        }
      }
    }
    return sessionId;
  } finally {
    void launchCommitted;
    clearLaunchGeneration(task.id, launchGeneration);
  }
}

/** Re-deliver an in-progress task's goal to its agent (e.g. if the first send missed). */
export function resendOrchestratorGoal(id: string): void {
  const task = get(orchestratorTasks).find((t) => t.id === id);
  if (!task || task.assignedSessionId == null || !task.goal || task.status !== 'in-progress') return;
  const live = getTerminalProjectState(task.projectId).sessions.find((s) => s.id === task.assignedSessionId);
  if (!live?.isRunning || live.ownerTaskId !== task.id) return;
  // A missed first send means the agent never received the goal — resend exactly
  // as the initial dispatch would (charter-wrapped for paste agents, task-only for
  // rules-file agents, whose brief is already in CLAUDE.md / AGENTS.md).
  resendLeasedOrchestratorGoal(
    task.assignedSessionId,
    buildLeasedAgentMessage(task.goal, task.agentPreset, task.name ?? null, task.projectId)
  );
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

/** Cancel a task outright, releasing its lease. */
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
  // killSession removes the session from project state synchronously, so the
  // onSessionExit reconciler (guarded on the session still being present) sees no
  // session for this task and won't race us to a "finished" completion.
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

const BRAIN_OUTPUT_TAIL = 2500;
const TASK_OUTPUT_TAIL = 4000;

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

/** Recent task state plus terminal output for conversational status/output answers. */
export function getAgentOutputRefs(projectId: string): AgentOutputRef[] {
  return get(orchestratorTasks)
    .filter((t) => t.projectId === projectId && t.status !== 'todo')
    .map((t) => {
      const full = getTaskTranscript(t);
      const recentOutput = full ? full.slice(-TASK_OUTPUT_TAIL) : null;
      const updatedAt = t.completedAt ?? t.startedAt ?? t.createdAt;
      const reason = t.blockedReason ?? t.failureReason ?? null;
      return {
        name: t.name ?? null,
        agent: t.agentPreset ?? 'agent',
        title: t.goal ? t.title : 'idle',
        status: t.status as AgentOutputRef['status'],
        updatedAt,
        reason,
        recentOutput,
      };
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 6);
}

/** Blocked agents that the assistant can resume naturally in chat. */
export function getReviewableAgentRefs(projectId: string): RunningAgentRef[] {
  return get(orchestratorTasks)
    .filter((t) => t.projectId === projectId && t.status === 'blocked')
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .map((t) => ({
      name: t.name ?? null,
      agent: t.agentPreset ?? 'agent',
      title: `${t.title} (waiting on you)`,
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
  const resumable = tasks.filter((t) => t.status === 'blocked');
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

/** Push a prompt to a running agent's live terminal; if blocked, reopen it and send automatically. */
async function sendFollowUpToAgent(task: OrchestratorTask, prompt: string, rootPath: string): Promise<boolean> {
  if (task.assignedSessionId != null) {
    const live = getTerminalProjectState(task.projectId).sessions.find((s) => s.id === task.assignedSessionId);
    if (!live?.isRunning || live.ownerTaskId !== task.id) return false;
    const sent = await sendOrchestratorFollowUpWhenReady(task.assignedSessionId, withAgentTaskPanelContext(prompt, task.projectId), {
      shouldContinue: () => leasedSessionLive(task.id, task.assignedSessionId!),
    });
    if (!sent) return false;
    patchTask(task.id, (current) => (current.status === 'in-progress' ? { ...current, promptSentAt: Date.now() } : current));
    logTaskActivity(task.id, 'follow-up', prompt);
    return true;
  }

  if (task.status !== 'blocked' || !task.agentPreset) return false;

  const sessionId = await leaseOrchestratorTerminal({
    agentCommand: task.agentPreset,
    cwd: rootPath,
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
    blockedReason: null,
    failureReason: null,
    promptSentAt: null,
  }));

  const agentName = getAgentDisplayName(task.agentPreset) ?? task.agentPreset;
  logTaskActivity(task.id, 'dispatch', `Resumed ${agentName}.`);

  // Resuming a blocked task re-leases a FRESH agent CLI (the previous process
  // exited), so it has no memory of its first-turn brief. A rules-file agent
  // re-reads CLAUDE.md / AGENTS.md on this fresh boot (the re-lease re-ensures
  // them), so it just needs the resume prompt; a paste agent needs the charter
  // wrapped around it, exactly like an initial dispatch. The activity log below
  // still records the clean prompt, not the message text.
  const sent = await sendOrchestratorFollowUpWhenReady(
    sessionId,
    buildLeasedAgentMessage(prompt, task.agentPreset, task.name ?? null, task.projectId),
    { shouldContinue: () => leasedSessionLive(task.id, sessionId) }
  );
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
  const learnedMemory = getProjectMemoryLines(projectId);
  const recentTaskMemory = get(orchestratorTasks)
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
  return [...learnedMemory, ...recentTaskMemory].slice(-10);
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
  if (!get(tasks).some((task) => task.projectId === projectId)) {
    try {
      await loadProjectTasks({ id: projectId, root_path: rootPath });
    } catch {
      // Task-panel context is helpful but must never block dispatch.
    }
  }
  const recentUserMessages = (get(chatMessages)[projectId] ?? [])
    .filter((m) => !m.pending && m.role === 'user')
    .map((m) => m.text)
    .slice(-6);
  const taskMemory = buildProjectTaskMemory(projectId);
  const taskPanel = getProjectTaskPanelLines(projectId);
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
        taskPanel,
        runningAgents: getRunningAgentRefs(projectId),
        reviewingAgents: getReviewableAgentRefs(projectId),
        taskOutputs: getAgentOutputRefs(projectId),
        llmConfig,
        conversational: !!opts?.voiceConversation,
      });
    } catch (err) {
      console.error('Orchestrator routing error:', err);
      result = { reply: 'Something went wrong routing that. Try again.', actions: [], viaLLM: false };
    }
  }

  patchChat(projectId, assistantId, { text: result.reply, pending: false });

  // ── Reconnaissance (started now, awaited after spawning) ──────────────────
  // Kick recon off immediately so its LLM calls (plan + craft) overlap with the
  // terminal spawn loop below. Previously recon ran strictly after every launch
  // had been awaited, so the two latencies stacked; now they run concurrently.
  const reconCommand = result.actions
    .flatMap((a) =>
      a.kind === 'spawn' && (a.prompt ?? '').trim().length > 10 ? [a.prompt as string] : []
    )
    .join('; ');
  let reconPromise: ReturnType<typeof reconnoiter> | null = null;
  if (reconCommand && rootPath) {
    patchChat(projectId, assistantId, { text: result.reply + '\n\n🔍 Analyzing codebase…' });
    reconPromise = reconnoiter(
      reconCommand,
      rootPath,
      opts?.projectName ?? 'project',
      async (sysPrompt, userText) => {
        const { provider, model, hasApiKey, baseUrl } = llmConfig;
        const local = isLocalProvider(provider);
        if ((!local || baseUrl) && (local || hasApiKey)) {
          return await invoke<string>('ai_complete', {
            systemPrompt: sysPrompt,
            userText,
            provider,
            model,
            apiKey: '',
            baseUrl: baseUrl || undefined,
          });
        }
        throw new Error('No AI provider configured');
      },
      projectId
    );
  }

  // ── Pre-spawn: start agent terminals (overlaps the recon above) ────────────
  // Terminals begin initializing (PTY, shell, CLAUDE.md load) while the recon
  // LLM calls run, so agent startup time overlaps with codebase analysis.
  const multiSpawn = result.actions.filter((a) => a.kind === 'spawn').length > 1;
  // Avoid name collisions with EVERY live named agent — including ones spawned
  // outside the orchestrator (the floating bar's "+"), which only exist as
  // terminal sessions with an agentName, not as tasks.
  const sessionAgentNames = getTerminalProjectState(projectId).sessions
    .filter((s) => s.isRunning && s.agentName?.trim())
    .map((s) => (s.agentName as string).trim());
  const usedNames = [
    ...getRunningAgentRefs(projectId)
      .map((r) => r.name)
      .filter((n): n is string => !!n),
    ...sessionAgentNames,
  ];
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
    // A *meaningfully* named or task-less spawn is a *persistent* agent:
    // skip the turn watcher so it stays addressable. Persistence keys off a
    // real name, before we apply an auto-name below — an auto-name must
    // not make a one-shot task persistent.
    const persistent = !!explicitName || !action.prompt;
    // Every spawned agent gets a friendly human name so it's easy to address.
    const name = explicitName ?? pickAssistantName(usedNames);
    usedNames.push(name);
    const isPrimary = spawnIndex === 0;
    spawnIndex++;

    const task = createOrchestratorTask(
      projectId,
      action.prompt ?? '',
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

  // ── Await reconnaissance ──────────────────────────────────────────────────
  // The recon LLM calls were started above and have been running while the
  // terminals spun up. Collect the enriched prompt now, just before dispatch.
  let reconSummary: string | null = null;
  let enrichedPrompt: string | null = null;

  if (reconPromise) {
    try {
      const recon = await reconPromise;
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
    } else {
      // No task yet (persistent/named agent) — deliver the standing brief so every
      // spawned agent is briefed (a no-op for rules-file agents, already briefed
      // via CLAUDE.md / AGENTS.md), then hand off to the user to drive it.
      sendBriefToLeasedTask(task.id, sessionId, agent, name);
      if (!persistent) {
        promptBarInput.set(goal);
        focusPromptBar();
      }
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
  // Process exit is the fallback completion path (covers agents that do exit,
  // crashes, and turns the watcher missed). Driven by the project-independent
  // `onSessionExit` broadcast rather than the `sessions` store, so an agent that
  // exits while its project is in the background is reconciled immediately
  // instead of being stranded in-progress until the user reopens that project.
  onSessionExit(({ sessionId, projectId, code }) => {
    const task = get(orchestratorTasks).find(
      (t) => t.status === 'in-progress' && t.assignedSessionId === sessionId
    );
    if (!task) return;
    // A deliberate close (closeOrchestratorAgent → killSession) removes the
    // session from project state *before* the async pty teardown fires this exit.
    // A natural exit leaves the session in place (flagged isRunning:false). So if
    // the session is already gone, this was an intentional close that the cancel
    // path is handling — don't race it to a "finished" completion.
    const sessionStillPresent = getTerminalProjectState(projectId).sessions.some((s) => s.id === sessionId);
    if (!sessionStillPresent) return;
    // Distinguish clean exit (code 0 or unknown) from crash (non-zero code) so
    // the task ends up in the right terminal state rather than always showing
    // "complete" for both success and crashes. The terminal layer already raised
    // its own exit notification, so suppress ours here (notify: false).
    const exitCode = code ?? null;
    const outcome: AgentTurnOutcome =
      exitCode !== null && exitCode !== 0
        ? { kind: 'blocked', reason: `Agent process exited with code ${exitCode}.` }
        : { kind: 'finished' };
    completeLeasedTask(task.id, sessionId, outcome, { notify: false, exitCode });
  });
}
