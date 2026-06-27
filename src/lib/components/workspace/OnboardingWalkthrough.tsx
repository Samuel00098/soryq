import { useEffect, useState, useCallback } from 'react';
import { markOnboardingCompleted } from '$lib/stores/settings';
import { switchPresetTheme, activeTheme } from '$lib/stores/theme';
import { useStore } from '$lib/react/useStore';
import packageJson from '../../../../package.json';
import './OnboardingWalkthrough.css';

const iconSrc = `/icon.png?v=${packageJson.version}`;

// ── Refined Copy Steps ──────────────────────────────────────────────────────
const steps = [
  {
    id: 'welcome',
    title: "A Developer's Workspace, Reimagined",
    kicker: 'Soryq Workspace',
    desc: 'Soryq is a native, keyboard-driven environment that consolidates your code editor, terminal grids, Git interface, and AI agents into a single high-performance window on your machine.',
  },
  {
    id: 'canvas',
    title: 'Infinite Canvas Workspace',
    kicker: 'Flexible Layouts',
    desc: 'Break free from rigid window layouts. Arrange panels dynamically across an infinite workspace. Your custom layouts save automatically per project.',
  },
  {
    id: 'terminal',
    title: 'Terminal-First Architecture',
    kicker: 'Native Integration',
    desc: 'Built for command-line efficiency. Run multiple native PTY grids side-by-side with full shell compatibility and ultra-fast rendering.',
  },
  {
    id: 'editor',
    title: 'Integrated Code Editor',
    kicker: 'Lightweight & Powerful',
    desc: 'A full-featured code editor built directly into Soryq, powered by CodeMirror 6 with full language server protocol (LSP) diagnostics and autocompletion.',
  },
  {
    id: 'git',
    title: 'Native Git & Code Review',
    kicker: 'Version Control',
    desc: 'Manage your repositories directly from the canvas. Stage, commit, and branch using quick commands, and perform side-by-side code reviews.',
  },
  {
    id: 'orchestrator',
    title: 'AI Agent Orchestrator',
    kicker: 'Agentic Workflows',
    desc: 'Work alongside a fleet of autonomous coding agents. Tell the orchestrator what you want, and watch it delegate tasks, run code, and self-correct.',
  },
  {
    id: 'quickaccess',
    title: 'Instant Command Control',
    kicker: 'Speed & Shortcuts',
    desc: 'Soryq is built to be used entirely from the keyboard. Search files, run commands, trigger AI tasks, and navigate layouts without lifting your hands.',
  },
];

// ── Themes ─────────────────────────────────────────────────────────────────
const featuredThemes = [
  { id: 'dusk',        name: 'Dusk',    bg: '#1a1412', accent: '#d4753a', text: '#e8ddd0' },
  { id: 'moss',        name: 'Moss',    bg: '#141c14', accent: '#7a9a5a', text: '#b8d4a8' },
  { id: 'violet',      name: 'Violet',  bg: '#120e1a', accent: '#9a6abc', text: '#d8d0e4' },
  { id: 'golden-hour', name: 'Golden',  bg: '#faf3e8', accent: '#c08a3a', text: '#6b4a1a' },
  { id: 'clay',        name: 'Clay',    bg: '#f0e8e0', accent: '#b06840', text: '#5a3020' },
  { id: 'raven',       name: 'Raven',   bg: '#0e1014', accent: '#c48a8a', text: '#d8dce4' },
];

// ── Keyboard rows (for step 6 palette demo) ────────────────────────────────
const QWERTY_ROW = ['q','w','e','r','t','y','u','i','o','p'];
const ASDF_ROW   = ['a','s','d','f','g','h','j','k','l',';'];
const ZXCV_ROW   = ['z','x','c','v','b','n','m',' '];

// ── Checklist Icons (Step Specific) ────────────────────────────────────────
const PositionIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
    <circle cx="12" cy="12" r="2" fill="var(--accent)" />
  </svg>
);

const PanelGridIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
    <line x1="15" y1="21" x2="15" y2="9" />
  </svg>
);

const LayoutSaveIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const TerminalSplitIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="3" y1="12" x2="12" y2="12" />
  </svg>
);

const ShellPromptIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" strokeWidth="2.5" />
  </svg>
);

const RendererSpeedIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const LspCodeIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

const FormatSaveIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 4 5 2-3 4-5-2z" />
    <path d="M17 8.5v3c0 2.8-2.2 5-5 5H6.5a2.5 2.5 0 0 0 0 5H18c3.3 0 6-2.7 6-6V8.5" />
    <path d="M9 13.5H4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2z" />
  </svg>
);

const VimBindingsIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="4" />
    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M18 12h.01M7 16h10" />
  </svg>
);

const GitBranchIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 15V9a4 4 0 0 0-4-4H9" />
    <line x1="6" y1="9" x2="6" y2="15" />
  </svg>
);

const DiffReviewIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="15" y1="12" x2="19" y2="12" />
    <line x1="5" y1="12" x2="9" y2="12" />
    <line x1="7" y1="10" x2="7" y2="14" />
  </svg>
);

const WorktreeShieldIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const OrchestratorHubIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);

const AgentTermIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="2" y1="20" x2="22" y2="20" />
    <line x1="12" y1="17" x2="12" y2="20" />
    <polyline points="7 8 10 10 7 12" />
  </svg>
);

const VoiceMicIcon = () => (
  <svg className="ob-checklist-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
  </svg>
);

const TickIcon = () => (
  <svg className="ob-tick" width="14" height="14" viewBox="0 0 24 24" fill="none"
       stroke="var(--success)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ── High-Fidelity Slide Illustrations ────────────────────────────────────────

function WelcomeIllus() {
  return (
    <svg viewBox="0 0 480 200" width="100%" height="100%" className="ob-svg">
      <defs>
        <linearGradient id="ob-cg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <filter id="ob-glow">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feComposite in="SourceGraphic" in2="blur" operator="over"/>
        </filter>
        <pattern id="ob-welcome-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="0.75" fill="rgba(255,255,255,0.06)"/>
        </pattern>
      </defs>

      <rect width="480" height="200" fill="url(#ob-welcome-grid)" />

      <g className="ob-float">
        {/* Main app window */}
        <rect x="70" y="15" width="340" height="170" rx="12" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.2" style={{ filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.5))' }}/>
        
        {/* Title bar */}
        <path d="M 70,27 A 12,12 0 0 1 82,15 L 398,15 A 12,12 0 0 1 410,27 L 410,38 L 70,38 Z" fill="var(--bg-tertiary)"/>
        <line x1="70" y1="38" x2="410" y2="38" stroke="var(--border)" strokeWidth="1" />
        
        {/* Window controls */}
        <circle cx="86" cy="26" r="3.5" fill="#ff5f56"/>
        <circle cx="96" cy="26" r="3.5" fill="#ffbd2e"/>
        <circle cx="106" cy="26" r="3.5" fill="#27c93f"/>
        <text x="240" y="30" fontFamily="system-ui, sans-serif" fontSize="8.5" fill="var(--text-muted)" textAnchor="middle" fontWeight="600" letterSpacing="0.8">Soryq — Workspace</text>

        {/* Sidebar Activity bar */}
        <rect x="70" y="39" width="22" height="145" fill="var(--bg-tertiary)" rx="1"/>
        <line x1="92" y1="39" x2="92" y2="184" stroke="var(--border)" strokeWidth="1"/>
        {[50, 70, 90, 110].map((y, i) => (
          <circle key={i} cx="81" cy={y} r="4.5"
                  fill={i === 0 ? 'var(--accent)' : 'var(--text-muted)'} opacity={i === 0 ? 0.95 : 0.25}/>
        ))}

        {/* Editor Pane (Middle) */}
        <rect x="93" y="39" width="166" height="145" fill="var(--editor-bg,#121216)"/>
        <line x1="259" y1="39" x2="259" y2="184" stroke="var(--border)" strokeWidth="1"/>
        
        {/* Editor Code Mockup */}
        <text x="105" y="58" fontFamily="monospace" fontSize="6.5" fill="var(--syntax-keyword, #89ddff)">import</text>
        <text x="133" y="58" fontFamily="monospace" fontSize="6.5" fill="var(--text-primary)">{'{ Soryq }'}</text>
        <text x="175" y="58" fontFamily="monospace" fontSize="6.5" fill="var(--syntax-keyword, #89ddff)">from</text>
        <text x="196" y="58" fontFamily="monospace" fontSize="6.5" fill="var(--syntax-string, #c3e88d)">'soryq'</text>
        
        <text x="105" y="70" fontFamily="monospace" fontSize="6.5" fill="var(--syntax-keyword, #89ddff)">const</text>
        <text x="130" y="70" fontFamily="monospace" fontSize="6.5" fill="var(--accent)">app</text>
        <text x="146" y="70" fontFamily="monospace" fontSize="6.5" fill="var(--text-secondary)">= new Soryq();</text>

        <text x="105" y="86" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)" opacity="0.5">// Initialize local developer environment</text>
        <text x="105" y="98" fontFamily="monospace" fontSize="6.5" fill="var(--accent)">app</text>
        <text x="117" y="98" fontFamily="monospace" fontSize="6.5" fill="var(--text-secondary)">.startWorkspace({'{'}</text>
        <text x="115" y="110" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)">  hotkeys: <tspan fill="var(--syntax-string, #c3e88d)">'vim'</tspan>,</text>
        <text x="115" y="122" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)">  ai: <tspan fill="var(--syntax-keyword, #89ddff)">true</tspan></text>
        <text x="105" y="134" fontFamily="monospace" fontSize="6.5" fill="var(--text-secondary)">{'});'}</text>

        <rect x="105" y="146" width="95" height="12" rx="3" fill="var(--accent)" opacity="0.08" stroke="var(--accent)" strokeWidth="0.5"/>
        <text x="110" y="154" fontFamily="monospace" fontSize="6" fill="var(--accent)" fontWeight="bold">LSP Server Ready</text>

        {/* Terminal Pane (Right) */}
        <rect x="260" y="39" width="149" height="145" fill="var(--terminal-bg,#0a0a0c)"/>
        
        <text x="272" y="58" fontFamily="monospace" fontSize="6.5" fill="var(--accent)" opacity="0.8">$ soryq dev</text>
        <text x="272" y="70" fontFamily="monospace" fontSize="6" fill="var(--success)" opacity="0.9">✔ Native PTY grid established</text>
        <text x="272" y="82" fontFamily="monospace" fontSize="6" fill="var(--text-secondary)">Watching local directory...</text>
        
        <rect x="272" y="96" width="125" height="1" fill="rgba(255,255,255,0.06)" />
        
        <text x="272" y="112" fontFamily="monospace" fontSize="6" fill="var(--text-muted)">[1/2] Launching agent swarm...</text>
        <text x="272" y="124" fontFamily="monospace" fontSize="6" fill="var(--text-muted)">[2/2] Connecting local LSP...</text>
        <text x="272" y="136" fontFamily="monospace" fontSize="6" fill="var(--success)">✔ Systems fully operational</text>
        <text x="272" y="152" fontFamily="monospace" fontSize="6.5" fill="var(--accent)">$ <tspan className="ob-caret">▋</tspan></text>
      </g>

      {/* Floating Orchestrator Badge */}
      <g className="ob-badge-float" filter="url(#ob-glow)">
        <rect x="345" y="135" width="85" height="34" rx="10" fill="var(--bg-tertiary)" stroke="var(--accent)" strokeWidth="1.2" style={{ filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.3))' }}/>
        <circle cx="362" cy="152" r="5" fill="var(--success)"/>
        <text x="374" y="151" fontFamily="sans-serif" fontSize="7.5" fill="var(--text-primary)" fontWeight="700">AI Active</text>
        <text x="374" y="160" fontFamily="monospace" fontSize="5.5" fill="var(--text-muted)">swarm running</text>
      </g>
    </svg>
  );
}

function CanvasIllus() {
  return (
    <svg viewBox="0 0 480 200" width="100%" height="100%">
      <defs>
        <pattern id="ob-canvas-dots" width="18" height="18" patternUnits="userSpaceOnUse">
          <circle cx="9" cy="9" r="0.8" fill="rgba(255,255,255,0.08)"/>
        </pattern>
      </defs>
      
      {/* Mesh dot background */}
      <rect width="480" height="200" fill="url(#ob-canvas-dots)"/>

      {/* Interactive connection wires (curved bezier lines) */}
      <path d="M 155,75 C 190,75 180,50 200,50" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="3,3" opacity="0.6"/>
      <path d="M 320,60 C 335,60 330,90 350,90" fill="none" stroke="var(--accent)" strokeWidth="1.2" strokeDasharray="3,3" opacity="0.6"/>
      <path d="M 130,125 C 130,140 220,135 220,110" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,4"/>

      {/* Terminal Room */}
      <g className="ob-float" style={{ animationDelay: '0s' }}>
        <rect x="25" y="30" width="130" height="85" rx="8" fill="rgba(22, 22, 30, 0.75)" stroke="var(--border)" strokeWidth="1.2" style={{ backdropFilter: 'blur(8px)' }}/>
        <rect x="25" y="30" width="130" height="18" rx="8" fill="var(--bg-tertiary)"/>
        <rect x="25" y="42" width="130" height="6" fill="var(--bg-tertiary)"/>
        <circle cx="34" cy="39" r="2" fill="#ff5f56"/>
        <circle cx="40" cy="39" r="2" fill="#ffbd2e"/>
        <circle cx="46" cy="39" r="2" fill="#27c93f"/>
        <text x="75" y="42" fontFamily="sans-serif" fontSize="7" fill="var(--text-muted)" textAnchor="middle" fontWeight="bold">Terminal Room</text>
        <rect x="35" y="58" width="60" height="3" rx="1.5" fill="var(--accent)" opacity="0.8"/>
        <rect x="35" y="66" width="100" height="2.5" rx="1" fill="var(--text-secondary)" opacity="0.4"/>
        <rect x="35" y="74" width="80" height="2.5" rx="1" fill="var(--text-muted)" opacity="0.3"/>
        <text x="35" y="94" fontFamily="monospace" fontSize="6.5" fill="var(--success)">$ node index.js</text>
      </g>

      {/* Code Editor Room */}
      <g className="ob-float" style={{ animationDelay: '0.6s' }}>
        <rect x="180" y="15" width="140" height="100" rx="8" fill="rgba(22, 22, 30, 0.75)" stroke="var(--accent)" strokeWidth="1.2" style={{ backdropFilter: 'blur(8px)' }}/>
        <rect x="180" y="15" width="140" height="18" rx="8" fill="var(--bg-tertiary)"/>
        <rect x="180" y="27" width="140" height="6" fill="var(--bg-tertiary)"/>
        <circle cx="189" cy="24" r="2" fill="#ff5f56"/>
        <circle cx="195" cy="24" r="2" fill="#ffbd2e"/>
        <circle cx="201" cy="24" r="2" fill="#27c93f"/>
        <text x="245" y="27" fontFamily="sans-serif" fontSize="7" fill="var(--accent)" textAnchor="middle" fontWeight="bold">Editor Room</text>
        
        {/* Mock coding lines */}
        <rect x="192" y="42" width="70" height="3" rx="1.5" fill="var(--syntax-keyword, #89ddff)" opacity="0.9"/>
        <rect x="192" y="50" width="50" height="3" rx="1.5" fill="var(--text-primary)" opacity="0.8"/>
        <rect x="192" y="58" width="95" height="3" rx="1.5" fill="var(--syntax-string, #c3e88d)" opacity="0.7"/>
        <rect x="192" y="66" width="80" height="3" rx="1.5" fill="var(--accent)" opacity="0.9"/>
        <rect x="192" y="74" width="40" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.4"/>
      </g>

      {/* Web Preview Room */}
      <g className="ob-float" style={{ animationDelay: '1.2s' }}>
        <rect x="345" y="35" width="115" height="80" rx="8" fill="rgba(22, 22, 30, 0.75)" stroke="var(--border)" strokeWidth="1.2" style={{ backdropFilter: 'blur(8px)' }}/>
        <rect x="345" y="35" width="115" height="18" rx="8" fill="var(--bg-tertiary)"/>
        <rect x="345" y="47" width="115" height="6" fill="var(--bg-tertiary)"/>
        <text x="400" y="46" fontFamily="sans-serif" fontSize="7" fill="var(--text-muted)" textAnchor="middle">Preview Panel</text>
        <rect x="353" y="59" width="98" height="48" rx="4" fill="var(--bg-primary)" stroke="var(--border)" strokeWidth="0.8"/>
        
        {/* Miniature Web Page View */}
        <circle cx="362" cy="68" r="5" fill="var(--accent)" opacity="0.8"/>
        <rect x="372" y="64" width="50" height="4" rx="2" fill="var(--text-primary)" opacity="0.9"/>
        <rect x="372" y="71" width="30" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.6"/>
        <rect x="358" y="82" width="88" height="20" rx="3" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="0.5"/>
        <circle cx="366" cy="92" r="3" fill="var(--success)" opacity="0.7"/>
        <rect x="374" y="90" width="40" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.5"/>
      </g>

      {/* AI Assistant Agent Room */}
      <g className="ob-float" style={{ animationDelay: '1.8s' }}>
        <rect x="80" y="130" width="170" height="55" rx="8" fill="rgba(22, 22, 30, 0.85)" stroke="var(--accent)" strokeWidth="1.2" opacity="0.95" style={{ backdropFilter: 'blur(8px)' }}/>
        <rect x="80" y="130" width="170" height="16" rx="8" fill="var(--bg-tertiary)"/>
        <rect x="80" y="141" width="170" height="5" fill="var(--bg-tertiary)"/>
        <text x="165" y="141" fontFamily="sans-serif" fontSize="7.5" fill="var(--accent)" textAnchor="middle" fontWeight="bold">🤖 Agent Orchestrator</text>
        <circle cx="95" cy="162" r="5" fill="var(--accent)" opacity="0.2"/>
        <circle cx="95" cy="162" r="2.5" fill="var(--accent)"/>
        <rect x="106" y="156" width="105" height="3.5" rx="1.5" fill="var(--text-secondary)" opacity="0.8"/>
        <rect x="106" y="165" width="70" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.5"/>
      </g>

      {/* Compass/Navigator HUD in bottom right */}
      <g transform="translate(420, 140)" opacity="0.6">
        <circle cx="20" cy="20" r="18" fill="none" stroke="var(--border)" strokeWidth="1"/>
        <line x1="20" y1="5" x2="20" y2="35" stroke="var(--border)" strokeWidth="0.8"/>
        <line x1="5" y1="20" x2="35" y2="20" stroke="var(--border)" strokeWidth="0.8"/>
        <polygon points="20,10 24,20 20,18 16,20" fill="var(--accent)"/>
      </g>
    </svg>
  );
}

function TerminalIllus() {
  return (
    <svg viewBox="0 0 480 200" width="100%" height="100%">
      {/* Full-width Terminal window frame */}
      <rect x="25" y="15" width="430" height="170" rx="10" fill="var(--terminal-bg,#0a0a0c)" stroke="var(--border)" strokeWidth="1.2"/>
      
      {/* Title bar */}
      <path d="M 25,25 A 10,10 0 0 1 35,15 L 445,15 A 10,10 0 0 1 455,25 L 455,38 L 25,38 Z" fill="rgba(255,255,255,0.03)"/>
      <circle cx="42" cy="26" r="3.5" fill="#ff5f56"/>
      <circle cx="52" cy="26" r="3.5" fill="#ffbd2e"/>
      <circle cx="62" cy="26" r="3.5" fill="#27c93f"/>
      <text x="240" y="29" fontFamily="monospace" fontSize="8" fill="var(--text-muted)" textAnchor="middle" fontWeight="bold">bash (grid: 2 rooms) — Soryq PTY</text>

      {/* Vertical Splitting line */}
      <line x1="240" y1="38" x2="240" y2="185" stroke="rgba(255,255,255,0.08)" strokeWidth="1.2"/>

      {/* LEFT PANE */}
      {/* Pane tabs */}
      <rect x="25" y="38" width="215" height="16" fill="rgba(0,0,0,0.2)"/>
      <rect x="30" y="38" width="60" height="16" fill="var(--terminal-bg,#0a0a0c)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
      <text x="60" y="49" fontFamily="monospace" fontSize="6.5" fill="var(--accent)" textAnchor="middle" fontWeight="bold">dev server</text>
      
      <text x="37"  y="70" fontFamily="monospace" fontSize="7" fill="var(--accent)">~/projects/soryq-app</text>
      <text x="37"  y="81" fontFamily="monospace" fontSize="7" fill="var(--text-secondary)">$ npm run dev</text>
      <text x="37"  y="95" fontFamily="monospace" fontSize="6.5" fill="var(--success)">  ➜  Vite: http://localhost:5173</text>
      <text x="37"  y="105" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)">  ➜  press h + enter to show help</text>
      
      <line x1="25" y1="116" x2="240" y2="116" stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
      
      <text x="37"  y="132" fontFamily="monospace" fontSize="7" fill="var(--accent)">~/projects/soryq-app</text>
      <text x="37"  y="143" fontFamily="monospace" fontSize="7" fill="var(--text-secondary)">$ git branch</text>
      <text x="37"  y="155" fontFamily="monospace" fontSize="7" fill="var(--success)">* <tspan fill="var(--text-primary)" fontWeight="bold">main</tspan> [origin/main]</text>
      <text x="37"  y="167" fontFamily="monospace" fontSize="7" fill="var(--accent)">$ <tspan className="ob-caret">▋</tspan></text>

      {/* RIGHT PANE */}
      {/* Pane tabs */}
      <rect x="240" y="38" width="215" height="16" fill="rgba(0,0,0,0.2)"/>
      <rect x="245" y="38" width="60" height="16" fill="var(--terminal-bg,#0a0a0c)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
      <text x="275" y="49" fontFamily="monospace" fontSize="6.5" fill="var(--text-primary)" textAnchor="middle">cargo run</text>
      
      <text x="252" y="70" fontFamily="monospace" fontSize="7" fill="var(--accent)">~/projects/soryq-core</text>
      <text x="252" y="81" fontFamily="monospace" fontSize="7" fill="var(--text-secondary)">$ cargo build --release</text>
      <text x="252" y="93" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)">   Compiling soryq-backend v1.0.0</text>
      
      {/* Compiling Progress bar */}
      <rect x="252" y="102" width="180" height="6" rx="3" fill="rgba(255,255,255,0.05)"/>
      <rect x="252" y="102" width="135" height="6" rx="3" fill="var(--accent)"/>
      <text x="438" y="108" fontFamily="monospace" fontSize="6" fill="var(--accent)" textAnchor="end">75%</text>

      <text x="252" y="122" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)">{"   Building [===================>       ]"}</text>
      <text x="252" y="136" fontFamily="monospace" fontSize="6.5" fill="var(--success)">   Finished release [optimized] target(s) in 12.4s</text>
      <text x="252" y="152" fontFamily="monospace" fontSize="7" fill="var(--accent)">$ <tspan className="ob-caret">▋</tspan></text>

      {/* WebGL Status Badge in bottom right */}
      <rect x="408" y="162" width="40" height="14" rx="4" fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="0.8"/>
      <circle cx="415" cy="169" r="2.5" fill="var(--success)"/>
      <text x="438" y="171" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)" textAnchor="end">WebGL</text>
    </svg>
  );
}

function EditorIllus() {
  return (
    <svg viewBox="0 0 480 200" width="100%" height="100%">
      {/* IDE Frame */}
      <rect x="20" y="12" width="440" height="176" rx="10" fill="var(--editor-bg,#121216)" stroke="var(--border)" strokeWidth="1.2"/>
      
      {/* Tab bar */}
      <path d="M 20,22 A 10,10 0 0 1 30,12 L 450,12 A 10,10 0 0 1 460,22 L 460,36 L 20,36 Z" fill="var(--bg-tertiary)"/>
      <line x1="20" y1="36" x2="460" y2="36" stroke="var(--border)" strokeWidth="1" />
      
      <rect x="28" y="16" width="75" height="20" rx="4" fill="var(--editor-bg,#121216)" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5"/>
      <text x="65" y="29" fontFamily="monospace" fontSize="7.5" fill="var(--text-primary)" textAnchor="middle" fontWeight="bold">App.tsx</text>
      
      <text x="140" y="29" fontFamily="monospace" fontSize="7.5" fill="var(--text-muted)" textAnchor="middle">theme.ts</text>
      <text x="210" y="29" fontFamily="monospace" fontSize="7.5" fill="var(--text-muted)" textAnchor="middle">package.json</text>

      {/* Editor Line Numbers */}
      {[1,2,3,4,5,6,7,8,9,10].map((n, i) => (
        <text key={n} x="38" y="52 + i * 12" fontFamily="monospace" fontSize="7.5" fill="var(--text-muted)" opacity="0.3" textAnchor="end">{n}</text>
      ))}

      {/* Code Text */}
      <text x="48" y="52" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-keyword, #89ddff)">import</text>
      <text x="82" y="52" fontFamily="monospace" fontSize="7.5" fill="var(--text-secondary)">{`{ useState, useEffect }`}</text>
      <text x="195" y="52" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-keyword, #89ddff)">from</text>
      <text x="220" y="52" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-string, #c3e88d)">'react'</text>

      <text x="48" y="64" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-keyword, #89ddff)">export default function</text>
      <text x="175" y="64" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-function, #82aaff)">Onboarding</text>
      <text x="225" y="64" fontFamily="monospace" fontSize="7.5" fill="var(--text-primary)">() {'{'}</text>

      <text x="60" y="76" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-keyword, #89ddff)">const</text>
      <text x="90" y="76" fontFamily="monospace" fontSize="7.5" fill="var(--text-primary)">[theme, setTheme] =</text>
      <text x="180" y="76" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-function, #82aaff)">useState</text>
      <text x="218" y="76" fontFamily="monospace" fontSize="7.5" fill="var(--text-secondary)">(initialTheme);</text>

      {/* Underlined Diagnostic Error */}
      <text x="60" y="88" fontFamily="monospace" fontSize="7.5" fill="var(--text-primary)">
        const x: <tspan fill="var(--accent)" fontWeight="bold">ThemeType</tspan> = <tspan fill="var(--syntax-string, #c3e88d)">'invalid-theme'</tspan>;
      </text>
      <path d="M 103,91 L 140,91" stroke="#f87171" strokeWidth="1.2" strokeDasharray="2,1.5"/>

      {/* Editor active line highlight */}
      <rect x="42" y="96" width="405" height="12" rx="2" fill="rgba(255,255,255,0.02)"/>
      <text x="60" y="105" fontFamily="monospace" fontSize="7.5" fill="var(--syntax-keyword, #89ddff)">return</text>
      <text x="94" y="105" fontFamily="monospace" fontSize="7.5" fill="var(--text-secondary)">{`<Workspace theme={theme} />`}</text>

      <text x="48" y="117" fontFamily="monospace" fontSize="7.5" fill="var(--text-primary)">{'}'}</text>

      {/* Diagnostic hover popup */}
      <g style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.3))' }}>
        <rect x="80" y="100" width="180" height="24" rx="4" fill="var(--bg-tertiary)" stroke="#f87171" strokeWidth="0.8"/>
        <circle cx="92" cy="112" r="3.5" fill="#f87171"/>
        <text x="102" y="115" fontFamily="sans-serif" fontSize="6.5" fill="var(--text-primary)">Type '"invalid-theme"' is not assignable to ThemeType.</text>
      </g>

      {/* LSP Autocomplete Popup */}
      <g style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.4))' }}>
        <rect x="270" y="65" width="160" height="65" rx="6" fill="var(--bg-tertiary)" stroke="var(--accent)" strokeWidth="1"/>
        
        {/* Suggestion item 1 (Active) */}
        <rect x="274" y="69" width="152" height="13" rx="3" fill="rgba(255,255,255,0.06)"/>
        <rect x="278" y="72" width="8" height="7" rx="1.5" fill="var(--accent)"/>
        <text x="282" y="78" fontFamily="monospace" fontSize="5.5" fill="#fff" textAnchor="middle" fontWeight="bold">M</text>
        <text x="291" y="78" fontFamily="monospace" fontSize="7" fill="var(--text-primary)" fontWeight="bold">switchTheme</text>
        <text x="420" y="78" fontFamily="monospace" fontSize="6" fill="var(--text-muted)" textAnchor="end">Method</text>

        {/* Suggestion item 2 */}
        <rect x="278" y="87" width="8" height="7" rx="1.5" fill="var(--success)"/>
        <text x="282" y="93" fontFamily="monospace" fontSize="5.5" fill="#fff" textAnchor="middle" fontWeight="bold">P</text>
        <text x="291" y="93" fontFamily="monospace" fontSize="7" fill="var(--text-secondary)">activeTheme</text>
        <text x="420" y="93" fontFamily="monospace" fontSize="6" fill="var(--text-muted)" textAnchor="end">Property</text>

        {/* Suggestion item 3 */}
        <rect x="278" y="102" width="8" height="7" rx="1.5" fill="#f59e0b"/>
        <text x="282" y="108" fontFamily="monospace" fontSize="5.5" fill="#fff" textAnchor="middle" fontWeight="bold">C</text>
        <text x="291" y="108" fontFamily="monospace" fontSize="7" fill="var(--text-secondary)">themeConfig</text>
        <text x="420" y="108" fontFamily="monospace" fontSize="6" fill="var(--text-muted)" textAnchor="end">Class</text>
      </g>

      {/* Editor Status Bar */}
      <rect x="20" y="170" width="440" height="18" fill="var(--accent)" opacity="0.08" />
      <text x="32"  y="182" fontFamily="monospace" fontSize="7" fill="var(--accent)" fontWeight="bold">LSP: TypeScript ✓</text>
      <text x="125" y="182" fontFamily="monospace" fontSize="7" fill="var(--success)">Prettier On Save</text>
      <text x="375" y="182" fontFamily="monospace" fontSize="7" fill="var(--text-muted)">UTF-8</text>
      <text x="425" y="182" fontFamily="monospace" fontSize="7" fill="var(--text-muted)">Vim Mode</text>
    </svg>
  );
}

function GitIllus() {
  return (
    <svg viewBox="0 0 480 200" width="100%" height="100%">
      <defs>
        <linearGradient id="ob-git-accent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--accent)"/>
          <stop offset="100%" stopColor="#ec4899"/>
        </linearGradient>
      </defs>

      {/* Curved Git Graph */}
      <g className="ob-float">
        {/* Main branch line */}
        <path d="M 40,80 L 440,80" stroke="var(--border)" strokeWidth="2.5" fill="none"/>
        
        {/* Feature branch line */}
        <path d="M 120,80 C 150,80 160,35 190,35 L 340,35 C 370,35 380,80 410,80" stroke="url(#ob-git-accent)" strokeWidth="2.5" fill="none"/>

        {/* Commit nodes main */}
        {[60, 120, 260, 410].map((cx, i) => (
          <g key={i}>
            <circle cx={cx} cy="80" r="5.5" fill="var(--bg-secondary)" stroke={i === 3 ? 'var(--accent)' : 'var(--text-muted)'} strokeWidth="2"/>
            <circle cx={cx} cy="80" r="2.5" fill={i === 3 ? 'var(--accent)' : 'var(--text-secondary)'}/>
          </g>
        ))}

        {/* Commit nodes feature */}
        {[190, 250, 310].map((cx, i) => (
          <g key={i}>
            <circle cx={cx} cy="35" r="5" fill="var(--bg-secondary)" stroke="#ec4899" strokeWidth="2"/>
            <circle cx={cx} cy="35" r="2" fill="#ec4899"/>
          </g>
        ))}

        {/* Branch Labels */}
        <rect x="52" y="90" width="30" height="11" rx="3.5" fill="var(--bg-tertiary)" stroke="var(--border)" strokeWidth="0.8"/>
        <text x="67" y="98" fontFamily="monospace" fontSize="6.5" fill="var(--text-secondary)" textAnchor="middle" fontWeight="bold">main</text>

        <rect x="215" y="15" width="60" height="11" rx="3.5" fill="var(--bg-tertiary)" stroke="#ec4899" strokeWidth="0.8"/>
        <text x="245" y="23" fontFamily="monospace" fontSize="6" fill="#ec4899" textAnchor="middle" fontWeight="bold">feat/editor-lsp</text>
      </g>

      {/* Side-by-side Review Cards */}
      
      {/* Left Commit Info Card */}
      <g transform="translate(25, 120)" className="ob-float" style={{ animationDelay: '0.4s' }}>
        <rect x="0" y="0" width="195" height="60" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.2"/>
        <text x="12" y="16" fontFamily="sans-serif" fontSize="7.5" fill="var(--text-muted)" fontWeight="bold">ACTIVE COMMIT</text>
        
        {/* Author Avatar & text */}
        <circle cx="20" cy="36" r="8" fill="var(--accent)" opacity="0.3"/>
        <text x="20" y="38" fontFamily="sans-serif" fontSize="6" fill="var(--accent)" textAnchor="middle" fontWeight="bold">U</text>
        <text x="34" y="34" fontFamily="monospace" fontSize="7" fill="var(--text-primary)" fontWeight="bold">feat: setup autocompletion</text>
        <text x="34" y="44" fontFamily="monospace" fontSize="6.5" fill="var(--text-muted)">hash: a9d8c3f (2 files changed)</text>

        {/* Commit mini statistics */}
        <rect x="12" y="50" width="10" height="3" rx="1" fill="var(--success)"/>
        <rect x="25" y="50" width="6" height="3" rx="1" fill="#f87171"/>
      </g>

      {/* Right Diff Review Card */}
      <g transform="translate(245, 120)" className="ob-float" style={{ animationDelay: '0.8s' }}>
        <rect x="0" y="0" width="210" height="60" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.2"/>
        <text x="12" y="16" fontFamily="sans-serif" fontSize="7.5" fill="var(--text-muted)" fontWeight="bold">CODE REVIEW (DIFF)</text>
        
        {/* Added Code block */}
        <rect x="12" y="24" width="186" height="12" rx="2" fill="var(--success)" opacity="0.08"/>
        <text x="18" y="32" fontFamily="monospace" fontSize="6.5" fill="var(--success)">+ const server = startLspClient();</text>

        {/* Deleted Code block */}
        <rect x="12" y="38" width="186" height="12" rx="2" fill="#ef4444" opacity="0.08"/>
        <text x="18" y="46" fontFamily="monospace" fontSize="6.5" fill="#f87171">- const server = null;</text>

        {/* Isolation Worktree Badge */}
        <rect x="135" y="10" width="65" height="10" rx="3" fill="var(--bg-tertiary)" stroke="var(--accent)" strokeWidth="0.6"/>
        <text x="167" y="17" fontFamily="monospace" fontSize="5.5" fill="var(--accent)" textAnchor="middle" fontWeight="bold">isolated worktree</text>
      </g>
    </svg>
  );
}

function AgentIllus() {
  return (
    <svg viewBox="0 0 480 200" width="100%" height="100%">
      <defs>
        <linearGradient id="ob-ai-core-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--accent)"/>
          <stop offset="100%" stopColor="#c08a3a"/>
        </linearGradient>
        <radialGradient id="ob-ai-core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4"/>
          <stop offset="100%" stopColor="transparent" stopOpacity="0"/>
        </radialGradient>
      </defs>

      {/* Central Orchestrator Core */}
      <g className="ob-float">
        {/* Glow halo */}
        <circle cx="240" cy="100" r="50" fill="url(#ob-ai-core-glow)" />
        
        {/* Outer Rotating Dotted Rings */}
        <circle cx="240" cy="100" r="34" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="6,4" className="ob-dash" opacity="0.6"/>
        <circle cx="240" cy="100" r="28" fill="none" stroke="var(--accent)" strokeWidth="0.8" strokeDasharray="3,3" className="ob-dash" style={{ animationDirection: 'reverse' }} opacity="0.4"/>
        
        {/* Solid center bubble */}
        <circle cx="240" cy="100" r="20" fill="var(--bg-secondary)" stroke="url(#ob-ai-core-grad)" strokeWidth="2.2" style={{ filter: 'drop-shadow(0 5px 15px rgba(0,0,0,0.4))' }}/>
        <circle cx="240" cy="100" r="8" fill="url(#ob-ai-core-grad)" opacity="0.8"/>
        <circle cx="240" cy="100" r="3" fill="#fff"/>
        <text x="240" y="132" fontFamily="sans-serif" fontSize="8" fill="var(--text-primary)" textAnchor="middle" fontWeight="bold">Orchestrator</text>
      </g>

      {/* Orbiting Specialist Agents */}
      {[
        { x: 95,  y: 50,  label: 'Coder Agent',    color: 'var(--accent)', icon: '</>' },
        { x: 385, y: 50,  label: 'Tester Agent',   color: '#38bdf8',       icon: '✔'   },
        { x: 95,  y: 150, label: 'Research Agent', color: '#f59e0b',       icon: '🔍'  },
        { x: 385, y: 150, label: 'Reviewer Agent', color: '#ec4899',       icon: '±'   },
      ].map((agent, i) => (
        <g key={i} className="ob-float" style={{ animationDelay: `${i * 0.4}s` }}>
          {/* Active Data Connection paths */}
          <line x1={agent.x + (agent.x < 240 ? 25 : -25)} y1={agent.y}
                x2={240 + (agent.x < 240 ? -28 : 28)} y2={100}
                stroke={agent.color} strokeWidth="1.2" strokeDasharray="5,4" opacity="0.6" className="ob-dash"/>
                
          {/* Agent Bubble */}
          <circle cx={agent.x} cy={agent.y} r="20" fill="var(--bg-secondary)" stroke={agent.color} strokeWidth="1.8" style={{ filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.3))' }}/>
          <text x={agent.x} y={agent.y + 3} fontFamily="monospace" fontSize="8" fill={agent.color} textAnchor="middle" fontWeight="bold">{agent.icon}</text>
          
          <text x={agent.x} y={agent.y + 32} fontFamily="sans-serif" fontSize="7" fill="var(--text-muted)" textAnchor="middle" fontWeight="600">{agent.label}</text>
        </g>
      ))}

      {/* Glowing Voice Dictation Ring Overlay */}
      <g transform="translate(218, 12)" className="ob-float" style={{ animationDelay: '0.2s' }}>
        <circle cx="22" cy="18" r="16" fill="var(--bg-secondary)" stroke="#ec4899" strokeWidth="1.2" opacity="0.9" style={{ filter: 'drop-shadow(0 4px 10px rgba(236,72,153,0.2))' }}/>
        
        {/* Wave Microphone */}
        <rect x="18" y="9" width="8" height="13" rx="4" fill="none" stroke="#ec4899" strokeWidth="1.5"/>
        <path d="M 13,15 A 9,9 0 0 0 31,15" fill="none" stroke="#ec4899" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="22" y1="20" x2="22" y2="25" stroke="#ec4899" strokeWidth="1.5"/>
        
        {/* Pulsing indicator */}
        <circle cx="22" cy="3" r="1.8" fill="#ec4899" className="ob-pulse-1"/>
      </g>
    </svg>
  );
}

interface PaletteIllusProps {
  isPaletteOpen: boolean;
  typedCommand: string;
  showSuccessBanner: boolean;
  lastChar: string;
  onTrigger: () => void;
}

function PaletteIllus({
  isPaletteOpen,
  typedCommand,
  showSuccessBanner,
  lastChar,
  onTrigger,
}: PaletteIllusProps) {
  return (
    <div className="ob-palette-box">
      {!isPaletteOpen && !showSuccessBanner && (
        <div className="ob-interactive-prompt">
          <div className="ob-keyboard-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="4"/>
              {[6,10,14,18].map(x => <line key={x} x1={x} y1="8" x2={x} y2="8" strokeWidth="2"/>)}
              {[6,18].map(x => <line key={x} x1={x} y1="12" x2={x} y2="12" strokeWidth="2"/>)}
              <rect x="9" y="11" width="6" height="2" rx="1" fill="var(--accent)" stroke="none"/>
              {[6,10,14,18].map(x => <line key={x} x1={x} y1="16" x2={x} y2="16" strokeWidth="2"/>)}
            </svg>
          </div>
          <span>Press <kbd>Ctrl+Shift+P</kbd> or click the button to simulate the keyboard command</span>
          <button className="ob-trigger-btn" onClick={onTrigger}>Try Command Palette</button>
        </div>
      )}

      {isPaletteOpen && (
        <div className="ob-mock-palette">
          <div className="ob-mock-input">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2.2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span className="ob-typing-text">{typedCommand}<span className="ob-caret">|</span></span>
            <span className="ob-palette-badge">Launcher</span>
          </div>
          <div className="ob-mock-list">
            {[
              { label: 'Open: Daily Note', tag: 'Actions', kbd: 'Ctrl+Shift+D' },
              { label: 'Quick Capture',    tag: 'Capture', kbd: 'Ctrl+Shift+Space' },
              { label: 'Switch Theme',     tag: 'Themes',  kbd: 'Enter' },
            ].map((item, i) => (
              <div key={i} className={`ob-mock-item${i === 0 ? ' active' : ''}`}>
                <div className="ob-mock-item-left">
                  <span className="ob-mock-item-bullet" style={{ background: i === 0 ? 'var(--accent)' : 'transparent' }} />
                  <span className="ob-mock-item-label">{item.label}</span>
                  <span className="ob-mock-item-tag">{item.tag}</span>
                </div>
                <kbd>{item.kbd}</kbd>
              </div>
            ))}
          </div>
        </div>
      )}

      {isPaletteOpen && (
        <div className="ob-virtual-kbd">
          {[QWERTY_ROW, ASDF_ROW, ZXCV_ROW].map((row, ri) => (
            <div key={ri} className="ob-kbd-row">
              {row.map((k) => (
                <span key={k}
                  className={`ob-key${lastChar.toLowerCase() === k ? ' active' : ''}${k === ' ' ? ' space' : ''}`}>
                  {k === ' ' ? 'SPC' : k.toUpperCase()}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {!isPaletteOpen && showSuccessBanner && (
        <div className="ob-success-banner">
          <div className="ob-success-icon">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h3>Command Palette simulated successfully!</h3>
          <p>Instantly search commands, files, workspaces, snapshots, and triggers via <kbd>Ctrl+Shift+P</kbd>.</p>
          <button className="ob-trigger-btn secondary" onClick={onTrigger}>Simulate again</button>
        </div>
      )}
    </div>
  );
}

// ── Main Walkthrough Component ──────────────────────────────────────────────
export default function OnboardingWalkthrough({ onclose = () => {} }: { onclose?: () => void }) {
  const theme = useStore(activeTheme);
  const [step, setStep] = useState(0);
  const [iconError, setIconError] = useState(false);

  // Command palette typing simulation states
  const [typedCommand, setTypedCommand]       = useState('');
  const [isPaletteOpen, setIsPaletteOpen]     = useState(false);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [lastChar, setLastChar]               = useState('');

  const finish = useCallback(() => {
    markOnboardingCompleted();
    onclose();
  }, [onclose]);

  const next = useCallback(() => {
    setStep((s) => {
      if (s < steps.length - 1) return s + 1;
      finish();
      return s;
    });
  }, [finish]);

  const prev = useCallback(() => setStep((s) => (s > 0 ? s - 1 : s)), []);

  // Keyboard controls for slides
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && step < steps.length - 1) next();
      else if (e.key === 'ArrowLeft' && step > 0) prev();
      else if (e.key === 'Escape') finish();

      // Trigger palette simulation via Ctrl+Shift+P when on the last step
      if (step === 6 && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        e.stopPropagation();
        triggerPalette();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function typeText(text: string, index: number) {
    if (index <= text.length) {
      setTypedCommand(text.slice(0, index));
      const char = text[index - 1] || '';
      setLastChar(char);
      setTimeout(() => setLastChar((c) => (c === char ? '' : c)), 100);
      setTimeout(() => typeText(text, index + 1), 75);
    } else {
      setLastChar('');
      setTimeout(() => {
        setIsPaletteOpen(false);
        setShowSuccessBanner(true);
      }, 850);
    }
  }

  function triggerPalette() {
    setIsPaletteOpen(true);
    setTypedCommand('');
    setLastChar('');
    setShowSuccessBanner(false);
    setTimeout(() => typeText('open: daily note', 0), 400);
  }

  const current = steps[step];

  const illustrations: Record<string, React.ReactNode> = {
    welcome:     <WelcomeIllus />,
    canvas:      <CanvasIllus />,
    terminal:    <TerminalIllus />,
    editor:      <EditorIllus />,
    git:         <GitIllus />,
    orchestrator:<AgentIllus />,
    quickaccess: null, // Custom interactive palette simulator used instead
  };

  return (
    <div className="ob-overlay">
      <div className="ob-card">

        {/* ── Header ── */}
        <header className="ob-header">
          <div className="ob-logo-row">
            {!iconError ? (
              <img src={iconSrc} alt="Soryq" className="ob-logo-img" onError={() => setIconError(true)}/>
            ) : (
              <svg width="26" height="26" viewBox="0 0 36 36" fill="none">
                <rect width="36" height="36" rx="8" fill="var(--accent-light)"/>
                <polyline points="10,22 14,18 10,14" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"/>
                <rect x="17" y="17" width="10" height="2.5" rx="1.25" fill="var(--text-primary)"/>
              </svg>
            )}
            <span className="ob-logo-text">Getting Started</span>
          </div>

          <div className="ob-step-counter">
            <span className="ob-step-num">{step + 1}</span>
            <span className="ob-step-total">/ {steps.length}</span>
          </div>

          <button className="ob-skip-btn" onClick={finish}>Skip tour</button>
        </header>

        {/* ── Body ── */}
        <div className="ob-body">
          <div className="ob-slide" key={step}>

            {/* Step Section Kicker */}
            <span className="ob-kicker">{current.kicker}</span>

            {/* High-Fidelity Illustration Area */}
            {current.id !== 'quickaccess' ? (
              <div className="ob-illus-area">
                {illustrations[current.id]}
              </div>
            ) : (
              <PaletteIllus
                isPaletteOpen={isPaletteOpen}
                typedCommand={typedCommand}
                showSuccessBanner={showSuccessBanner}
                lastChar={lastChar}
                onTrigger={triggerPalette}
              />
            )}

            {/* Title & Description */}
            <h2 className="ob-title">{current.title}</h2>
            <p className="ob-desc">{current.desc}</p>

            {/* Step-Specific Details and Checklists */}
            {current.id === 'welcome' && (
              <div className="ob-theme-picker">
                <span className="ob-theme-label">Select Workspace Theme Preset</span>
                <div className="ob-theme-grid">
                  {featuredThemes.map((t) => (
                    <button
                      key={t.id}
                      className={`ob-theme-btn${theme?.id === t.id ? ' selected' : ''}`}
                      style={{ '--ob-bg': t.bg, '--ob-accent': t.accent, '--ob-text': t.text } as React.CSSProperties}
                      onClick={() => switchPresetTheme(t.id, false)}
                      title={t.name}
                    >
                      <div className="ob-theme-preview">
                        <div className="ob-theme-sidebar" style={{ background: `color-mix(in srgb, ${t.bg} 80%, black)` }}/>
                        <div className="ob-theme-editor">
                          <div className="ob-theme-line" style={{ width: '55%', background: t.accent }}/>
                          <div className="ob-theme-line" style={{ width: '80%', background: t.text, opacity: 0.4 }}/>
                          <div className="ob-theme-line" style={{ width: '45%', background: t.text, opacity: 0.25 }}/>
                        </div>
                      </div>
                      <span className="ob-theme-name">{t.name}</span>
                      {theme?.id === t.id && (
                        <div className="ob-theme-check">
                          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.5">
                            <polyline points="2 6 5 9 10 3"/>
                          </svg>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {current.id === 'canvas' && (
              <ul className="ob-checklist">
                <li><PositionIcon/><span>Arrange terminals, editors, and web previews side-by-side on a zoomable workspace</span></li>
                <li><PanelGridIcon/><span>Drag, drop, and snap rooms together to form your perfect interface</span></li>
                <li><LayoutSaveIcon/><span>Layouts auto-save in real-time, restoring your exact state when opened</span></li>
              </ul>
            )}

            {current.id === 'terminal' && (
              <ul className="ob-checklist">
                <li><TerminalSplitIcon/><span>Split terminals instantly into custom vertical or horizontal layouts</span></li>
                <li><ShellPromptIcon/><span>Full support for bash, zsh, fish, PowerShell, and custom shells</span></li>
                <li><RendererSpeedIcon/><span>GPU-accelerated WebGL rendering with zero-latency scrollback</span></li>
              </ul>
            )}

            {current.id === 'editor' && (
              <ul className="ob-checklist">
                <li><LspCodeIcon/><span>LSP autocompletion, hover definitions, syntax diagnostics, and go-to-reference</span></li>
                <li><FormatSaveIcon/><span>Preconfigured format-on-save using Prettier, rustfmt, black, and more</span></li>
                <li><VimBindingsIcon/><span>Seamless Vim keybindings and multi-cursor editing out of the box</span></li>
              </ul>
            )}

            {current.id === 'git' && (
              <ul className="ob-checklist">
                <li><GitBranchIcon/><span>Stage changes, write commit messages, and push updates in milliseconds</span></li>
                <li><DiffReviewIcon/><span>Interactive diff viewer with side-by-side and inline visual modes</span></li>
                <li><WorktreeShieldIcon/><span>Automatic git worktree isolation prevents agents from cluttering your code</span></li>
              </ul>
            )}

            {current.id === 'orchestrator' && (
              <ul className="ob-checklist">
                <li><OrchestratorHubIcon/><span>Unified agent orchestrator delegates tasks to specialized AI coding agents</span></li>
                <li><AgentTermIcon/><span>Agents read, write, and run code in real-time within sandboxed terminals</span></li>
                <li><VoiceMicIcon/><span>Voice Loop & Speech-to-Code: dictate edits hands-free via <kbd>Ctrl+Shift+V</kbd></span></li>
              </ul>
            )}

            {current.id === 'quickaccess' && (
              <div className="ob-shortcuts-grid">
                {[
                  { label: 'Command Palette', kbd: 'Ctrl+Shift+P'    },
                  { label: 'Quick Capture',   kbd: 'Ctrl+Shift+Space' },
                  { label: 'Daily Note',      kbd: 'Ctrl+Shift+D'    },
                  { label: 'Voice Dictation', kbd: 'Ctrl+Shift+V'    },
                  { label: 'Open Folder',     kbd: 'Ctrl+O'          },
                  { label: 'Settings',        kbd: 'Ctrl+,'          },
                ].map((s) => (
                  <div key={s.kbd} className="ob-shortcut-item">
                    <span className="ob-shortcut-label">{s.label}</span>
                    <kbd className="ob-shortcut-kbd">{s.kbd}</kbd>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <footer className="ob-footer">
          <div className="ob-dots">
            {steps.map((_, i) => (
              <button
                key={i}
                className={`ob-dot${step === i ? ' active' : ''}`}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}: ${steps[i].title}`}
              />
            ))}
          </div>

          <div className="ob-nav">
            {step > 0 && (
              <button className="ob-btn-prev" onClick={prev}>← Back</button>
            )}
            <button className="ob-btn-next" onClick={next}>
              {step === steps.length - 1 ? 'Launch Soryq →' : 'Next →'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
