import { useState, useEffect } from 'react';
import './DashboardShowcase.css';

interface CodeLine {
  num: number;
  text: string;
  type?: 'added' | 'deleted' | 'normal';
}

interface TerminalLine {
  text: string;
  type: 'cmd' | 'success' | 'info' | 'warning' | 'normal';
}

export default function DashboardShowcase() {
  const [isVibeMode, setIsVibeMode] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'canvas'>('grid');
  const [agentState, setAgentState] = useState<'idle' | 'thinking' | 'coding' | 'testing'>('idle');
  const [activeMemoryNode, setActiveMemoryNode] = useState<string>('config');
  const [terminalTab, setTerminalTab] = useState<'dev' | 'agents'>('dev');

  // Simulation states
  const [previewLoaded, setPreviewLoaded] = useState<boolean>(false);
  const [codeLines, setCodeLines] = useState<CodeLine[]>([
    { num: 1, text: "import { useState } from 'react';" },
    { num: 2, text: "import { Card } from './components/shared';" },
    { num: 3, text: "" },
    { num: 4, text: "export default function App() {" },
    { num: 5, text: "  const [user, setUser] = useState({ name: 'Sam' });" },
    { num: 6, text: "  return (" },
    { num: 7, text: "    <div className=\"app-container\">" },
    { num: 8, text: "      <h1>Hello World</h1>" },
    { num: 9, text: "    </div>" },
    { num: 10, text: "  );" },
    { num: 11, text: "}" },
  ]);

  const [devTerminalLines, setDevTerminalLines] = useState<TerminalLine[]>([
    { text: "$ npm run dev", type: 'cmd' },
    { text: "  VITE v8.0.14  ready in 242 ms", type: 'success' },
    { text: "  ➜  Local:   http://localhost:5173/", type: 'info' },
  ]);

  const [agentTerminalLines, setAgentTerminalLines] = useState<TerminalLine[]>([
    { text: "$ bridge-agent --swarm init", type: 'cmd' },
    { text: "[Swarm] Spawning Coordinator, Builder, and Scout...", type: 'info' },
    { text: "[Swarm] Fleet connected to local workspace.", type: 'success' },
    { text: "[Swarm] Waiting for developer prompt.", type: 'normal' },
  ]);

  // Simulate AI Agent Swarm Run
  const runSwarmSimulation = () => {
    if (agentState !== 'idle') return;

    // Phase 1: Thinking (1.5s)
    setAgentState('thinking');
    setAgentTerminalLines(prev => [
      ...prev,
      { text: "\n[Swarm] Received user request: 'Implement a beautiful interactive stats widget.'", type: 'cmd' },
      { text: "[Coordinator] Analyzing project schema and active themes...", type: 'info' },
      { text: "[Scout] File list loaded. Identified target component at src/App.tsx", type: 'info' },
    ]);

    setTimeout(() => {
      // Phase 2: Coding (3s)
      setAgentState('coding');
      setAgentTerminalLines(prev => [
        ...prev,
        { text: "[Builder] Rewriting src/App.tsx. Injecting premium layout elements...", type: 'warning' },
        { text: "[Builder] Adding state hooks and CSS gradient transitions.", type: 'info' },
      ]);

      // Animate code edits
      setCodeLines([
        { num: 1, text: "import { useState } from 'react';" },
        { num: 2, text: "import { Card } from './components/shared';" },
        { num: 3, text: "" },
        { num: 4, text: "export default function App() {" },
        { num: 5, text: "  const [user, setUser] = useState({ name: 'Sam' });" },
        { num: 6, text: "  // Swarm modification here:", type: 'normal' },
        { num: 7, text: "-     <h1>Hello World</h1>", type: 'deleted' },
        { num: 7, text: "+     <Card glow={true}>", type: 'added' },
        { num: 8, text: "+       <h2 className=\"heading\">Metrics Summary</h2>", type: 'added' },
        { num: 9, text: "+       <p className=\"stat-value\">99.8% Uptime</p>", type: 'added' },
        { num: 10, text: "+       <button className=\"btn-glow\">Refresh Stats</button>", type: 'added' },
        { num: 11, text: "+     </Card>", type: 'added' },
        { num: 12, text: "  );" },
        { num: 13, text: "}" },
      ]);

      setTimeout(() => {
        // Phase 3: Testing (2s)
        setAgentState('testing');
        setAgentTerminalLines(prev => [
          ...prev,
          { text: "[Reviewer] Launching Vitest suite: vitest run App.test.tsx", type: 'info' },
        ]);
        setDevTerminalLines(prev => [
          ...prev,
          { text: "✓ src/App.test.tsx (1) - App renders without crashing", type: 'success' },
          { text: "✓ src/App.test.tsx (2) - App matches premium zinc design variables", type: 'success' },
          { text: "Test Files: 1 passed (1 total)", type: 'success' },
        ]);

        setTimeout(() => {
          // Finish
          setAgentState('idle');
          setPreviewLoaded(true);
          setAgentTerminalLines(prev => [
            ...prev,
            { text: "[Coordinator] Swarm task complete. Live preview reloaded.", type: 'success' },
          ]);
          setDevTerminalLines(prev => [
            ...prev,
            { text: "Vite HMR: src/App.tsx updated", type: 'info' },
          ]);
        }, 2000);

      }, 3000);

    }, 1500);
  };

  const getMemoryNodeDetails = () => {
    switch (activeMemoryNode) {
      case 'config':
        return 'System settings & API Keys caches loaded. Connected via localhost WebSocket (BridgeMCP).';
      case 'theme':
        return 'Themes loaded: "Zinc Dark" (Default), "Solid Dark", "Amber Light". Primary colors mapped to CSS variables.';
      case 'db':
        return 'SQLite local state active. Sync paths: C:/Users/samue/OneDrive/Documents/Projects/Real Projects/soryq/.soryq/state.db';
      default:
        return '';
    }
  };

  return (
    <div className="dashboard-showcase">
      {/* TitleBar header */}
      <header className="showcase-header">
        <div className="header-left">
          <span className="brand-badge">Soryq</span>
          <span className="header-title">Developer Workspace Demo</span>
        </div>

        {/* Toggle Mode: Vibe Coder vs Developer */}
        <div className="header-center">
          <button 
            className={`mode-toggle-btn ${!isVibeMode ? 'active' : ''}`}
            onClick={() => setIsVibeMode(false)}
          >
            Developer Mode
          </button>
          <button 
            className={`mode-toggle-btn ${isVibeMode ? 'active' : ''}`}
            onClick={() => setIsVibeMode(true)}
          >
            Vibe Coder Mode
          </button>
        </div>

        <div className="header-right">
          <div className="agent-state-pill">
            <span className={`state-dot ${agentState}`}></span>
            <span style={{ textTransform: 'capitalize' }}>
              Swarm: {agentState === 'idle' ? 'Ready' : agentState}
            </span>
          </div>
          <button 
            className="swarm-action-btn"
            onClick={runSwarmSimulation}
            disabled={agentState !== 'idle'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
            {agentState === 'idle' ? 'Trigger Swarm' : 'Swarm Running...'}
          </button>
        </div>
      </header>

      {/* Main Workspace Contents */}
      <div className="showcase-content">
        {/* Sidebar Panel: Show AI Fleet & Directory */}
        <aside className="showcase-sidebar">
          <div>
            <div className="sidebar-section-title">Workspace Explorer</div>
            <div className="sidebar-list">
              <div className="sidebar-item active">src/App.tsx</div>
              <div className="sidebar-item">src/styles/global.css</div>
              <div className="sidebar-item">package.json</div>
            </div>
          </div>

          <div>
            <div className="sidebar-section-title">Active AI Team</div>
            <div className="agent-team-list">
              <div className="agent-card">
                <div className="agent-avatar coordinator">CO</div>
                <div className="agent-info">
                  <span className="agent-role">Coordinator</span>
                  <span className="agent-status">{agentState === 'thinking' ? 'Analyzing...' : 'Ready'}</span>
                </div>
              </div>
              <div className="agent-card">
                <div className="agent-avatar builder">BU</div>
                <div className="agent-info">
                  <span className="agent-role">Builder</span>
                  <span className="agent-status">{agentState === 'coding' ? 'Coding...' : 'Ready'}</span>
                </div>
              </div>
              <div className="agent-card">
                <div className="agent-avatar reviewer">RE</div>
                <div className="agent-info">
                  <span className="agent-role">Reviewer</span>
                  <span className="agent-status">{agentState === 'testing' ? 'Testing...' : 'Ready'}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Central Workspace Main Area */}
        <main className="main-workspace">
          <div className="workspace-toolbar">
            <div className="toolbar-tabs">
              <div 
                className={`workspace-tab ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
              >
                Code Split View
              </div>
              <div 
                className={`workspace-tab ${viewMode === 'canvas' ? 'active' : ''}`}
                onClick={() => setViewMode('canvas')}
              >
                Spatial Canvas View
              </div>
            </div>
            <div className="view-controls">
              <div className="view-btn">
                <span>Layout: Consolidated</span>
              </div>
            </div>
          </div>

          {/* Central panels split based on chosen View Mode */}
          <div className="workspace-panels">
            {viewMode === 'canvas' ? (
              /* Canvas visual node graph */
              <div className="canvas-panel">
                <div className="canvas-viewport">
                  {/* Connection Arrows SVG */}
                  <svg className="connector-svg">
                    {/* Coordinator to Scout */}
                    <path 
                      d="M 320 100 C 400 100, 400 160, 480 160" 
                      className={`connector-path ${agentState === 'thinking' ? 'active' : ''}`}
                    />
                    {/* Scout to Builder */}
                    <path 
                      d="M 620 220 C 620 300, 500 380, 340 380" 
                      className={`connector-path ${agentState === 'coding' ? 'active' : ''}`}
                    />
                    {/* Builder to Reviewer */}
                    <path 
                      d="M 340 380 C 420 380, 420 440, 500 440" 
                      className={`connector-path ${agentState === 'testing' ? 'active' : ''}`}
                    />
                  </svg>

                  {/* Node 1: Coordinator (Always visible) */}
                  <div className={`canvas-node node-pos-1 spawned ${agentState === 'thinking' ? 'active' : ''}`}>
                    <div className="canvas-node-header">
                      <span className="node-title" style={{ color: '#06b6d4' }}>
                        CO: Coordinator Swarm
                      </span>
                      <span className="node-meta">Active</span>
                    </div>
                    <div className="node-content">
                      Prompt: "Implement a beautiful interactive stats widget." Coordinates workspace tasks and delegates execution.
                    </div>
                  </div>

                  {/* Node 2: Scout (Spawns during thinking phase) */}
                  <div className={`canvas-node node-pos-2 ${agentState !== 'idle' ? 'spawned' : ''} ${agentState === 'thinking' ? 'active' : ''}`}>
                    <div className="canvas-node-header">
                      <span className="node-title" style={{ color: '#fbbf24' }}>
                        SC: Scout Context
                      </span>
                      <span className="node-meta">{agentState === 'thinking' ? 'Scanning...' : 'Complete'}</span>
                    </div>
                    <div className="node-content">
                      Analyzes files, reads dependencies, and locates targeted components at <code>src/App.tsx</code>.
                    </div>
                  </div>

                  {/* Node 3: Builder (Spawns during coding phase) */}
                  <div className={`canvas-node node-pos-3 ${agentState === 'coding' || agentState === 'testing' || (agentState === 'idle' && previewLoaded) ? 'spawned' : ''} ${agentState === 'coding' ? 'active' : ''}`}>
                    <div className="canvas-node-header">
                      <span className="node-title" style={{ color: '#8b5cf6' }}>
                        BU: Builder CodeGen
                      </span>
                      <span className="node-meta">{agentState === 'coding' ? 'Compiling...' : 'Complete'}</span>
                    </div>
                    <div className="node-content">
                      Applies code refactors, writes component states, and outputs modifications to the editor buffer.
                    </div>
                  </div>

                  {/* Node 4: Reviewer (Spawns during testing phase) */}
                  <div className={`canvas-node node-pos-4 ${agentState === 'testing' || (agentState === 'idle' && previewLoaded) ? 'spawned' : ''} ${agentState === 'testing' ? 'active' : ''}`}>
                    <div className="canvas-node-header">
                      <span className="node-title" style={{ color: '#4ade80' }}>
                        RE: Reviewer Testing
                      </span>
                      <span className="node-meta">{agentState === 'testing' ? 'Executing...' : 'Complete'}</span>
                    </div>
                    <div className="node-content">
                      Launches Vitest suites, checks accessibility standards, and validates visual responsiveness.
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Split Code Grid View */
              <div className="grid-panel">
                <div className="editor-pane">
                  <div className="code-viewer-container">
                    {codeLines.map((line, idx) => (
                      <div 
                        key={idx} 
                        className={`code-line ${line.type === 'added' ? 'line-added' : ''} ${line.type === 'deleted' ? 'line-deleted' : ''}`}
                      >
                        <span className="line-number">{line.num}</span>
                        <span className="line-content">{line.text}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Inspector Panel / Live Preview Hub */}
                <div className="inspector-pane">
                  <div className="inspector-header">Live Preview & Context</div>
                  <div className="inspector-body">
                    {/* Live Preview Window */}
                    <div>
                      <div className="sidebar-section-title">App Render Preview</div>
                      <div className="inline-preview-mock">
                        <div className="preview-address-bar">
                          <span className="preview-dot"></span>
                          <span className="preview-dot"></span>
                          <span className="preview-address">localhost:5173/preview</span>
                        </div>
                        <div className="preview-viewport-mock">
                          <div className="preview-content-wrapper">
                            {!previewLoaded ? (
                              <div>
                                <h1 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 4px' }}>Welcome Screen</h1>
                                <p style={{ fontSize: '0.65rem', margin: 0, color: 'gray' }}>Waiting for updates...</p>
                              </div>
                            ) : (
                              <div className="preview-card-glow">
                                <h3 style={{ fontSize: '0.8rem', margin: '0 0 4px', color: '#06b6d4' }}>Metrics Summary</h3>
                                <p style={{ fontSize: '1.2rem', fontWeight: 700, margin: '4px 0', color: '#fff' }}>99.8% Uptime</p>
                                <span style={{ fontSize: '0.6rem', color: '#4ade80' }}>✓ Swarm Test Passed</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Shared Memory Protocol (MCP Graph) */}
                    <div>
                      <div className="sidebar-section-title">Shared Memory Context</div>
                      <div className="memory-graph">
                        <div className="memory-nodes-grid">
                          <div 
                            className={`memory-node-chip ${activeMemoryNode === 'config' ? 'active' : ''}`}
                            onClick={() => setActiveMemoryNode('config')}
                          >
                            Project Settings
                          </div>
                          <div 
                            className={`memory-node-chip ${activeMemoryNode === 'theme' ? 'active' : ''}`}
                            onClick={() => setActiveMemoryNode('theme')}
                          >
                            Theme Tokens
                          </div>
                          <div 
                            className={`memory-node-chip ${activeMemoryNode === 'db' ? 'active' : ''}`}
                            onClick={() => setActiveMemoryNode('db')}
                          >
                            State SQLite DB
                          </div>
                        </div>
                        <div className="memory-details-box">
                          {getMemoryNodeDetails()}
                        </div>
                      </div>
                    </div>

                    {/* Kanban/Task Queue */}
                    {isVibeMode && (
                      <div>
                        <div className="sidebar-section-title">Swarm Goals Board</div>
                        <div className="kanban-preview">
                          <div className="kanban-task">
                            <span className={`task-tag ${agentState === 'idle' && previewLoaded ? 'done' : 'progress'}`}>
                              {agentState === 'idle' && previewLoaded ? 'Done' : 'In Progress'}
                            </span>
                            <span>Build metric stats card with glowing interactive state.</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Terminal Output showing logs */}
          {!isVibeMode && (
            <div className="terminal-grid-pane">
              <div className="terminal-header">
                <div className="terminal-tabs">
                  <div 
                    className={`terminal-tab ${terminalTab === 'dev' ? 'active' : ''}`}
                    onClick={() => setTerminalTab('dev')}
                  >
                    Vite Server Log
                  </div>
                  <div 
                    className={`terminal-tab ${terminalTab === 'agents' ? 'active' : ''}`}
                    onClick={() => setTerminalTab('agents')}
                  >
                    AI Swarm Output
                  </div>
                </div>
                <div className="terminal-actions">
                  <span className="terminal-btn">Clear Logs</span>
                </div>
              </div>

              <div className="terminal-body">
                <div className="terminal-split-view">
                  <div className="terminal-terminal-pane">
                    {terminalTab === 'dev' ? (
                      devTerminalLines.map((line, idx) => (
                        <div key={idx} className={`terminal-line ${line.type}`}>
                          {line.text}
                        </div>
                      ))
                    ) : (
                      agentTerminalLines.map((line, idx) => (
                        <div key={idx} className={`terminal-line ${line.type}`}>
                          {line.text}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Statusbar footer */}
      <footer className="showcase-statusbar">
        <div className="statusbar-left">
          <span>Mode: {isVibeMode ? 'Vibe Coder (High-Level)' : 'Developer (Low-Level)'}</span>
          <span>•</span>
          <span>Vite Port: 5173</span>
        </div>
        <div className="statusbar-right">
          <span>Branch: main</span>
          <span>UTF-8</span>
          <span>TypeScript</span>
        </div>
      </footer>
    </div>
  );
}
