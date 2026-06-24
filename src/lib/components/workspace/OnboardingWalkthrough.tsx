import { useEffect, useState } from 'react';
import { markOnboardingCompleted } from '$lib/stores/settings';
import { switchPresetTheme, activeTheme } from '$lib/stores/theme';
import { useStore } from '$lib/react/useStore';
import packageJson from '../../../../package.json';
import './OnboardingWalkthrough.css';

// Cache-bust by app version so the logo refreshes on every update.
const iconSrc = `/icon.png?v=${packageJson.version}`;

const steps = [
  { title: 'Welcome to Soryq', desc: 'Your terminal-first workspace for coding and productivity. Everything in one window, nothing in your way.' },
  { title: 'Your Layout, Your Way', desc: 'Control your workspace with the Activity Bar. Split between a terminal, editor, preview, database explorer, sketch canvas, and more.' },
  { title: 'AI Agent & Voice Input', desc: 'Engage peer AI agents via the Agent Orchestrator to run tasks, or trigger the Voice Loop to dictate code and commands hands-free.' },
  { title: 'DB & Canvas Integration', desc: 'Query databases natively with the DB Explorer, and draft flows or sketch system architectures with the built-in Sketch Canvas.' },
  { title: 'Built-in Productivity', desc: 'A daily note opens each morning, quick capture saves thoughts in a keystroke, and a Kanban board tracks what matters.' },
  { title: 'Command Palette', desc: 'Launch files, switch themes, and open any panel in milliseconds. Everything Soryq can do is one shortcut away.' },
  { title: 'Ready to Go', desc: 'Your workspace is set. Open a folder and start building — or start writing.' },
];

const featuredThemes = [
  { id: 'dusk', name: 'Dusk', color: '#1a1412', accent: '#d4753a' },
  { id: 'moss', name: 'Moss', color: '#141c14', accent: '#7a9a5a' },
  { id: 'golden-hour', name: 'Golden Hour', color: '#faf3e8', accent: '#c08a3a' },
  { id: 'clay', name: 'Clay', color: '#f0e8e0', accent: '#b06840' },
];

const QWERTY_ROW = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
const ASDF_ROW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ':'];
const ZXCV_ROW = ['z', 'x', 'c', 'v', 'b', 'n', 'm', ' '];

const CheckIcon = () => (
  <svg className="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function OnboardingWalkthrough({ onclose = () => {} }: { onclose?: () => void }) {
  const theme = useStore(activeTheme);

  const [currentStep, setCurrentStep] = useState(0);
  const [typedCommand, setTypedCommand] = useState('');
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [iconError, setIconError] = useState(false);
  const [lastChar, setLastChar] = useState('');

  function nextStep() {
    setCurrentStep((step) => {
      if (step < steps.length - 1) return step + 1;
      finish();
      return step;
    });
  }

  function prevStep() {
    setCurrentStep((step) => (step > 0 ? step - 1 : step));
  }

  function finish() {
    markOnboardingCompleted();
    onclose();
  }

  function selectTheme(id: string) {
    switchPresetTheme(id, false);
  }

  function typeCommandText(text: string, index: number) {
    if (index <= text.length) {
      setTypedCommand(text.slice(0, index));
      const char = text[index - 1] || '';
      setLastChar(char);
      setTimeout(() => {
        setLastChar((current) => (current === char ? '' : current));
      }, 100);
      setTimeout(() => typeCommandText(text, index + 1), 75);
    } else {
      setLastChar('');
      setTimeout(() => {
        setIsPaletteOpen(false);
        setShowSuccessBanner(true);
      }, 800);
    }
  }

  function triggerPaletteSimulator() {
    setIsPaletteOpen(true);
    setTypedCommand('');
    setLastChar('');
    setShowSuccessBanner(false);
    setTimeout(() => typeCommandText('open: daily note', 0), 400);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' && currentStep < steps.length - 1) nextStep();
      else if (e.key === 'ArrowLeft' && currentStep > 0) prevStep();
      else if (e.key === 'Escape') finish();

      if (currentStep === 5) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
          e.preventDefault();
          e.stopPropagation();
          triggerPaletteSimulator();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        {/* Header */}
        <div className="card-header">
          <div className="logo-wrap">
            {!iconError ? (
              <img src={iconSrc} alt="Soryq" className="logo-img" onError={() => setIconError(true)} />
            ) : (
              <svg width="24" height="24" viewBox="0 0 36 36" fill="none">
                <rect width="36" height="36" rx="8" fill="var(--accent-light)" />
                <polyline points="10,22 14,18 10,14" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="17" y="17" width="10" height="2.5" rx="1.25" fill="var(--text-primary)" />
              </svg>
            )}
            <span className="logo-text">Getting Started</span>
          </div>
          <button className="skip-btn" onClick={finish}>Skip Tour</button>
        </div>

        {/* Slides */}
        <div className="card-body">
          {currentStep === 0 && (
            <div className="slide-content" key={0}>
              <div className="illustration-area">
                <svg viewBox="0 0 400 180" width="100%" height="100%" className="animated-svg">
                  <defs>
                    <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--accent)" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                  </defs>
                  <g className="float-animation">
                    {/* App window */}
                    <rect x="80" y="20" width="240" height="140" rx="12" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
                    <rect x="80" y="20" width="240" height="26" rx="12" fill="var(--bg-tertiary)" />
                    <circle cx="100" cy="33" r="4" fill="#f87171" />
                    <circle cx="113" cy="33" r="4" fill="#fbbf24" />
                    <circle cx="126" cy="33" r="4" fill="#4ade80" />
                    <text x="200" y="38" fontFamily="sans-serif" fontSize="9" fill="var(--text-muted)" textAnchor="middle" fontWeight="600">SORYQ</text>
                    {/* Sidebar */}
                    <rect x="80" y="46" width="34" height="114" fill="var(--bg-tertiary)" rx="0" />
                    <rect x="114" y="46" width="1" height="114" fill="var(--border)" />
                    {/* Terminal area */}
                    <rect x="115" y="100" width="118" height="60" fill="var(--terminal-bg, #0d0d0f)" />
                    <rect x="125" y="110" width="60" height="3" rx="1.5" fill="var(--accent)" opacity="0.7" className="pulse-animation-1" />
                    <rect x="125" y="118" width="80" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4" className="pulse-animation-2" />
                    <rect x="125" y="126" width="45" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3" className="pulse-animation-3" />
                    {/* Editor area */}
                    <rect x="115" y="46" width="118" height="54" fill="var(--editor-bg, #13131a)" />
                    <rect x="125" y="56" width="70" height="3" rx="1.5" fill="url(#cg)" opacity="0.9" className="pulse-animation-4" />
                    <rect x="125" y="64" width="95" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4" className="pulse-animation-1" />
                    <rect x="125" y="72" width="55" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3" className="pulse-animation-2" />
                    {/* Right panel */}
                    <line x1="233" y1="46" x2="233" y2="160" stroke="var(--border)" strokeWidth="1" />
                    <rect x="234" y="46" width="86" height="114" fill="var(--bg-primary)" />
                    {/* Right panel tabs */}
                    <rect x="234" y="46" width="86" height="16" fill="var(--bg-secondary)" />
                    <rect x="238" y="50" width="22" height="8" rx="3" fill="var(--accent)" opacity="0.25" />
                    <text x="249" y="57" fontFamily="sans-serif" fontSize="5.5" fill="var(--accent)" textAnchor="middle">Tasks</text>
                    <rect x="263" y="50" width="22" height="8" rx="3" fill="transparent" />
                    <text x="274" y="57" fontFamily="sans-serif" fontSize="5.5" fill="var(--text-muted)" textAnchor="middle">Editor</text>
                    {/* Kanban mini */}
                    <rect x="238" y="70" width="22" height="30" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="0.8" />
                    <rect x="240" y="73" width="18" height="3" rx="1" fill="var(--text-muted)" opacity="0.5" />
                    <rect x="240" y="79" width="14" height="3" rx="1" fill="var(--text-muted)" opacity="0.3" />
                    <rect x="262" y="70" width="22" height="30" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="0.8" />
                    <rect x="264" y="73" width="18" height="3" rx="1" fill="var(--warning)" opacity="0.5" />
                    <rect x="264" y="79" width="12" height="3" rx="1" fill="var(--text-muted)" opacity="0.3" />
                    <rect x="286" y="70" width="22" height="30" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="0.8" />
                    <rect x="288" y="73" width="18" height="3" rx="1" fill="var(--success)" opacity="0.5" />
                  </g>
                </svg>
              </div>

              <h2 className="slide-title">{steps[0].title}</h2>
              <p className="slide-desc">{steps[0].desc}</p>

              <div className="theme-selection-area">
                <span className="theme-select-label">Pick a starting theme:</span>
                <div className="theme-cards">
                  {featuredThemes.map((t) => (
                    <button
                      key={t.id}
                      className={`theme-card-btn${theme?.id === t.id ? ' selected' : ''}`}
                      style={{ '--theme-bg': t.color, '--theme-accent': t.accent } as React.CSSProperties}
                      onClick={() => selectTheme(t.id)}
                    >
                      <div className="mini-ide-preview">
                        <div className="mini-ide-sidebar" style={{ background: `color-mix(in srgb,${t.color} 85%,black)` }} />
                        <div className="mini-ide-editor">
                          <div className="mini-ide-line" style={{ width: '40%', background: t.accent }} />
                          <div className="mini-ide-line" style={{ width: '75%', background: 'var(--text-secondary)' }} />
                          <div className="mini-ide-line" style={{ width: '50%', background: 'var(--text-muted)' }} />
                        </div>
                      </div>
                      <span className="theme-card-name">{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="slide-content" key={1}>
              <div className="illustration-area">
                <svg viewBox="0 0 400 180" width="100%" height="100%">
                  {/* Window */}
                  <rect x="30" y="15" width="340" height="155" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
                  {/* Activity bar */}
                  <rect x="30" y="15" width="28" height="155" fill="var(--bg-tertiary)" rx="8" />
                  <rect x="58" y="15" width="1" height="155" fill="var(--border)" />
                  {/* Sidebar */}
                  <rect x="59" y="15" width="60" height="155" fill="var(--bg-tertiary)" opacity="0.5" />
                  <rect x="119" y="15" width="1" height="155" fill="var(--border)" />
                  {/* Terminal (main) */}
                  <rect x="120" y="15" width="130" height="155" fill="var(--terminal-bg, #0d0d0f)" />
                  <rect x="128" y="30" width="60" height="3" rx="1.5" fill="var(--accent)" opacity="0.6" />
                  <rect x="128" y="38" width="90" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.3" />
                  <rect x="128" y="46" width="70" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.25" />
                  <rect x="128" y="54" width="50" height="3" rx="1.5" fill="var(--accent)" opacity="0.4" className="pulse-animation-1" />
                  {/* Divider */}
                  <line x1="250" y1="15" x2="250" y2="170" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4,3" className="dash-flow" />
                  {/* Right panel */}
                  <rect x="251" y="15" width="119" height="155" fill="var(--bg-primary)" />
                  {/* Aux tab bar */}
                  <rect x="251" y="15" width="119" height="18" fill="var(--bg-secondary)" />
                  {/* Tab pills */}
                  <rect x="254" y="18" width="24" height="10" rx="4" fill="var(--accent)" opacity="0.2" />
                  <text x="266" y="26" fontFamily="sans-serif" fontSize="5" fill="var(--accent)" textAnchor="middle" fontWeight="600">Editor</text>
                  <rect x="280" y="18" width="26" height="10" rx="4" />
                  <text x="293" y="26" fontFamily="sans-serif" fontSize="5" fill="var(--text-muted)" textAnchor="middle">Preview</text>
                  <rect x="308" y="18" width="20" height="10" rx="4" />
                  <text x="318" y="26" fontFamily="sans-serif" fontSize="5" fill="var(--text-muted)" textAnchor="middle">Tasks</text>
                  <rect x="330" y="18" width="14" height="10" rx="4" />
                  <text x="337" y="26" fontFamily="sans-serif" fontSize="5" fill="var(--text-muted)" textAnchor="middle">···</text>
                  {/* Editor content in right panel */}
                  <rect x="258" y="40" width="80" height="3" rx="1.5" fill="var(--accent)" opacity="0.7" />
                  <rect x="258" y="48" width="100" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4" />
                  <rect x="258" y="56" width="65" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3" />
                  <rect x="258" y="64" width="90" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.35" />
                  <rect x="258" y="72" width="50" height="3" rx="1.5" fill="var(--success)" opacity="0.5" />
                  {/* Resize handle highlight */}
                  <rect x="248" y="80" width="5" height="30" rx="2.5" fill="var(--accent)" opacity="0.4" />
                </svg>
              </div>

              <h2 className="slide-title">{steps[1].title}</h2>
              <p className="slide-desc">{steps[1].desc}</p>

              <div className="features-checklist">
                <div className="feature-item">
                  <CheckIcon />
                  <span>Real PTY terminal with multi-pane grid layouts</span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Layout and state saved automatically per project</span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Activity Bar for quick access to database explorer, sketch canvas, AI agents, and settings</span>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="slide-content" key={2}>
              <div className="illustration-area">
                <svg viewBox="0 0 400 180" width="100%" height="100%">
                  <defs>
                    <linearGradient id="ai-glow" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--accent)" />
                      <stop offset="100%" stopColor="#ec4899" />
                    </linearGradient>
                  </defs>
                  <g className="float-animation">
                    {/* AI Core / Brain */}
                    <circle cx="160" cy="90" r="28" fill="rgba(6, 182, 212, 0.1)" stroke="url(#ai-glow)" strokeWidth="2" />
                    <circle cx="160" cy="90" r="14" fill="var(--accent)" opacity="0.2" />
                    <circle cx="160" cy="90" r="6" fill="var(--accent)" />
                    {/* Connected Nodes */}
                    <line x1="160" y1="90" x2="110" y2="60" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3,3" />
                    <line x1="160" y1="90" x2="110" y2="120" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3,3" />
                    <line x1="160" y1="90" x2="210" y2="90" stroke="var(--border)" strokeWidth="1.5" />
                    {/* Node circles */}
                    <circle cx="110" cy="60" r="6" fill="var(--text-muted)" />
                    <circle cx="110" cy="120" r="6" fill="var(--text-muted)" />
                    {/* Voice Microphone Icon */}
                    <g transform="translate(240, 65)">
                      <rect x="16" y="10" width="12" height="20" rx="6" fill="none" stroke="#ec4899" strokeWidth="2" />
                      <path d="M 10,22 A 14,14 0 0 0 34,22" fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" />
                      <line x1="22" y1="32" x2="22" y2="38" stroke="#ec4899" strokeWidth="2" />
                      {/* Waveform */}
                      <path d="M -40,22 Q -30,12 -20,22 T 0,22 T 20,22 T 40,22" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" className="dash-flow" />
                    </g>
                  </g>
                </svg>
              </div>

              <h2 className="slide-title">{steps[2].title}</h2>
              <p className="slide-desc">{steps[2].desc}</p>

              <div className="features-checklist">
                <div className="feature-item">
                  <CheckIcon />
                  <span>Agent Orchestrator: Delegate tasks to peer AI agents that build, test, and write code</span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Voice Loop: High-performance local speech recognition for hands-free workflow control</span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Speech-to-Code: dictation shortcut <kbd>Ctrl+Shift+V</kbd> to type text directly through your microphone</span>
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="slide-content" key={3}>
              <div className="illustration-area">
                <svg viewBox="0 0 400 180" width="100%" height="100%">
                  <g className="float-animation">
                    {/* Database Cylinder */}
                    <g transform="translate(80, 40)">
                      <path d="M 10,15 A 25,10 0 0 0 60,15 A 25,10 0 0 0 10,15 Z" fill="none" stroke="var(--accent)" strokeWidth="2" />
                      <path d="M 10,15 L 10,40 A 25,10 0 0 0 60,40 L 60,15" fill="none" stroke="var(--accent)" strokeWidth="2" />
                      <path d="M 10,40 L 10,65 A 25,10 0 0 0 60,65 L 60,40" fill="none" stroke="var(--accent)" strokeWidth="2" />
                      <ellipse cx="35" cy="15" rx="25" ry="10" fill="var(--accent-light)" />
                      <line x1="20" y1="28" x2="50" y2="28" stroke="var(--border)" strokeWidth="1.5" />
                      <line x1="20" y1="53" x2="50" y2="53" stroke="var(--border)" strokeWidth="1.5" />
                    </g>
                    {/* Connector Line */}
                    <path d="M 155,75 Q 200,45 235,75" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="4,4" />
                    {/* Sketch Canvas Board */}
                    <g transform="translate(245, 35)">
                      <rect x="0" y="0" width="90" height="75" rx="6" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
                      {/* Shapes on Canvas */}
                      <circle cx="25" cy="38" r="12" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth="1.5" />
                      <rect x="55" y="28" width="20" height="20" rx="3" fill="rgba(6,182,212,0.12)" stroke="var(--accent)" strokeWidth="1.5" />
                      <path d="M 37,38 L 55,38" fill="none" stroke="var(--text-muted)" strokeWidth="1.2" strokeLinecap="round" />
                      {/* Hand Drawn Pencil */}
                      <path d="M 65,60 L 75,50 L 78,53 L 68,63 Z" fill="var(--text-secondary)" />
                      <circle cx="65" cy="63" r="1.5" fill="var(--accent)" />
                    </g>
                  </g>
                </svg>
              </div>

              <h2 className="slide-title">{steps[3].title}</h2>
              <p className="slide-desc">{steps[3].desc}</p>

              <div className="features-checklist">
                <div className="feature-item">
                  <CheckIcon />
                  <span>DB Explorer: Native SQLite, Postgres, and MySQL panel with schema tree and SQL runner</span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Sketch Canvas: Vector design and diagrams (rectangles, circles, lines, pen tool) in a dedicated tab</span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Integrated Workspace: Connect your database schema directly to your AI context or sketch notes</span>
                </div>
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="slide-content" key={4}>
              <div className="illustration-area">
                <svg viewBox="0 0 400 180" width="100%" height="100%">
                  {/* Daily note card */}
                  <rect x="30" y="20" width="110" height="140" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
                  <rect x="30" y="20" width="110" height="26" rx="8" fill="var(--bg-tertiary)" />
                  {/* Calendar icon in header */}
                  <rect x="40" y="27" width="12" height="12" rx="2" fill="none" stroke="var(--accent)" strokeWidth="1.2" />
                  <line x1="43" y1="25" x2="43" y2="27" stroke="var(--accent)" strokeWidth="1.2" />
                  <line x1="49" y1="25" x2="49" y2="27" stroke="var(--accent)" strokeWidth="1.2" />
                  <line x1="40" y1="31" x2="52" y2="31" stroke="var(--accent)" strokeWidth="0.8" />
                  <text x="86" y="36" fontFamily="sans-serif" fontSize="7.5" fill="var(--text-muted)" textAnchor="middle" fontWeight="600">Daily Note</text>
                  {/* Note content */}
                  <rect x="40" y="56" width="90" height="3" rx="1.5" fill="var(--accent)" opacity="0.8" />
                  <rect x="40" y="64" width="70" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4" />
                  <rect x="40" y="72" width="85" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3" />
                  <rect x="40" y="84" width="60" height="3" rx="1.5" fill="var(--warning)" opacity="0.5" />
                  <rect x="40" y="92" width="75" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.3" />
                  <rect x="40" y="100" width="55" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.25" />
                  {/* "auto-opens" badge */}
                  <rect x="38" y="140" width="54" height="12" rx="4" fill="rgba(74,222,128,0.12)" stroke="rgba(74,222,128,0.3)" strokeWidth="0.8" />
                  <text x="65" y="149" fontFamily="sans-serif" fontSize="6" fill="var(--success)" textAnchor="middle">Auto-opens daily</text>

                  {/* Quick Capture */}
                  <rect x="155" y="20" width="90" height="140" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
                  <rect x="155" y="20" width="90" height="26" rx="8" fill="var(--bg-tertiary)" />
                  <text x="200" y="36" fontFamily="sans-serif" fontSize="7.5" fill="var(--text-muted)" textAnchor="middle" fontWeight="600">Quick Capture</text>

                  {/* Input field simulation */}
                  <rect x="163" y="56" width="74" height="24" rx="4" fill="var(--bg-tertiary)" stroke="var(--accent)" strokeWidth="1" />
                  <text x="169" y="70" fontFamily="sans-serif" fontSize="6.5" fill="var(--text-primary)">Idea for app...</text>
                  <line x1="222" y1="62" x2="222" y2="74" stroke="var(--accent)" strokeWidth="1" className="caret" />

                  {/* Captured thoughts list */}
                  <rect x="163" y="90" width="74" height="12" rx="3" fill="var(--bg-tertiary)" opacity="0.5" />
                  <rect x="167" y="95" width="50" height="2" rx="0.5" fill="var(--text-secondary)" opacity="0.6" />
                  <rect x="163" y="106" width="74" height="12" rx="3" fill="var(--bg-tertiary)" opacity="0.5" />
                  <rect x="167" y="111" width="40" height="2" rx="0.5" fill="var(--text-secondary)" opacity="0.6" />

                  {/* Shortcut info */}
                  <rect x="161" y="140" width="78" height="12" rx="4" fill="rgba(6,182,212,0.12)" stroke="rgba(6,182,212,0.2)" strokeWidth="0.8" />
                  <text x="200" y="148" fontFamily="monospace" fontSize="5.5" fill="var(--accent)" textAnchor="middle">Ctrl+Shift+Space</text>

                  {/* Kanban Board */}
                  <rect x="260" y="20" width="110" height="140" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="1.5" />
                  <rect x="260" y="20" width="110" height="26" rx="8" fill="var(--bg-tertiary)" />
                  <text x="315" y="36" fontFamily="sans-serif" fontSize="7.5" fill="var(--text-muted)" textAnchor="middle" fontWeight="600">Kanban Board</text>

                  {/* Kanban Columns */}
                  {/* To Do */}
                  <rect x="265" y="52" width="30" height="75" rx="3" fill="var(--bg-tertiary)" opacity="0.6" />
                  <rect x="268" y="57" width="24" height="12" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" strokeWidth="0.8" />
                  <rect x="271" y="61" width="18" height="2" rx="0.5" fill="var(--text-muted)" opacity="0.4" />

                  {/* In Progress */}
                  <rect x="300" y="52" width="30" height="75" rx="3" fill="var(--bg-tertiary)" opacity="0.6" />
                  <rect x="303" y="57" width="24" height="16" rx="2" fill="var(--bg-secondary)" stroke="var(--warning)" strokeWidth="0.8" />
                  <rect x="306" y="61" width="18" height="2" rx="0.5" fill="var(--warning)" opacity="0.6" />
                  <rect x="306" y="67" width="12" height="2" rx="0.5" fill="var(--text-muted)" opacity="0.3" />

                  {/* Done */}
                  <rect x="335" y="52" width="30" height="75" rx="3" fill="var(--bg-tertiary)" opacity="0.6" />
                  <rect x="338" y="57" width="24" height="12" rx="2" fill="var(--bg-secondary)" stroke="var(--success)" strokeWidth="0.8" />
                  <rect x="341" y="61" width="18" height="2" rx="0.5" fill="var(--success)" opacity="0.6" />
                </svg>
              </div>

              <h2 className="slide-title">{steps[4].title}</h2>
              <p className="slide-desc">{steps[4].desc}</p>

              <div className="features-checklist">
                <div className="feature-item">
                  <CheckIcon />
                  <span>Daily note auto-creates each morning — open with <kbd>Ctrl+Shift+D</kbd></span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Quick Capture drops a thought to <code>.soryq/inbox.md</code> instantly</span>
                </div>
                <div className="feature-item">
                  <CheckIcon />
                  <span>Kanban task board (To Do / In Progress / Done) per project</span>
                </div>
              </div>
            </div>
          )}

          {currentStep === 5 && (
            <div className="slide-content" key={5}>
              <div className="palette-interactive-box">
                {!isPaletteOpen && !showSuccessBanner && (
                  <div className="interactive-prompt">
                    <div className="keyboard-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
                        <rect x="2" y="4" width="20" height="16" rx="4" />
                        <line x1="6" y1="8" x2="6" y2="8" strokeWidth="2" strokeLinecap="round" />
                        <line x1="10" y1="8" x2="10" y2="8" strokeWidth="2" strokeLinecap="round" />
                        <line x1="14" y1="8" x2="14" y2="8" strokeWidth="2" strokeLinecap="round" />
                        <line x1="18" y1="8" x2="18" y2="8" strokeWidth="2" strokeLinecap="round" />
                        <line x1="6" y1="12" x2="6" y2="12" strokeWidth="2" strokeLinecap="round" />
                        <line x1="18" y1="12" x2="18" y2="12" strokeWidth="2" strokeLinecap="round" />
                        <rect x="9" y="11" width="6" height="2" rx="1" fill="var(--accent)" />
                        <line x1="6" y1="16" x2="6" y2="16" strokeWidth="2" strokeLinecap="round" />
                        <line x1="10" y1="16" x2="10" y2="16" strokeWidth="2" strokeLinecap="round" />
                        <line x1="14" y1="16" x2="14" y2="16" strokeWidth="2" strokeLinecap="round" />
                        <line x1="18" y1="16" x2="18" y2="16" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <span>Press <kbd>Ctrl+Shift+P</kbd> or click below to try it</span>
                    <button className="test-trigger-btn" onClick={triggerPaletteSimulator}>Simulate Command Palette</button>
                  </div>
                )}
                {isPaletteOpen && (
                  <div className="mock-palette">
                    <div className="mock-palette-input">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <span className="typing-text">{typedCommand}<span className="caret">|</span></span>
                    </div>
                    <div className="mock-palette-list">
                      <div className="mock-palette-item active">
                        <span>Open: Daily Note</span>
                        <kbd>Ctrl+Shift+D</kbd>
                      </div>
                      <div className="mock-palette-item">
                        <span>Quick Capture</span>
                        <kbd>Ctrl+Shift+Space</kbd>
                      </div>
                      <div className="mock-palette-item">
                        <span>Theme: Switch Theme</span>
                        <kbd>Enter</kbd>
                      </div>
                    </div>
                  </div>
                )}
                {!isPaletteOpen && showSuccessBanner && (
                  <div className="success-banner">
                    <div className="success-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <h3>Every command, one shortcut away</h3>
                    <p>Files, panels, themes, shortcuts — all searchable from <kbd>Ctrl+Shift+P</kbd>.</p>
                    <button className="test-trigger-btn secondary" onClick={triggerPaletteSimulator}>Try again</button>
                  </div>
                )}
              </div>

              {isPaletteOpen && (
                <div className="virtual-keyboard">
                  <div className="keyboard-row">
                    {QWERTY_ROW.map((k) => (
                      <span key={k} className={`key-cap${lastChar.toLowerCase() === k ? ' active' : ''}`}>{k.toUpperCase()}</span>
                    ))}
                  </div>
                  <div className="keyboard-row">
                    {ASDF_ROW.map((k) => (
                      <span key={k} className={`key-cap${lastChar.toLowerCase() === k ? ' active' : ''}`}>{k.toUpperCase()}</span>
                    ))}
                  </div>
                  <div className="keyboard-row">
                    {ZXCV_ROW.map((k) => (
                      <span
                        key={k}
                        className={`key-cap${lastChar.toLowerCase() === k ? ' active' : ''}${k === ' ' ? ' space' : ''}`}
                      >
                        {k === ' ' ? 'SPACE' : k.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <h2 className="slide-title" style={isPaletteOpen ? { marginTop: '10px' } : undefined}>{steps[5].title}</h2>
              <p className="slide-desc">{steps[5].desc}</p>
            </div>
          )}

          {currentStep === 6 && (
            <div className="slide-content" key={6}>
              <div className="illustration-area ready-illus">
                <svg viewBox="0 0 400 150" width="100%" height="100%">
                  <defs>
                    <linearGradient id="cg2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="var(--accent)" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                  </defs>
                  <g className="float-animation">
                    <circle cx="200" cy="70" r="50" fill="url(#cg2)" opacity="0.12" />
                    <circle cx="200" cy="70" r="38" fill="url(#cg2)" opacity="0.22" />
                    <circle cx="200" cy="70" r="26" fill="var(--accent)" />
                    <polyline points="191,70 198,77 212,62" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                </svg>
              </div>

              <h2 className="slide-title">{steps[6].title}</h2>
              <p className="slide-desc">{steps[6].desc}</p>

              <div className="shortcut-reference-grid">
                <div className="shortcut-ref-item">
                  <span className="ref-label">Command Palette</span>
                  <kbd className="ref-kbd">Ctrl+Shift+P</kbd>
                </div>
                <div className="shortcut-ref-item">
                  <span className="ref-label">Quick Capture</span>
                  <kbd className="ref-kbd">Ctrl+Shift+Space</kbd>
                </div>
                <div className="shortcut-ref-item">
                  <span className="ref-label">Daily Note</span>
                  <kbd className="ref-kbd">Ctrl+Shift+D</kbd>
                </div>
                <div className="shortcut-ref-item">
                  <span className="ref-label">Voice Dictation</span>
                  <kbd className="ref-kbd">Ctrl+Shift+V</kbd>
                </div>
                <div className="shortcut-ref-item">
                  <span className="ref-label">Open Folder</span>
                  <kbd className="ref-kbd">Ctrl+O</kbd>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="card-footer">
          <div className="step-indicators">
            {steps.map((_, i) => (
              <button
                key={i}
                className={`indicator-dot${currentStep === i ? ' active' : ''}`}
                onClick={() => setCurrentStep(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
          <div className="nav-actions">
            {currentStep > 0 && (
              <button className="nav-btn-prev" onClick={prevStep}>Back</button>
            )}
            <button className="nav-btn-next" onClick={nextStep}>
              {currentStep === steps.length - 1 ? 'Launch Soryq' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
