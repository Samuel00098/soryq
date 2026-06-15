<script lang="ts">
  import { markOnboardingCompleted } from '$lib/stores/settings';
  import { switchPresetTheme, activeTheme } from '$lib/stores/theme';
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import packageJson from '../../../../package.json';

  // Cache-bust by app version so the logo refreshes on every update.
  const iconSrc = `/icon.png?v=${packageJson.version}`;

  let { onclose = () => {} } = $props();

  let currentStep = $state(0);
  const steps = [
    { title: 'Welcome to Soryq',       desc: 'Your terminal-first workspace for coding and productivity. Everything in one window, nothing in your way.' },
    { title: 'Your Layout, Your Way',  desc: 'Control your workspace with the Activity Bar. Split between a terminal, editor, preview, database explorer, sketch canvas, and more.' },
    { title: 'AI Agent & Voice Input', desc: 'Engage peer AI agents via the Agent Orchestrator to run tasks, or trigger the Voice Loop to dictate code and commands hands-free.' },
    { title: 'DB & Canvas Integration', desc: 'Query databases natively with the DB Explorer, and draft flows or sketch system architectures with the built-in Sketch Canvas.' },
    { title: 'Built-in Productivity',  desc: 'A daily note opens each morning, quick capture saves thoughts in a keystroke, and a Kanban board tracks what matters.' },
    { title: 'Command Palette',        desc: 'Launch files, switch themes, and open any panel in milliseconds. Everything Soryq can do is one shortcut away.' },
    { title: 'Ready to Go',            desc: 'Your workspace is set. Open a folder and start building — or start writing.' },
  ];

  const featuredThemes = [
    { id: 'tokyo-night',      name: 'Tokyo Night',      color: '#1a1b26', accent: '#7aa2f7' },
    { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', color: '#1e1e2e', accent: '#cba6f7' },
    { id: 'github-light',     name: 'GitHub Light',     color: '#f6f8fa', accent: '#0969da' },
    { id: 'catppuccin-latte', name: 'Catppuccin Latte', color: '#eff1f5', accent: '#1e66f5' },
  ];

  let typedCommand  = $state('');
  let isPaletteOpen = $state(false);
  let showSuccessBanner = $state(false);
  let iconError     = $state(false);
  let lastChar      = $state('');

  function nextStep() {
    if (currentStep < steps.length - 1) currentStep++;
    else finish();
  }

  function prevStep() {
    if (currentStep > 0) currentStep--;
  }

  function finish() {
    markOnboardingCompleted();
    onclose();
  }

  function selectTheme(id: string) { switchPresetTheme(id, false); }

  function triggerPaletteSimulator() {
    isPaletteOpen = true;
    typedCommand  = '';
    lastChar      = '';
    showSuccessBanner = false;
    setTimeout(() => typeCommandText('open: daily note', 0), 400);
  }

  function typeCommandText(text: string, index: number) {
    if (index <= text.length) {
      typedCommand = text.slice(0, index);
      lastChar = text[index - 1] || '';
      setTimeout(() => { if (lastChar === text[index - 1]) lastChar = ''; }, 100);
      setTimeout(() => typeCommandText(text, index + 1), 75);
    } else {
      lastChar = '';
      setTimeout(() => { isPaletteOpen = false; showSuccessBanner = true; }, 800);
    }
  }

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

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
</script>

<div class="onboarding-overlay" transition:fade={{ duration: 250 }}>
  <div class="onboarding-card" transition:fly={{ y: 20, duration: 400 }}>

    <!-- Header -->
    <div class="card-header">
      <div class="logo-wrap">
        {#if !iconError}
          <img src={iconSrc} alt="Soryq" class="logo-img" onerror={() => iconError = true} />
        {:else}
          <svg width="24" height="24" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="8" fill="var(--accent-light)"/>
            <polyline points="10,22 14,18 10,14" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            <rect x="17" y="17" width="10" height="2.5" rx="1.25" fill="var(--text-primary)"/>
          </svg>
        {/if}
        <span class="logo-text">Getting Started</span>
      </div>
      <button class="skip-btn" onclick={finish}>Skip Tour</button>
    </div>

    <!-- Slides -->
    <div class="card-body">

      <!-- ── Step 0: Welcome + theme picker ── -->
      {#if currentStep === 0}
        <div class="slide-content" in:fly={{ x: 30, duration: 300 }} out:fly={{ x: -30, duration: 300 }}>
          <div class="illustration-area">
            <svg viewBox="0 0 400 180" width="100%" height="100%" class="animated-svg">
              <defs>
                <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="var(--accent)" />
                  <stop offset="100%" stop-color="#38bdf8" />
                </linearGradient>
              </defs>
              <g class="float-animation">
                <!-- App window -->
                <rect x="80" y="20" width="240" height="140" rx="12" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5"/>
                <rect x="80" y="20" width="240" height="26" rx="12" fill="var(--bg-tertiary)"/>
                <circle cx="100" cy="33" r="4" fill="#f87171"/>
                <circle cx="113" cy="33" r="4" fill="#fbbf24"/>
                <circle cx="126" cy="33" r="4" fill="#4ade80"/>
                <text x="200" y="38" font-family="sans-serif" font-size="9" fill="var(--text-muted)" text-anchor="middle" font-weight="600">SORYQ</text>
                <!-- Sidebar -->
                <rect x="80" y="46" width="34" height="114" fill="var(--bg-tertiary)" rx="0"/>
                <rect x="114" y="46" width="1" height="114" fill="var(--border)"/>
                <!-- Terminal area -->
                <rect x="115" y="100" width="118" height="60" fill="var(--terminal-bg, #0d0d0f)"/>
                <rect x="125" y="110" width="60" height="3" rx="1.5" fill="var(--accent)" opacity="0.7" class="pulse-animation-1"/>
                <rect x="125" y="118" width="80" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4" class="pulse-animation-2"/>
                <rect x="125" y="126" width="45" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3" class="pulse-animation-3"/>
                <!-- Editor area -->
                <rect x="115" y="46" width="118" height="54" fill="var(--editor-bg, #13131a)"/>
                <rect x="125" y="56" width="70" height="3" rx="1.5" fill="url(#cg)" opacity="0.9" class="pulse-animation-4"/>
                <rect x="125" y="64" width="95" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4" class="pulse-animation-1"/>
                <rect x="125" y="72" width="55" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3" class="pulse-animation-2"/>
                <!-- Right panel -->
                <line x1="233" y1="46" x2="233" y2="160" stroke="var(--border)" stroke-width="1"/>
                <rect x="234" y="46" width="86" height="114" fill="var(--bg-primary)"/>
                <!-- Right panel tabs -->
                <rect x="234" y="46" width="86" height="16" fill="var(--bg-secondary)"/>
                <rect x="238" y="50" width="22" height="8" rx="3" fill="var(--accent)" opacity="0.25"/>
                <text x="249" y="57" font-family="sans-serif" font-size="5.5" fill="var(--accent)" text-anchor="middle">Tasks</text>
                <rect x="263" y="50" width="22" height="8" rx="3" fill="transparent"/>
                <text x="274" y="57" font-family="sans-serif" font-size="5.5" fill="var(--text-muted)" text-anchor="middle">Editor</text>
                <!-- Kanban mini -->
                <rect x="238" y="70" width="22" height="30" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="0.8"/>
                <rect x="240" y="73" width="18" height="3" rx="1" fill="var(--text-muted)" opacity="0.5"/>
                <rect x="240" y="79" width="14" height="3" rx="1" fill="var(--text-muted)" opacity="0.3"/>
                <rect x="262" y="70" width="22" height="30" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="0.8"/>
                <rect x="264" y="73" width="18" height="3" rx="1" fill="var(--warning)" opacity="0.5"/>
                <rect x="264" y="79" width="12" height="3" rx="1" fill="var(--text-muted)" opacity="0.3"/>
                <rect x="286" y="70" width="22" height="30" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="0.8"/>
                <rect x="288" y="73" width="18" height="3" rx="1" fill="var(--success)" opacity="0.5"/>
              </g>
            </svg>
          </div>

          <h2 class="slide-title">{steps[0].title}</h2>
          <p class="slide-desc">{steps[0].desc}</p>

          <div class="theme-selection-area">
            <span class="theme-select-label">Pick a starting theme:</span>
            <div class="theme-cards">
              {#each featuredThemes as theme}
                <button
                  class="theme-card-btn"
                  class:selected={$activeTheme?.id === theme.id}
                  style="--theme-bg:{theme.color}; --theme-accent:{theme.accent};"
                  onclick={() => selectTheme(theme.id)}
                >
                  <div class="mini-ide-preview">
                    <div class="mini-ide-sidebar" style="background:color-mix(in srgb,{theme.color} 85%,black);"></div>
                    <div class="mini-ide-editor">
                      <div class="mini-ide-line" style="width:40%;background:{theme.accent}"></div>
                      <div class="mini-ide-line" style="width:75%;background:var(--text-secondary)"></div>
                      <div class="mini-ide-line" style="width:50%;background:var(--text-muted)"></div>
                    </div>
                  </div>
                  <span class="theme-card-name">{theme.name}</span>
                </button>
              {/each}
            </div>
          </div>
        </div>

      <!-- ── Step 1: Layout ── -->
      {:else if currentStep === 1}
        <div class="slide-content" in:fly={{ x: 30, duration: 300 }} out:fly={{ x: -30, duration: 300 }}>
          <div class="illustration-area">
            <svg viewBox="0 0 400 180" width="100%" height="100%">
              <!-- Window -->
              <rect x="30" y="15" width="340" height="155" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5"/>
              <!-- Activity bar -->
              <rect x="30" y="15" width="28" height="155" fill="var(--bg-tertiary)" rx="8"/>
              <rect x="58" y="15" width="1" height="155" fill="var(--border)"/>
              <!-- Sidebar -->
              <rect x="59" y="15" width="60" height="155" fill="var(--bg-tertiary)" opacity="0.5"/>
              <rect x="119" y="15" width="1" height="155" fill="var(--border)"/>
              <!-- Terminal (main) -->
              <rect x="120" y="15" width="130" height="155" fill="var(--terminal-bg, #0d0d0f)"/>
              <rect x="128" y="30" width="60" height="3" rx="1.5" fill="var(--accent)" opacity="0.6"/>
              <rect x="128" y="38" width="90" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.3"/>
              <rect x="128" y="46" width="70" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.25"/>
              <rect x="128" y="54" width="50" height="3" rx="1.5" fill="var(--accent)" opacity="0.4" class="pulse-animation-1"/>
              <!-- Divider -->
              <line x1="250" y1="15" x2="250" y2="170" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4,3" class="dash-flow"/>
              <!-- Right panel -->
              <rect x="251" y="15" width="119" height="155" fill="var(--bg-primary)"/>
              <!-- Aux tab bar -->
              <rect x="251" y="15" width="119" height="18" fill="var(--bg-secondary)"/>
              <!-- Tab pills -->
              <rect x="254" y="18" width="24" height="10" rx="4" fill="var(--accent)" opacity="0.2"/>
              <text x="266" y="26" font-family="sans-serif" font-size="5" fill="var(--accent)" text-anchor="middle" font-weight="600">Editor</text>
              <rect x="280" y="18" width="26" height="10" rx="4"/>
              <text x="293" y="26" font-family="sans-serif" font-size="5" fill="var(--text-muted)" text-anchor="middle">Preview</text>
              <rect x="308" y="18" width="20" height="10" rx="4"/>
              <text x="318" y="26" font-family="sans-serif" font-size="5" fill="var(--text-muted)" text-anchor="middle">Tasks</text>
              <rect x="330" y="18" width="14" height="10" rx="4"/>
              <text x="337" y="26" font-family="sans-serif" font-size="5" fill="var(--text-muted)" text-anchor="middle">···</text>
              <!-- Editor content in right panel -->
              <rect x="258" y="40" width="80" height="3" rx="1.5" fill="var(--accent)" opacity="0.7"/>
              <rect x="258" y="48" width="100" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4"/>
              <rect x="258" y="56" width="65" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3"/>
              <rect x="258" y="64" width="90" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.35"/>
              <rect x="258" y="72" width="50" height="3" rx="1.5" fill="var(--success)" opacity="0.5"/>
              <!-- Resize handle highlight -->
              <rect x="248" y="80" width="5" height="30" rx="2.5" fill="var(--accent)" opacity="0.4"/>
            </svg>
          </div>

          <h2 class="slide-title">{steps[1].title}</h2>
          <p class="slide-desc">{steps[1].desc}</p>

          <div class="features-checklist">
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Real PTY terminal with multi-pane grid layouts</span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Layout and state saved automatically per project</span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Activity Bar for quick access to database explorer, sketch canvas, AI agents, and settings</span>
            </div>
          </div>
        </div>

      <!-- ── Step 2: AI Agents & Voice ── -->
      {:else if currentStep === 2}
        <div class="slide-content" in:fade={{ duration: 200 }}>
          <div class="illustration-area">
            <svg viewBox="0 0 400 180" width="100%" height="100%">
              <defs>
                <linearGradient id="ai-glow" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="var(--accent)" />
                  <stop offset="100%" stop-color="#ec4899" />
                </linearGradient>
              </defs>
              <g class="float-animation">
                <!-- AI Core / Brain -->
                <circle cx="160" cy="90" r="28" fill="rgba(6, 182, 212, 0.1)" stroke="url(#ai-glow)" stroke-width="2"/>
                <circle cx="160" cy="90" r="14" fill="var(--accent)" opacity="0.2"/>
                <circle cx="160" cy="90" r="6" fill="var(--accent)"/>
                <!-- Connected Nodes -->
                <line x1="160" y1="90" x2="110" y2="60" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="3,3"/>
                <line x1="160" y1="90" x2="110" y2="120" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="3,3"/>
                <line x1="160" y1="90" x2="210" y2="90" stroke="var(--border)" stroke-width="1.5"/>
                <!-- Node circles -->
                <circle cx="110" cy="60" r="6" fill="var(--text-muted)"/>
                <circle cx="110" cy="120" r="6" fill="var(--text-muted)"/>
                <!-- Voice Microphone Icon -->
                <g transform="translate(240, 65)">
                  <rect x="16" y="10" width="12" height="20" rx="6" fill="none" stroke="#ec4899" stroke-width="2"/>
                  <path d="M 10,22 A 14,14 0 0 0 34,22" fill="none" stroke="#ec4899" stroke-width="2" stroke-linecap="round"/>
                  <line x1="22" y1="32" x2="22" y2="38" stroke="#ec4899" stroke-width="2"/>
                  <!-- Waveform -->
                  <path d="M -40,22 Q -30,12 -20,22 T 0,22 T 20,22 T 40,22" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" class="dash-flow"/>
                </g>
              </g>
            </svg>
          </div>

          <h2 class="slide-title">{steps[2].title}</h2>
          <p class="slide-desc">{steps[2].desc}</p>

          <div class="features-checklist">
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Agent Orchestrator: Delegate tasks to peer AI agents that build, test, and write code</span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Voice Loop: High-performance local speech recognition for hands-free workflow control</span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Speech-to-Code: dictation shortcut <kbd>Ctrl+Shift+V</kbd> to type text directly through your microphone</span>
            </div>
          </div>
        </div>

      <!-- ── Step 3: DB & Canvas ── -->
      {:else if currentStep === 3}
        <div class="slide-content" in:fade={{ duration: 200 }}>
          <div class="illustration-area">
            <svg viewBox="0 0 400 180" width="100%" height="100%">
              <g class="float-animation">
                <!-- Database Cylinder -->
                <g transform="translate(80, 40)">
                  <path d="M 10,15 A 25,10 0 0 0 60,15 A 25,10 0 0 0 10,15 Z" fill="none" stroke="var(--accent)" stroke-width="2"/>
                  <path d="M 10,15 L 10,40 A 25,10 0 0 0 60,40 L 60,15" fill="none" stroke="var(--accent)" stroke-width="2"/>
                  <path d="M 10,40 L 10,65 A 25,10 0 0 0 60,65 L 60,40" fill="none" stroke="var(--accent)" stroke-width="2"/>
                  <ellipse cx="35" cy="15" rx="25" ry="10" fill="var(--accent-light)"/>
                  <line x1="20" y1="28" x2="50" y2="28" stroke="var(--border)" stroke-width="1.5"/>
                  <line x1="20" y1="53" x2="50" y2="53" stroke="var(--border)" stroke-width="1.5"/>
                </g>
                <!-- Connector Line -->
                <path d="M 155,75 Q 200,45 235,75" fill="none" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="4,4"/>
                <!-- Sketch Canvas Board -->
                <g transform="translate(245, 35)">
                  <rect x="0" y="0" width="90" height="75" rx="6" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5"/>
                  <!-- Shapes on Canvas -->
                  <circle cx="25" cy="38" r="12" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" stroke-width="1.5"/>
                  <rect x="55" y="28" width="20" height="20" rx="3" fill="rgba(6,182,212,0.12)" stroke="var(--accent)" stroke-width="1.5"/>
                  <path d="M 37,38 L 55,38" fill="none" stroke="var(--text-muted)" stroke-width="1.2" stroke-linecap="round"/>
                  <!-- Hand Drawn Pencil -->
                  <path d="M 65,60 L 75,50 L 78,53 L 68,63 Z" fill="var(--text-secondary)"/>
                  <circle cx="65" cy="63" r="1.5" fill="var(--accent)"/>
                </g>
              </g>
            </svg>
          </div>

          <h2 class="slide-title">{steps[3].title}</h2>
          <p class="slide-desc">{steps[3].desc}</p>

          <div class="features-checklist">
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>DB Explorer: Native SQLite, Postgres, and MySQL panel with schema tree and SQL runner</span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Sketch Canvas: Vector design and diagrams (rectangles, circles, lines, pen tool) in a dedicated tab</span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Integrated Workspace: Connect your database schema directly to your AI context or sketch notes</span>
            </div>
          </div>
        </div>

      <!-- ── Step 4: Productivity ── -->
      {:else if currentStep === 4}
        <div class="slide-content" in:fly={{ x: 30, duration: 300 }} out:fly={{ x: -30, duration: 300 }}>
          <div class="illustration-area">
            <svg viewBox="0 0 400 180" width="100%" height="100%">
              <!-- Daily note card -->
              <rect x="30" y="20" width="110" height="140" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5"/>
              <rect x="30" y="20" width="110" height="26" rx="8" fill="var(--bg-tertiary)"/>
              <!-- Calendar icon in header -->
              <rect x="40" y="27" width="12" height="12" rx="2" fill="none" stroke="var(--accent)" stroke-width="1.2"/>
              <line x1="43" y1="25" x2="43" y2="27" stroke="var(--accent)" stroke-width="1.2"/>
              <line x1="49" y1="25" x2="49" y2="27" stroke="var(--accent)" stroke-width="1.2"/>
              <line x1="40" y1="31" x2="52" y2="31" stroke="var(--accent)" stroke-width="0.8"/>
              <text x="86" y="36" font-family="sans-serif" font-size="7.5" fill="var(--text-muted)" text-anchor="middle" font-weight="600">Daily Note</text>
              <!-- Note content -->
              <rect x="40" y="56" width="90" height="3" rx="1.5" fill="var(--accent)" opacity="0.8"/>
              <rect x="40" y="64" width="70" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.4"/>
              <rect x="40" y="72" width="85" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.3"/>
              <rect x="40" y="84" width="60" height="3" rx="1.5" fill="var(--warning)" opacity="0.5"/>
              <rect x="40" y="92" width="75" height="3" rx="1.5" fill="var(--text-secondary)" opacity="0.3"/>
              <rect x="40" y="100" width="55" height="3" rx="1.5" fill="var(--text-muted)" opacity="0.25"/>
              <!-- "auto-opens" badge -->
              <rect x="38" y="140" width="54" height="12" rx="4" fill="rgba(74,222,128,0.12)" stroke="rgba(74,222,128,0.3)" stroke-width="0.8"/>
              <text x="65" y="149" font-family="sans-serif" font-size="6" fill="var(--success)" text-anchor="middle">Auto-opens daily</text>

              <!-- Quick Capture -->
              <rect x="155" y="20" width="90" height="140" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5"/>
              <rect x="155" y="20" width="90" height="26" rx="8" fill="var(--bg-tertiary)"/>
              <text x="200" y="36" font-family="sans-serif" font-size="7.5" fill="var(--text-muted)" text-anchor="middle" font-weight="600">Quick Capture</text>
              
              <!-- Input field simulation -->
              <rect x="163" y="56" width="74" height="24" rx="4" fill="var(--bg-tertiary)" stroke="var(--accent)" stroke-width="1"/>
              <text x="169" y="70" font-family="sans-serif" font-size="6.5" fill="var(--text-primary)">Idea for app...</text>
              <line x1="222" y1="62" x2="222" y2="74" stroke="var(--accent)" stroke-width="1" class="caret"/>
              
              <!-- Captured thoughts list -->
              <rect x="163" y="90" width="74" height="12" rx="3" fill="var(--bg-tertiary)" opacity="0.5"/>
              <rect x="167" y="95" width="50" height="2" rx="0.5" fill="var(--text-secondary)" opacity="0.6"/>
              <rect x="163" y="106" width="74" height="12" rx="3" fill="var(--bg-tertiary)" opacity="0.5"/>
              <rect x="167" y="111" width="40" height="2" rx="0.5" fill="var(--text-secondary)" opacity="0.6"/>
              
              <!-- Shortcut info -->
              <rect x="161" y="140" width="78" height="12" rx="4" fill="rgba(6,182,212,0.12)" stroke="rgba(6,182,212,0.2)" stroke-width="0.8"/>
              <text x="200" y="148" font-family="monospace" font-size="5.5" fill="var(--accent)" text-anchor="middle">Ctrl+Shift+Space</text>

              <!-- Kanban Board -->
              <rect x="260" y="20" width="110" height="140" rx="8" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5"/>
              <rect x="260" y="20" width="110" height="26" rx="8" fill="var(--bg-tertiary)"/>
              <text x="315" y="36" font-family="sans-serif" font-size="7.5" fill="var(--text-muted)" text-anchor="middle" font-weight="600">Kanban Board</text>
              
              <!-- Kanban Columns -->
              <!-- To Do -->
              <rect x="265" y="52" width="30" height="75" rx="3" fill="var(--bg-tertiary)" opacity="0.6"/>
              <rect x="268" y="57" width="24" height="12" rx="2" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="0.8"/>
              <rect x="271" y="61" width="18" height="2" rx="0.5" fill="var(--text-muted)" opacity="0.4"/>
              
              <!-- In Progress -->
              <rect x="300" y="52" width="30" height="75" rx="3" fill="var(--bg-tertiary)" opacity="0.6"/>
              <rect x="303" y="57" width="24" height="16" rx="2" fill="var(--bg-secondary)" stroke="var(--warning)" stroke-width="0.8"/>
              <rect x="306" y="61" width="18" height="2" rx="0.5" fill="var(--warning)" opacity="0.6"/>
              <rect x="306" y="67" width="12" height="2" rx="0.5" fill="var(--text-muted)" opacity="0.3"/>
              
              <!-- Done -->
              <rect x="335" y="52" width="30" height="75" rx="3" fill="var(--bg-tertiary)" opacity="0.6"/>
              <rect x="338" y="57" width="24" height="12" rx="2" fill="var(--bg-secondary)" stroke="var(--success)" stroke-width="0.8"/>
              <rect x="341" y="61" width="18" height="2" rx="0.5" fill="var(--success)" opacity="0.6"/>
            </svg>
          </div>

          <h2 class="slide-title">{steps[4].title}</h2>
          <p class="slide-desc">{steps[4].desc}</p>

          <div class="features-checklist">
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Daily note auto-creates each morning — open with <kbd>Ctrl+Shift+D</kbd></span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Quick Capture drops a thought to <code>.soryq/inbox.md</code> instantly</span>
            </div>
            <div class="feature-item">
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Kanban task board (To Do / In Progress / Done) per project</span>
            </div>
          </div>
        </div>

      <!-- ── Step 5: Command Palette (interactive) ── -->
      {:else if currentStep === 5}
        <div class="slide-content" in:fly={{ x: 30, duration: 300 }} out:fly={{ x: -30, duration: 300 }}>
          <div class="palette-interactive-box">
            {#if !isPaletteOpen && !showSuccessBanner}
              <div class="interactive-prompt" transition:fade>
                <div class="keyboard-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8">
                    <rect x="2" y="4" width="20" height="16" rx="4"/>
                    <line x1="6"  y1="8"  x2="6"  y2="8"  stroke-width="2" stroke-linecap="round"/>
                    <line x1="10" y1="8"  x2="10" y2="8"  stroke-width="2" stroke-linecap="round"/>
                    <line x1="14" y1="8"  x2="14" y2="8"  stroke-width="2" stroke-linecap="round"/>
                    <line x1="18" y1="8"  x2="18" y2="8"  stroke-width="2" stroke-linecap="round"/>
                    <line x1="6"  y1="12" x2="6"  y2="12" stroke-width="2" stroke-linecap="round"/>
                    <line x1="18" y1="12" x2="18" y2="12" stroke-width="2" stroke-linecap="round"/>
                    <rect x="9" y="11" width="6" height="2" rx="1" fill="var(--accent)"/>
                    <line x1="6"  y1="16" x2="6"  y2="16" stroke-width="2" stroke-linecap="round"/>
                    <line x1="10" y1="16" x2="10" y2="16" stroke-width="2" stroke-linecap="round"/>
                    <line x1="14" y1="16" x2="14" y2="16" stroke-width="2" stroke-linecap="round"/>
                    <line x1="18" y1="16" x2="18" y2="16" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </div>
                <span>Press <kbd>Ctrl+Shift+P</kbd> or click below to try it</span>
                <button class="test-trigger-btn" onclick={triggerPaletteSimulator}>Simulate Command Palette</button>
              </div>
            {:else if isPaletteOpen}
              <div class="mock-palette" transition:fly={{ y: -10, duration: 200 }}>
                <div class="mock-palette-input">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <span class="typing-text">{typedCommand}<span class="caret">|</span></span>
                </div>
                <div class="mock-palette-list">
                  <div class="mock-palette-item active">
                    <span>Open: Daily Note</span>
                    <kbd>Ctrl+Shift+D</kbd>
                  </div>
                  <div class="mock-palette-item">
                    <span>Quick Capture</span>
                    <kbd>Ctrl+Shift+Space</kbd>
                  </div>
                  <div class="mock-palette-item">
                    <span>Theme: Switch Theme</span>
                    <kbd>Enter</kbd>
                  </div>
                </div>
              </div>
            {:else if showSuccessBanner}
              <div class="success-banner" transition:fade>
                <div class="success-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <h3>Every command, one shortcut away</h3>
                <p>Files, panels, themes, shortcuts — all searchable from <kbd>Ctrl+Shift+P</kbd>.</p>
                <button class="test-trigger-btn secondary" onclick={triggerPaletteSimulator}>Try again</button>
              </div>
            {/if}
          </div>

          {#if isPaletteOpen}
            <div class="virtual-keyboard" transition:fade>
              <div class="keyboard-row">
                {#each ['q','w','e','r','t','y','u','i','o','p'] as k}
                  <span class="key-cap" class:active={lastChar.toLowerCase() === k}>{k.toUpperCase()}</span>
                {/each}
              </div>
              <div class="keyboard-row">
                {#each ['a','s','d','f','g','h','j','k','l',':'] as k}
                  <span class="key-cap" class:active={lastChar.toLowerCase() === k}>{k.toUpperCase()}</span>
                {/each}
              </div>
              <div class="keyboard-row">
                {#each ['z','x','c','v','b','n','m',' '] as k}
                  <span class="key-cap" class:active={lastChar.toLowerCase() === k} class:space={k === ' '}>
                    {k === ' ' ? 'SPACE' : k.toUpperCase()}
                  </span>
                {/each}
              </div>
            </div>
          {/if}

          <h2 class="slide-title" style={isPaletteOpen ? 'margin-top:10px;' : ''}>{steps[5].title}</h2>
          <p class="slide-desc">{steps[5].desc}</p>
        </div>

      <!-- ── Step 6: Ready ── -->
      {:else if currentStep === 6}
        <div class="slide-content" in:fly={{ x: 30, duration: 300 }} out:fly={{ x: -30, duration: 300 }}>
          <div class="illustration-area ready-illus">
            <svg viewBox="0 0 400 150" width="100%" height="100%">
              <defs>
                <linearGradient id="cg2" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="var(--accent)"/>
                  <stop offset="100%" stop-color="#38bdf8"/>
                </linearGradient>
              </defs>
              <g class="float-animation">
                <circle cx="200" cy="70" r="50" fill="url(#cg2)" opacity="0.12"/>
                <circle cx="200" cy="70" r="38" fill="url(#cg2)" opacity="0.22"/>
                <circle cx="200" cy="70" r="26" fill="var(--accent)"/>
                <polyline points="191,70 198,77 212,62" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
              </g>
            </svg>
          </div>

          <h2 class="slide-title">{steps[6].title}</h2>
          <p class="slide-desc">{steps[6].desc}</p>

          <div class="shortcut-reference-grid">
            <div class="shortcut-ref-item">
              <span class="ref-label">Command Palette</span>
              <kbd class="ref-kbd">Ctrl+Shift+P</kbd>
            </div>
            <div class="shortcut-ref-item">
              <span class="ref-label">Quick Capture</span>
              <kbd class="ref-kbd">Ctrl+Shift+Space</kbd>
            </div>
            <div class="shortcut-ref-item">
              <span class="ref-label">Daily Note</span>
              <kbd class="ref-kbd">Ctrl+Shift+D</kbd>
            </div>
            <div class="shortcut-ref-item">
              <span class="ref-label">Voice Dictation</span>
              <kbd class="ref-kbd">Ctrl+Shift+V</kbd>
            </div>
            <div class="shortcut-ref-item">
              <span class="ref-label">Toggle Sidebar</span>
              <kbd class="ref-kbd">Ctrl+B</kbd>
            </div>
            <div class="shortcut-ref-item">
              <span class="ref-label">Open Folder</span>
              <kbd class="ref-kbd">Ctrl+O</kbd>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div class="card-footer">
      <div class="step-indicators">
        {#each steps as _, i}
          <button
            class="indicator-dot"
            class:active={currentStep === i}
            onclick={() => currentStep = i}
            aria-label="Go to step {i + 1}"
          ></button>
        {/each}
      </div>
      <div class="nav-actions">
        {#if currentStep > 0}
          <button class="nav-btn-prev" onclick={prevStep}>Back</button>
        {/if}
        <button class="nav-btn-next" onclick={nextStep}>
          {currentStep === steps.length - 1 ? 'Launch Soryq' : 'Next'}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .onboarding-overlay {
    position: fixed;
    inset: 0;
    background: rgba(4, 4, 5, 0.85);
    backdrop-filter: blur(16px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
  }

  .onboarding-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    width: 620px;
    max-width: calc(100vw - 32px);
    height: 580px;
    border-radius: var(--radius-lg, 14px);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg), 0 0 40px var(--accent-glow);
    overflow: hidden;
  }

  /* ── Header ── */
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .logo-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-img {
    width: 24px;
    height: 24px;
    border-radius: 6px;
  }

  .logo-text {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .skip-btn {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    transition: color 0.15s;
  }

  .skip-btn:hover { color: var(--text-primary); }

  /* ── Body ── */
  .card-body {
    flex: 1;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .slide-content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 48px 24px;
    text-align: center;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .slide-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 14px 0 7px;
  }

  .slide-desc {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.65;
    max-width: 440px;
    margin-bottom: 20px;
  }

  /* ── Illustration ── */
  .illustration-area {
    width: 100%;
    height: 155px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.14);
    border-radius: 10px;
    border: 1px dashed var(--border);
    overflow: hidden;
    flex-shrink: 0;
  }

  .animated-svg { max-width: 340px; }

  .float-animation { animation: floating 4s ease-in-out infinite; }

  @keyframes floating {
    0%,100% { transform: translateY(0); }
    50%      { transform: translateY(-5px); }
  }

  .pulse-animation-1 { animation: pulsing 3s ease-in-out infinite; }
  .pulse-animation-2 { animation: pulsing 3s ease-in-out 0.5s infinite; }
  .pulse-animation-3 { animation: pulsing 3s ease-in-out 1s infinite; }
  .pulse-animation-4 { animation: pulsing 3s ease-in-out 1.5s infinite; }

  @keyframes pulsing {
    0%,100% { opacity: 0.3; }
    50%      { opacity: 0.9; }
  }

  .dash-flow {
    stroke-dashoffset: 40;
    animation: dash 5s linear infinite;
  }

  @keyframes dash { to { stroke-dashoffset: 0; } }

  /* ── Theme picker ── */
  .theme-selection-area {
    width: 100%;
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .theme-select-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .theme-cards {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .theme-card-btn {
    background: var(--theme-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
  }

  .theme-card-btn:hover {
    transform: translateY(-2px);
    border-color: var(--theme-accent);
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }

  .theme-card-btn.selected {
    border-color: var(--theme-accent);
    box-shadow: 0 0 10px var(--theme-accent);
    transform: translateY(-1px);
  }

  .mini-ide-preview {
    width: 100%;
    height: 36px;
    border-radius: 4px;
    border: 1px solid rgba(255,255,255,0.05);
    display: flex;
    overflow: hidden;
    background: rgba(0,0,0,0.2);
  }

  .mini-ide-sidebar {
    width: 14px;
    border-right: 1px solid rgba(255,255,255,0.03);
    opacity: 0.7;
  }

  .mini-ide-editor {
    flex: 1;
    padding: 4px 5px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    justify-content: center;
  }

  .mini-ide-line {
    height: 3px;
    border-radius: 1px;
  }

  .theme-card-name {
    font-size: 10px;
    font-weight: 550;
    color: #fff;
    white-space: nowrap;
  }

  /* ── Feature checklist ── */
  .features-checklist {
    display: flex;
    flex-direction: column;
    gap: 9px;
    align-items: flex-start;
    max-width: 420px;
    width: 100%;
  }

  .feature-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 11.5px;
    color: var(--text-primary);
    text-align: left;
    line-height: 1.5;
  }

  .check-icon { flex-shrink: 0; margin-top: 1px; }

  kbd {
    background: var(--bg-hover);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: monospace;
    font-size: 10px;
    color: var(--accent);
    box-shadow: 0 2px 0 var(--border);
  }

  code {
    font-family: monospace;
    font-size: 10.5px;
    color: var(--accent);
    background: rgba(6,182,212,0.08);
    padding: 1px 5px;
    border-radius: 4px;
  }

  /* ── Command palette interactive ── */
  .palette-interactive-box {
    width: 100%;
    height: 175px;
    background: rgba(0,0,0,0.18);
    border-radius: 10px;
    border: 1px dashed var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    padding: 16px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .interactive-prompt {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .keyboard-icon { animation: floating 3s ease-in-out infinite; }

  .test-trigger-btn {
    background: var(--button-bg);
    color: var(--button-text);
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    transition: background 0.15s;
  }

  .test-trigger-btn:hover { background: var(--button-hover-bg); }

  .test-trigger-btn.secondary {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }

  .test-trigger-btn.secondary:hover { background: var(--bg-active); }

  .mock-palette {
    width: 320px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .mock-palette-input {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
    font-family: monospace;
    font-size: 11px;
    color: var(--text-primary);
  }

  .typing-text { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; }

  .caret { animation: caret-blink 0.8s infinite; color: var(--accent); font-weight: bold; }

  @keyframes caret-blink { 50% { opacity: 0; } }

  .mock-palette-list { display: flex; flex-direction: column; padding: 4px; }

  .mock-palette-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 10.5px;
    color: var(--text-secondary);
  }

  .mock-palette-item.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .success-banner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }

  .success-icon {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: rgba(74,222,128,0.1);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: scale-up 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  @keyframes scale-up {
    from { transform: scale(0.8); opacity: 0; }
    to   { transform: scale(1); opacity: 1; }
  }

  .success-banner h3 { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .success-banner p  { font-size: 11.5px; color: var(--text-muted); max-width: 260px; margin-bottom: 6px; }

  .virtual-keyboard {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: center;
    background: rgba(0,0,0,0.15);
    padding: 8px;
    border-radius: 8px;
    border: 1px solid var(--border);
    width: 320px;
  }

  .keyboard-row { display: flex; gap: 3px; }

  .key-cap {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    font-family: monospace;
    font-size: 8.5px;
    font-weight: 600;
    color: var(--text-muted);
    transition: all 0.12s ease;
    box-shadow: 0 1px 0 var(--border);
  }

  .key-cap.active {
    background: var(--accent);
    color: var(--button-text, #fff);
    border-color: var(--accent);
    box-shadow: 0 0 8px var(--accent-light);
    transform: scale(1.08);
  }

  .key-cap.space { width: 60px; }

  /* ── Shortcuts grid ── */
  .shortcut-reference-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    width: 100%;
    max-width: 440px;
  }

  .shortcut-ref-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(0,0,0,0.1);
    padding: 8px 12px;
    border-radius: 7px;
    border: 1px solid var(--border-subtle);
    gap: 8px;
  }

  .ref-label {
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: 500;
    white-space: nowrap;
  }

  .ref-kbd { font-size: 9px; white-space: nowrap; }

  /* ── Footer ── */
  .card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 24px;
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-tertiary);
    flex-shrink: 0;
  }

  .step-indicators { display: flex; gap: 6px; }

  .indicator-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.4;
    transition: all 0.2s ease;
    cursor: pointer;
  }

  .indicator-dot.active {
    background: var(--accent);
    opacity: 1;
    width: 16px;
    border-radius: 3px;
  }

  .nav-actions { display: flex; gap: 8px; }

  .nav-btn-prev {
    font-size: 11.5px;
    font-weight: 550;
    color: var(--text-secondary);
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border);
    transition: background 0.15s, color 0.15s;
  }

  .nav-btn-prev:hover { background: var(--bg-hover); color: var(--text-primary); }

  .nav-btn-next {
    font-size: 11.5px;
    font-weight: 600;
    background: var(--button-bg);
    color: var(--button-text);
    padding: 6px 18px;
    border-radius: 6px;
    box-shadow: var(--shadow-sm);
    transition: background 0.15s, transform 0.1s;
  }

  .nav-btn-next:hover  { background: var(--button-hover-bg); }
  .nav-btn-next:active { transform: scale(0.98); }

  .ready-illus { border-style: solid; }
</style>
