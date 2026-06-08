import {
  spawnAgentPreset,
  setActiveSession,
  setSessionOwnerTask,
  setSessionTaskSummary,
  setSessionAgentName,
  setSessionRole,
  sendAgentPromptDirect,
  getSessionOutputBuffer,
} from '$lib/stores/terminal';

export interface LeaseOrchestratorTerminalArgs {
  agentCommand: string;
  cwd: string;
  taskId: string;
  taskTitle: string;
  /** Assistant name shown on the pane badge (e.g. "Iris"). */
  name?: string | null;
  /** Focus this terminal after launching. Pass false to spawn in the background
   *  (keeps the primary agent stationary when launching several at once). */
  activate?: boolean;
}

/**
 * Reflect an orchestrator agent's name on its terminal. The name shows as the
 * pane's badge (kept separate from the CLI-driven `paneTitle` so both are
 * visible) and drives the `role` used for the terminal tab label. Passing an
 * empty name clears the badge and restores the default "Agent" role.
 */
export function applyOrchestratorAgentName(sessionId: number, name: string | null | undefined): void {
  const trimmed = name?.trim();
  setSessionAgentName(sessionId, trimmed ? trimmed : null);
  setSessionRole(sessionId, trimmed ? trimmed : 'Agent');
}

const READY_OUTPUT_DELTA = 16;
const READY_POLL_MS = 50;
const READY_SETTLE_MS = 300;
const READY_MAX_WAIT_MS = 9000;

async function waitForAgentReady(sessionId: number): Promise<void> {
  const startedAt = Date.now();
  const startLen = getSessionOutputBuffer(sessionId).length;

  while (Date.now() - startedAt < READY_MAX_WAIT_MS) {
    if (getSessionOutputBuffer(sessionId).length > startLen + READY_OUTPUT_DELTA) break;
    await new Promise<void>((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  await new Promise<void>((resolve) => setTimeout(resolve, READY_SETTLE_MS));
}

export function recordOrchestratorTerminalLease(
  sessionId: number,
  taskId: string,
  taskTitle: string,
  name?: string | null
): void {
  setSessionOwnerTask(sessionId, taskId);
  setSessionTaskSummary(sessionId, taskTitle);
  if (name?.trim()) applyOrchestratorAgentName(sessionId, name);
}

/**
 * Focus a freshly-leased agent's pane in the terminal grid. Deliberately does NOT
 * switch the aux view to the terminal: the terminal pane is always visible beside
 * the orchestrator panel, so launching an agent should keep the Agents panel open
 * (the panel's "Focus terminal" button reveals the terminal explicitly when wanted).
 */
export function activateOrchestratorTerminal(sessionId: number): void {
  setActiveSession(sessionId);
}

export async function leaseOrchestratorTerminal(args: LeaseOrchestratorTerminalArgs): Promise<number | null> {
  const activate = args.activate ?? true;
  const sessionId = await spawnAgentPreset(args.agentCommand, args.cwd, { activate });
  if (sessionId == null) return null;

  recordOrchestratorTerminalLease(sessionId, args.taskId, args.taskTitle, args.name);
  // Only the primary agent grabs focus; additional agents tile in silently.
  if (activate) activateOrchestratorTerminal(sessionId);
  return sessionId;
}

export async function sendOrchestratorGoalWhenReady(
  sessionId: number,
  goal: string,
  opts?: { shouldContinue?: () => boolean }
): Promise<boolean> {
  if (!goal.trim()) return false;

  await waitForAgentReady(sessionId);
  if (opts?.shouldContinue && !opts.shouldContinue()) return false;

  return sendAgentPromptDirect(sessionId, goal);
}
export async function sendOrchestratorFollowUpWhenReady(
  sessionId: number,
  prompt: string,
  opts?: { shouldContinue?: () => boolean }
): Promise<boolean> {
  return sendOrchestratorGoalWhenReady(sessionId, prompt, opts);
}

export function resendOrchestratorGoal(sessionId: number, goal: string): void {
  if (!goal.trim()) return;
  void sendAgentPromptDirect(sessionId, goal);
}

export function releaseOrchestratorTerminal(sessionId: number): void {
  setSessionOwnerTask(sessionId, null);
  setSessionTaskSummary(sessionId, null);
}
