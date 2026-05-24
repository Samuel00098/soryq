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
    commandHistory,
    addHistoryEntry,
    setSessionExecuting,
    paneAssignments,
    createTerminalSession,
    activeSessionId,
    terminalInputRequest,
  } from '$lib/stores/terminal';
  import {
    terminalFontSize,
    terminalCursorStyle,
    terminalScrollback,
    terminalRenderer,
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

  // Custom Capsule Dock state
  let inputValue = $state('');
  let isCapsuleFocused = $state(false);
  let isDraggingOver = $state(false);
  let isListening = $state(false);
  let showHistoryMenu = $state(false);
  let historyIndex = $state(-1);
  let tempInputValue = '';
  let lastExitCode = $state(0); // 0 = success, 1 = failure/error indicator

  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let historyMenuEl = $state<HTMLDivElement | null>(null);
  let executingTimeout: any = null;
  let hoveredTerminalLink: string | null = null;

  let currentShellCwd = $state<string | null>(null);

  // Dynamic Prompt Path: displays the project-relative path if inside the project, otherwise the last folder name
  let promptPath = $derived(
    (() => {
      const activePath = currentShellCwd || $activeProject?.root_path;
      if (!activePath) return 'forge';
      
      const projectRoot = $activeProject?.root_path;
      if (projectRoot && activePath.startsWith(projectRoot)) {
        let relative = activePath.slice(projectRoot.length);
        relative = relative.replace(/^[/\\]+/, '');
        const rootName = projectRoot.split(/[/\\]/).pop() || 'forge';
        return relative ? `${rootName}/${relative.replace(/\\/g, '/')}` : rootName;
      }
      
      const cleanPath = activePath.replace(/[/\\]$/, '');
      const parts = cleanPath.split(/[/\\]/);
      return parts[parts.length - 1] || 'forge';
    })()
  );

  // Clicking the prompt badge copies the current terminal path to clipboard
  function copyTerminalPath(e: MouseEvent) {
    e.stopPropagation();
    const activePath = currentShellCwd || $activeProject?.root_path;
    if (activePath) {
      navigator.clipboard.writeText(activePath).then(() => {
        showToast(`Copied path to clipboard: ${activePath}`, 'success');
      }).catch(err => {
        console.error('Failed to copy path:', err);
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
    try {
      parsed = new URL(trimmed);
    } catch {
      return;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return;
    }

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
    openUrlInPreview(uri).catch((err) => {
      console.error('Failed to open terminal URL in preview:', err);
    });
  }

  // Parse OSC 7 directory change escape codes
  function parseOSC7Sequence(text: string) {
    const match = text.match(/\u001b\]7;file:\/\/[^\/]+([^\u0007\u001b]+)/);
    if (match && match[1]) {
      let rawPath = match[1];
      if (rawPath.startsWith('/') && rawPath.charAt(2) === ':') {
        rawPath = rawPath.slice(1);
      }
      currentShellCwd = decodeURIComponent(rawPath);
    }
  }

  // Focus capsule input when this tab becomes active
  $effect(() => {
    if (isActive && inputEl) {
      inputEl.focus();
    }
  });

  function adjustInputHeight() {
    if (!inputEl) return;
    inputEl.style.height = '32px';
  }

  $effect(() => {
    inputValue;
    adjustInputHeight();
  });

  $effect(() => {
    inputEl;
    adjustInputHeight();
  });

  $effect(() => {
    const request = $terminalInputRequest;
    if (!request || request.sessionId !== sessionId) return;

    const insertText = request.text.trim();
    if (!insertText) return;

    if ($activeSessionId !== sessionId && !isActive) return;

    inputValue = inputValue ? `${inputValue} ${insertText}` : insertText;
    historyIndex = -1;
    tempInputValue = '';
    inputEl?.focus();
    terminalInputRequest.set(null);
  });

  // Synchronize shell settings dynamically. If the user changes their terminal app in settings,
  // we restart this session using the new shell path.
  let currentShell = $state<string | null>(null);
  let isLightTheme = $derived($activeTheme?.type === 'light');

  async function restartSessionWithNewShell() {
    if (isDead) return;
    const cwd = currentShellCwd || $activeProject?.root_path;
    const paneIdx = $paneAssignments.indexOf(sessionId);
    await killSession(sessionId);
    if (paneIdx !== -1) {
      const newSessionId = await createTerminalSession(cwd, paneIdx);
      if (newSessionId !== null) {
        showToast('Terminal session updated to new shell settings', 'success');
      }
    }
  }

  $effect(() => {
    const configuredShell = $terminalShell || '';
    if (currentShell === null) {
      currentShell = configuredShell;
      return;
    }
    if (currentShell !== configuredShell) {
      currentShell = configuredShell;
      restartSessionWithNewShell();
    }
  });

  // Speech Recognition integration
  let recognition: any = null;
  function getVoiceInputErrorMessage() {
    if (typeof window === 'undefined') {
      return 'Voice input is only available in the browser.';
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const isTauriRuntime = Boolean((window as any).__TAURI__);

    if (!SpeechRecognition) {
      return isTauriRuntime
        ? 'Voice input is not supported in this desktop webview. Open the app in a supported browser like Edge or Chrome.'
        : 'Voice input is not supported in this browser.';
    }

    if (!window.isSecureContext) {
      return 'Voice input requires a secure context. Run the app from localhost or HTTPS.';
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      return 'This runtime cannot access the microphone.';
    }

    return null;
  }

  async function verifyMicrophoneAccess() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return 'This runtime cannot access the microphone.';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return null;
    } catch (err: any) {
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        return 'Microphone access denied. Please allow microphone permissions in Windows and your browser settings.';
      }
      if (err?.name === 'NotFoundError') {
        return 'No microphone was found. Check that a microphone is connected and selected as the default input device.';
      }
      if (err?.name === 'NotReadableError' || err?.name === 'AbortError') {
        return 'Microphone capture failed. Ensure your microphone is not being used by another app.';
      }
      return 'Could not access the microphone.';
    }
  }

  async function toggleVoiceInput() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const supportError = getVoiceInputErrorMessage();
    if (supportError) {
      showToast(supportError, 'error');
      return;
    }

    if (isListening) {
      recognition?.stop();
      return;
    }

    try {
      const micError = await verifyMicrophoneAccess();
      if (micError) {
        showToast(micError, 'error');
        return;
      }

      recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isListening = true;
        showToast('Listening for voice command...', 'info');
      };

      recognition.onresult = (e: any) => {
        const transcript = e.results[0][0].transcript;
        if (transcript) {
          inputValue = inputValue ? `${inputValue} ${transcript}` : transcript;
        }
      };

      recognition.onerror = (err: any) => {
        console.error('Speech recognition error:', err);
        let msg = 'Voice input failed.';
        if (err.error === 'no-speech') {
          msg = 'No speech was detected. If this keeps happening in Tauri or a desktop webview, the speech engine may not be available there. Try Edge or Chrome, or check that your microphone is active and selected as the default input device.';
        } else if (err.error === 'audio-capture') {
          msg = 'Microphone capture failed. Ensure your microphone is plugged in and not in use by another app.';
        } else if (err.error === 'not-allowed') {
          msg = 'Microphone access denied. Please enable microphone permissions in Windows Privacy Settings.';
        } else if (err.error === 'network') {
          msg = 'Network error. Could not connect to the online speech recognition service.';
        } else if (err.error) {
          msg = `Voice input error: ${err.error}`;
        }
        showToast(msg, 'error');
        isListening = false;
      };

      recognition.onend = () => {
        isListening = false;
      };

      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      showToast('Could not access microphone.', 'error');
      isListening = false;
    }
  }

  // File picker attachment
  async function handleAttachFile() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        directory: false,
        title: 'Select File to Append'
      });
      if (selected && selected.length > 0) {
        const paths = selected.map(p => p.includes(' ') ? `"${p}"` : p).join(' ');
        inputValue = inputValue ? `${inputValue} ${paths}` : paths;
        inputEl?.focus();
        showToast(`Attached path: ${selected[0]}`, 'success');
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err);
      showToast('Failed to select file', 'error');
    }
  }

  // Drag & drop handlers
  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = true;
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDraggingOver = false;

    // 1. Check for internal file node drag path
    const internalPath = e.dataTransfer?.getData('text/plain');
    if (internalPath && (internalPath.includes('\\') || internalPath.includes('/'))) {
      const formatted = internalPath.includes(' ') ? `"${internalPath}"` : internalPath;
      inputValue = inputValue ? `${inputValue} ${formatted}` : formatted;
      inputEl?.focus();
      showToast(`Inserted path from workspace`, 'success');
      return;
    }

    // 2. Check for external files
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      const filePaths: string[] = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        const path = (file as any).path || file.name;
        filePaths.push(path.includes(' ') ? `"${path}"` : path);
      }
      if (filePaths.length > 0) {
        inputValue = inputValue ? `${inputValue} ${filePaths.join(' ')}` : filePaths.join(' ');
        inputEl?.focus();
        showToast(`Inserted external file paths`, 'success');
      }
    }
  }

  function submitCommand() {
    const cmd = inputValue.trim();
    if (!cmd) return;

    addHistoryEntry(cmd);
    writeToSession(sessionId, cmd + '\r');
    setSessionExecuting(sessionId, true);

    if (cmd.startsWith('exit ')) {
      const codeVal = parseInt(cmd.slice(5));
      if (!isNaN(codeVal)) lastExitCode = codeVal;
    } else {
      lastExitCode = 0;
    }

    inputValue = '';
    historyIndex = -1;
    tempInputValue = '';
  }

  function clearTerminal() {
    term?.clear();
  }

  async function restartTerminalSession() {
    const paneIdx = $paneAssignments.indexOf(sessionId);
    const cwd = currentShellCwd || $activeProject?.root_path;

    clearTerminal();
    inputValue = '';
    historyIndex = -1;
    tempInputValue = '';

    if (paneIdx === -1) {
      return;
    }

    await killSession(sessionId);
    await createTerminalSession(cwd, paneIdx);
  }

  // Keyboard navigation and command execution
  function handleKeyDown(e: KeyboardEvent) {
    // Forward PTY control signals
    if (e.ctrlKey) {
      const lowerKey = e.key.toLowerCase();
      if (lowerKey === 'c') {
        if (term?.hasSelection()) {
          // Copy selected text to clipboard
          e.preventDefault();
          navigator.clipboard.writeText(term.getSelection()).then(() => {
            showToast('Selection copied to clipboard', 'info');
          }).catch(err => {
            console.error('Failed to copy text:', err);
          });
          return;
        }
        // Ctrl+C (ETX - End of Text / Interrupt)
        e.preventDefault();
        writeToSession(sessionId, '\x03');
        setSessionExecuting(sessionId, true);
        inputValue = '';
        return;
      }
      if (lowerKey === 'd') {
        // Ctrl+D (EOT - End of Transmission)
        e.preventDefault();
        writeToSession(sessionId, '\x04');
        return;
      }
      if (lowerKey === 'l') {
        // Ctrl+L (Form Feed / Clear Visual Screen)
        e.preventDefault();
        clearTerminal();
        return;
      }
    }

    if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || e.key === 'NumpadEnter') {
      e.preventDefault();
      submitCommand();
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      const history = $commandHistory;
      if (history.length > 0) {
        if (historyIndex === -1) {
          tempInputValue = inputValue;
        }
        if (historyIndex < history.length - 1) {
          historyIndex++;
          inputValue = history[historyIndex];
        }
      }
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      const history = $commandHistory;
      if (historyIndex > -1) {
        historyIndex--;
        if (historyIndex === -1) {
          inputValue = tempInputValue;
        } else {
          inputValue = history[historyIndex];
        }
      }
    } else if (e.key === 'Escape') {
      if (showHistoryMenu) {
        showHistoryMenu = false;
      } else {
        inputValue = '';
        historyIndex = -1;
      }
    }
  }

  function selectHistoryCommand(cmd: string) {
    inputValue = cmd;
    showHistoryMenu = false;
    inputEl?.focus();
  }

  function toggleHistoryMenu(e: MouseEvent) {
    e.stopPropagation();
    showHistoryMenu = !showHistoryMenu;
  }

  function handleOutsideClick(e: MouseEvent) {
    if (showHistoryMenu && historyMenuEl && !historyMenuEl.contains(e.target as Node)) {
      showHistoryMenu = false;
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (!isActive) return;
    if (e.code === 'AltRight') {
      e.preventDefault();
      e.stopPropagation();
      toggleVoiceInput();
    }
  }

  async function handleContextMenu(e: MouseEvent) {
    // If right-clicked inside the capsule, allow default input field context menu
    if ((e.target as HTMLElement).closest('.command-capsule-container')) {
      return;
    }

    e.preventDefault();

    if (term?.hasSelection()) {
      try {
        const text = term.getSelection();
        await navigator.clipboard.writeText(text);
        term.clearSelection();
        showToast('Text copied to clipboard', 'info');
      } catch (err) {
        console.error('Failed to copy selected text:', err);
      }
    } else {
      try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText) {
          inputValue = inputValue ? `${inputValue}${clipboardText}` : clipboardText;
          inputEl?.focus();
        }
      } catch (err) {
        console.error('Failed to read from clipboard:', err);
        showToast('Could not access clipboard data', 'error');
      }
    }
  }

  onMount(() => {

    const initialColors = $activeTheme?.colors || {};
    const initialSyntax = $activeTheme?.syntax || {};
    const isLightTheme = $activeTheme?.type === 'light';

    term = new Terminal({
      cursorBlink: true,
      cursorStyle: $terminalCursorStyle,
      reflowCursorLine: true,
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
    term.loadAddon(new WebLinksAddon((event: MouseEvent, uri: string) => {
      event.preventDefault();
      event.stopPropagation();
      term?.clearSelection();
      openUrlInPreview(uri).catch((err) => {
        console.error('Failed to open terminal URL in preview:', err);
      });
    }, {
      hover: (_event, uri) => {
        hoveredTerminalLink = uri;
      },
      leave: () => {
        hoveredTerminalLink = null;
      },
    }));
    term.open(container);
    container.addEventListener('mousedown', handleTerminalLinkMouseDown, true);
    container.addEventListener('mouseup', handleTerminalLinkMouseUp, true);

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

    function resetExecutingTimer() {
      if (executingTimeout) clearTimeout(executingTimeout);
      executingTimeout = setTimeout(() => {
        if (sessionInfo?.isExecuting) {
          setSessionExecuting(sessionId, false);
        }
      }, 800);
    }

    const decoder = new TextDecoder();
    registerDataCallback(sessionId, (bytes: Uint8Array) => {
      term?.write(bytes);
      try {
        const text = decoder.decode(bytes);
        parseOSC7Sequence(text);
      } catch (_) {}
      resetExecutingTimer();
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
    container?.removeEventListener('mousedown', handleTerminalLinkMouseDown, true);
    container?.removeEventListener('mouseup', handleTerminalLinkMouseUp, true);
    unregisterDataCallback(sessionId);
    canvasAddon?.dispose();
    term?.dispose();
    if (executingTimeout) clearTimeout(executingTimeout);
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
            if (inputEl) {
              inputEl.focus();
            } else {
              term?.focus();
            }
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
      term.options.reflowCursorLine = true;
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

<svelte:window onclick={handleOutsideClick} onkeydown={handleWindowKeyDown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-pane"
  class:active={isActive}
  class:dead={isDead}
  onclick={onActivate}
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  oncontextmenu={handleContextMenu}
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

  <!-- Spacer to prevent capsule from overlapping text in terminal scrollback -->
  <div class="capsule-spacer"></div>

  <!-- Floating Command Capsule Dock -->
  <div
    class="command-capsule-container"
    class:focused={isCapsuleFocused}
    class:light={isLightTheme}
    class:executing={sessionInfo?.isExecuting}
  >
    <!-- Dynamic Glowing Status Node -->
    <div
      class="status-node"
      class:success={lastExitCode === 0 && !sessionInfo?.isExecuting}
      class:running={sessionInfo?.isExecuting}
      class:error={lastExitCode > 0 && !sessionInfo?.isExecuting}
    ></div>

    <!-- Directory prompt -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="prompt-text clickable"
      onclick={copyTerminalPath}
      title="Click to copy absolute path"
    >
      {promptPath}
    </span>

    <!-- Text input box -->
    <textarea
      class="command-input"
      rows="1"
      placeholder="Type a command. Ctrl+Enter to run..."
      bind:value={inputValue}
      onkeydown={handleKeyDown}
      onfocus={() => isCapsuleFocused = true}
      onblur={() => isCapsuleFocused = false}
      bind:this={inputEl}
      disabled={isDead}
    ></textarea>

    <!-- Action buttons -->
    <div class="capsule-actions">
      <!-- Send -->
      <button
        class="action-btn send-btn"
        onclick={(e) => { e.stopPropagation(); submitCommand(); }}
        title="Send command"
        disabled={isDead || inputValue.trim().length === 0}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m22 2-7 20-4-9-9-4 20-7z"/>
          <path d="M22 2 11 13"/>
        </svg>
      </button>

      <!-- Voice Input (Mic) -->
      <button
        class="action-btn mic-btn"
        class:active={isListening}
        onclick={toggleVoiceInput}
        title="Voice command (Speech-to-Text)"
        disabled={isDead}
      >
        <svg class:pulse={isListening} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
      </button>

      <!-- Attach file (Paperclip) -->
      <button
        class="action-btn file-btn"
        onclick={handleAttachFile}
        title="Attach file paths"
        disabled={isDead}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>

      <!-- Command History (Clock) -->
      <button
        class="action-btn history-btn"
        onclick={toggleHistoryMenu}
        title="Recent commands"
        disabled={isDead}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      </button>

      <!-- Clear Terminal (Trash) -->
      <button
        class="action-btn clear-btn"
        onclick={(e) => { e.stopPropagation(); restartTerminalSession(); }}
        title="Clear and restart terminal"
        disabled={isDead}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18"/>
          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
        </svg>
      </button>
    </div>

    <!-- History Dropdown Overlay -->
    {#if showHistoryMenu}
      <div class="history-dropdown" bind:this={historyMenuEl}>
        <div class="history-header">Recent Commands</div>
        {#if $commandHistory.length === 0}
          <div class="history-empty">No history yet</div>
        {:else}
          {#each $commandHistory as cmd}
            <button class="history-item" onclick={() => selectHistoryCommand(cmd)} title={cmd}>
              <span class="history-item-text">{cmd}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Drag and Drop Overlay Portal -->
  {#if isDraggingOver}
    <div class="drop-portal-overlay">
      <div class="drop-portal-content">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" x2="12" y1="3" y2="15"/>
        </svg>
        <span>Drop files here to insert paths</span>
      </div>
    </div>
  {/if}
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
    container-type: inline-size;
    container-name: terminal-cell;
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

  /* Spacer at bottom of terminal pane */
  .capsule-spacer {
    height: 84px;
    flex-shrink: 0;
    background: var(--bg-primary);
  }

  /* Command Capsule Container */
  .command-capsule-container {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: calc(100% - 32px);
    max-width: 600px;
    min-height: 40px;
    max-height: 112px;
    background: color-mix(in srgb, var(--bg-secondary) 86%, transparent);
    backdrop-filter: blur(12px);
    border: 1px solid var(--border);
    border-radius: 20px;
    display: flex;
    align-items: center;
    padding: 6px 6px 6px 12px;
    gap: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    z-index: 10;
    transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
  }

  .command-capsule-container.focused {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--bg-primary) 94%, var(--bg-secondary) 6%);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), 0 0 0 2px var(--accent-light);
  }

  .command-capsule-container.light {
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  }

  .command-capsule-container.light.focused {
    box-shadow: 0 8px 28px rgba(15, 23, 42, 0.12), 0 0 0 2px var(--accent-light);
  }

  .command-capsule-container.executing {
    animation: borderPulse 2s infinite ease-in-out;
  }

  @keyframes borderPulse {
    0%, 100% { border-color: var(--border); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
    50% { border-color: var(--accent); box-shadow: 0 8px 32px rgba(124, 106, 247, 0.2); }
  }

  /* Status Node Dot */
  .status-node {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.3s, box-shadow 0.3s;
  }

  .status-node.success {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
  }

  .status-node.running {
    background: var(--warning);
    box-shadow: 0 0 8px var(--warning);
    animation: statusPulse 1.2s infinite ease-in-out;
  }

  .status-node.error {
    background: var(--error);
    box-shadow: 0 0 6px var(--error);
  }

  @keyframes statusPulse {
    0%, 100% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.2); opacity: 1; }
  }

  /* Prompt Badge */
  .prompt-text {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-light);
    padding: 2px 8px;
    border-radius: 10px;
    letter-spacing: 0.5px;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: none;
    transition: background 0.15s, color 0.15s;
  }

  .prompt-text.clickable {
    cursor: pointer;
  }

  .prompt-text.clickable:hover {
    background: var(--accent);
    color: var(--button-text, #ffffff);
  }

  /* Command input field */
  .command-input {
    flex: 1;
    height: 32px;
    min-height: 32px;
    max-height: 32px;
    background: none;
    border: none;
    outline: none;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-primary);
    caret-color: var(--accent);
    resize: none;
    overflow-y: auto;
    padding: 6px 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .command-capsule-container.light .command-input {
    color: var(--text-primary);
  }

  .command-input::placeholder {
    color: var(--text-muted);
    opacity: 0.7;
  }

  /* Actions container */
  .capsule-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--text-muted);
    transition: background 0.15s, color 0.15s, transform 0.1s;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .action-btn:hover:not(:disabled) {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.08);
  }

  .action-btn:active:not(:disabled) {
    transform: scale(0.92);
  }

  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-btn.mic-btn.active {
    color: var(--error);
    background: rgba(239, 68, 68, 0.15);
  }

  .action-btn.send-btn {
    color: var(--accent);
  }

  .action-btn.send-btn:hover:not(:disabled) {
    background: rgba(124, 106, 247, 0.12);
  }

  /* Microphone pulsing animation */
  @keyframes micPulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
    50% { transform: scale(1.1); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
  }

  .pulse {
    animation: micPulse 1.5s infinite ease-in-out;
  }

  /* History Popover */
  .history-dropdown {
    position: absolute;
    bottom: 46px;
    right: 8px;
    width: 240px;
    max-height: 200px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    z-index: 100;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 2px;
  }

  .history-header {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 4px;
  }

  .history-empty {
    font-size: 11px;
    color: var(--text-muted);
    text-align: center;
    padding: 16px;
  }

  .history-item {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 8px;
    border-radius: 6px;
    background: transparent;
    text-align: left;
    transition: background 0.15s;
    cursor: pointer;
    border: none;
  }

  .history-item:hover {
    background: var(--bg-hover);
  }

  .history-item-text {
    font-size: 11px;
    font-family: monospace;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Drop portal overlay */
  .drop-portal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(10, 10, 12, 0.6);
    backdrop-filter: blur(8px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    animation: fadeInOverlay 0.25s ease;
  }

  @keyframes fadeInOverlay {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .drop-portal-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 24px;
    border: 2px dashed var(--accent);
    border-radius: 16px;
    color: var(--accent);
    background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }

  .drop-portal-content span {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.2px;
  }

  /* ── Container Queries for split terminals ── */
  @container terminal-cell (max-width: 460px) {
    .prompt-text {
      display: none;
    }
    .history-dropdown {
      width: 180px;
    }
  }

  @container terminal-cell (max-width: 325px) {
    .clear-btn, .history-btn {
      display: none;
    }
    .command-capsule-container {
      padding: 0 4px 0 8px;
      gap: 4px;
      width: calc(100% - 16px);
      bottom: 8px;
    }
    .capsule-spacer {
      height: 48px;
    }
  }
</style>
