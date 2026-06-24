import { openProject } from '$lib/stores/workspace';
import './EmptyWorkspace.css';

export default function EmptyWorkspace() {
  return (
    <div className="empty-workspace">
      <div className="illustration-container">
        {/* Premium workspace illustration with glowing nodes and network connection lines */}
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none" className="empty-illustration">
          <defs>
            <linearGradient id="folder-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--accent)" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 30%, #8b5cf6)" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Connective network paths */}
          <path
            d="M 60,65 L 35,45 M 60,65 L 85,45 M 60,65 L 60,95"
            stroke="var(--text-muted)"
            strokeWidth="1.5"
            strokeDasharray="3,3"
            className="dash-flow"
            opacity="0.6"
          />

          {/* Orbit lines */}
          <circle cx="60" cy="65" r="32" stroke="var(--border)" strokeWidth="1" strokeDasharray="2,4" />

          {/* Left Node (Terminal) */}
          <g className="node-left">
            <circle cx="35" cy="45" r="16" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
            <rect x="29" y="39" width="12" height="12" rx="2" fill="var(--bg-tertiary)" />
            <polyline
              points="32 43 35 45 32 47"
              fill="none"
              stroke="var(--text-secondary)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line x1="37" y1="47" x2="40" y2="47" stroke="var(--accent)" strokeWidth="1.2" />
          </g>

          {/* Right Node (Preview) */}
          <g className="node-right">
            <circle cx="85" cy="45" r="16" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
            <circle cx="85" cy="45" r="6" stroke="var(--text-secondary)" strokeWidth="1.2" />
            <path d="M 85,39 L 85,51 M 79,45 L 91,45" stroke="var(--text-muted)" strokeWidth="1" opacity="0.5" />
          </g>

          {/* Center Node (Main Folder Workspace) */}
          <g className="node-center">
            {/* Shadow/Glow */}
            <circle cx="60" cy="65" r="22" fill="var(--accent-light)" filter="url(#glow)" opacity="0.3" />
            <circle cx="60" cy="65" r="20" fill="var(--bg-primary)" stroke="var(--accent)" strokeWidth="1.5" />

            {/* Folder Icon */}
            <path d="M 52,57 L 57,57 L 59,60 L 68,60 L 68,73 L 52,73 Z" fill="url(#folder-gradient)" />
            <path d="M 50,60 L 70,60 L 68,73 L 52,73 Z" fill="var(--accent)" opacity="0.8" />

            {/* Plus badge */}
            <circle cx="70" cy="71" r="5" fill="var(--success)" stroke="var(--bg-primary)" strokeWidth="1.2" />
            <line x1="70" y1="69" x2="70" y2="73" stroke="#fff" strokeWidth="1" />
            <line x1="68" y1="71" x2="72" y2="71" stroke="#fff" strokeWidth="1" />
          </g>
        </svg>
      </div>

      <h3 className="empty-title">Empty Workspace</h3>
      <p className="empty-desc">
        Add one or more project folders to start coding, tracking git changes, and previewing your work.
      </p>

      <button className="add-folder-btn" onClick={openProject}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>Add Folder</span>
      </button>
    </div>
  );
}
