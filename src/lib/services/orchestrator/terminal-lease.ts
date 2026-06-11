import {
  spawnAgentPreset,
  setActiveSession,
  setSessionOwnerTask,
  setSessionTaskSummary,
  setSessionAgentName,
  setSessionRole,
  sendAgentPromptDirect,
  getSessionOutputBuffer,
  waitForAgentReady,
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
  const sessionId = await spawnAgentPreset(args.agentCommand, args.cwd, { activate, skipAutoBrief: true });
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

  // 'launch-failed' = the shell rejected the agent command (not installed) —
  // the pane is a plain shell, so sending the goal would execute it as
  // commands. waitForAgentReady already surfaced the error toast.
  if ((await waitForAgentReady(sessionId)) === 'launch-failed') return false;
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
