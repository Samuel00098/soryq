<script lang="ts">
  import { get } from 'svelte/store';
  import { invoke } from '@tauri-apps/api/core';
  import {
    activeSessionId,
    sessions,
    commandHistory,
    addHistoryEntry,
    writeToSession,
    setSessionExecuting,
    startCommandBlock,
    promptBarInput,
    activateSessionInPane,
    requestTerminalInput,
    getSessionLabel,
  } from '$lib/stores/terminal';
  import { layout } from '$lib/stores/layout';
  import { showToast } from '$lib/stores/notification';
  import { createVoiceInputSession } from '$lib/services/voice-input';
  import { activeProject } from '$lib/stores/workspace';

  let inputValue = $state('');
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let historyIndex = $state(-1);
  let draftBeforeHistory = $state('');
  let historyOpen = $state(false);
  let isListening = $state(false);
  let broadcastAgents = $state(false);
  let shellEl = $state<HTMLDivElement | null>(null);
  let isHovered = $state(false);
  let isFocused = $state(false);
  let isDragOver = $state(false);
  // Manually-pinned target session ID — overrides auto-selection when set
  let manualTargetId = $state<number | null>(null);
  let targetPickerOpen = $state(false);
  let isActive = $derived(
    isHovered || isFocused || historyOpen || targetPickerOpen || isListening || broadcastAgents || isDragOver || isGlobalFileDrag
  );

  type PastedImage = { objectUrl: string; dataUrl: string; name: string };
  let pastedImages = $state<PastedImage[]>([]);

  let activeTerminal = $derived($sessions.find((session) => session.id === $activeSessionId) ?? null);
  let preferredAgentTerminal = $derived(
    activeTerminal?.agentPreset
      ? activeTerminal
      : ($sessions
          .filter((session) => session.isRunning && session.agentPreset)
          .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))[0] ?? null)
  );
  let autoTarget = $derived(preferredAgentTerminal ?? activeTerminal);
  let manualTarget = $derived(
    manualTargetId !== null
      ? ($sessions.find((s) => s.id === manualTargetId && s.isRunning) ?? null)
      : null
  );
  let promptTarget = $derived(manualTarget ?? autoTarget);
  let broadcastTargets = $derived(
    $sessions
      .filter((session) => session.isRunning && session.agentPreset)
      .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))
  );
  let runningSessions = $derived($sessions.filter((s) => s.isRunning));
  let historyItems = $derived(($commandHistory || []).slice(0, 12));
  let canSend = $derived(broadcastAgents ? broadcastTargets.length > 0 : Boolean(promptTarget?.isRunning));

  // Clear manual pin if the session dies
  $effect(() => {
    if (manualTargetId !== null && !$sessions.find((s) => s.id === manualTargetId && s.isRunning)) {
      manualTargetId = null;
    }
  });

  function selectTarget(id: number) {
    manualTargetId = id;
    targetPickerOpen = false;
    focusInput();
  }

  function toggleTargetPicker() {
    targetPickerOpen = !targetPickerOpen;
    historyOpen = false;
  }

  function resolvePromptTarget() {
    const allSessions = get(sessions);
    if (manualTargetId !== null) {
      const manual = allSessions.find((s) => s.id === manualTargetId && s.isRunning);
      if (manual) return manual;
    }
    const currentActiveSessionId = get(activeSessionId);
    const currentActiveTerminal = allSessions.find((session) => session.id === currentActiveSessionId) ?? null;
    const currentPreferredAgentTerminal = currentActiveTerminal?.agentPreset
      ? currentActiveTerminal
      : (allSessions
          .filter((session) => session.isRunning && session.agentPreset)
          .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))[0] ?? null);
    return currentPreferredAgentTerminal ?? currentActiveTerminal;
  }

  function resolveBroadcastTargets() {
    return get(sessions)
      .filter((session) => session.isRunning && session.agentPreset)
      .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0));
  }

  function focusInput() {
    requestAnimationFrame(() => inputEl?.focus());
  }

  function adjustInputHeight() {
    if (!inputEl) return;
    inputEl.style.height = '0px';
    const nextHeight = Math.min(inputEl.scrollHeight, 100);
    inputEl.style.height = `${Math.max(nextHeight, 24)}px`;
  }

  function resetHistoryCursor() {
    historyIndex = -1;
    draftBeforeHistory = '';
  }

  function sendPromptToTarget(sessionId: number, text: string, agentPreset?: string | null) {
    if (agentPreset === 'codex') {
      requestTerminalInput(sessionId, text);
      setTimeout(() => writeToSession(sessionId, '\r'), 80);
      return;
    }
    writeToSession(sessionId, `${text}\r`);
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

  async function saveImageToDisk(img: PastedImage): Promise<string | null> {
    try {
      const projectPath = get(activeProject)?.root_path;
      if (!projectPath) return null;
      const savePath = `${projectPath}/.devdock/attachments/${img.name}`;
      const response = await fetch(img.dataUrl);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const data = Array.from(new Uint8Array(arrayBuffer));
      await invoke('fs_write_binary', { path: savePath, data });
      return savePath;
    } catch {
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
      const name = `paste-${Date.now()}.png`;
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
      pastedImages = [];
      const paths = await Promise.all(toSave.map(saveImageToDisk));
      const validPaths = paths.filter(Boolean) as string[];
      if (validPaths.length > 0) {
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
      sendPromptToTarget(target.id, finalText, target.agentPreset);
      setSessionExecuting(target.id, true);
      startCommandBlock(target.id, finalText);
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
      event.preventDefault();
      stepHistory(1);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      stepHistory(-1);
      return;
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
      showToast('Listening for terminal prompt...', 'info');
    },
    onResult: (transcript) => {
      inputValue = inputValue ? `${inputValue} ${transcript}` : transcript;
      requestAnimationFrame(adjustInputHeight);
      focusInput();
    },
    onEnd: () => {
      isListening = false;
    },
    onError: (message) => {
      isListening = false;
      showToast(message, 'error');
    },
  });

  async function toggleVoiceInput() {
    if (isListening) {
      voiceInput.stop();
      return;
    }
    await voiceInput.start();
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

      const paths = (Array.isArray(selected) ? selected : [selected])
        .map((path) => {
          const value = String(path);
          return value.includes(' ') ? `"${value}"` : value;
        })
        .join(' ');

      inputValue = inputValue ? `${inputValue} ${paths}` : paths;
      historyOpen = false;
      resetHistoryCursor();
      requestAnimationFrame(() => {
        adjustInputHeight();
        inputEl?.focus();
        inputEl?.setSelectionRange(inputEl.value.length, inputEl.value.length);
      });
    } catch (error) {
      console.error('Failed to attach files to prompt:', error);
      showToast('Failed to attach files', 'error');
    }
  }

  $effect(() => {
    const text = $promptBarInput;
    if (text) {
      inputValue = text;
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
    if (!historyOpen && !targetPickerOpen) return;
    const target = event.target as Node | null;
    if (shellEl && target && !shellEl.contains(target)) {
      historyOpen = false;
      targetPickerOpen = false;
    }
  }

  function handleGlobalVoiceShortcut(event: KeyboardEvent) {
    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat) return;
    const activeElement = document.activeElement;
    if (!shellEl || !activeElement || !shellEl.contains(activeElement)) return;
    event.preventDefault();
    toggleVoiceInput();
  }

  // Track whether the user is dragging files anywhere over the window
  let isGlobalFileDrag = $state(false);
  let globalDragCounter = 0; // dragenter/dragleave fire for every child element, use counter

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('mousedown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleGlobalVoiceShortcut);

    function onWindowDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      globalDragCounter++;
      isGlobalFileDrag = true;
    }

    function onWindowDragLeave(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      globalDragCounter--;
      if (globalDragCounter <= 0) {
        globalDragCounter = 0;
        isGlobalFileDrag = false;
        isDragOver = false;
      }
    }

    function onWindowDrop(e: DragEvent) {
      globalDragCounter = 0;
      isGlobalFileDrag = false;
      // If the drop wasn't on our bar, prevent the browser default (opening the file)
      if (!shellEl?.contains(e.target as Node)) {
        e.preventDefault();
      }
    }

    function onWindowDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    }

    window.addEventListener('dragenter', onWindowDragEnter);
    window.addEventListener('dragleave', onWindowDragLeave);
    window.addEventListener('drop', onWindowDrop);
    window.addEventListener('dragover', onWindowDragOver);

    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleGlobalVoiceShortcut);
      window.removeEventListener('dragenter', onWindowDragEnter);
      window.removeEventListener('dragleave', onWindowDragLeave);
      window.removeEventListener('drop', onWindowDrop);
      window.removeEventListener('dragover', onWindowDragOver);
    };
  });

  function handleDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    isDragOver = true;
  }

  function handleDragLeave(e: DragEvent) {
    const bar = e.currentTarget as HTMLElement;
    if (!bar.contains(e.relatedTarget as Node)) {
      isDragOver = false;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;
    isGlobalFileDrag = false;
    globalDragCounter = 0;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;

    const paths = files
      .map((f) => {
        const p = (f as File & { path?: string }).path ?? f.name;
        return p.includes(' ') ? `"${p}"` : p;
      })
      .join(' ');

    inputValue = inputValue ? `${inputValue} ${paths}` : paths;
    historyOpen = false;
    targetPickerOpen = false;
    resetHistoryCursor();
    requestAnimationFrame(() => {
      adjustInputHeight();
      inputEl?.focus();
      inputEl?.setSelectionRange(inputValue.length, inputValue.length);
    });
  }
</script>

<div class="floating-prompt-shell" class:active={isActive} bind:this={shellEl}>
    {#if historyOpen && historyItems.length > 0}
      <div class="history-panel"
        onmouseenter={() => isHovered = true}
        onmouseleave={() => isHovered = false}
      >
        {#each historyItems as item}
          <button class="history-item" onclick={() => selectHistoryItem(item)} title={item}>
            <span>{item}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="floating-prompt-bar"
      class:disabled={!canSend}
      class:drag-over={isDragOver}
      class:global-drag={isGlobalFileDrag && !isDragOver}
      onmouseenter={() => isHovered = true}
      onmouseleave={() => isHovered = false}
      onfocusin={() => isFocused = true}
      onfocusout={() => isFocused = false}
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
    >
      {#if isGlobalFileDrag}
        <div class="drop-overlay" ondragover={handleDragOver} ondragleave={handleDragLeave} ondrop={handleDrop}>
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
        onclick={toggleVoiceInput}
        title={isListening ? 'Stop voice input' : 'Start voice input'}
        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
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
        <div class="prompt-meta">
          {#if broadcastAgents}
            <span class="prompt-target"
              >Broadcast to {broadcastTargets.length} AI agent terminal{broadcastTargets.length === 1 ? '' : 's'}</span
            >
          {:else}
            <button
              class="prompt-target prompt-target-btn"
              class:pinned={manualTargetId !== null}
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
                {#if s.id === promptTarget?.id && manualTargetId === null}
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
    max-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--border));
    border-radius: 16px;
    background: color-mix(in srgb, var(--bg-secondary) 90%, transparent);
    backdrop-filter: blur(18px);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
  }

  .history-item {
    width: 100%;
    border: 0;
    border-radius: 10px;
    padding: 10px 12px;
    text-align: left;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
    transition: background 0.15s, color 0.15s;
    overflow: hidden;
  }

  .history-item span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--editor-font-family, monospace);
    font-size: 12px;
  }

  .history-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .floating-prompt-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    border-radius: 20px;
    background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
    backdrop-filter: blur(20px);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.32);
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
    pointer-events: all;
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
    gap: 6px;
  }

  .image-chip {
    position: relative;
    flex-shrink: 0;
  }

  .chip-thumb {
    display: block;
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid var(--border);
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
      padding: 8px;
      border-radius: 14px;
    }

    .history-item {
      padding: 8px 10px;
    }

    .history-item span {
      font-size: 11px;
    }

    .history-toggle,
    .attach-toggle,
    .broadcast-toggle,
    .voice-toggle,
    .send-btn {
      height: 34px;
    }

    .history-toggle,
    .attach-toggle,
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
      max-height: 160px;
      padding: 7px;
      border-radius: 12px;
    }

    .history-item {
      padding: 7px 8px;
      border-radius: 8px;
    }

    .history-item span {
      font-size: 10px;
    }

    .history-toggle,
    .attach-toggle,
    .broadcast-toggle,
    .voice-toggle {
      width: 30px;
      height: 30px;
      border-radius: 9px;
    }

    .history-toggle :global(svg),
    .attach-toggle :global(svg),
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

  @media (max-width: 720px) {
    .floating-prompt-shell {
      width: calc(100% - 20px);
      bottom: 12px;
    }
  }
</style>
