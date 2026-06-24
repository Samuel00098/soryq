import {
  activeSessionId,
  killSession,
  setActiveSession,
  type TerminalSessionInfo,
} from '$lib/stores/terminal';
import { useStore } from '$lib/react/useStore';
import './TerminalTab.css';

export default function TerminalTab({ session }: { session: TerminalSessionInfo }) {
  const activeId = useStore(activeSessionId);
  const isActive = activeId === session.id;

  function handleClick() {
    setActiveSession(session.id);
  }

  function handleClose(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation();
    killSession(session.id);
  }

  return (
    <button
      className={`terminal-tab${isActive ? ' active' : ''}`}
      onClick={handleClick}
      role="tab"
      aria-selected={isActive}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4,17 10,11 4,5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
      <span className="tab-title">{session.title}</span>
      <span
        className="tab-close"
        role="button"
        tabIndex={0}
        onClick={handleClose}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClose(e);
        }}
        aria-label="Close terminal"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </span>
    </button>
  );
}
