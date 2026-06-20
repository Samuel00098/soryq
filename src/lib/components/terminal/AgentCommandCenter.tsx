import { useEffect, useMemo, useRef, useState } from 'react';
import { activeProject } from '$lib/stores/workspace';
import {
  getProjectChat,
  loadProjectOrchestratorTasks,
  clearProjectChat,
  resetOrchestratorSession,
  type ChatMessage,
} from '$lib/stores/orchestrator';
import { settingsOpen } from '$lib/stores/layout';
import { detectAgentAccess, type AgentAccessStatus } from '$lib/services/agent-access';
import { useStore } from '$lib/react/useStore';
import './AgentCommandCenter.css';

// ── agent colors ────────────────────────────────────────────────────────────
const AGENT_COLORS: Record<string, string> = {
  claude: '#d97757', codex: '#10a37f', agy: '#a78bfa', antigravity: '#a78bfa',
  opencode: '#60a5fa', pi: '#f472b6', omp: '#fbbf24', 'oh-my-pi': '#fbbf24',
  agent: '#22d3ee', cursor: '#22d3ee',
};
const agentColor = (cmd: string | null | undefined) => (cmd && AGENT_COLORS[cmd]) || '#9ca3af';

// ── helpers ──────────────────────────────────────────────────────────────────
function formatSecs(s: number | null | undefined): string {
  if (s == null) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function AgentCommandCenter() {
  // ── project derived state ───────────────────────────────────────────────────
  const project = useStore(activeProject);
  const projectId = project?.id ?? '';
  const settingsIsOpen = useStore(settingsOpen);

  const chatStore = useMemo(() => getProjectChat(projectId), [projectId]);
  const messages = useStore(chatStore);

  // ── agent access ────────────────────────────────────────────────────────────
  const [agentAccess, setAgentAccess] = useState<AgentAccessStatus>({
    ready: false, via: 'none', providerId: null, message: 'Checking...',
  });
  const [checkingAgentAccess, setCheckingAgentAccess] = useState(true);
  const settingsWereOpen = useRef(false);

  async function refreshAgentAccess() {
    setCheckingAgentAccess(true);
    try {
      setAgentAccess(await detectAgentAccess());
    } finally {
      setCheckingAgentAccess(false);
    }
  }

  useEffect(() => {
    if (settingsIsOpen) {
      settingsWereOpen.current = true;
      return;
    }
    if (settingsWereOpen.current) {
      settingsWereOpen.current = false;
      void refreshAgentAccess();
    }
  }, [settingsIsOpen]);

  useEffect(() => {
    if (project) void loadProjectOrchestratorTasks(project);
  }, [project]);

  // ── scroll management ───────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isStuckToBottom = useRef(true);

  function handleScroll() {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    isStuckToBottom.current = scrollHeight - scrollTop - clientHeight < 60;
  }

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl && isStuckToBottom.current) {
      requestAnimationFrame(() => {
        if (scrollEl && isStuckToBottom.current) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  }, [messages.length]);

  useEffect(() => {
    void refreshAgentAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The orchestrator now lives inside a workspace room — the room frame owns the
  // title, sizing, minimize, and close. This panel just provides its toolbar
  // (reset + clear), the access banner, and the chat transcript.
  return (
    <div className="orc" aria-label="Orchestrator">
      {/* ── Toolbar ────────────────────────────────────────────────────────────── */}
      <div className="orc-header">
        <div className="orc-title">
          <span className="orc-title-dot"></span>
          <span>orchestrator</span>
        </div>
        <div className="orc-header-right">
          <button
            className="orc-reset-btn"
            onClick={() => resetOrchestratorSession(projectId)}
            title="Reset session — stops the running task and clears the chat (keeps what I've learned)"
            aria-label="Reset session"
          >
            reset
          </button>
          {messages.length > 0 && (
            <button className="orc-icon-btn" onClick={() => clearProjectChat(projectId)} title="Clear conversation" aria-label="Clear conversation">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {!checkingAgentAccess && !agentAccess.ready && (
        <div className="orc-lock-banner">{agentAccess.message}</div>
      )}

      {/* ── Chat transcript ────────────────────────────────────────────────────── */}
      <div className="orc-scroll" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="orc-empty">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="11" width="18" height="10" rx="2"/>
              <path d="M12 7v4"/>
              <circle cx="12" cy="5" r="2"/>
            </svg>
            <span>Ask me about your project, tell me to open files or pages, or describe what to build — I'll handle it or put an agent on it.</span>
          </div>
        ) : (
          messages.map((msg: ChatMessage) =>
            msg.role === 'user' ? (
              <div className="orc-msg user" key={msg.id}><div className="orc-bubble">{msg.text}</div></div>
            ) : (
              <div className="orc-msg assistant" key={msg.id}>
                <div className={`orc-bubble${msg.completion ? ' completion-bubble' : ''}`}>
                  {msg.pending ? (
                    <span className="orc-typing"><span></span><span></span><span></span></span>
                  ) : (
                    <>
                      {msg.reconSummary && (
                        <div className="orc-recon">{msg.reconSummary}</div>
                      )}
                      {msg.completion ? (
                        <div className={`orc-completion orc-completion-${msg.completion.status}`}>
                          <span className="orc-comp-icon">{msg.completion.status === 'done' ? '✅' : msg.completion.status === 'failed' ? '❌' : '⚠️'}</span>
                          <div className="orc-comp-body">
                            <span className="orc-comp-headline">
                              {msg.completion.agentName}
                              <span className="orc-comp-status">{msg.completion.status === 'done' ? 'finished' : msg.completion.status === 'failed' ? 'failed' : 'needs input'}</span>
                              {msg.completion.elapsedSec != null && <span className="orc-comp-time">· {formatSecs(msg.completion.elapsedSec)}</span>}
                            </span>
                            <span className="orc-comp-task" title={msg.completion.taskTitle}>{msg.completion.taskTitle}</span>
                            {msg.completion.reason && <span className="orc-comp-reason">{msg.completion.reason}</span>}
                            {msg.completion.summaryPending ? (
                              <span className="orc-comp-loading"><span className="orc-typing-sm"><span></span><span></span><span></span></span>Summarizing…</span>
                            ) : msg.completion.summary ? (
                              <p className="orc-comp-summary">{msg.completion.summary}</p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        msg.text
                      )}
                      {msg.dispatched && msg.dispatched.length > 0 && (
                        <div className="orc-chips">
                          {msg.dispatched.map((d) => (
                            <span className="orc-chip" style={{ '--c': agentColor(d.agent) } as React.CSSProperties} key={d.taskId}>
                              <span className="chip-dot"></span>
                              <span>{d.via === 'send' ? 'Sent to' : 'Dispatched to'} {d.name || d.agent}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          )
        )}
      </div>
    </div>
  );
}
