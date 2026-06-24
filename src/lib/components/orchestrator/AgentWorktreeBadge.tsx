import { useEffect, useMemo, useState } from 'react';
import { orchestratorTasks } from '$lib/stores/orchestrator';
import { sessions } from '$lib/stores/terminal';
import { getWorktreeStatus, type WorktreeStatus } from '$lib/services/orchestrator/worktree-manager';
import { useStore } from '$lib/react/useStore';
import './AgentWorktreeBadge.css';

interface Props {
  /** The agent's terminal session id; matched to its owning orchestrator task. */
  sessionId: number;
}

/**
 * A compact, live badge shown above an agent's terminal: the isolated git branch
 * the agent is working in, plus a polling count of changed files. Renders nothing
 * when the agent has no worktree (e.g. a non-git project running in the root).
 */
export default function AgentWorktreeBadge({ sessionId }: Props) {
  const tasks = useStore(orchestratorTasks);
  const allSessions = useStore(sessions);
  // The worktree lives on the session for floating-bar agents and on the task for
  // orchestrator-dispatched ones — surface whichever this agent has.
  const worktree = useMemo(
    () =>
      allSessions.find((s) => s.id === sessionId)?.worktree ??
      tasks.find((task) => task.assignedSessionId === sessionId)?.worktree ??
      null,
    [allSessions, tasks, sessionId],
  );

  const [status, setStatus] = useState<WorktreeStatus | null>(null);

  useEffect(() => {
    if (!worktree) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const next = await getWorktreeStatus(worktree);
      if (!cancelled) setStatus(next);
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [worktree]);

  if (!worktree) return null;

  const changed = status?.changedFiles ?? 0;

  return (
    <div
      className="wt-badge"
      title={`Isolated worktree\nBranch: ${worktree.branch}\nForked from: ${worktree.baseBranch}\nPath: ${worktree.path}`}
    >
      <span className="wt-icon" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="2.6" />
          <circle cx="6" cy="18" r="2.6" />
          <circle cx="18" cy="9" r="2.6" />
          <path d="M6 8.6v6.8" />
          <path d="M18 11.4c0 4-4 3.4-6.6 4.4" />
        </svg>
      </span>
      <span className="wt-branch">{worktree.branch}</span>
      <span className="wt-sep" aria-hidden="true">·</span>
      <span className={`wt-changes${changed > 0 ? ' dirty' : ''}`}>
        {changed === 0 ? 'no changes' : `${changed} changed`}
      </span>
    </div>
  );
}
