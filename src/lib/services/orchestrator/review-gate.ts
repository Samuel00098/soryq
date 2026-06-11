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
 * Decide a task's next state once its agent run ends.
 *
 * - non-zero exit            → `failed`
 * - clean exit, needs input  → `blocked`
 * - clean exit               → `complete`
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

  return {
    ...transitionTask(task, 'complete'),
    assignedSessionId: null,
    blockedReason: null,
    failureReason: null,
  };
}
