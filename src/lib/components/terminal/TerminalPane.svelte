<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { CanvasAddon } from '@xterm/addon-canvas';
  import '@xterm/xterm/css/xterm.css';
  import {
    writeToSession,
    registerDataCallback,
    unregisterDataCallback,
    resizeSession,
    sessions,
    killSession,
  } from '$lib/stores/terminal';
  import {
    terminalFontSize,
    terminalCursorStyle,
    terminalScrollback,
    terminalRenderer,
    resolvedFontFamily,
  } from '$lib/stores/settings';
  import { activeTheme } from '$lib/stores/theme';
  import { layout } from '$lib/stores/layout';

  let {
    sessionId,
    isActive,
    onActivate,
    onClose,
  }: {
    sessionId: number;
    isActive: boolean;
    onActivate: () => void;
    onClose: () => void;
  } = $props();

  let container: HTMLDivElement;
  let term = $state<any>(null);
  let fitAddon = $state<any>(null);
  let canvasAddon = $state<any>(null);
  let resizeObserver: ResizeObserver | null = null;

  let sessionInfo = $derived($sessions.find((s) => s.id === sessionId));
  let isDead = $derived(sessionInfo ? !sessionInfo.isRunning : false);

  onMount(() => {

    const initialColors = $activeTheme?.colors || {};
    const initialSyntax = $activeTheme?.syntax || {};
    const isLightTheme = $activeTheme?.type === 'light';

    term = new Terminal({
      cursorBlink: true,
      cursorStyle: $terminalCursorStyle,
      theme: {
        background: initialColors['editor-bg'] || initialColors['bg-primary'] || '#111116',
        foreground: initialColors['text-primary'] || '#e6edf3',
        cursor: initialColors['accent'] || '#7c6af7',
        cursorAccent: initialColors['editor-bg'] || initialColors['bg-primary'] || '#1a1a1f',
        selectionBackground: initialColors['selection-bg'] || 'rgba(124,106,247,0.3)',
        black: isLightTheme ? '#1f2328' : (initialColors['bg-tertiary'] || '#484f58'),
        red: initialColors['error'] || '#f85149',
        green: initialColors['success'] || '#4ade80',
        yellow: initialColors['warning'] || '#fbbf24',
        blue: initialColors['accent'] || '#7c6af7',
        magenta: initialSyntax['function'] || '#d2a8ff',
        cyan: initialSyntax['constant'] || '#39d2c0',
        white: initialColors['text-primary'] || '#e6edf3',
        brightBlack: initialColors['text-muted'] || '#6e7681',
        brightRed: initialSyntax['keyword'] || '#ff7b72',
        brightGreen: initialColors['success'] || '#4ade80',
        brightYellow: initialColors['warning'] || '#fbbf24',
        brightBlue: initialColors['accent-hover'] || '#9585ff',
        brightMagenta: initialSyntax['function'] || '#d2a8ff',
        brightCyan: initialSyntax['constant'] || '#39d2c0',
        brightWhite: initialColors['text-primary'] || '#ffffff',
      },
      fontSize: $terminalFontSize,
      fontFamily: $resolvedFontFamily,
      allowTransparency: true,
      scrollback: $terminalScrollback,
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

    // Fit after a tick so DOM is sized
    requestAnimationFrame(() => {
      fitAddon?.fit();
      const dims = fitAddon?.proposeDimensions();
      if (dims) resizeSession(sessionId, dims.rows, dims.cols);
    });

    term.onData((data: string) => writeToSession(sessionId, data));
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      resizeSession(sessionId, rows, cols);
    });

    // When this pane is clicked, focus the terminal
    term.onKey(() => onActivate());

    registerDataCallback(sessionId, (bytes: Uint8Array) => {
      term?.write(bytes);
    });

    // Observe container size changes and refit, then tell PTY about new size
    resizeObserver = new ResizeObserver(() => {
      if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;
      requestAnimationFrame(() => {
        if (fitAddon) {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims && dims.cols > 0 && dims.rows > 0) {
            resizeSession(sessionId, dims.rows, dims.cols);
          }
        }
      });
    });
    resizeObserver.observe(container);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    unregisterDataCallback(sessionId);
    canvasAddon?.dispose();
    term?.dispose();
  });
  // Focus and fit effect
  $effect(() => {
    if (isActive && fitAddon) {
      requestAnimationFrame(() => {
        if (container && container.clientWidth > 0 && container.clientHeight > 0) {
          fitAddon?.fit();
          const dims = fitAddon?.proposeDimensions();
          if (dims && dims.cols > 0 && dims.rows > 0) {
            resizeSession(sessionId, dims.rows, dims.cols);
          }
          if ($layout.activeView === 'terminal') {
            term?.focus();
          }
        }
      });
    }
  });

  // Dynamically update terminal options when global stores change
  $effect(() => {
    if (term) {
      term.options.fontFamily = $resolvedFontFamily;
      term.options.fontSize = $terminalFontSize;
      term.options.cursorStyle = $terminalCursorStyle;
      term.options.scrollback = $terminalScrollback;
      // Refit after options change
      requestAnimationFrame(() => {
        if (fitAddon) {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) resizeSession(sessionId, dims.rows, dims.cols);
        }
      });
    }
  });

  function loadCanvasAddon() {
    if (!term || canvasAddon) return;
    if (container && (container.clientWidth === 0 || container.clientHeight === 0)) return;
    try {
      const addon = new CanvasAddon();
      term.loadAddon(addon);
      canvasAddon = addon;
      term.refresh(0, term.rows - 1);
      requestAnimationFrame(() => fitAddon?.fit());
    } catch (e) {
      console.warn('Canvas renderer not available, falling back to DOM renderer', e);
      canvasAddon = null;
    }
  }

  // Swap Canvas / DOM renderer based on setting and tab active/visible state
  $effect(() => {
    if (!term) return;
    
    // Only use Canvas if the setting is enabled and this tab is active
    const shouldShowCanvas = $terminalRenderer === 'canvas' && isActive;
    const hasCanvas = !!canvasAddon;

    if (shouldShowCanvas && !hasCanvas) {
      requestAnimationFrame(() => loadCanvasAddon());
    } else if (!shouldShowCanvas && hasCanvas) {
      try {
        canvasAddon?.dispose();
        canvasAddon = null;
        term.refresh(0, term.rows - 1);
      } catch (e) {
        console.warn('Failed to dispose Canvas addon', e);
      }
    }
  });

  // Dynamically update terminal theme to match active workspace theme
  $effect(() => {
    if (term && $activeTheme) {
      const colors = $activeTheme.colors;
      const syntax = $activeTheme.syntax;
      const isLight = $activeTheme.type === 'light';

      term.options.theme = {
        background: colors['editor-bg'] || colors['bg-primary'] || (isLight ? '#ffffff' : '#111116'),
        foreground: colors['text-primary'] || (isLight ? '#1f2328' : '#e6edf3'),
        cursor: colors['accent'] || (isLight ? '#0f766e' : '#7c6af7'),
        cursorAccent: colors['editor-bg'] || colors['bg-primary'] || (isLight ? '#ffffff' : '#111116'),
        selectionBackground: colors['selection-bg'] || (isLight ? 'rgba(15, 118, 110, 0.2)' : 'rgba(124,106,247,0.3)'),
        
        black: isLight ? '#1f2328' : (colors['bg-tertiary'] || '#21262d'),
        red: colors['error'] || (isLight ? '#cf222e' : '#f85149'),
        green: colors['success'] || (isLight ? '#1a7f37' : '#4ade80'),
        yellow: colors['warning'] || (isLight ? '#9a6700' : '#fbbf24'),
        blue: colors['accent'] || (isLight ? '#0969da' : '#7c6af7'),
        magenta: syntax['function'] || (isLight ? '#8250df' : '#d2a8ff'),
        cyan: syntax['constant'] || (isLight ? '#0598bc' : '#39d2c0'),
        white: isLight ? '#eaeef2' : (colors['text-primary'] || '#e6edf3'),
        
        brightBlack: isLight ? '#656d76' : (colors['text-muted'] || '#6e7681'),
        brightRed: syntax['keyword'] || (isLight ? '#cf222e' : '#ff7b72'),
        brightGreen: colors['success'] || (isLight ? '#1a7f37' : '#4ade80'),
        brightYellow: colors['warning'] || (isLight ? '#9a6700' : '#fbbf24'),
        brightBlue: colors['accent-hover'] || (isLight ? '#218bff' : '#9585ff'),
        brightMagenta: syntax['function'] || (isLight ? '#8250df' : '#d2a8ff'),
        brightCyan: syntax['constant'] || (isLight ? '#0598bc' : '#39d2c0'),
        brightWhite: isLight ? '#ffffff' : (colors['text-primary'] || '#ffffff'),
      };
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-pane"
  class:active={isActive}
  class:dead={isDead}
  onclick={onActivate}
>
  <!-- Pane title bar -->
  <div class="pane-titlebar">
    <div class="pane-title-left">
      <span class="pane-dot" class:running={!isDead}></span>
      <span class="pane-name">{sessionInfo?.title ?? `Terminal ${sessionId}`}</span>
    </div>
    <button
      class="pane-close"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
      aria-label="Close terminal"
      title="Close terminal"
    >
      <svg width="9" height="9" viewBox="0 0 9 9">
        <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <!-- xterm container -->
  <div class="xterm-container" bind:this={container}></div>
</div>

<style>
  .terminal-pane {
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    overflow: hidden;
    position: relative;
    border: 1.5px solid transparent;
    transition: border-color 0.15s, background-color 0.15s;
  }

  .terminal-pane.active {
    border-color: var(--accent-light);
  }

  .terminal-pane.dead {
    opacity: 0.6;
  }

  /* Pane title bar */
  .pane-titlebar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 28px;
    padding: 0 8px 0 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .pane-title-left {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .pane-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.2s, box-shadow 0.2s;
  }

  .pane-dot.running {
    background: var(--success);
    box-shadow: 0 0 5px var(--success);
  }

  .pane-name {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    letter-spacing: 0.2px;
  }

  .terminal-pane.active .pane-name {
    color: var(--text-secondary);
  }

  .pane-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: var(--text-muted);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
  }

  .terminal-pane:hover .pane-close {
    opacity: 1;
  }

  .pane-close:hover {
    background: rgba(239, 68, 68, 0.15);
    color: var(--error);
  }

  /* xterm fills remaining space */
  .xterm-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    position: relative;
  }

  .xterm-container :global(.xterm) {
    height: 100%;
    width: 100%;
    padding: 0;
  }

  .xterm-container :global(.xterm-screen) {
    height: 100%;
  }

  .xterm-container :global(.xterm-viewport) {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
    background-color: var(--bg-primary) !important;
    overflow-y: scroll;
  }

  .xterm-container :global(.xterm-helper-textarea) {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: 0 !important;
    height: 0 !important;
    opacity: 0 !important;
    pointer-events: none !important;
  }
</style>
