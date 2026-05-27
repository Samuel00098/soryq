<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import '@xterm/xterm/css/xterm.css';
  import {
    writeToSession,
    registerDataCallback,
    unregisterDataCallback,
    resizeSession,
    sessions,
    killSession,
    setSessionExecuting,
    setSessionRole,
    setSessionCwd,
    appendToCommandBlock,
    finalizeCommandBlock,
    paneAssignments,
    createTerminalSession,
    terminalInputRequest,
    getSessionLabel,
    activateSessionInPane,
  } from '$lib/stores/terminal';
  import {
    terminalFontSize,
    terminalCursorStyle,
    terminalScrollback,
    resolvedFontFamily,
    terminalShell,
  } from '$lib/stores/settings';
  import { activeTheme } from '$lib/stores/theme';
  import { layout, setActiveView } from '$lib/stores/layout';
  import { activeProject } from '$lib/stores/workspace';
  import { clearProxyTarget, currentUrl, ensureProxyRunning, setPreferredLocalHost, setTargetPort } from '$lib/stores/preview';
  import { showToast } from '$lib/stores/notification';

  let {
    sessionId,
    isActive,
    isMaximized = false,
    onActivate,
    onClose,
    onMaximize,
    onResizeLeft,
    onResizeRight,
    onResizeTop,
    onResizeBottom,
  }: {
    sessionId: number;
    isActive: boolean;
    isMaximized?: boolean;
    onActivate: () => void;
    onClose: () => void;
    onMaximize?: () => void;
    onResizeLeft?: (e: MouseEvent) => void;
    onResizeRight?: (e: MouseEvent) => void;
    onResizeTop?: (e: MouseEvent) => void;
    onResizeBottom?: (e: MouseEvent) => void;
  } = $props();

  let container: HTMLDivElement;
  let paneEl: HTMLDivElement;
  let term = $state<any>(null);
  let fitAddon = $state<any>(null);
  let resizeObserver: ResizeObserver | null = null;
  let hoveredTerminalLink: string | null = null;
  let currentShellCwd = $state<string | null>(null);
  let currentShell = $state<string | null>(null);
  let fitRaf: number | null = null;
  let fitTimer: ReturnType<typeof setTimeout> | null = null;

  // Role picker state
  let rolePickerOpen = $state(false);
  let customRoleInput = $state('');

  const ROLE_PRESETS = [
    { label: 'Server', color: '#4ade80' },
    { label: 'Tests',  color: '#60a5fa' },
    { label: 'Build',  color: '#fb923c' },
    { label: 'Agent',  color: '#a78bfa' },
    { label: 'Git',    color: '#fbbf24' },
  ] as const;

  function getRoleColor(role: string | null | undefined): string {
    if (!role) return 'transparent';
    const preset = ROLE_PRESETS.find((r) => r.label === role);
    return preset ? preset.color : '#9ca3af';
  }

  function openRolePicker(e: MouseEvent) {
    e.stopPropagation();
    customRoleInput = sessionInfo?.role && !ROLE_PRESETS.some((r) => r.label === sessionInfo.role)
      ? sessionInfo.role
      : '';
    rolePickerOpen = !rolePickerOpen;
  }

  function selectRole(role: string | null) {
    setSessionRole(sessionId, role);
    rolePickerOpen = false;
  }

  function applyCustomRole() {
    const trimmed = customRoleInput.trim();
    setSessionRole(sessionId, trimmed || null);
    rolePickerOpen = false;
  }

  function handleRolePickerKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { rolePickerOpen = false; e.stopPropagation(); }
    if (e.key === 'Enter') { applyCustomRole(); e.stopPropagation(); }
  }

  // Dev server URL detection — fires once per unique URL per pane session
  const seenDevUrls = new Set<string>();

  // Build process detection — fires once per pane session
  let seenBuild = false;
  // Matches common build tool output across webpack, Vite, Rollup, esbuild, tsc,
  // Cargo, Maven, Gradle, Next.js, and generic "compiling/bundling" messages.
  const BUILD_PATTERN = /\b(compiling|bundling|transpiling)\b|creating an optimized production build|\bbuild success\b|compiled successfully|successfully compiled|\bwebpack\b.*\bcompi|\bbundled\b|\brollup\b/i;

  function detectBuildProcess(text: string) {
    if (seenBuild) return;
    const info = get(sessions).find((s) => s.id === sessionId);
    if (info?.role) return; // don't override an already-set role
    if (!BUILD_PATTERN.test(text)) return;
    seenBuild = true;
    setSessionRole(sessionId, 'Build');
  }

  // Agent attention detection — fires when an agent pauses waiting for the user.
  // Only active on terminals with an agentPreset. Rate-limited to avoid spam.
  let lastAgentAttentionAt = 0;
  const AGENT_ATTENTION_COOLDOWN = 12_000;
  // Patterns that indicate an AI agent is waiting for user input or confirmation.
  const AGENT_ATTENTION_PATTERN =
    /\[y\/n\]|\[Y\/n\]|\[n\/Y\]|\(y\/n\)|\(Y\/n\)|\(yes\/no\)|\[yes\/no\]|do you want to|would you like to|shall i\b|please (confirm|review|choose|select)|press enter to continue|awaiting (your )?input|waiting for (your )?response|needs? your (input|attention|review)/i;

  function detectAgentNeedsAttention(text: string) {
    const info = get(sessions).find((s) => s.id === sessionId);
    if (!info?.agentPreset) return;
    if (!AGENT_ATTENTION_PATTERN.test(text)) return;
    const now = Date.now();
    if (now - lastAgentAttentionAt < AGENT_ATTENTION_COOLDOWN) return;
    lastAgentAttentionAt = now;
    const label = getSessionLabel(info, get(sessions));
    showToast(
      `${label} is waiting for your response`,
      'warning',
      10000,
      true,
      { label: 'Focus', onClick: () => { activateSessionInPane(sessionId); setActiveView('terminal'); } }
    );
  }

  function detectDevServerUrl(text: string) {
    const matches = text.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g);
    if (!matches) return;
    for (const url of matches) {
      if (seenDevUrls.has(url)) continue;
      if (url === get(currentUrl)) continue;
      seenDevUrls.add(url);
      const portMatch = url.match(/:(\d+)$/);
      const port = portMatch ? Number(portMatch[1]) : 80;
      // Auto-label this pane as "Server" if it has no role yet
      const info = get(sessions).find((s) => s.id === sessionId);
      if (!info?.role) setSessionRole(sessionId, 'Server');
      showToast(
        `Dev server on port ${port}`,
        'info',
        8000,
        false,
        { label: 'Open Preview', onClick: () => openUrlInPreview(url) }
      );
    }
  }

  // Minimum terminal dimensions — prevents degenerate atlas state when pane is dragged tiny.
  // Below these values xterm bakes glyphs at wrong cell sizes, corrupting the atlas for future resizes.
  const MIN_COLS = 10;
  const MIN_ROWS = 3;
  const isWindowsHost = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');
  const windowsPty = isWindowsHost ? { backend: 'conpty' as const, buildNumber: 22000 } : undefined;

  function forceRedraw() {
    if (!term) return;
    try {
      term.clearTextureAtlas?.();
      term.refresh(0, term.rows - 1);
    } catch {}
  }

  function waitForOpenDimensions(target: HTMLDivElement) {
    return new Promise<void>((resolve) => {
      if (target.clientWidth > 0 && target.clientHeight > 0) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        resolve();
      };
      const observer = new ResizeObserver(() => {
        if (target.clientWidth > 0 && target.clientHeight > 0) finish();
      });
      observer.observe(target);
      setTimeout(finish, 250);
    });
  }

  function doFit() {
    if (!container || !fitAddon || !term) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    try {
      // Check proposed dimensions BEFORE resizing — skip if pane is too small to produce a
      // valid atlas. This prevents the degenerate small→large texture corruption.
      const dims = fitAddon.proposeDimensions();
      if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) return;

      fitAddon.fit();

      // Flush stale glyph cache immediately — cell pixel size changes with every col/row change.
      term.clearTextureAtlas?.();
      term.refresh(0, term.rows - 1);

      // Second pass after one settled frame — canvas addon needs an extra cycle after dimension
      // change before its internal draw state is correct.
      setTimeout(() => {
        if (!term) return;
        term.clearTextureAtlas?.();
        term.refresh(0, term.rows - 1);
      }, 60);
    } catch {}
  }

  // Debounced fit: waits 120 ms of silence before measuring.
  // Prevents doFit from running 60x/s during drag, which corrupts xterm's render pipeline.
  function scheduleFit() {
    if (fitRaf !== null) { cancelAnimationFrame(fitRaf); fitRaf = null; }
    if (fitTimer !== null) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      fitTimer = null;
      fitRaf = requestAnimationFrame(() => {
        fitRaf = null;
        doFit();
      });
    }, 120);
  }

  async function fitAfterFonts() {
    try { await document.fonts.ready; } catch {}
    doFit();
    setTimeout(doFit, 100);
  }

  let sessionInfo = $derived($sessions.find((s) => s.id === sessionId));
  let promptPath = $derived((() => {
    const activePath = currentShellCwd || $activeProject?.root_path;
    if (!activePath) return 'shell';
    const projectRoot = $activeProject?.root_path;
    if (projectRoot && activePath.startsWith(projectRoot)) {
      let relative = activePath.slice(projectRoot.length).replace(/^[/\\]+/, '');
      const rootName = projectRoot.split(/[/\\]/).pop() || 'shell';
      return relative ? `${rootName}/${relative.replace(/\\/g, '/')}` : rootName;
    }
    const parts = activePath.replace(/[/\\]$/, '').split(/[/\\]/);
    return parts[parts.length - 1] || 'shell';
  })());
  let sessionLabel = $derived(sessionInfo ? getSessionLabel(sessionInfo, $sessions) : promptPath);
  let isDead = $derived(sessionInfo ? !sessionInfo.isRunning : false);
  let isLightTheme = $derived($activeTheme?.type === 'light');

  function copyTerminalPath(e: MouseEvent) {
    e.stopPropagation();
    const activePath = currentShellCwd || $activeProject?.root_path;
    if (activePath) {
      navigator.clipboard.writeText(activePath).then(() => {
        showToast(`Copied: ${activePath}`, 'success');
      });
    }
  }

  function isLocalPreviewUrl(url: URL) {
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(url.hostname) ||
      /^(172\.(1[6-9]|2\d|3[0-1]))\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
    );
  }

  async function openUrlInPreview(rawUrl: string) {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    let parsed: URL;
    try { parsed = new URL(trimmed); } catch { return; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    if (isLocalPreviewUrl(parsed) && parsed.port) {
      await clearProxyTarget();
      const port = Number(parsed.port);
      if (Number.isFinite(port) && port > 0 && port <= 65535) {
        await setPreferredLocalHost(parsed.hostname);
        await setTargetPort(port);
      }
    } else {
      await setPreferredLocalHost(null);
    }
    await ensureProxyRunning();
    currentUrl.set(parsed.toString());
    setActiveView('preview');
  }

  function handleTerminalLinkMouseDown(event: MouseEvent) {
    if (!hoveredTerminalLink || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    term?.clearSelection();
  }

  function handleTerminalLinkMouseUp(event: MouseEvent) {
    if (!hoveredTerminalLink || event.button !== 0) return;
    const uri = hoveredTerminalLink;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    term?.clearSelection();
    openUrlInPreview(uri).catch(console.error);
  }

  function parseOSC7Sequence(text: string) {
    const match = text.match(/\]7;file:\/\/[^\/]+([^]+)/);
    if (match && match[1]) {
      let rawPath = match[1];
      if (rawPath.startsWith('/') && rawPath.charAt(2) === ':') rawPath = rawPath.slice(1);
      currentShellCwd = decodeURIComponent(rawPath);
      setSessionCwd(sessionId, currentShellCwd);
    }
  }

  function clearTerminal() {
    term?.clear();
    term?.focus();
  }

  function isSessionExecutingNow(id: number) {
    return get(sessions).find((session) => session.id === id)?.isExecuting ?? false;
  }

  async function restartSession() {
    const paneIdx = $paneAssignments.indexOf(sessionId);
    const cwd = currentShellCwd || $activeProject?.root_path;
    clearTerminal();
    if (paneIdx === -1) return;
    await killSession(sessionId);
    await createTerminalSession(cwd, paneIdx);
  }

  async function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (term?.hasSelection()) {
      try {
        await navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        showToast('Copied to clipboard', 'info');
      } catch {}
    } else {
      try {
        const text = await navigator.clipboard.readText();
        if (text) writeToSession(sessionId, text);
      } catch {}
    }
  }

  $effect(() => {
    const configuredShell = $terminalShell || '';
    if (currentShell === null) { currentShell = configuredShell; return; }
    if (currentShell !== configuredShell) {
      currentShell = configuredShell;
      restartSession();
    }
  });

  $effect(() => {
    if (fitAddon) {
      scheduleFit();
      if ((isActive || isMaximized) && $layout.activeView === 'terminal') {
        requestAnimationFrame(() => term?.focus());
      }
    }
  });

  // When this pane becomes active, flush any stale atlas state accumulated while idle.
  // Covers the case where an inactive pane's canvas drifts while another pane was focused.
  $effect(() => {
    if (isActive && term) {
      requestAnimationFrame(() => forceRedraw());
    }
  });

  onMount(() => {
    const initialColors = $activeTheme?.colors || {};
    const initialSyntax = $activeTheme?.syntax || {};
    const isLight = $activeTheme?.type === 'light';

    term = new Terminal({
      cursorBlink: true,
      cursorStyle: $terminalCursorStyle,
      allowTransparency: false,
      scrollback: $terminalScrollback,
      fontSize: $terminalFontSize,
      fontFamily: $resolvedFontFamily,
      windowsPty,
      theme: {
        background: initialColors['editor-bg'] || initialColors['bg-primary'] || (isLight ? '#ffffff' : '#111116'),
        foreground: initialColors['text-primary'] || (isLight ? '#1f2328' : '#e6edf3'),
        cursor: initialColors['accent'] || (isLight ? '#0f766e' : '#7c6af7'),
        cursorAccent: initialColors['editor-bg'] || initialColors['bg-primary'] || (isLight ? '#ffffff' : '#1a1a1f'),
        selectionBackground: initialColors['selection-bg'] || (isLight ? 'rgba(15,118,110,0.2)' : 'rgba(124,106,247,0.3)'),
        black: isLight ? '#1f2328' : (initialColors['bg-tertiary'] || '#484f58'),
        red: initialColors['error'] || (isLight ? '#cf222e' : '#f85149'),
        green: initialColors['success'] || (isLight ? '#1a7f37' : '#4ade80'),
        yellow: initialColors['warning'] || (isLight ? '#9a6700' : '#fbbf24'),
        blue: initialColors['accent'] || (isLight ? '#0969da' : '#7c6af7'),
        magenta: initialSyntax['function'] || (isLight ? '#8250df' : '#d2a8ff'),
        cyan: initialSyntax['constant'] || (isLight ? '#0598bc' : '#39d2c0'),
        white: isLight ? '#eaeef2' : (initialColors['text-primary'] || '#e6edf3'),
        brightBlack: initialColors['text-muted'] || (isLight ? '#656d76' : '#6e7681'),
        brightRed: initialSyntax['keyword'] || (isLight ? '#cf222e' : '#ff7b72'),
        brightGreen: initialColors['success'] || (isLight ? '#1a7f37' : '#4ade80'),
        brightYellow: initialColors['warning'] || (isLight ? '#9a6700' : '#fbbf24'),
        brightBlue: initialColors['accent-hover'] || (isLight ? '#218bff' : '#9585ff'),
        brightMagenta: initialSyntax['function'] || (isLight ? '#8250df' : '#d2a8ff'),
        brightCyan: initialSyntax['constant'] || (isLight ? '#0598bc' : '#39d2c0'),
        brightWhite: isLight ? '#ffffff' : (initialColors['text-primary'] || '#ffffff'),
      },
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon((event: MouseEvent, uri: string) => {
      event.preventDefault();
      event.stopPropagation();
      term?.clearSelection();
      openUrlInPreview(uri).catch(console.error);
    }, {
      hover: (_event: any, uri: string) => { hoveredTerminalLink = uri; },
      leave: () => { hoveredTerminalLink = null; },
    }));

    let disposed = false;
    let executingTimeout: any = null;
    const decoder = new TextDecoder();

    void (async () => {
      await waitForOpenDimensions(container);
      if (disposed || !term) return;

      term.open(container);
      container.addEventListener('mousedown', handleTerminalLinkMouseDown, true);
      container.addEventListener('mouseup', handleTerminalLinkMouseUp, true);

      // Double rAF lets flex layout settle, then wait for fonts for accurate glyph metrics
      requestAnimationFrame(() => requestAnimationFrame(() => fitAfterFonts()));

      term.onData((data: string) => writeToSession(sessionId, data));
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => resizeSession(sessionId, rows, cols));
      term.onKey(() => onActivate());

      registerDataCallback(sessionId, (bytes: Uint8Array) => {
        term?.write(bytes);
        try {
          const text = decoder.decode(bytes);
          parseOSC7Sequence(text);
          detectDevServerUrl(text);
          detectBuildProcess(text);
          detectAgentNeedsAttention(text);
          if (isSessionExecutingNow(sessionId)) appendToCommandBlock(sessionId, text);
        } catch {}
        if (executingTimeout) clearTimeout(executingTimeout);
        executingTimeout = setTimeout(() => {
          if (isSessionExecutingNow(sessionId)) {
            setSessionExecuting(sessionId, false);
            finalizeCommandBlock(sessionId);
          }
        }, 800);
      });

      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(container);
    })();

    // After drag ends, cancel any pending debounce and fit immediately
    function onResizeEnd() {
      if (fitTimer !== null) { clearTimeout(fitTimer); fitTimer = null; }
      if (fitRaf !== null) { cancelAnimationFrame(fitRaf); fitRaf = null; }
      fitRaf = requestAnimationFrame(() => { fitRaf = null; doFit(); });
    }
    document.addEventListener('pane-resize-end', onResizeEnd);

    // Recover from idle rendering corruption: when the window/tab regains visibility after
    // being hidden (e.g., user switches away and back), the WebView2 GPU scheduler may have
    // evicted canvas textures. Force a full atlas flush on all panes.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        requestAnimationFrame(() => {
          forceRedraw();
          // Second pass after layout settles
          setTimeout(forceRedraw, 80);
        });
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Paste element context from the web preview inspector into this terminal pane
    const unsubInput = terminalInputRequest.subscribe((req) => {
      if (req && req.sessionId === sessionId && term) {
        term.paste(req.text);
        terminalInputRequest.set(null);
      }
    });

    return () => {
      disposed = true;
      if (executingTimeout) clearTimeout(executingTimeout);
      document.removeEventListener('pane-resize-end', onResizeEnd);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubInput();
    };
  });

  onDestroy(() => {
    if (fitRaf !== null) cancelAnimationFrame(fitRaf);
    if (fitTimer !== null) clearTimeout(fitTimer);
    resizeObserver?.disconnect();
    container?.removeEventListener('mousedown', handleTerminalLinkMouseDown, true);
    container?.removeEventListener('mouseup', handleTerminalLinkMouseUp, true);
    unregisterDataCallback(sessionId);
    term?.dispose();
  });

  $effect(() => {
    if (term) {
      term.options.fontFamily = $resolvedFontFamily;
      term.options.fontSize = $terminalFontSize;
      term.options.cursorStyle = $terminalCursorStyle;
      term.options.scrollback = $terminalScrollback;
      term.options.windowsPty = windowsPty;
      scheduleFit();
    }
  });

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
        selectionBackground: colors['selection-bg'] || (isLight ? 'rgba(15,118,110,0.2)' : 'rgba(124,106,247,0.3)'),
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
  class:maximized={isMaximized}
  bind:this={paneEl}
  onclick={onActivate}
  oncontextmenu={handleContextMenu}
>
  {#if onResizeLeft}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pane-resize-handle pane-resize-left" onmousedown={(e) => { e.stopPropagation(); onResizeLeft(e); }}></div>
  {/if}
  {#if onResizeRight}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pane-resize-handle pane-resize-right" onmousedown={(e) => { e.stopPropagation(); onResizeRight(e); }}></div>
  {/if}
  {#if onResizeTop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pane-resize-handle pane-resize-top" onmousedown={(e) => { e.stopPropagation(); onResizeTop(e); }}></div>
  {/if}
  {#if onResizeBottom}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="pane-resize-handle pane-resize-bottom" onmousedown={(e) => { e.stopPropagation(); onResizeBottom(e); }}></div>
  {/if}
  <!-- Pane title bar with role picker -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="pane-titlebar" onclick={() => { if (rolePickerOpen) rolePickerOpen = false; }}>
    <!-- Close button on the left -->
    <button
      class="pane-close-btn"
      onclick={(e) => { e.stopPropagation(); onClose(); }}
      title="Close pane"
    >
      <svg width="9" height="9" viewBox="0 0 9 9">
        <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </button>

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="pane-title" onclick={openRolePicker} title="Click to set role">
      {#if sessionInfo?.role}
        <span class="role-dot" style="background: {getRoleColor(sessionInfo.role)}"></span>
        {sessionLabel}
      {:else}
        {sessionInfo?.title ?? promptPath}
      {/if}
    </span>

    <!-- Running indicator dot -->
    <span class="pane-status-dot" class:running={!isDead}></span>

    <!-- Maximize / Restore button -->
    {#if onMaximize}
      <button
        class="pane-maximize-btn"
        onclick={(e) => { e.stopPropagation(); onMaximize(); }}
        title={isMaximized ? 'Restore pane' : 'Maximize pane'}
      >
        {#if isMaximized}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20"/>
            <polyline points="20 10 14 10 14 4"/>
            <line x1="10" y1="14" x2="3" y2="21"/>
            <line x1="21" y1="3" x2="14" y2="10"/>
          </svg>
        {:else}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"/>
            <polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/>
            <line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        {/if}
      </button>
    {/if}
  </div>

  <!-- Role picker popover -->
  {#if rolePickerOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="role-picker" onclick={(e) => e.stopPropagation()}>
      <div class="role-chips">
        {#each ROLE_PRESETS as preset}
          <button
            class="role-chip"
            class:active={sessionInfo?.role === preset.label}
            onclick={() => selectRole(preset.label)}
          >
            <span class="role-dot" style="background: {preset.color}"></span>
            {preset.label}
          </button>
        {/each}
        {#if sessionInfo?.role}
          <button class="role-chip role-chip-clear" onclick={() => selectRole(null)}>
            Clear
          </button>
        {/if}
      </div>
      <div class="role-custom-row">
        <input
          class="role-custom-input"
          type="text"
          placeholder="Custom label…"
          bind:value={customRoleInput}
          onkeydown={handleRolePickerKey}
        />
        <button class="role-custom-apply" onclick={applyCustomRole}>Set</button>
      </div>
    </div>
  {/if}

  <!-- xterm.js fills all remaining space — click and type directly -->
  <div class="xterm-container" bind:this={container}></div>
</div>

<style>
  .terminal-pane {
    display: flex;
    flex-direction: column;
    background: var(--editor-bg, var(--bg-primary));
    overflow: hidden;
    position: relative;
    border: 1.5px solid transparent;
    transition: border-color 0.15s;
  }

  .terminal-pane.active {
    border-color: var(--accent-light);
  }

  .terminal-pane.dead {
    opacity: 0.55;
  }

  .terminal-pane.maximized {
    position: absolute;
    inset: 0;
    z-index: 20;
    border-color: var(--accent);
  }

  /* ── Plain title bar ── */
  .pane-titlebar {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 28px;
    padding: 0 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .pane-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .pane-titlebar:hover .pane-close-btn {
    opacity: 1;
  }

  .pane-close-btn:hover {
    background: rgba(239, 68, 68, 0.14);
    color: var(--error);
  }

  .pane-maximize-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--text-secondary, #888);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0.35;
    transition: opacity 0.15s, background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .pane-titlebar:hover .pane-maximize-btn {
    opacity: 1;
    color: var(--text-primary, #ccc);
  }

  .terminal-pane.maximized .pane-maximize-btn {
    opacity: 1;
    color: var(--accent, #7c6af7);
  }

  .pane-maximize-btn:hover {
    background: var(--bg-hover, rgba(128,128,128,0.15));
    color: var(--text-primary, #fff);
    opacity: 1;
  }

  /* ── Pane title ── */
  .pane-title {
    flex: 1;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.15s;
  }

  .terminal-pane.active .pane-title {
    color: var(--text-secondary);
  }

  .pane-title:hover {
    color: var(--text-primary);
  }

  .pane-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.3;
    flex-shrink: 0;
    transition: background 0.2s, opacity 0.2s;
  }

  .pane-status-dot.running {
    background: var(--success);
    opacity: 1;
  }

  /* ── xterm container ── */
  .xterm-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    padding: 6px 6px 8px 6px;
  }

  .xterm-container :global(.xterm) {
    height: 100%;
    width: 100%;
  }

  .xterm-container :global(.xterm-screen) {
    height: 100%;
  }

  .xterm-container :global(.xterm-viewport) {
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
    background-color: transparent !important;
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

  /* ── Per-pane resize handles ── */
  .pane-resize-handle {
    position: absolute;
    z-index: 15;
    transition: background 0.15s;
  }

  .pane-resize-left,
  .pane-resize-right {
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
  }

  .pane-resize-left { left: 0; }
  .pane-resize-right { right: 0; }

  .pane-resize-top,
  .pane-resize-bottom {
    left: 0;
    right: 0;
    height: 6px;
    cursor: row-resize;
  }

  .pane-resize-top { top: 0; }
  .pane-resize-bottom { bottom: 0; }

  .pane-resize-handle:hover {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  /* ── Role dot inline with title ── */
  .role-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-right: 5px;
    flex-shrink: 0;
    vertical-align: middle;
    position: relative;
    top: -1px;
  }

  /* ── Role picker popover ── */
  .role-picker {
    position: absolute;
    top: 29px;
    left: 8px;
    z-index: 50;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    min-width: 200px;
  }

  .role-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .role-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .role-chip:hover {
    background: var(--bg-hover, rgba(128,128,128,0.15));
    color: var(--text-primary);
    border-color: var(--border-hover, var(--accent-light));
  }

  .role-chip.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--text-primary);
  }

  .role-chip-clear {
    color: var(--text-muted);
    font-style: italic;
  }

  .role-custom-row {
    display: flex;
    gap: 4px;
  }

  .role-custom-input {
    flex: 1;
    padding: 3px 7px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-primary);
    font-size: 11px;
    outline: none;
    transition: border-color 0.12s;
  }

  .role-custom-input:focus {
    border-color: var(--accent);
  }

  .role-custom-apply {
    padding: 3px 10px;
    background: var(--accent);
    border: none;
    border-radius: 5px;
    color: #fff;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.12s;
  }

  .role-custom-apply:hover {
    opacity: 0.85;
  }
</style>
