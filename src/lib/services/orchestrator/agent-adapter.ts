import {
  waitForAgentReady,
  sendAgentPromptDirect,
  writeToSession,
  getSessionOutputBuffer,
  onSessionExit,
  type AgentReadiness,
} from '$lib/stores/terminal';
import { captureTranscript } from '$lib/services/orchestrator/activity-log';
import {
  watchLeasedAgentTurn,
  type AgentTurnOutcome,
  type WatchLeasedAgentOptions,
} from '$lib/services/orchestrator/agent-turn-watch';

export interface SendOptions {
  /** Return false to abort before sending (task unlinked, session died, …). */
  shouldContinue?: () => boolean;
}

const DEFAULT_OUTPUT_POLL_MS = 500;

/**
 * The single channel through which the orchestrator talks to one terminal agent.
 *
 * It consolidates — it does NOT reimplement — the low-level PTY primitives in
 * terminal.ts: sends go through `sendAgentPromptDirect` (with a readiness gate),
 * and output is read from the shared rolling buffer (`getSessionOutputBuffer`).
 * It deliberately never touches `registerDataCallback` / `registerExitCallback`,
 * which are single-consumer channels owned by the xterm pane — streaming is done
 * by diffing the buffer, and exit by the multi-consumer `onSessionExit` broadcast.
 */
export class AgentAdapter {
  readonly sessionId: number;
  private outputTimers = new Set<ReturnType<typeof setInterval>>();
  private disposed = false;

  constructor(sessionId: number) {
    this.sessionId = sessionId;
  }

  // ── Send / input ────────────────────────────────────────────────────────────

  /** Resolve once the agent CLI has booted (or `launch-failed` if the shell rejected it). */
  waitForReady(): Promise<AgentReadiness> {
    return waitForAgentReady(this.sessionId);
  }

  /**
   * Wait for the agent to be ready, then deliver a message into its REPL.
   * Returns false if the launch failed or the caller aborted via `shouldContinue`.
   */
  async sendGoal(message: string, opts?: SendOptions): Promise<boolean> {
    if (!message.trim()) return false;
    // 'launch-failed' = the shell rejected the agent command; the pane is a plain
    // shell, so sending would execute the message as commands. Bail out.
    if ((await this.waitForReady()) === 'launch-failed') return false;
    if (opts?.shouldContinue && !opts.shouldContinue()) return false;
    return sendAgentPromptDirect(this.sessionId, message);
  }

  /** A follow-up turn uses the same ready-gated delivery path as the initial goal. */
  sendFollowUp(message: string, opts?: SendOptions): Promise<boolean> {
    return this.sendGoal(message, opts);
  }

  /** Re-deliver a message without the readiness gate (the REPL is already up). */
  resend(message: string): void {
    if (!message.trim()) return;
    void sendAgentPromptDirect(this.sessionId, message);
  }

  /** Raw keystrokes straight to the PTY (no Enter appended). */
  writeRaw(data: string): void {
    writeToSession(this.sessionId, data);
  }

  // ── Receive / output ─────────────────────────────────────────────────────────

  /** A readable snapshot of recent output: ANSI-stripped and tail-capped. */
  readOutput(tailChars?: number): string {
    return captureTranscript(getSessionOutputBuffer(this.sessionId), tailChars);
  }

  /** The raw rolling output buffer, control codes intact. */
  snapshot(): string {
    return getSessionOutputBuffer(this.sessionId);
  }

  /**
   * Stream output by polling the shared buffer and emitting only the newly-grown
   * tail. Safe alongside the xterm renderer (which owns the data callback).
   * Returns an unsubscribe function.
   */
  subscribeOutput(onChunk: (chunk: string) => void, intervalMs = DEFAULT_OUTPUT_POLL_MS): () => void {
    let lastLen = getSessionOutputBuffer(this.sessionId).length;
    const timer = setInterval(() => {
      const buf = getSessionOutputBuffer(this.sessionId);
      if (buf.length > lastLen) {
        onChunk(buf.slice(lastLen));
        lastLen = buf.length;
      } else if (buf.length < lastLen) {
        // Buffer was capped/sliced — resync without re-emitting old content.
        lastLen = buf.length;
      }
    }, intervalMs);
    this.outputTimers.add(timer);
    return () => {
      clearInterval(timer);
      this.outputTimers.delete(timer);
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Resolve once the agent's current turn ends (finished / blocked / aborted). */
  watchTurn(opts: WatchLeasedAgentOptions): Promise<AgentTurnOutcome> {
    return watchLeasedAgentTurn(this.sessionId, opts);
  }

  /** Fire when this session's process exits. Uses the multi-consumer broadcast. */
  onExit(cb: (code: number) => void): () => void {
    return onSessionExit((info) => {
      if (info.sessionId === this.sessionId) cb(info.code);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.outputTimers) clearInterval(timer);
    this.outputTimers.clear();
  }
}

const adapters = new Map<number, AgentAdapter>();

/** The one canonical adapter for a session (created on first use, then memoized). */
export function getAgentAdapter(sessionId: number): AgentAdapter {
  let adapter = adapters.get(sessionId);
  if (!adapter) {
    adapter = new AgentAdapter(sessionId);
    adapters.set(sessionId, adapter);
  }
  return adapter;
}

/**
 * Drop a session's adapter and clear its timers. Called from the orchestrator's
 * existing session-exit handler (we intentionally don't register our own
 * `onSessionExit` listener here, to keep the exit-listener set minimal).
 */
export function disposeAgentAdapter(sessionId: number): void {
  const adapter = adapters.get(sessionId);
  if (adapter) {
    adapter.dispose();
    adapters.delete(sessionId);
  }
}
