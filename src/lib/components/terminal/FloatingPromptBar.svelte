<script lang="ts">
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import {
    activeSessionId,
    manualPromptTargetId,
    sessions,
    commandHistory,
    addHistoryEntry,
    setSessionExecuting,
    setSessionTaskSummary,
    summarizeTerminalTask,
    startCommandBlock,
    promptBarInput,
    promptBarImage,
    promptBarFocusRequest,
    activateSessionInPane,
    sendPromptToSession,
    getSessionLabel,
    isAgentSession,
    spawnAgentPreset,
  } from '$lib/stores/terminal';
  import { getPresetRuns } from '$lib/stores/runs';
  import { layout } from '$lib/stores/layout';
  import { showToast } from '$lib/stores/notification';
  import { createVoiceInputSession, mergeVoiceTranscript } from '$lib/services/voice-input';
  import { refineVoicePrompt } from '$lib/services/voice-refinement';
  import { activeProject } from '$lib/stores/workspace';
  import { addRunEntry } from '$lib/stores/runHistory';
  import { isImagePath, getImageMimeType } from '$lib/stores/editor';

  // Per-project state cache
  const barProjectCache = new Map<string, { inputValue: string; manualTargetId: number | null }>();
  let lastBarProjectId = $state<string | null>(null);

  let inputValue = $state('');
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let historyIndex = $state(-1);
  let draftBeforeHistory = $state('');
  let historyOpen = $state(false);
  let isListening = $state(false);
  let isRefining = $state(false);
  let voiceLocked = $state(false);
  let voiceHeld = $state(false);
  let voiceStopping = $state(false);
  let broadcastAgents = $state(false);
  let spawnOpen = $state(false);
  let spawnCounts = $state<Map<string, number>>(new Map());
  let totalSpawnCount = $derived(Array.from(spawnCounts.values()).reduce((a, b) => a + b, 0));
  let shellEl = $state<HTMLDivElement | null>(null);
  let barEl = $state<HTMLDivElement | null>(null);
  let draggedExplorerPath = $state<string | null>(null);
  let lastExplorerDragPoint = $state<{ x: number; y: number } | null>(null);
  let isHovered = $state(false);
  let isFocused = $state(false);
  let isDragOver = $state(false);
  let isGlobalFileDrag = $state(false);
  let targetPickerOpen = $state(false);
  let voiceDraftBase = $state('');
  let voiceDraftText = $state('');
  let isActive = $derived(
    isHovered || isFocused || historyOpen || targetPickerOpen || spawnOpen || isListening || isRefining || broadcastAgents || isDragOver || (!draggedExplorerPath && isGlobalFileDrag)
  );

  const AI_AGENT_COMMANDS = new Set(['codex', 'claude', 'aider', 'agy', 'opencode', 'pi', 'copilot']);
  let spawnPresets = $derived(
    $activeProject
      ? getPresetRuns($activeProject.id).filter((r) => AI_AGENT_COMMANDS.has(r.command))
      : []
  );

  // `diskPath` is set when the image already exists on disk (attached via the
  // file picker) so submitPrompt can reference it directly instead of re-saving
  // a fresh copy — the agent then reads the exact file the user picked.
  type PastedImage = { objectUrl: string; dataUrl: string; name: string; diskPath?: string };
  let pastedImages = $state<PastedImage[]>([]);

  let activeTerminal = $derived($sessions.find((session) => session.id === $activeSessionId) ?? null);
  let preferredAgentTerminal = $derived(
    isAgentSession(activeTerminal)
      ? activeTerminal
      : ($sessions
          .filter((session) => session.isRunning && isAgentSession(session))
          .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))[0] ?? null)
  );
  // The terminal in focus (last clicked / keyboard-focused) is the natural
  // target; only fall back to auto-following an agent when there's no active one.
  let autoTarget = $derived(activeTerminal ?? preferredAgentTerminal);
  let manualTarget = $derived(
    $manualPromptTargetId !== null
      ? ($sessions.find((s) => s.id === $manualPromptTargetId && s.isRunning) ?? null)
      : null
  );
  let promptTarget = $derived(manualTarget ?? autoTarget);
  // "Pinned" only when the user deliberately targets a terminal other than the
  // active one (via the picker). Focusing a pane keeps target === active = auto.
  let isPinned = $derived($manualPromptTargetId !== null && $manualPromptTargetId !== $activeSessionId);
  let broadcastTargets = $derived(
    $sessions
      .filter((session) => session.isRunning && isAgentSession(session))
      .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))
  );
  let runningSessions = $derived($sessions.filter((s) => s.isRunning));
  let historyItems = $derived(($commandHistory || []).slice(0, 12));
  let canSend = $derived(broadcastAgents ? broadcastTargets.length > 0 : Boolean(promptTarget?.isRunning));

  // Per-project state: save/restore inputValue and pinned target when project changes
  $effect(() => {
    const projectId = $activeProject?.id ?? null;
    if (projectId === lastBarProjectId) return;

    if (lastBarProjectId !== null) {
      barProjectCache.set(lastBarProjectId, { inputValue, manualTargetId: get(manualPromptTargetId) });
    }

    if (projectId !== null) {
      const cached = barProjectCache.get(projectId);
      inputValue = cached?.inputValue ?? '';
      const sessionAlive = cached?.manualTargetId != null &&
        $sessions.some((s) => s.id === cached.manualTargetId && s.isRunning);
      manualPromptTargetId.set(sessionAlive ? (cached?.manualTargetId ?? null) : null);
    } else {
      inputValue = '';
      manualPromptTargetId.set(null);
    }

    lastBarProjectId = projectId;
    historyIndex = -1;
    draftBeforeHistory = '';
    historyOpen = false;
    targetPickerOpen = false;
    requestAnimationFrame(adjustInputHeight);
  });

  // Clear manual pin if the session dies
  $effect(() => {
    if ($manualPromptTargetId !== null && !$sessions.find((s) => s.id === $manualPromptTargetId && s.isRunning)) {
      manualPromptTargetId.set(null);
    }
  });

  function selectTarget(id: number) {
    manualPromptTargetId.set(id);
    targetPickerOpen = false;
    focusInput();
  }

  function toggleTargetPicker() {
    targetPickerOpen = !targetPickerOpen;
    historyOpen = false;
  }

  function resolvePromptTarget() {
    const allSessions = get(sessions);
    const pinnedId = get(manualPromptTargetId);
    if (pinnedId !== null) {
      const manual = allSessions.find((s) => s.id === pinnedId && s.isRunning);
      if (manual) return manual;
    }
    const currentActiveSessionId = get(activeSessionId);
    const currentActiveTerminal = allSessions.find((session) => session.id === currentActiveSessionId) ?? null;
    if (currentActiveTerminal) return currentActiveTerminal;
    // No focused terminal — fall back to the most recently used running agent.
    return allSessions
      .filter((session) => session.isRunning && isAgentSession(session))
      .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))[0] ?? null;
  }

  function resolveBroadcastTargets() {
    return get(sessions)
      .filter((session) => session.isRunning && isAgentSession(session))
      .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0));
  }

  function focusInput() {
    requestAnimationFrame(() => inputEl?.focus());
  }

  function adjustInputHeight() {
    if (!inputEl) return;
    if (!inputValue) {
      inputEl.style.height = '24px';
      return;
    }
    inputEl.style.height = '0px';
    const nextHeight = Math.min(inputEl.scrollHeight, 100);
    inputEl.style.height = `${Math.max(nextHeight, 24)}px`;
  }

  function resetHistoryCursor() {
    historyIndex = -1;
    draftBeforeHistory = '';
  }

  function sendPromptToTarget(sessionId: number, text: string, agentPreset?: string | null) {
    sendPromptToSession(sessionId, text, agentPreset);
  }

  function incrementSpawn(command: string) {
    const next = new Map(spawnCounts);
    next.set(command, (next.get(command) ?? 0) + 1);
    spawnCounts = next;
  }

  function decrementSpawn(command: string) {
    const next = new Map(spawnCounts);
    const count = next.get(command) ?? 0;
    if (count <= 1) {
      next.delete(command);
    } else {
      next.set(command, count - 1);
    }
    spawnCounts = next;
  }

  async function handleSpawnConfirm() {
    const entries = Array.from(spawnCounts.entries()).filter(([, count]) => count > 0);
    if (!entries.length) return;
    spawnOpen = false;
    spawnCounts = new Map();
    const cwd = $activeProject?.root_path;
    let lastId: number | null = null;
    let total = 0;
    for (const [cmd, count] of entries) {
      for (let i = 0; i < count; i++) {
        const id = await spawnAgentPreset(cmd, cwd);
        if (id !== null) { lastId = id; total++; }
      }
    }
    if (!total) {
      showToast('No available panes to spawn agents', 'warning');
      return;
    }
    if (lastId !== null) manualPromptTargetId.set(lastId);
    showToast(total === 1 ? 'Spawned agent' : `Spawned ${total} agents`, 'info', undefined, true);
    focusInput();
  }

  function toggleBroadcastAgents() {
    const targets = resolveBroadcastTargets();
    if (!broadcastAgents && targets.length === 0) {
      showToast('No running AI agent terminals available', 'warning');
      return;
    }
    broadcastAgents = !broadcastAgents;
    historyOpen = false;
    focusInput();
  }

  // Map a clipboard image MIME type to a clean file extension. Splitting on "/"
  // alone mangles compound subtypes (e.g. "image/svg+xml" -> "svgxml"), which
  // would write a file with a bogus extension the agent can't open.
  function extensionForMime(mime: string): string {
    switch (mime) {
      case 'image/png': return 'png';
      case 'image/apng': return 'apng';
      case 'image/jpeg': return 'jpg';
      case 'image/gif': return 'gif';
      case 'image/webp': return 'webp';
      case 'image/bmp': return 'bmp';
      case 'image/x-icon':
      case 'image/vnd.microsoft.icon': return 'ico';
      case 'image/svg+xml': return 'svg';
      case 'image/avif': return 'avif';
      case 'image/tiff': return 'tif';
      default: {
        const sub = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
        return sub || 'png';
      }
    }
  }

  async function saveImageToDisk(img: PastedImage, projectPath: string): Promise<string | null> {
    try {
      // Normalise to forward slashes so the path the agent CLI receives is clean
      // and unambiguous — mixed back/forward slashes can trip up TUI path parsing.
      const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const savePath = `${root}/.soryq/attachments/${img.name}`;
      const response = await fetch(img.dataUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const data = Array.from(new Uint8Array(arrayBuffer));
      await invoke('fs_write_binary', { path: savePath, data });
      return savePath;
    } catch (error) {
      console.error('Failed to save pasted image to disk:', error);
      return null;
    }
  }

  function removeImage(index: number) {
    const img = pastedImages[index];
    URL.revokeObjectURL(img.objectUrl);
    pastedImages = pastedImages.filter((_, i) => i !== index);
  }

  async function handlePaste(e: ClipboardEvent) {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;
      // Unique name (timestamp + random) so two images pasted at once never
      // collide; keep the real extension so the agent reads the right format.
      const ext = extensionForMime(item.type);
      const name = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const objectUrl = URL.createObjectURL(blob);
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      pastedImages = [...pastedImages, { objectUrl, dataUrl, name }];
    }
  }

  async function submitPrompt() {
    const text = inputValue.trim();
    if (!text && pastedImages.length === 0) return;

    let finalText = text;

    if (pastedImages.length > 0) {
      const toSave = [...pastedImages];
      // Only images without an on-disk path need to be written, which requires a
      // project to hold the .soryq/attachments folder. Picked-from-disk images
      // already have a path and can be sent even with no project open.
      const needsSave = toSave.some((img) => !img.diskPath);
      const projectPath = get(activeProject)?.root_path;
      if (needsSave && !projectPath) {
        showToast('Open a project before attaching images', 'warning');
        return;
      }
      pastedImages = [];
      const paths = await Promise.all(
        toSave.map((img) =>
          img.diskPath
            ? Promise.resolve(img.diskPath.replace(/\\/g, '/'))
            : saveImageToDisk(img, projectPath as string)
        )
      );
      const validPaths = paths.filter(Boolean) as string[];
      const failedCount = toSave.length - validPaths.length;
      if (failedCount > 0) {
        showToast(
          failedCount === toSave.length
            ? `Couldn't attach ${toSave.length === 1 ? 'the image' : 'the images'}`
            : `Couldn't attach ${failedCount} of ${toSave.length} images`,
          'error'
        );
      }
      if (validPaths.length > 0) {
        // Quote only when the path has spaces — matches attachPathsToInput and is
        // friendlier to agent TUIs than always-single-quoting (which would leave
        // literal quote characters in the prompt the CLI then reads).
        const quoted = validPaths.map((p) => (p.includes(' ') ? `"${p}"` : p)).join(' ');
        finalText = finalText ? `${finalText} ${quoted}` : quoted;
      }
      toSave.forEach((img) => URL.revokeObjectURL(img.objectUrl));
    }

    if (!finalText) return;

    const singleTarget = resolvePromptTarget();
    const targets = broadcastAgents
      ? resolveBroadcastTargets()
      : (singleTarget ? [singleTarget] : []);

    if (!targets.length) {
      showToast(
        broadcastAgents ? 'No running AI agent terminals available' : 'No active terminal available',
        'warning'
      );
      return;
    }

      activateSessionInPane(targets[0].id);
      for (const target of targets) {
        const taskSummary = summarizeTerminalTask(finalText);
        sendPromptToTarget(target.id, finalText, target.agentPreset);
        setSessionExecuting(target.id, true);
        setSessionTaskSummary(target.id, taskSummary || null);
        startCommandBlock(target.id, finalText);
        addRunEntry({
          command: finalText,
          sessionId: target.id,
          sessionRole: target.role ?? null,
          sessionLabel: getSessionLabel(target, $sessions),
          agentPreset: target.agentPreset ?? null,
          projectId: $activeProject?.id ?? '',
          startedAt: Date.now(),
        });
    }
    addHistoryEntry(finalText);

    inputValue = '';
    historyOpen = false;
    resetHistoryCursor();
    showToast(
      broadcastAgents
        ? `Broadcast to ${targets.length} AI agent terminal${targets.length === 1 ? '' : 's'}`
        : `Sent to ${targets[0]?.title ?? 'terminal'}`,
      'info',
      undefined,
      true
    );
  }

  function selectHistoryItem(text: string) {
    inputValue = text;
    historyOpen = false;
    resetHistoryCursor();
    focusInput();
  }

  function stepHistory(direction: 1 | -1) {
    const items = get(commandHistory);
    if (!items.length) return;

    if (historyIndex === -1) {
      draftBeforeHistory = inputValue;
    }

    const nextIndex = Math.max(-1, Math.min(items.length - 1, historyIndex + direction));
    historyIndex = nextIndex;
    inputValue = nextIndex === -1 ? draftBeforeHistory : items[nextIndex];
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitPrompt();
      return;
    }

    if (event.key === 'ArrowUp') {
      const cursorPos = inputEl?.selectionStart ?? 0;
      const onFirstLine = !inputValue.substring(0, cursorPos).includes('\n');
      if (onFirstLine) {
        event.preventDefault();
        stepHistory(1);
        return;
      }
    }

    if (event.key === 'ArrowDown') {
      const cursorPos = inputEl?.selectionStart ?? inputValue.length;
      const onLastLine = !inputValue.substring(cursorPos).includes('\n');
      if (onLastLine) {
        event.preventDefault();
        stepHistory(-1);
        return;
      }
    }

    if (event.key === 'Escape') {
      historyOpen = false;
      resetHistoryCursor();
    }
  }

  function handleInput() {
    historyOpen = false;
    adjustInputHeight();
    if (historyIndex !== -1) {
      historyIndex = -1;
    }
  }

  const voiceInput = createVoiceInputSession({
    onStart: () => {
      isListening = true;
      isRefining = false;
      voiceDraftBase = inputValue;
      voiceDraftText = '';
      showToast('Listening for terminal prompt...', 'info');
    },
    onResult: (transcript) => {
      voiceDraftText = transcript;
    },
    onEnd: () => {
      const shouldRestart = !voiceStopping && (voiceLocked || voiceHeld);
      isListening = false;
      isRefining = true;

      void (async () => {
        try {
          const result = await refineVoicePrompt(voiceDraftText);
          if (result.text) {
            inputValue = mergeVoiceTranscript(voiceDraftBase, result.text);
            requestAnimationFrame(adjustInputHeight);
            focusInput();
            if (result.aiRefined) {
              showToast('Prompt refined by AI', 'success', undefined, true);
            }
          }
        } catch (error) {
          console.error('Failed to refine voice prompt:', error);
        } finally {
          isRefining = false;
          voiceStopping = false;
          voiceDraftBase = '';
          voiceDraftText = '';
          if (shouldRestart) {
            queueMicrotask(() => {
              if (voiceLocked || voiceHeld) {
                voiceInput.start();
              }
            });
          }
        }
      })();
    },
    onError: (message) => {
      isListening = false;
      isRefining = false;
      voiceLocked = false;
      voiceHeld = false;
      voiceStopping = false;
      voiceDraftBase = '';
      voiceDraftText = '';
      showToast(message, 'error');
    },
  });

  async function toggleVoiceInput() {
    if (isRefining) return;
    if (isListening && voiceLocked) {
      voiceLocked = false;
      voiceStopping = true;
      voiceInput.stop();
      voiceDraftBase = '';
      return;
    }
    voiceLocked = true;
    await voiceInput.start();
  }

  // Read an on-disk image into a preview chip. Returns true when the chip was
  // added; false (e.g. file outside the project) lets the caller fall back to a
  // plain path so the image is still sent, just without a thumbnail.
  async function addDiskImageChip(path: string): Promise<boolean> {
    try {
      const bytes = await invoke<number[]>('fs_read_binary', { path });
      const mimeType = getImageMimeType(path);
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const name = path.split(/[\\/]/).pop() || 'image';
      pastedImages = [...pastedImages, { objectUrl, dataUrl: '', name, diskPath: path }];
      return true;
    } catch (error) {
      console.error('Failed to preview attached image:', error);
      return false;
    }
  }

  async function attachFiles() {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        directory: false,
        title: 'Attach files to prompt',
      });

      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;

      const items = (Array.isArray(selected) ? selected : [selected]).map(String);
      // Images become preview chips (sent as the exact file path, so the agent
      // reads the right image); everything else is inserted as a plain path.
      const textPaths: string[] = [];
      for (const path of items) {
        if (isImagePath(path)) {
          const previewed = await addDiskImageChip(path);
          if (!previewed) textPaths.push(path);
        } else {
          textPaths.push(path);
        }
      }

      if (textPaths.length > 0) {
        // Routed through the shared helper so quoting matches paste/drag-drop
        // (double-quote only when the path has spaces) — the previous always
        // single-quote behaviour left literal quotes the agent CLI couldn't open.
        attachPathsToInput(textPaths);
      } else {
        historyOpen = false;
        resetHistoryCursor();
        requestAnimationFrame(() => inputEl?.focus());
      }
    } catch (error) {
      console.error('Failed to attach files to prompt:', error);
      showToast('Failed to attach files', 'error');
    }
  }

  function attachPathsToInput(paths: string[]) {
    if (!paths.length) return;

    const formatted = paths
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => (path.includes(' ') ? `"${path}"` : path))
      .join(' ');

    if (!formatted) return;

    inputValue = inputValue ? `${inputValue} ${formatted}` : formatted;
    historyOpen = false;
    targetPickerOpen = false;
    resetHistoryCursor();
    requestAnimationFrame(() => {
      adjustInputHeight();
      inputEl?.focus();
      inputEl?.setSelectionRange(inputValue.length, inputValue.length);
    });
  }

  function isPointInsideBar(clientX: number, clientY: number) {
    if (!barEl || typeof document === 'undefined') return false;
    const hovered = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
    return hovered.some((el) => el === barEl || el.closest('.floating-prompt-bar') === barEl);
  }

  function updateExplorerDragPoint(clientX: number, clientY: number) {
    if (clientX < 0 || clientY < 0) return false;
    lastExplorerDragPoint = { x: clientX, y: clientY };
    isDragOver = isPointInsideBar(clientX, clientY);
    return isDragOver;
  }

  function handleInternalDragOver(event: DragEvent) {
    if (!draggedExplorerPath) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    updateExplorerDragPoint(event.clientX, event.clientY);
  }

  function handleInternalDragEnter(event: DragEvent) {
    if (!draggedExplorerPath) return;
    event.preventDefault();
    updateExplorerDragPoint(event.clientX, event.clientY);
  }

  function handleInternalDragLeave(event: DragEvent) {
    if (!draggedExplorerPath) return;
    event.preventDefault();
  }

  function handleInternalDrop(event: DragEvent) {
    const droppedPath =
      draggedExplorerPath ||
      event.dataTransfer?.getData('application/x-soryq-path')?.trim() ||
      event.dataTransfer?.getData('text/plain')?.trim() ||
      null;

    if (!droppedPath) return;

    event.preventDefault();
    event.stopPropagation();
    updateExplorerDragPoint(event.clientX, event.clientY);
    isDragOver = false;
    attachPathsToInput([droppedPath]);
    draggedExplorerPath = null;
    lastExplorerDragPoint = null;
  }

  let lastFocusRequest = 0;
  $effect(() => {
    const req = $promptBarFocusRequest;
    if (req !== lastFocusRequest) {
      lastFocusRequest = req;
      if (req > 0) focusInput();
    }
  });

  $effect(() => {
    const text = $promptBarInput;
    if (text) {
      // Append the injected text to any existing input rather than overwriting it
      inputValue = inputValue.trim() ? `${inputValue.trim()} ${text}` : text;
      promptBarInput.set(null);
      historyOpen = false;
      resetHistoryCursor();
      requestAnimationFrame(() => {
        adjustInputHeight();
        inputEl?.focus();
        inputEl?.setSelectionRange(inputEl.value.length, inputEl.value.length);
      });
    }
  });

  // Watch for element screenshots injected from the Preview panel inspector
  $effect(() => {
    const img = $promptBarImage;
    if (!img) return;
    promptBarImage.set(null);
    // Convert the dataUrl into an objectUrl so it renders in the chip
    fetch(img.dataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        pastedImages = [...pastedImages, { objectUrl, dataUrl: img.dataUrl, name: img.name }];
        requestAnimationFrame(() => {
          inputEl?.focus();
        });
      })
      .catch(() => {/* silently ignore */});
  });

  $effect(() => {
    if (!resolvePromptTarget()?.id) {
      historyOpen = false;
    }
  });

  $effect(() => {
    if (broadcastAgents && broadcastTargets.length === 0) {
      broadcastAgents = false;
    }
  });

  $effect(() => {
    const sessionId = resolvePromptTarget()?.id;
    if (!sessionId) return;
    historyOpen = false;
    resetHistoryCursor();
    requestAnimationFrame(() => {
      adjustInputHeight();
      inputEl?.focus();
    });
  });

  $effect(() => {
    inputValue;
    requestAnimationFrame(adjustInputHeight);
  });

  function handleDocumentPointerDown(event: MouseEvent) {
    if (!historyOpen && !targetPickerOpen && !spawnOpen) return;
    const target = event.target as Node | null;
    if (shellEl && target && !shellEl.contains(target)) {
      historyOpen = false;
      targetPickerOpen = false;
      spawnOpen = false;
      spawnCounts = new Map();
    }
  }

  function handleGlobalVoiceShortcut(event: KeyboardEvent) {
    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat || isRefining) return;
    const activeElement = document.activeElement;
    if (!shellEl || !activeElement || !shellEl.contains(activeElement)) return;
    event.preventDefault();
    if (voiceLocked || voiceHeld) return;
    voiceHeld = true;
    voiceInput.start();
  }

  function handleGlobalVoiceShortcutUp(event: KeyboardEvent) {
    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT) return;
    if (!voiceHeld) return;
    voiceHeld = false;
    voiceStopping = true;
    voiceInput.stop();
  }

  function handleExplorerDragStart(event: Event) {
    const custom = event as CustomEvent<{ path?: string }>;
    draggedExplorerPath = custom.detail?.path?.trim() || null;
    lastExplorerDragPoint = null;
    isDragOver = false;
    isGlobalFileDrag = false;
  }

  function handleExplorerDragMove(event: Event) {
    const custom = event as CustomEvent<{ clientX?: number; clientY?: number }>;
    if (!draggedExplorerPath) return;
    updateExplorerDragPoint(custom.detail?.clientX ?? -1, custom.detail?.clientY ?? -1);
  }

  function handleExplorerDragEnd(event: Event) {
    const custom = event as CustomEvent<{ path?: string; clientX?: number; clientY?: number }>;
    const endedPath = custom.detail?.path?.trim() || draggedExplorerPath;
    const droppedOverBar =
      typeof custom.detail?.clientX === 'number' && typeof custom.detail?.clientY === 'number'
        ? updateExplorerDragPoint(custom.detail.clientX, custom.detail.clientY)
        : lastExplorerDragPoint
          ? isPointInsideBar(lastExplorerDragPoint.x, lastExplorerDragPoint.y)
          : isDragOver;

    if (endedPath && droppedOverBar) {
      draggedExplorerPath = endedPath;
      attachPathsToInput([draggedExplorerPath]);
    }
    draggedExplorerPath = null;
    lastExplorerDragPoint = null;
    isDragOver = false;
  }

  function handleDocumentDragOver(event: DragEvent) {
    if (!draggedExplorerPath) return;
    const overBar = updateExplorerDragPoint(event.clientX, event.clientY);
    if (overBar) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  }

  function handleDocumentDrop(event: DragEvent) {
    const droppedPath =
      draggedExplorerPath ||
      event.dataTransfer?.getData('application/x-soryq-path')?.trim() ||
      event.dataTransfer?.getData('text/plain')?.trim() ||
      null;

    if (!droppedPath) return;
    const overBar = updateExplorerDragPoint(event.clientX, event.clientY);
    if (overBar) {
      event.preventDefault();
      event.stopPropagation();
      attachPathsToInput([droppedPath]);
    }
    draggedExplorerPath = null;
    lastExplorerDragPoint = null;
    isDragOver = false;
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('mousedown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    document.addEventListener('keyup', handleGlobalVoiceShortcutUp);
    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('drop', handleDocumentDrop);
    window.addEventListener('soryq-explorer-drag-start', handleExplorerDragStart as EventListener);
    window.addEventListener('soryq-explorer-drag-move', handleExplorerDragMove as EventListener);
    window.addEventListener('soryq-explorer-drag-end', handleExplorerDragEnd);

    // Tauri v2 intercepts OS file drops before HTML5 events reach the webview.
    // Use getCurrentWindow().onDragDropEvent() — the correct Tauri v2 API.
    let unlistenDragDrop: (() => void) | undefined;

    getCurrentWindow().onDragDropEvent((event) => {
      if (draggedExplorerPath) {
        return;
      }

      const type = event.payload.type;

      if (type === 'enter') {
        isGlobalFileDrag = true;
        return;
      }

      if (type === 'leave') {
        isGlobalFileDrag = false;
        isDragOver = false;
        return;
      }

      if (type === 'over') {
        if (!barEl) return;
        const pos = (event.payload as any).position as { x: number; y: number };
        const rect = barEl.getBoundingClientRect();
        isDragOver = pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom;
        return;
      }

      if (type === 'drop') {
        isGlobalFileDrag = false;
        const payload = event.payload as any;
        const paths: string[] = payload.paths ?? [];

        if (!barEl || !paths.length) { isDragOver = false; return; }

        const pos = payload.position as { x: number; y: number };
        const rect = barEl.getBoundingClientRect();
        const isOverBar = pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom;

        isDragOver = false;
        if (!isOverBar) return;

        attachPathsToInput(paths);
      }
    }).then((u) => { unlistenDragDrop = u; });

      return () => {
        document.removeEventListener('mousedown', handleDocumentPointerDown);
        document.removeEventListener('keydown', handleGlobalVoiceShortcut);
        document.removeEventListener('keyup', handleGlobalVoiceShortcutUp);
        document.removeEventListener('dragover', handleDocumentDragOver);
      document.removeEventListener('drop', handleDocumentDrop);
      window.removeEventListener('soryq-explorer-drag-start', handleExplorerDragStart as EventListener);
      window.removeEventListener('soryq-explorer-drag-move', handleExplorerDragMove as EventListener);
      window.removeEventListener('soryq-explorer-drag-end', handleExplorerDragEnd);
      unlistenDragDrop?.();
    };
  });
</script>

<div class="floating-prompt-shell" class:active={isActive} bind:this={shellEl}>
    {#if historyOpen && historyItems.length > 0}
      <div class="history-panel"
        onmouseenter={() => isHovered = true}
        onmouseleave={() => isHovered = false}
      >
        <div class="history-header">
          <span class="history-label">Recent prompts</span>
          <span class="history-hint">Click to re-use</span>
        </div>
        <div class="history-list">
          {#each historyItems as item, i}
            <button class="history-item" onclick={() => selectHistoryItem(item)} title={item}>
              <span class="history-index">{i + 1}</span>
              <span class="history-text">{item}</span>
              <svg class="history-insert-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 10 4 15 9 20"/>
                <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
              </svg>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="floating-prompt-bar"
      bind:this={barEl}
      class:disabled={!canSend}
      class:drag-over={isDragOver}
      class:global-drag={isGlobalFileDrag && !isDragOver}
      ondragenter={handleInternalDragEnter}
      ondragover={handleInternalDragOver}
      ondragleave={handleInternalDragLeave}
      ondrop={handleInternalDrop}
      onmouseenter={() => isHovered = true}
      onmouseleave={() => isHovered = false}
      onfocusin={() => isFocused = true}
      onfocusout={() => isFocused = false}
    >
      {#if draggedExplorerPath ? isDragOver : (isGlobalFileDrag || isDragOver)}
        <div class="drop-overlay">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" x2="12" y1="3" y2="15"/>
          </svg>
          Drop file to add as context
        </div>
      {/if}
      <button
        class="history-toggle"
        onclick={() => historyOpen = !historyOpen}
        title="Toggle prompt history"
        aria-label="Toggle prompt history"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3v5h5"/>
          <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>
          <path d="M12 7v5l3 3"/>
        </svg>
      </button>

      <button
        class="spawn-toggle"
        class:active={spawnOpen}
        onclick={() => { spawnOpen = !spawnOpen; if (!spawnOpen) spawnCounts = new Map(); historyOpen = false; targetPickerOpen = false; }}
        title="Spawn agent"
        aria-label="Spawn agent"
        disabled={!$activeProject}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {#if totalSpawnCount > 0}
          <span class="spawn-toggle-badge">{totalSpawnCount}</span>
        {/if}
      </button>

      <button
        class="attach-toggle"
        onclick={attachFiles}
        title="Attach file paths"
        aria-label="Attach file paths"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
      </button>

      <button
        class="voice-toggle"
        class:listening={isListening}
        class:refining={isRefining}
        onclick={toggleVoiceInput}
        title={isRefining ? 'Refining with AI…' : isListening ? 'Stop voice input' : 'Start voice input'}
        aria-label={isRefining ? 'Refining with AI…' : isListening ? 'Stop voice input' : 'Start voice input'}
      >
        {#if isRefining}
          <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <polyline points="21 3 21 8 16 8"/>
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
            <line x1="12" x2="12" y1="19" y2="22"/>
          </svg>
        {/if}
      </button>

      <button
        class="broadcast-toggle"
        class:active={broadcastAgents}
        onclick={toggleBroadcastAgents}
        title={broadcastAgents ? 'Broadcast to all running AI agent terminals' : 'Enable broadcast to all running AI agent terminals'}
        aria-label={broadcastAgents ? 'Broadcast to all running AI agent terminals' : 'Enable broadcast to all running AI agent terminals'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 12h4"/>
          <path d="M16 12h4"/>
          <path d="M12 4v4"/>
          <path d="M12 16v4"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>

      <div class="prompt-copy">
        {#if spawnOpen && spawnPresets.length > 0}
          <div class="spawn-picker">
            <div class="spawn-header">Spawn Agents</div>
            {#each spawnPresets as preset (preset.id)}
              {@const count = spawnCounts.get(preset.command) ?? 0}
              <div class="spawn-row" class:selected={count > 0}>
                <div class="spawn-counter">
                  <button
                    class="counter-btn"
                    onclick={() => decrementSpawn(preset.command)}
                    disabled={count === 0}
                    title="Spawn fewer"
                    aria-label="Spawn fewer {preset.name}"
                  >−</button>
                  <span class="counter-value">{count}</span>
                  <button
                    class="counter-btn"
                    onclick={() => incrementSpawn(preset.command)}
                    title="Spawn more"
                    aria-label="Spawn more {preset.name}"
                  >+</button>
                </div>
                <button
                  class="spawn-item"
                  onclick={() => incrementSpawn(preset.command)}
                  title="Add one"
                >
                  <span class="spawn-name">{preset.name}</span>
                  <span class="spawn-cmd">{preset.command}</span>
                </button>
              </div>
            {/each}
            <div class="spawn-footer">
              <button
                class="spawn-confirm"
                onclick={handleSpawnConfirm}
                disabled={totalSpawnCount === 0}
              >
                Spawn{totalSpawnCount > 0 ? ` ${totalSpawnCount}` : ''}
              </button>
            </div>
          </div>
        {/if}
        <div class="prompt-meta">
          {#if broadcastAgents}
            <span class="prompt-target"
              >Broadcast to {broadcastTargets.length} AI agent terminal{broadcastTargets.length === 1 ? '' : 's'}</span
            >
          {:else}
            <button
              class="prompt-target prompt-target-btn"
              class:pinned={isPinned}
              onclick={toggleTargetPicker}
              title="Click to choose target terminal"
            >
              {promptTarget ? getSessionLabel(promptTarget, $sessions) : 'No active terminal'}
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chevron-icon">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          {/if}
          <span class="prompt-hint">Enter to send, Up/Down for history, mic to dictate</span>
        </div>

        {#if targetPickerOpen && runningSessions.length > 0}
          <div class="target-picker">
            {#each runningSessions as s (s.id)}
              <button
                class="target-item"
                class:active={promptTarget?.id === s.id}
                onclick={() => selectTarget(s.id)}
              >
                {#if s.role}
                  <span class="target-dot" style="background: {s.role === 'Server' ? '#4ade80' : s.role === 'Tests' ? '#60a5fa' : s.role === 'Build' ? '#fb923c' : s.role === 'Agent' ? '#a78bfa' : s.role === 'Git' ? '#fbbf24' : '#9ca3af'}"></span>
                {/if}
                <span class="target-label">{getSessionLabel(s, $sessions)}</span>
                {#if s.id === promptTarget?.id && !isPinned}
                  <span class="target-auto-badge">auto</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}

        {#if pastedImages.length > 0}
          <div class="image-chips">
            {#each pastedImages as img, i (img.objectUrl)}
              <div class="image-chip">
                <img src={img.objectUrl} alt="Pasted image" class="chip-thumb" />
                <span class="chip-label">{img.name || 'image'}</span>
                <button class="chip-remove" onclick={() => removeImage(i)} title="Remove image" aria-label="Remove image">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <textarea
          bind:this={inputEl}
          bind:value={inputValue}
          class="prompt-input"
          placeholder={canSend ? (broadcastAgents ? 'Broadcast to all running AI agent terminals...' : 'Prompt the active terminal...') : 'Open or focus a terminal to send prompts'}
          rows="1"
          disabled={!canSend}
          oninput={handleInput}
          onkeydown={handleKeyDown}
          onpaste={handlePaste}
          onmousedown={() => { targetPickerOpen = false; historyOpen = false; }}
        ></textarea>
      </div>

      <button
        class="send-btn"
        onclick={submitPrompt}
        disabled={!canSend || (!inputValue.trim() && pastedImages.length === 0)}
        title={broadcastAgents ? 'Broadcast prompt to all running AI agent terminals' : (preferredAgentTerminal ? 'Send prompt to AI agent terminal' : 'Send prompt to active terminal')}
      >
        Send
      </button>
    </div>
</div>


<style>
  .floating-prompt-shell {
    position: absolute;
    left: 50%;
    bottom: 18px;
    transform: translateX(-50%);
    width: min(760px, calc(100% - 40px));
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    opacity: 0.28;
    transition: opacity 0.4s ease;
  }

  .floating-prompt-shell.active {
    opacity: 1;
  }

  .history-panel,
  .floating-prompt-bar {
    pointer-events: auto;
  }

  .history-panel {
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 16px;
    background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    box-shadow: var(--glass-shadow, 0 24px 60px -20px rgba(0, 0, 0, 0.65)), inset 0 1px 0 var(--glass-rim-strong, rgba(255, 255, 255, 0.13));
    overflow: hidden;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 6px;
    flex-shrink: 0;
  }

  .history-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
  }

  .history-hint {
    font-size: 9.5px;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .history-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px 8px;
    max-height: 220px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb, rgba(128,128,128,0.2)) transparent;
  }

  .history-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 0;
    border-radius: 9px;
    padding: 8px 10px;
    text-align: left;
    color: var(--text-secondary);
    background: transparent;
    transition: background 0.12s, color 0.12s;
    overflow: hidden;
    min-width: 0;
  }

  .history-index {
    flex-shrink: 0;
    width: 16px;
    font-size: 9.5px;
    font-weight: 700;
    color: var(--text-muted);
    text-align: center;
    opacity: 0.5;
  }

  .history-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--editor-font-family, monospace);
    font-size: 12px;
  }

  .history-insert-icon {
    flex-shrink: 0;
    opacity: 0;
    color: var(--accent);
    transition: opacity 0.12s;
  }

  .history-item:hover {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
    color: var(--text-primary);
  }

  .history-item:hover .history-insert-icon {
    opacity: 1;
  }

  .history-item:hover .history-index {
    opacity: 1;
    color: var(--accent);
  }

  .floating-prompt-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    border-radius: 20px;
    background: color-mix(in srgb, var(--bg-secondary) 86%, transparent);
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    box-shadow: var(--glass-shadow, 0 24px 60px -20px rgba(0, 0, 0, 0.65)), inset 0 1px 0 var(--glass-rim-strong, rgba(255, 255, 255, 0.13));
  }

  .floating-prompt-bar.disabled {
    opacity: 0.82;
  }

  .floating-prompt-bar.global-drag {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  }

  .floating-prompt-bar.drag-over {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent), 0 18px 50px rgba(0, 0, 0, 0.32);
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 500;
    color: var(--accent);
    pointer-events: none;
    z-index: 5;
    background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
    backdrop-filter: blur(6px);
  }

  .floating-prompt-bar.drag-over .drop-overlay {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary));
  }

  .history-toggle,
  .attach-toggle,
  .broadcast-toggle,
  .voice-toggle,
  .send-btn {
    flex-shrink: 0;
    border: 0;
    transition: background 0.15s, color 0.15s, opacity 0.15s;
  }

  .history-toggle,
  .attach-toggle,
  .broadcast-toggle,
  .voice-toggle {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    color: var(--text-secondary);
  }

  /* spawn-toggle shares the same base sizing via its own rule above,
     but needs to participate in responsive shrink alongside the others */

  .history-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .attach-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .broadcast-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .broadcast-toggle.active {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-primary));
    color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 34%, transparent);
  }

  .voice-toggle:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .voice-toggle.listening {
    background: rgba(239, 68, 68, 0.14);
    color: var(--error);
    box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.2);
  }

  .voice-toggle.refining {
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-primary));
    color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 0.9s linear infinite;
  }

  .prompt-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
  }

  .prompt-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-width: 0;
  }

  .prompt-target {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .prompt-target-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    border-radius: 4px;
    transition: color 0.12s;
  }

  .prompt-target-btn:hover {
    color: var(--accent);
  }

  .prompt-target-btn.pinned {
    color: var(--accent);
  }

  .chevron-icon {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .target-picker {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    background: color-mix(in srgb, var(--bg-secondary) 96%, transparent);
    backdrop-filter: blur(18px);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 14px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.26);
    z-index: 10;
  }

  .target-item {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .target-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .target-item.active {
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-primary));
    color: var(--text-primary);
  }

  .target-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .target-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .target-auto-badge {
    font-size: 9px;
    color: var(--text-muted);
    background: var(--bg-tertiary);
    border-radius: 4px;
    padding: 1px 5px;
    flex-shrink: 0;
  }

  .prompt-hint {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
  }

  .image-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
    border-radius: 10px;
    border: 1px solid var(--border);
  }

  .image-chip {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    max-width: 64px;
  }

  .chip-thumb {
    display: block;
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: 8px;
    border: 1.5px solid var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }

  .image-chip:hover .chip-thumb {
    transform: scale(1.04);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
  }

  .chip-label {
    font-size: 9px;
    color: var(--text-muted);
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
    line-height: 1.2;
  }

  .chip-remove {
    position: absolute;
    top: -5px;
    right: -5px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-muted);
    padding: 0;
    transition: background 0.12s, color 0.12s;
  }

  .chip-remove:hover {
    background: rgba(239, 68, 68, 0.18);
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.3);
  }

  .prompt-input {
    width: 100%;
    min-height: 24px;
    max-height: 100px;
    resize: none;
    overflow-y: auto;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-family: var(--editor-font-family, monospace);
    font-size: 12.5px;
    line-height: 1.45;
    height: 24px;
  }

  .prompt-input::placeholder {
    color: var(--text-muted);
  }

  .send-btn {
    height: 36px;
    padding: 0 16px;
    border-radius: 12px;
    background: var(--button-bg, var(--accent));
    color: var(--button-text, #fff);
    font-size: 12px;
    font-weight: 600;
  }

  @container center-panel (max-width: 860px) {
    .floating-prompt-shell {
      width: calc(100% - 24px);
      bottom: 14px;
    }

    .floating-prompt-bar {
      gap: 8px;
      padding: 9px 10px;
      border-radius: 18px;
    }

    .history-panel {
      border-radius: 14px;
    }

    .history-item {
      padding: 7px 8px;
    }

    .history-text {
      font-size: 11px;
    }

    .history-toggle,
    .attach-toggle,
    .spawn-toggle,
    .broadcast-toggle,
    .voice-toggle,
    .send-btn {
      height: 34px;
    }

    .history-toggle,
    .attach-toggle,
    .spawn-toggle,
    .broadcast-toggle,
    .voice-toggle {
      width: 34px;
      border-radius: 10px;
    }

    .prompt-copy {
      gap: 5px;
    }

    .prompt-meta {
      gap: 8px;
    }

    .prompt-target {
      font-size: 10px;
    }

    .prompt-hint {
      font-size: 9px;
    }

    .prompt-input {
      font-size: 12px;
      min-height: 22px;
      height: 22px;
    }

    .send-btn {
      padding: 0 12px;
      border-radius: 10px;
      font-size: 11px;
    }
  }

  @container center-panel (max-width: 620px) {
    .floating-prompt-shell {
      width: calc(100% - 16px);
      bottom: 10px;
    }

    .floating-prompt-bar {
      gap: 6px;
      padding: 8px;
      border-radius: 16px;
    }

    .history-panel {
      border-radius: 12px;
    }

    .history-list {
      max-height: 160px;
      padding: 3px 4px 6px;
    }

    .history-item {
      padding: 6px 7px;
      border-radius: 8px;
    }

    .history-text {
      font-size: 10px;
    }

    .history-toggle,
    .attach-toggle,
    .spawn-toggle,
    .broadcast-toggle,
    .voice-toggle {
      width: 30px;
      height: 30px;
      border-radius: 9px;
    }

    .history-toggle :global(svg),
    .attach-toggle :global(svg),
    .spawn-toggle :global(svg),
    .broadcast-toggle :global(svg),
    .voice-toggle :global(svg) {
      width: 12px;
      height: 12px;
    }

    .prompt-copy {
      gap: 4px;
    }

    .prompt-meta {
      flex-direction: column;
      align-items: flex-start;
      gap: 3px;
    }

    .prompt-target {
      font-size: 9.5px;
      max-width: 100%;
    }

    .prompt-hint {
      display: none;
    }

    .prompt-input {
      font-size: 11px;
      line-height: 1.35;
      min-height: 20px;
      height: 20px;
    }

    .send-btn {
      height: 30px;
      min-width: 46px;
      padding: 0 10px;
      border-radius: 9px;
      font-size: 10px;
    }
  }

  .send-btn:hover:not(:disabled) {
    background: var(--button-hover-bg, var(--accent-hover));
  }

  .send-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .spawn-toggle {
    width: 36px;
    height: 36px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-primary);
    color: var(--text-secondary);
    flex-shrink: 0;
    border: 0;
    transition: background 0.15s, color 0.15s;
    position: relative;
  }

  .spawn-toggle-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 15px;
    height: 15px;
    padding: 0 3px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--button-text, #fff);
    font-size: 8.5px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    pointer-events: none;
    box-shadow: 0 0 0 2px var(--bg-primary);
  }

  .spawn-toggle:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .spawn-toggle.active {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-primary));
    color: var(--accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 34%, transparent);
  }

  .spawn-toggle:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .spawn-picker {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    background: color-mix(in srgb, var(--bg-secondary) 96%, transparent);
    backdrop-filter: blur(18px);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 14px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.26);
    z-index: 10;
  }

  .spawn-header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: var(--text-muted);
    padding: 4px 10px 6px;
  }

  .spawn-row {
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: 9px;
    transition: background 0.12s;
  }

  .spawn-row.selected {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
  }

  .spawn-item {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: color 0.12s;
  }

  .spawn-row:not(.selected) .spawn-item:hover {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
    color: var(--text-primary);
  }

  .spawn-row.selected .spawn-item {
    color: var(--text-primary);
  }

  .spawn-counter {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding-left: 4px;
  }

  .counter-value {
    min-width: 16px;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .spawn-name {
    flex: 1;
    min-width: 0;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spawn-cmd {
    font-family: var(--editor-font-family, monospace);
    font-size: 10.5px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .counter-btn {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    background: transparent;
    color: var(--accent);
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.12s, opacity 0.12s;
  }

  .counter-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-primary));
  }

  .counter-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .spawn-footer {
    padding: 6px 4px 2px;
    display: flex;
    justify-content: flex-end;
    border-top: 1px solid var(--border);
    margin-top: 2px;
  }

  .spawn-confirm {
    height: 30px;
    padding: 0 14px;
    border-radius: 9px;
    border: 0;
    background: var(--button-bg, var(--accent));
    color: var(--button-text, #fff);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }

  .spawn-confirm:hover:not(:disabled) {
    background: var(--button-hover-bg, var(--accent-hover));
  }

  .spawn-confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  @media (max-width: 720px) {
    .floating-prompt-shell {
      width: calc(100% - 20px);
      bottom: 12px;
    }
  }

  @container center-panel (max-width: 480px) {
    .floating-prompt-shell {
      width: calc(100% - 12px);
      bottom: 8px;
    }

    .floating-prompt-bar {
      gap: 4px;
      padding: 7px 7px;
      border-radius: 14px;
    }

    .voice-toggle,
    .attach-toggle {
      display: none;
    }

    .history-toggle,
    .spawn-toggle,
    .broadcast-toggle {
      width: 28px;
      height: 28px;
      border-radius: 8px;
    }

    .history-toggle :global(svg),
    .spawn-toggle :global(svg),
    .broadcast-toggle :global(svg) {
      width: 11px;
      height: 11px;
    }

    .send-btn {
      height: 28px;
      min-width: 40px;
      padding: 0 8px;
      border-radius: 8px;
      font-size: 10px;
    }

    .prompt-input {
      font-size: 11px;
      min-height: 20px;
      height: 20px;
    }

    .prompt-meta {
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    }

    .prompt-hint {
      display: none;
    }

    .prompt-target {
      font-size: 9px;
    }
  }
</style>
