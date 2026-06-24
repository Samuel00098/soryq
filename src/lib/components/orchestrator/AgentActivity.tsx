import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getTaskTranscript, type OrchestratorTask, type ActivityKind } from '$lib/stores/orchestrator';
import './AgentActivity.css';

interface Props {
  task: OrchestratorTask;
  /** `open` was a $bindable; in React it's controlled via onOpenChange. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const KIND_COLOR: Record<ActivityKind, string> = {
  dispatch: 'var(--accent)',
  goal: '#60a5fa',
  'follow-up': '#60a5fa',
  review: 'var(--accent)',
  finished: 'var(--success, #4ade80)',
  approved: 'var(--success, #4ade80)',
  blocked: 'var(--warning, #fbbf24)',
  changes: 'var(--warning, #fbbf24)',
  failed: 'var(--error, #f87171)',
  cancelled: 'var(--text-muted)',
  released: 'var(--text-muted)',
  info: 'var(--text-muted)',
};

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AgentActivity({ task, open = false, onOpenChange }: Props) {
  const events = task.activity ?? [];
  const isLive = task.status === 'in-progress' && task.assignedSessionId != null;

  // Live transcript while running (poll the terminal buffer), stored snapshot otherwise.
  const [transcript, setTranscript] = useState('');
  const outputEl = useRef<HTMLPreElement | null>(null);
  const pinned = useRef(true);

  useEffect(() => {
    if (!open) return;
    setTranscript(getTaskTranscript(task));
    if (!isLive) return;
    const t = setInterval(() => setTranscript(getTaskTranscript(task)), 1200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLive, task]);

  function onScroll() {
    if (!outputEl.current) return;
    pinned.current =
      outputEl.current.scrollHeight - outputEl.current.scrollTop - outputEl.current.clientHeight < 24;
  }

  // Keep the transcript pinned to the newest output while live (used tick();
  // the effect runs after the DOM commit, so we can scroll directly).
  useEffect(() => {
    if (open && isLive && pinned.current && outputEl.current) {
      outputEl.current.scrollTop = outputEl.current.scrollHeight;
    }
  }, [transcript, open, isLive]);

  return (
    <div className="activity">
      <button
        className={`activity-toggle${open ? ' open' : ''}`}
        onClick={() => onOpenChange?.(!open)}
        aria-expanded={open}
        title={open ? 'Hide history' : 'Show history'}
      >
        <span className="activity-head">
          <span className="activity-head-left">
            <svg className="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <svg className="history-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 3 3 9 9 9" />
              <path d="M12 7v5l3 2" />
            </svg>
            <span className="activity-label">History</span>
          </span>
          <span className="activity-head-right">
            {events.length > 0 && <span className="activity-count">{events.length}</span>}
            {isLive && <span className="live-dot" title="Recording"></span>}
          </span>
        </span>
      </button>

      {open && (
        <div className="activity-body">
          <div className="section-head">
            <span>History</span>
            {events.length > 0 && <span className="section-meta">{events.length} events</span>}
          </div>
          {events.length > 0 ? (
            <ul className="timeline">
              {events.map((ev) => (
                <li key={ev.id} className="event">
                  <span className="event-dot" style={{ '--ec': KIND_COLOR[ev.kind] } as CSSProperties}></span>
                  <span className="event-text">{ev.text}</span>
                  <span className="event-time">{relTime(ev.ts)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="history-empty">No recorded history yet.</p>
          )}

          <div className="output-head">
            <span>Terminal transcript</span>
            {isLive && <span className="output-live">live</span>}
          </div>
          {transcript ? (
            <pre className="output" ref={outputEl} onScroll={onScroll}>
              {transcript}
            </pre>
          ) : (
            <p className="output-empty">No terminal output captured yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
