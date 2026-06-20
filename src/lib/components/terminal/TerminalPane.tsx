import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { get } from '$lib/stores/storeCompat';
import { Terminal } from '@xterm/xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  writeToSession,
  registerDataCallback,
  registerExitCallback,
  unregisterDataCallback,
  unregisterExitCallback,
  getSessionOutputBuffer,
  resizeSession,
  sessions,
  killSession,
  setSessionExecuting,
  setSessionRole,
  setSessionCwd,
  applyOscPaneTitle,
  appendToCommandBlock,
  finalizeCommandBlockWithExit,
  paneAssignments,
  createTerminalSession,
  terminalInputRequest,
  getSessionLabel,
  getAgentDisplayName,
  getSessionPaneDisplayTitle,
  getSessionPaneSecondaryTitle,
  activateSessionInPane,
} from '$lib/stores/terminal';
import {
  terminalFontSize,
  terminalCursorStyle,
  terminalScrollback,
  resolvedFontFamily,
  terminalShell,
  terminalRenderer,
} from '$lib/stores/settings';
import { activeTheme } from '$lib/stores/theme';
import { setActiveView, showTerminal } from '$lib/stores/layout';
import { activeProject } from '$lib/stores/workspace';
import { clearProxyTarget, currentUrl, ensureProxyRunning, setPreferredLocalHost, setTargetPort } from '$lib/stores/preview';
import { showToast } from '$lib/stores/notification';
import { appendRunOutput, finalizeRunEntry, activeRunIds } from '$lib/stores/runHistory';
import { AGENT_ATTENTION_PATTERN } from '$lib/services/orchestrator/agent-signals';
import { useStore } from '$lib/react/useStore';
import './TerminalPane.css';

const ROLE_PRESETS = [
  { label: 'Server', color: '#4ade80' },
  { label: 'Tests', color: '#60a5fa' },
  { label: 'Build', color: '#fb923c' },
  { label: 'Agent', color: '#a78bfa' },
  { label: 'Git', color: '#fbbf24' },
] as const;

function getRoleColor(role: string | null | undefined): string {
  if (!role) return 'transparent';
  const preset = ROLE_PRESETS.find((r) => r.label === role);
  return preset ? preset.color : '#9ca3af';
}

// Minimum terminal dimensions — prevents degenerate atlas state when pane is dragged tiny.
// Below these values xterm bakes glyphs at wrong cell sizes, corrupting the atlas for future resizes.
const MIN_COLS = 10;
const MIN_ROWS = 3;
const isWindowsHost = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

let cachedWindowsBuild: number | null = null;
let hasCheckedPowerShell7 = false;

// Build process detection — fires once per pane session.
// Matches common build tool output across webpack, Vite, Rollup, esbuild, tsc,
// Cargo, Maven, Gradle, Next.js, and generic "compiling/bundling" messages.
const BUILD_PATTERN = /\b(compiling|bundling|transpiling)\b|creating an optimized production build|\bbuild success\b|compiled successfully|successfully compiled|\bwebpack\b.*\bcompi|\bbundled\b|\brollup\b/i;

// Agent attention detection rate limit — fires when an agent pauses waiting for the user.
const AGENT_ATTENTION_COOLDOWN = 12_000;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePaneTitle(title: string) {
  return title.replace(/\s+/g, ' ').trim();
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
  try {
    parsed = new URL(trimmed);
  } catch {
    return;
  }
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

function isSessionExecutingNow(id: number) {
  return get(sessions).find((session) => session.id === id)?.isExecuting ?? false;
}

export default function TerminalPane({
  sessionId,
  paneIndex,
  isActive,
  isMaximized = false,
  onActivate,
  onClose,
  onMaximize,
  onPaneDragStart,
  onResizeLeft,
  onResizeRight,
  onResizeTop,
  onResizeBottom,
}: {
  sessionId: number;
  paneIndex: number;
  isActive: boolean;
  isMaximized?: boolean;
  onActivate: () => void;
  onClose: () => void;
  onMaximize?: () => void;
  onPaneDragStart?: (paneIndex: number, e: React.MouseEvent) => void;
  onResizeLeft?: (e: React.MouseEvent) => void;
  onResizeRight?: (e: React.MouseEvent) => void;
  onResizeTop?: (e: React.MouseEvent) => void;
  onResizeBottom?: (e: React.MouseEvent) => void;
}) {
  const allSessions = useStore(sessions);
  const activeThemeValue = useStore(activeTheme);
  const fontFamily = useStore(resolvedFontFamily);
  const fontSize = useStore(terminalFontSize);
  const cursorStyle = useStore(terminalCursorStyle);
  const scrollback = useStore(terminalScrollback);
  const configuredShell = useStore(terminalShell);
  const renderer = useStore(terminalRenderer);
  const project = useStore(activeProject);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const canvasAddonRef = useRef<CanvasAddon | null>(null);
  const hoveredTerminalLinkRef = useRef<string | null>(null);
  const oscSequenceRemainderRef = useRef('');
  const fitRafRef = useRef<number | null>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentShellRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);
  const seenDevUrlsRef = useRef<Set<string>>(new Set());
  const seenBuildRef = useRef(false);
  const lastAgentAttentionAtRef = useRef(0);

  const [currentShellCwd, setCurrentShellCwd] = useState<string | null>(null);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [customRoleInput, setCustomRoleInput] = useState('');

  const [windowsBuild, setWindowsBuild] = useState<number | null>(cachedWindowsBuild);

  const windowsPty = useMemo(() => {
    if (!isWindowsHost) return undefined;
    return {
      backend: 'conpty' as const,
      buildNumber: windowsBuild ?? 22000,
    };
  }, [windowsBuild]);

  const sessionInfo = allSessions.find((s) => s.id === sessionId);

  const promptPath = useMemo(() => {
    const activePath = currentShellCwd || project?.root_path;
    if (!activePath) return 'shell';
    const projectRoot = project?.root_path;
    if (projectRoot && activePath.startsWith(projectRoot)) {
      const relative = activePath.slice(projectRoot.length).replace(/^[/\\]+/, '');
      const rootName = projectRoot.split(/[/\\]/).pop() || 'shell';
      return relative ? `${rootName}/${relative.replace(/\\/g, '/')}` : rootName;
    }
    const parts = activePath.replace(/[/\\]$/, '').split(/[/\\]/);
    return parts[parts.length - 1] || 'shell';
  }, [currentShellCwd, project?.root_path]);

  const sessionLabel = sessionInfo ? getSessionLabel(sessionInfo, allSessions) : promptPath;
  // Badge shows the orchestrator-assigned assistant name (e.g. "Iris"), falling
  // back to the agent CLI's product name. The main title is driven by the CLI's
  // OSC title (what it reports it's doing) — the two no longer share a field, so
  // both stay visible at once.
  const agentName = sessionInfo?.agentName?.trim() || getAgentDisplayName(sessionInfo?.agentPreset);
  const paneTitleText = sessionInfo ? getSessionPaneDisplayTitle(sessionInfo, allSessions) : promptPath;
  const paneSecondaryText = sessionInfo ? getSessionPaneSecondaryTitle(sessionInfo) : '';
  const isDead = sessionInfo ? !sessionInfo.isRunning : false;
  const isLightTheme = activeThemeValue?.type === 'light';

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // Pointer-based drag to reposition. Native HTML5 DnD is unreliable inside the
  // Tauri webview (it fights the OS file-drop handler), so the parent panel drives
  // the drag from a plain mousedown on the titlebar — matching the file explorer.
  function handleTitlebarMouseDown(e: React.MouseEvent) {
    if (e.button !== 0 || !onPaneDragStart) return;
    // Let the close / maximize buttons handle their own clicks.
    if ((e.target as HTMLElement).closest('button')) return;
    onPaneDragStart(paneIndex, e);
  }

  function openRolePicker(e: React.MouseEvent) {
    e.stopPropagation();
    setCustomRoleInput(
      sessionInfo?.role && !ROLE_PRESETS.some((r) => r.label === sessionInfo.role) ? sessionInfo.role : '',
    );
    setRolePickerOpen((open) => !open);
  }

  function selectRole(role: string | null) {
    setSessionRole(sessionId, role);
    setRolePickerOpen(false);
  }

  function applyCustomRole() {
    const trimmed = customRoleInput.trim();
    setSessionRole(sessionId, trimmed || null);
    setRolePickerOpen(false);
  }

  function handleRolePickerKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setRolePickerOpen(false);
      e.stopPropagation();
    }
    if (e.key === 'Enter') {
      applyCustomRole();
      e.stopPropagation();
    }
  }

  function detectBuildProcess(text: string) {
    if (seenBuildRef.current) return;
    const info = get(sessions).find((s) => s.id === sessionId);
    if (info?.role) return; // don't override an already-set role
    if (!BUILD_PATTERN.test(text)) return;
    seenBuildRef.current = true;
    setSessionRole(sessionId, 'Build');
  }

  function detectAgentNeedsAttention(text: string) {
    const info = get(sessions).find((s) => s.id === sessionId);
    if (!info?.agentPreset) return;
    if (!AGENT_ATTENTION_PATTERN.test(text)) return;
    const now = Date.now();
    if (now - lastAgentAttentionAtRef.current < AGENT_ATTENTION_COOLDOWN) return;
    lastAgentAttentionAtRef.current = now;
    const label = getSessionLabel(info, get(sessions));
    showToast(`${label} is waiting for your response`, 'warning', 10000, true, {
      label: 'Focus',
      onClick: () => {
        activateSessionInPane(sessionId);
        showTerminal();
      },
    });
  }

  function detectDevServerUrl(text: string) {
    const matches = text.match(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/g);
    if (!matches) return;
    for (const url of matches) {
      if (seenDevUrlsRef.current.has(url)) continue;
      if (url === get(currentUrl)) continue;
      seenDevUrlsRef.current.add(url);
      const portMatch = url.match(/:(\d+)$/);
      const port = portMatch ? Number(portMatch[1]) : 80;
      // Auto-label this pane as "Server" if it has no role yet
      const info = get(sessions).find((s) => s.id === sessionId);
      if (!info?.role) setSessionRole(sessionId, 'Server');
      showToast(`Dev server on port ${port}`, 'info', 8000, false, {
        label: 'Open Preview',
        onClick: () => openUrlInPreview(url),
      });
    }
  }

  function forceRedraw() {
    const term = termRef.current;
    if (!term) return;
    try {
      (term as any).clearTextureAtlas?.();
      canvasAddonRef.current?.clearTextureAtlas();
      term.refresh(0, term.rows - 1);
    } catch {}
  }

  function applyTerminalRenderer() {
    const term = termRef.current;
    if (!term) return;

    if (renderer === 'canvas') {
      if (canvasAddonRef.current) return;
      try {
        const canvasAddon = new CanvasAddon();
        canvasAddonRef.current = canvasAddon;
        term.loadAddon(canvasAddon);
      } catch (error) {
        console.error('Failed to enable canvas terminal renderer', error);
        canvasAddonRef.current?.dispose();
        canvasAddonRef.current = null;
        terminalRenderer.set('dom');
        showToast('Canvas renderer unavailable; using DOM renderer.', 'warning');
        return;
      }
    } else if (canvasAddonRef.current) {
      canvasAddonRef.current.dispose();
      canvasAddonRef.current = null;
    }

    scheduleFit();
    requestAnimationFrame(() => forceRedraw());
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
    const container = containerRef.current;
    const fitAddon = fitAddonRef.current;
    const term = termRef.current;
    if (!container || !fitAddon || !term) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    try {
      // Check proposed dimensions BEFORE resizing — skip if pane is too small to produce a
      // valid atlas. This prevents the degenerate small→large texture corruption.
      const dims = fitAddon.proposeDimensions();
      if (!dims || dims.cols < MIN_COLS || dims.rows < MIN_ROWS) return;

      fitAddon.fit();

      // Flush stale glyph cache immediately — cell pixel size changes with every col/row change.
      (term as any).clearTextureAtlas?.();
      term.refresh(0, term.rows - 1);

      // Second pass after one settled frame — canvas addon needs an extra cycle after dimension
      // change before its internal draw state is correct.
      setTimeout(() => {
        const t = termRef.current;
        if (!t) return;
        (t as any).clearTextureAtlas?.();
        t.refresh(0, t.rows - 1);
      }, 60);
    } catch {}
  }

  // Debounced fit: waits 120 ms of silence before measuring.
  // Prevents doFit from running 60x/s during drag, which corrupts xterm's render pipeline.
  function scheduleFit() {
    if (fitRafRef.current !== null) {
      cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = null;
    }
    if (fitTimerRef.current !== null) clearTimeout(fitTimerRef.current);
    fitTimerRef.current = setTimeout(() => {
      fitTimerRef.current = null;
      fitRafRef.current = requestAnimationFrame(() => {
        fitRafRef.current = null;
        doFit();
      });
    }, 50);
  }

  async function fitAfterFonts() {
    try {
      await document.fonts.ready;
    } catch {}
    doFit();
    setTimeout(doFit, 100);
  }

  // Force a running full-screen TUI (e.g. the Claude Code agent) to repaint when
  // this pane reattaches to a still-alive session. On a project switch the pane
  // unmounts and its xterm is disposed, but the PTY keeps running; coming back,
  // the fresh xterm fits to the SAME size the PTY already has, so no resize
  // reaches the app and it shows a stale frame until the user drags to resize.
  // We reproduce that manual resize: briefly shrink the PTY by one row, then
  // restore it — a genuine size change the TUI reacts to by redrawing. xterm
  // itself stays at its fitted size, so reverting immediately resyncs the two.
  function forceReattachRepaint() {
    const term = termRef.current;
    if (!term) return;
    const cols = term.cols;
    const rows = term.rows;
    if (!cols || !rows || rows < MIN_ROWS + 1) return;
    resizeSession(sessionId, rows - 1, cols);
    setTimeout(() => {
      const t = termRef.current;
      if (!t) return;
      resizeSession(sessionId, t.rows, t.cols);
    }, 80);
  }

  function copyTerminalPath(e: React.MouseEvent) {
    e.stopPropagation();
    const activePath = currentShellCwd || project?.root_path;
    if (activePath) {
      navigator.clipboard.writeText(activePath).then(() => {
        showToast(`Copied: ${activePath}`, 'success');
      });
    }
  }

  function handleTerminalLinkMouseDown(event: MouseEvent) {
    if (!hoveredTerminalLinkRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    termRef.current?.clearSelection();
  }

  function handleTerminalLinkMouseUp(event: MouseEvent) {
    if (!hoveredTerminalLinkRef.current || event.button !== 0) return;
    const uri = hoveredTerminalLinkRef.current;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    termRef.current?.clearSelection();
    openUrlInPreview(uri).catch(console.error);
  }

  function parseOsc7Path(value: string) {
    const rawValue = value.trim();
    if (!rawValue.startsWith('file://')) return;
    let rawPath = rawValue.replace(/^file:\/\/[^/]+/, '');
    if (!rawPath) return;
    if (rawPath.startsWith('/') && rawPath.charAt(2) === ':') rawPath = rawPath.slice(1);
    const decoded = decodeURIComponent(rawPath);
    setCurrentShellCwd(decoded);
    setSessionCwd(sessionId, decoded);
  }

  function parseOscTitle(value: string, shellCwd: string | null) {
    const info = sessionInfo;
    if (!info?.agentPreset) return;

    const displayName = getAgentDisplayName(info.agentPreset) ?? info.title;
    const activeProjectName = project?.name?.trim() || '';
    const activeProjectRootName =
      project?.root_path?.replace(/[/\\]+$/, '').split(/[/\\]/).pop()?.trim() || '';
    const cwdBaseName = shellCwd?.replace(/[/\\]+$/, '').split(/[/\\]/).pop()?.trim() || '';
    const cleaned = normalizePaneTitle(value)
      .replace(new RegExp(`\\s+[·|-]\\s+${escapeRegExp(displayName)}$`, 'i'), '')
      .trim();

    if (!cleaned) return;

    const genericTitles = new Set(
      [
        info.title,
        info.role,
        sessionLabel,
        agentName,
        displayName,
        promptPath,
        activeProjectName,
        activeProjectRootName,
        cwdBaseName,
      ]
        .filter((entry): entry is string => Boolean(entry?.trim()))
        .map((entry) => entry.trim().toLowerCase()),
    );
    const lowered = cleaned.toLowerCase();

    if (genericTitles.has(lowered)) return;
    if (/^[A-Z]:[\\/]|^\/|^~[\\/]|^file:\/\//i.test(cleaned)) return;
    if (/^(powershell|pwsh|bash|zsh|cmd|fish|nu|nushell)(\.exe)?$/i.test(cleaned)) return;

    applyOscPaneTitle(sessionId, cleaned);
  }

  function parseOscSequences(text: string, shellCwd: string | null) {
    const combined = `${oscSequenceRemainderRef.current}${text}`;
    const pattern = /\x1b\](\d+);(.*?)(?:\x07|\x1b\\)/gs;
    let lastConsumed = 0;

    for (const match of combined.matchAll(pattern)) {
      const full = match[0];
      const code = match[1];
      const value = match[2] ?? '';
      const idx = match.index ?? 0;
      lastConsumed = idx + full.length;

      if (code === '7') {
        parseOsc7Path(value);
      } else if (code === '0' || code === '1' || code === '2') {
        parseOscTitle(value, shellCwd);
      }
    }

    const pendingStart = combined.lastIndexOf('\x1b]');
    oscSequenceRemainderRef.current =
      pendingStart !== -1 && pendingStart >= lastConsumed ? combined.slice(pendingStart).slice(-1024) : '';
  }

  function clearTerminal() {
    termRef.current?.clear();
    termRef.current?.focus();
  }


  async function restartSession() {
    const paneIdx = get(paneAssignments).indexOf(sessionId);
    const cwd = currentShellCwd || project?.root_path;
    clearTerminal();
    if (paneIdx === -1) return;
    await killSession(sessionId);
    await createTerminalSession(cwd, paneIdx);
  }

  async function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const term = termRef.current;
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

  useEffect(() => {
    if (isWindowsHost) {
      if (!hasCheckedPowerShell7) {
        hasCheckedPowerShell7 = true;
        invoke<any[]>('terminal_list_shells')
          .then((shells) => {
            const hasPwsh = shells.some((s) =>
              s.program.toLowerCase().includes('pwsh')
            );
            if (!hasPwsh) {
              showToast(
                'PowerShell 7 (pwsh) is not installed. For the best terminal experience and to avoid resizing display bugs, please install PowerShell 7.',
                'warning',
                8000
              );
            }
          })
          .catch((err) => {
            console.error('Failed to query available shells on startup:', err);
          });
      }

      if (windowsBuild === null) {
        invoke<number>('terminal_get_windows_build')
          .then((build) => {
            cachedWindowsBuild = build;
            setWindowsBuild(build);
          })
          .catch((err) => {
            console.error('Failed to fetch Windows build number:', err);
            setWindowsBuild(22000);
          });
      }
    }
  }, [windowsBuild]);

  // Mount xterm once per session. Mirrors mount/unmount lifecycle:
  // create the Terminal, wire PTY callbacks, observers and listeners, then tear
  // everything down on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialColors = get(activeTheme)?.colors || {};
    const initialSyntax = get(activeTheme)?.syntax || {};
    const isLight = get(activeTheme)?.type === 'light';

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: get(terminalCursorStyle),
      // Transparent terminal so the frosted glass pane (and ambient backdrop)
      // shows through — the premium "Warp" look. DOM renderer handles this for free.
      allowTransparency: true,
      scrollback: get(terminalScrollback),
      fontSize: get(terminalFontSize),
      fontFamily: get(resolvedFontFamily),
      windowsPty,
      theme: {
        background: 'rgba(0, 0, 0, 0)',
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
        // In light mode ANSI white/brightWhite must stay dark, or shell output
        // drawn in those colors (e.g. command tokens) is invisible on the light
        // background. Map them to readable dark tones instead of near-white.
        white: isLight ? '#586069' : (initialColors['text-primary'] || '#e6edf3'),
        brightBlack: initialColors['text-muted'] || (isLight ? '#656d76' : '#6e7681'),
        brightRed: initialSyntax['keyword'] || (isLight ? '#cf222e' : '#ff7b72'),
        brightGreen: initialColors['success'] || (isLight ? '#1a7f37' : '#4ade80'),
        brightYellow: initialColors['warning'] || (isLight ? '#9a6700' : '#fbbf24'),
        brightBlue: initialColors['accent-hover'] || (isLight ? '#218bff' : '#9585ff'),
        brightMagenta: initialSyntax['function'] || (isLight ? '#8250df' : '#d2a8ff'),
        brightCyan: initialSyntax['constant'] || (isLight ? '#0598bc' : '#39d2c0'),
        brightWhite: isLight ? '#24292f' : (initialColors['text-primary'] || '#ffffff'),
      },
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(
      new WebLinksAddon(
        (event: MouseEvent, uri: string) => {
          event.preventDefault();
          event.stopPropagation();
          term.clearSelection();
          openUrlInPreview(uri).catch(console.error);
        },
        {
          hover: (_event: any, uri: string) => {
            hoveredTerminalLinkRef.current = uri;
          },
          leave: () => {
            hoveredTerminalLinkRef.current = null;
          },
        },
      ),
    );

    let disposed = false;
    let executingTimeout: ReturnType<typeof setTimeout> | null = null;
    const decoder = new TextDecoder();
    // True only while the reattach buffer below is being parsed. Replayed history
    // re-feeds the agent's startup color/DA queries (e.g. Codex's ESC]10;?/ESC]11;?),
    // and xterm answers them again — those synthetic replies must NOT be written
    // back to the live PTY (they'd land as `]10;rgb:…` junk in the input box).
    let suppressReplayInput = false;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      await waitForOpenDimensions(container);
      if (disposed) return;

      term.open(container);
      applyTerminalRenderer();
      container.addEventListener('mousedown', handleTerminalLinkMouseDown, true);
      container.addEventListener('mouseup', handleTerminalLinkMouseUp, true);

      const existingBuffer = getSessionOutputBuffer(sessionId);
      // A non-empty buffer means this pane is reattaching to a session that was
      // already running (e.g. after a project switch), so its TUI needs a resize
      // kick to repaint once the fit settles. A fresh session paints on its own.
      const isReattach = !!existingBuffer;
      if (existingBuffer) {
        // Gate outbound data until this historical write finishes parsing, so the
        // re-answered color/DA queries it contains don't leak into the live PTY.
        // The gate MUST never stay stuck `true` — while it is, every keystroke for
        // this session is silently dropped. xterm normally clears it via the write
        // callback once replay finishes parsing, but that callback can be deferred
        // indefinitely when the pane isn't visible/attached yet (a background tab,
        // or reattaching on app open), so a timeout guarantees input is re-enabled.
        suppressReplayInput = true;
        const clearReplayGate = () => {
          suppressReplayInput = false;
        };
        const replayGateTimer = setTimeout(clearReplayGate, 1500);
        term.write(existingBuffer, () => {
          clearTimeout(replayGateTimer);
          clearReplayGate();
        });
      }

      // Double rAF lets the flex mosaic settle (a sibling pane may still be tiling
      // in), THEN wait for fonts for accurate glyph metrics before the first fit.
      // Fitting before the layout settles latches a transient (narrow) size — the
      // bug where the 2nd/3rd agent panes render narrower than their pane.
      requestAnimationFrame(() =>
        requestAnimationFrame(async () => {
          await fitAfterFonts();
          if (isReattach) forceReattachRepaint();
        }),
      );

      term.onData((data: string) => {
        // Drop xterm's synthetic query replies emitted while replaying history (see
        // the reattach buffer write above); genuine keystrokes still pass through.
        if (suppressReplayInput) return;
        writeToSession(sessionId, data);
      });
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => resizeSession(sessionId, rows, cols));
      term.onKey(() => {
        if (!isActiveRef.current) onActivate();
      });

      registerDataCallback(sessionId, (bytes: Uint8Array) => {
        term.write(bytes);
        try {
          const text = decoder.decode(bytes);
          parseOscSequences(text, currentShellCwd);
          detectDevServerUrl(text);
          detectBuildProcess(text);
          detectAgentNeedsAttention(text);
          if (isSessionExecutingNow(sessionId)) {
            appendToCommandBlock(sessionId, text);
            const runId = activeRunIds.get(sessionId);
            if (runId) appendRunOutput(runId, text);
          }
        } catch {}
        if (executingTimeout) clearTimeout(executingTimeout);
        executingTimeout = setTimeout(() => {
          if (isSessionExecutingNow(sessionId)) {
            setSessionExecuting(sessionId, false);
            finalizeCommandBlockWithExit(sessionId, 0);
            const runId = activeRunIds.get(sessionId);
            if (runId) {
              finalizeRunEntry(runId, 0);
              activeRunIds.delete(sessionId);
            }
          }
        }, 800);
      });

      registerExitCallback(sessionId, (code: number) => {
        if (executingTimeout) clearTimeout(executingTimeout);
        setSessionExecuting(sessionId, false);
        finalizeCommandBlockWithExit(sessionId, code);
        const runId = activeRunIds.get(sessionId);
        if (runId) {
          finalizeRunEntry(runId, code);
          activeRunIds.delete(sessionId);
        }
      });

      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(container);
    })();

    // After drag ends, cancel any pending debounce and fit immediately
    function onResizeEnd() {
      if (fitTimerRef.current !== null) {
        clearTimeout(fitTimerRef.current);
        fitTimerRef.current = null;
      }
      if (fitRafRef.current !== null) {
        cancelAnimationFrame(fitRafRef.current);
        fitRafRef.current = null;
      }
      fitRafRef.current = requestAnimationFrame(() => {
        fitRafRef.current = null;
        doFit();
      });
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
      if (req && req.sessionId === sessionId && termRef.current) {
        termRef.current.paste(req.text);
        terminalInputRequest.set(null);
      }
    });

    return () => {
      disposed = true;
      if (executingTimeout) clearTimeout(executingTimeout);
      document.removeEventListener('pane-resize-end', onResizeEnd);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubInput();
      if (fitRafRef.current !== null) cancelAnimationFrame(fitRafRef.current);
      if (fitTimerRef.current !== null) clearTimeout(fitTimerRef.current);
      resizeObserver?.disconnect();
      container.removeEventListener('mousedown', handleTerminalLinkMouseDown, true);
      container.removeEventListener('mouseup', handleTerminalLinkMouseUp, true);
      unregisterDataCallback(sessionId);
      unregisterExitCallback(sessionId);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      canvasAddonRef.current = null;
    };
    // Intentionally mirrors mount/unmount: this effect runs once
    // per mounted session and tears down fully on unmount. Reactive prop/store
    // changes (theme, font, renderer, shell) are applied through the separate
    // effects below instead of re-running this setup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Restart the session when the configured default shell changes.
  useEffect(() => {
    const shellValue = configuredShell || '';
    if (currentShellRef.current === null) {
      currentShellRef.current = shellValue;
      return;
    }
    if (currentShellRef.current !== shellValue) {
      currentShellRef.current = shellValue;
      restartSession();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configuredShell]);

  useEffect(() => {
    if (fitAddonRef.current) {
      scheduleFit();
      if (isActive || isMaximized) {
        requestAnimationFrame(() => termRef.current?.focus());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, isMaximized]);

  // When this pane becomes active, flush any stale atlas state accumulated while idle.
  // Covers the case where an inactive pane's canvas drifts while another pane was focused.
  useEffect(() => {
    if (isActive && termRef.current) {
      requestAnimationFrame(() => forceRedraw());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    const term = termRef.current;
    if (term) {
      term.options.fontFamily = fontFamily;
      term.options.fontSize = fontSize;
      term.options.cursorStyle = cursorStyle;
      term.options.scrollback = scrollback;
      term.options.windowsPty = windowsPty;
      scheduleFit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontFamily, fontSize, cursorStyle, scrollback, windowsPty]);

  useEffect(() => {
    if (termRef.current) {
      applyTerminalRenderer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  useEffect(() => {
    const term = termRef.current;
    if (term && activeThemeValue) {
      const colors = activeThemeValue.colors;
      const syntax = activeThemeValue.syntax;
      const isLight = activeThemeValue.type === 'light';
      term.options.theme = {
        background: 'rgba(0, 0, 0, 0)',
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
        white: isLight ? '#586069' : (colors['text-primary'] || '#e6edf3'),
        brightBlack: isLight ? '#656d76' : (colors['text-muted'] || '#6e7681'),
        brightRed: syntax['keyword'] || (isLight ? '#cf222e' : '#ff7b72'),
        brightGreen: colors['success'] || (isLight ? '#1a7f37' : '#4ade80'),
        brightYellow: colors['warning'] || (isLight ? '#9a6700' : '#fbbf24'),
        brightBlue: colors['accent-hover'] || (isLight ? '#218bff' : '#9585ff'),
        brightMagenta: syntax['function'] || (isLight ? '#8250df' : '#d2a8ff'),
        brightCyan: syntax['constant'] || (isLight ? '#0598bc' : '#39d2c0'),
        brightWhite: isLight ? '#24292f' : (colors['text-primary'] || '#ffffff'),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThemeValue]);

  const classNames = [
    'terminal-pane',
    isActive && 'active',
    isDead && 'dead',
    isMaximized && 'maximized',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classNames}
      onClick={onActivate}
      onContextMenu={handleContextMenu}
      style={{ '--terminal-font-family': fontFamily } as React.CSSProperties}
    >
      {onResizeLeft && (
        <div
          className="pane-resize-handle pane-resize-left"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeLeft(e);
          }}
        ></div>
      )}
      {onResizeRight && (
        <div
          className="pane-resize-handle pane-resize-right"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeRight(e);
          }}
        ></div>
      )}
      {onResizeTop && (
        <div
          className="pane-resize-handle pane-resize-top"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeTop(e);
          }}
        ></div>
      )}
      {onResizeBottom && (
        <div
          className="pane-resize-handle pane-resize-bottom"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizeBottom(e);
          }}
        ></div>
      )}

      {/* Pane title bar with role picker */}
      <div
        className={`pane-titlebar${onPaneDragStart ? ' draggable' : ''}`}
        onMouseDown={handleTitlebarMouseDown}
        onClick={() => {
          if (rolePickerOpen) setRolePickerOpen(false);
        }}
      >
        {/* Close button on the left */}
        <button
          className="pane-close-btn"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close pane"
        >
          <svg width="9" height="9" viewBox="0 0 9 9">
            <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <span className="pane-title" onClick={openRolePicker} title={paneTitleText || 'Click to set role'}>
          {agentName && <span className="pane-agent-badge">{agentName}</span>}
          <span className="pane-title-copy">
            <span className="pane-title-main">
              {sessionInfo?.role && (
                <span className="role-dot" style={{ background: getRoleColor(sessionInfo.role) }}></span>
              )}
              {paneTitleText}
            </span>
            {paneSecondaryText && <span className="pane-title-summary">{paneSecondaryText}</span>}
          </span>
        </span>

        {/* Running indicator dot */}
        <span className={`pane-status-dot${!isDead ? ' running' : ''}`}></span>

        {/* Maximize / Restore button */}
        {onMaximize && (
          <button
            className="pane-maximize-btn"
            onClick={(e) => {
              e.stopPropagation();
              onMaximize();
            }}
            title={isMaximized ? 'Restore pane' : 'Maximize pane'}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="10" y1="14" x2="3" y2="21" />
                <line x1="21" y1="3" x2="14" y2="10" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Role picker popover */}
      {rolePickerOpen && (
        <div className="role-picker" onClick={(e) => e.stopPropagation()}>
          <div className="role-chips">
            {ROLE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className={`role-chip${sessionInfo?.role === preset.label ? ' active' : ''}`}
                onClick={() => selectRole(preset.label)}
              >
                <span className="role-dot" style={{ background: preset.color }}></span>
                {preset.label}
              </button>
            ))}
            {sessionInfo?.role && (
              <button className="role-chip role-chip-clear" onClick={() => selectRole(null)}>
                Clear
              </button>
            )}
          </div>
          <div className="role-custom-row">
            <input
              className="role-custom-input"
              type="text"
              placeholder="Custom label…"
              value={customRoleInput}
              onChange={(e) => setCustomRoleInput(e.target.value)}
              onKeyDown={handleRolePickerKey}
            />
            <button className="role-custom-apply" onClick={applyCustomRole}>
              Set
            </button>
          </div>
        </div>
      )}

      {/* Command history blocks above the live terminal */}

      {/* xterm.js fills all remaining space — click and type directly.
          Bare container, matching the Svelte original: xterm handles its own
          mousedown→textarea focus internally, and pane activation comes from the
          outer div's onClick + term.onKey. An onFocus/onMouseDown handler here
          that both activates AND calls term.focus() created a focus→activate→
          refocus loop that repainted every frame (the flicker). */}
      <div className="xterm-container" ref={containerRef}></div>
    </div>
  );
}
