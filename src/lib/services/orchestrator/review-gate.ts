import { transitionTask, type OrchestratorTask } from './task-lifecycle';

/** What the orchestrator could observe about a finished agent run. */
export interface ExecutionOutcome {
  /** Process exit code, or null when it can't be determined. */
  exitCode: number | null;
  /** The agent stopped because it needs a human decision (key, approval, …). */
  needsHumanInput?: boolean;
  /** Free-text context for the resulting blocked/failed state. */
  note?: string;
}

/**
 * Decide a task's next state once its agent run ends. Terminal exit is treated
 * as an *event to classify*, not unconditional success:
 *
 * - non-zero exit            → `failed`
 * - clean exit, needs input  → `blocked`
 * - clean exit               → `complete`
 *
 * The leased session is always detached (`assignedSessionId: null`) since the
 * agent process is gone.
 */
export function classifyTaskAfterExecution(
  task: OrchestratorTask,
  outcome: ExecutionOutcome
): OrchestratorTask {
  if (outcome.exitCode !== 0) {
    return {
      ...task,
      status: 'failed',
      failureReason: outcome.note ?? `Agent exited with code ${outcome.exitCode ?? 'unknown'}`,
      blockedReason: null,
      assignedSessionId: null,
      promptSentAt: null,
    };
  }

  if (outcome.needsHumanInput) {
    return {
      ...task,
      status: 'blocked',
      blockedReason: outcome.note ?? 'Human input required',
      failureReason: null,
      assignedSessionId: null,
      promptSentAt: null,
    };
  }

  const nextStatus = task.executionMode === 'worktree' ? 'in-review' : 'complete';
  return {
    ...transitionTask(task, nextStatus),
    assignedSessionId: null,
    blockedReason: null,
    failureReason: null,
  };
}
