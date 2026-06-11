export type OrchestratorTaskStatus =
  | 'todo'
  | 'in-progress'
  | 'complete'
  | 'blocked'
  | 'failed'
  | 'cancelled';

import type { ActivityEvent } from './activity-log';
export type { ActivityEvent } from './activity-log';

export interface OrchestratorTask {
  id: string;
  projectId: string;
  goal: string;
  title: string;
  /** User-assigned handle for a running agent (e.g. "Backend"); null until named. */
  name?: string | null;
  status: OrchestratorTaskStatus;
  agentPreset?: string | null;
  assignedSessionId?: number | null;
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

const ALLOWED_TRANSITIONS: Record<OrchestratorTaskStatus, readonly OrchestratorTaskStatus[]> = {
  todo: ['in-progress', 'blocked', 'failed', 'cancelled'],
  'in-progress': ['todo', 'complete', 'blocked', 'failed', 'cancelled'],
  complete: [],
  blocked: ['todo', 'in-progress', 'cancelled', 'failed'],
  failed: [],
  cancelled: [],
};

export function createTaskRecord(
  projectId: string,
  goal: string,
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
    agentPreset: agentPreset ?? null,
    assignedSessionId: null,
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
    promptSentAt: next === 'in-progress' ? (task.promptSentAt ?? null) : null,
  };
}

export function cancelTask(task: OrchestratorTask, note?: string): OrchestratorTask {
  if (task.status === 'cancelled') return task;

  const now = Date.now();
  void note;

  return {
    ...task,
    status: 'cancelled',
    completedAt: task.completedAt ?? now,
  };
}
