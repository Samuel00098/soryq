export type OrchestratorTaskStatus =
  | 'todo'
  | 'in-progress'
  | 'in-review'
  | 'complete'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type ExecutionMode = 'direct' | 'worktree';

import type { ActivityEvent } from './activity-log';
export type { ActivityEvent } from './activity-log';

export interface OrchestratorWorktree {
  id: string;
  path: string;
  branchName: string;
  baseBranch: string;
  baseCommit: string;
  createdAt: number;
  changedFilesCount?: number | null;
}

export type OrchestratorReviewDecision =
  | 'pending'
  | 'approved'
  | 'changes-requested'
  | 'cancelled'
  | null;

export interface OrchestratorReviewState {
  requestedAt: number | null;
  decision: OrchestratorReviewDecision;
  note?: string | null;
}

export interface OrchestratorTask {
  id: string;
  projectId: string;
  goal: string;
  title: string;
  /** User-assigned handle for a running agent (e.g. "Backend"); null until named. */
  name?: string | null;
  status: OrchestratorTaskStatus;
  executionMode: ExecutionMode;
  agentPreset?: string | null;
  assignedSessionId?: number | null;
  worktree?: OrchestratorWorktree | null;
  review?: OrchestratorReviewState | null;
  blockedReason?: string | null;
  failureReason?: string | null;
  /** Most recent prompt delivery for the current run; null until the agent has work. */
  promptSentAt?: number | null;
  /** Structured timeline of what the agent/orchestrator did (most recent last). */
  activity?: ActivityEvent[];
  /** Verbatim, ANSI-stripped snapshot of the agent's terminal output. */
  transcript?: string | null;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

const CODE_CHANGE_RE =
  /\b(add|build|delete|edit|fix|implement|modify|patch|refactor|remove|rename|rewrite)\b/i;
const READ_ONLY_RE =
  /\b(explain|inspect|investigate|look at|logs|review|summari[sz]e|summary|trace|understand)\b/i;
const ALLOWED_TRANSITIONS: Record<OrchestratorTaskStatus, readonly OrchestratorTaskStatus[]> = {
  todo: ['in-progress', 'blocked', 'failed', 'cancelled'],
  'in-progress': ['todo', 'complete', 'in-review', 'blocked', 'failed', 'cancelled'],
  'in-review': ['todo', 'complete', 'blocked', 'failed', 'cancelled'],
  complete: [],
  blocked: ['todo', 'in-progress', 'cancelled', 'failed'],
  failed: [],
  cancelled: [],
};

export function inferExecutionMode(goal: string): ExecutionMode {
  const text = goal.trim();
  if (!text) return 'direct';
  const isCodeChange = CODE_CHANGE_RE.test(text);
  const isReadOnly = READ_ONLY_RE.test(text);

  if (isReadOnly && !isCodeChange) return 'direct';
  return 'worktree';
}

export function createTaskRecord(
  projectId: string,
  goal: string,
  executionMode: ExecutionMode,
  agentPreset?: string | null,
  name?: string | null
): OrchestratorTask {
  const now = Date.now();
  const trimmedGoal = goal.trim();

  return {
    id: `ot_${now}_${Math.random().toString(36).slice(2, 7)}`,
    projectId,
    goal: trimmedGoal,
    title: !trimmedGoal ? 'Untitled task' : trimmedGoal.length > 72 ? `${trimmedGoal.slice(0, 69)}...` : trimmedGoal,
    name: name?.trim() ? name.trim() : null,
    status: 'todo',
    executionMode,
    agentPreset: agentPreset ?? null,
    assignedSessionId: null,
    worktree: null,
    review: null,
    blockedReason: null,
    failureReason: null,
    promptSentAt: null,
    activity: [],
    transcript: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
}

export function transitionTask(task: OrchestratorTask, next: OrchestratorTaskStatus): OrchestratorTask {
  if (!ALLOWED_TRANSITIONS[task.status].includes(next)) {
    throw new Error(`Invalid orchestrator transition: ${task.status} -> ${next}`);
  }

  const now = Date.now();

  return {
    ...task,
    status: next,
    startedAt: next === 'in-progress' ? task.startedAt ?? now : task.startedAt ?? null,
    completedAt: next === 'complete' ? now : task.completedAt ?? null,
    review: next === 'in-review' ? { requestedAt: now, decision: 'pending', note: null } : task.review ?? null,
    promptSentAt: next === 'in-progress' ? (task.promptSentAt ?? null) : null,
  };
}

export function approveTask(task: OrchestratorTask): OrchestratorTask {
  const reviewed = task.status === 'in-review' ? task : transitionTask(task, 'in-review');
  const completed = transitionTask(reviewed, 'complete');

  return {
    ...completed,
    review: {
      ...(reviewed.review ?? { requestedAt: Date.now(), decision: 'pending', note: null }),
      decision: 'approved',
    },
  };
}

export function requestTaskChanges(task: OrchestratorTask, note: string): OrchestratorTask {
  const reviewed = task.status === 'in-review' ? task : transitionTask(task, 'in-review');
  const reset = transitionTask(reviewed, 'todo');
  const trimmedNote = note.trim();

  return {
    ...reset,
    assignedSessionId: null,
    startedAt: null,
    completedAt: null,
    review: {
      ...(reviewed.review ?? { requestedAt: Date.now(), decision: 'pending', note: null }),
      decision: 'changes-requested',
      note: trimmedNote ? trimmedNote : null,
    },
  };
}

export function cancelTask(task: OrchestratorTask, note?: string): OrchestratorTask {
  if (task.status === 'cancelled') {
    return task;
  }

  const now = Date.now();
  const trimmedNote = note?.trim();

  return {
    ...task,
    status: 'cancelled',
    review: task.review
      ? {
          ...task.review,
          decision: 'cancelled',
          note: trimmedNote ? trimmedNote : (task.review.note ?? null),
        }
      : trimmedNote
        ? {
            requestedAt: null,
            decision: 'cancelled',
            note: trimmedNote,
          }
        : null,
    completedAt: task.completedAt ?? now,
  };
}
