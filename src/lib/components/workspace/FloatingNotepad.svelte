<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { notes, getNoteForProject, setNoteForProject, closeFloatingNote } from '$lib/stores/notes';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { createVoiceInputSession } from '$lib/services/voice-input';

  let posX = $state(window.innerWidth - 420);
  let posY = $state(80);
  let width = $state(380);
  let height = $state(480);
  let previewMode = $state(false);
  let dragging = $state(false);
  let resizing = $state(false);
  let dragStartX = 0, dragStartY = 0, dragOriginX = 0, dragOriginY = 0;
  let resizeStartX = 0, resizeStartY = 0, resizeOriginW = 0, resizeOriginH = 0;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  let content = $state('');
  let saved = $state(true);
  let panelEl = $state<HTMLDivElement | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let isListening = $state(false);
  let voiceLocked = $state(false);
  let voiceHeld = $state(false);
  let voiceStopping = $state(false);
  let renderedHtml = $derived(
    previewMode ? DOMPurify.sanitize(marked.parse(content) as string) : ''
  );

  function queueSave() {
    saved = false;
    if (saveTimer) clearTimeout(saveTimer);
    if ($activeProject?.id) {
      saveTimer = setTimeout(() => {
        setNoteForProject($activeProject!.id, content);
        saved = true;
      }, 400);
    }
  }

  $effect(() => {
    const pid = $activeProject?.id;
    content = pid ? getNoteForProject(pid) : '';
    saved = true;
  });

  $effect(() => {
    const _ = $notes;
    const pid = $activeProject?.id;
    if (pid) {
      content = getNoteForProject(pid);
    }
  });

  function handleInput(e: Event) {
    content = (e.target as HTMLTextAreaElement).value;
    queueSave();
  }

  const voiceInput = createVoiceInputSession({
    onStart: () => {
      isListening = true;
      showToast('Listening for notes...', 'info');
    },
    onResult: (transcript) => {
      const spacer = content.trim().length > 0 ? ' ' : '';
      content = `${content}${spacer}${transcript}`;
      queueSave();
      requestAnimationFrame(() => textareaEl?.focus());
    },
    onEnd: () => {
      isListening = false;
      if (!voiceStopping && (voiceLocked || voiceHeld)) {
        queueMicrotask(() => {
          if (voiceLocked || voiceHeld) {
            voiceInput.start();
          }
        });
      }
      voiceStopping = false;
    },
    onError: (message) => {
      isListening = false;
      voiceLocked = false;
      voiceHeld = false;
      voiceStopping = false;
      showToast(message, 'error');
    },
  });

  async function toggleVoiceInput() {
    if (isListening && voiceLocked) {
      voiceLocked = false;
      voiceStopping = true;
      voiceInput.stop();
      return;
    }
    voiceLocked = true;
    await voiceInput.start();
  }

  function handleGlobalVoiceShortcut(event: KeyboardEvent) {
    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat) return;
    const activeElement = document.activeElement;
    if (!panelEl || !activeElement || !panelEl.contains(activeElement)) return;
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

  function startDrag(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragOriginX = posX; dragOriginY = posY;
    e.preventDefault();
  }

  function startResize(e: MouseEvent) {
    resizing = true;
    resizeStartX = e.clientX; resizeStartY = e.clientY;
    resizeOriginW = width; resizeOriginH = height;
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseMove(e: MouseEvent) {
    if (dragging) {
      posX = Math.max(0, Math.min(window.innerWidth - width, dragOriginX + (e.clientX - dragStartX)));
      posY = Math.max(0, Math.min(window.innerHeight - 60, dragOriginY + (e.clientY - dragStartY)));
    }
    if (resizing) {
      width = Math.max(260, resizeOriginW + (e.clientX - resizeStartX));
      height = Math.max(180, resizeOriginH + (e.clientY - resizeStartY));
    }
  }

  function onMouseUp() {
    dragging = false;
    resizing = false;
  }

  onMount(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    document.addEventListener('keyup', handleGlobalVoiceShortcutUp);
  });

  onDestroy(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', handleGlobalVoiceShortcut);
    document.removeEventListener('keyup', handleGlobalVoiceShortcutUp);
    if (saveTimer) clearTimeout(saveTimer);
  });
</script>

<div
  bind:this={panelEl}
  class="floating-notepad"
  style="left: {posX}px; top: {posY}px; width: {width}px; height: {height}px;"
>
  <div class="note-header" onmousedown={startDrag} role="presentation">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="drag-icon">
      <circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/>
      <circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>
    </svg>
    <span class="note-title">Notes{$activeProject ? ` - ${$activeProject.name}` : ''}</span>
    <div class="note-actions">
      <button
        class="note-action-btn"
        class:listening={isListening}
        onclick={toggleVoiceInput}
        title={isListening ? 'Stop voice input' : 'Start voice input'}
        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
      </button>
      <span class="save-indicator" class:saved>
        {saved ? 'Saved' : 'Saving...'}
      </span>
      <button
        class="note-action-btn"
        class:active={previewMode}
        onclick={() => previewMode = !previewMode}
        title={previewMode ? 'Edit mode' : 'Preview markdown'}
      >MD</button>
      <button class="note-action-btn note-close-btn" onclick={closeFloatingNote} title="Close">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="note-body">
    {#if previewMode}
      <div class="note-preview markdown-body">{@html renderedHtml}</div>
    {:else}
      <textarea
        bind:this={textareaEl}
        class="note-textarea"
        value={content}
        oninput={handleInput}
        placeholder="Write notes in markdown… (stored in browser localStorage — avoid storing passwords or secrets)"
        spellcheck="false"
      ></textarea>
    {/if}
  </div>

  <div class="resize-handle" onmousedown={startResize} role="presentation"></div>
</div>

<style>
  .floating-notepad {
    position: fixed;
    z-index: 9000;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 260px;
    min-height: 180px;
  }

  .note-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--bg-tertiary, var(--bg-secondary));
    border-bottom: 1px solid var(--border);
    cursor: move;
    user-select: none;
    flex-shrink: 0;
  }

  .drag-icon {
    color: var(--text-muted);
    opacity: 0.4;
    flex-shrink: 0;
  }

  .note-title {
    flex: 1;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .note-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .save-indicator {
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0.55;
    transition: color 0.2s, opacity 0.2s;
  }

  .save-indicator.saved {
    color: var(--success);
    opacity: 0.85;
  }

  .note-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    line-height: 1.4;
  }

  .note-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  .note-action-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
  }

  .note-action-btn.listening {
    background: rgba(239, 68, 68, 0.14);
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.28);
  }

  .note-close-btn:hover {
    background: var(--error, #e53e3e);
    color: #fff;
    border-color: var(--error, #e53e3e);
  }

  .note-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .note-textarea {
    flex: 1;
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    padding: 12px;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    line-height: 1.6;
    resize: none;
    box-sizing: border-box;
  }

  .note-textarea::placeholder {
    color: var(--text-muted);
    opacity: 0.6;
  }

  .note-preview {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--text-primary);
    box-sizing: border-box;
    scrollbar-width: thin;
  }

  .note-preview :global(h1),
  .note-preview :global(h2),
  .note-preview :global(h3),
  .note-preview :global(h4),
  .note-preview :global(h5),
  .note-preview :global(h6) {
    font-weight: 600;
    margin: 0.6em 0 0.3em;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .note-preview :global(h1) { font-size: 1.3em; }
  .note-preview :global(h2) { font-size: 1.15em; }
  .note-preview :global(h3) { font-size: 1.05em; }
  .note-preview :global(p) { margin: 0.4em 0; }
  .note-preview :global(ul),
  .note-preview :global(ol) {
    margin: 0.4em 0;
    padding-left: 1.4em;
  }
  .note-preview :global(li) { margin: 0.15em 0; }
  .note-preview :global(code) {
    font-family: var(--font-mono, monospace);
    font-size: 0.9em;
    background: var(--bg-tertiary, rgba(255,255,255,0.07));
    border: 1px solid var(--border);
    border-radius: 3px;
    padding: 0.1em 0.35em;
    color: var(--accent);
  }
  .note-preview :global(pre) {
    background: var(--bg-tertiary, rgba(255,255,255,0.07));
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  .note-preview :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-primary);
    font-size: 1em;
  }
  .note-preview :global(blockquote) {
    margin: 0.5em 0;
    padding: 4px 12px;
    border-left: 3px solid var(--accent);
    color: var(--text-secondary);
    font-style: italic;
  }
  .note-preview :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .note-preview :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: 0.8em 0;
  }
  .note-preview :global(strong) { font-weight: 700; }
  .note-preview :global(em) { font-style: italic; }

  .resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    opacity: 0.4;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    bottom: 3px;
    right: 3px;
    width: 6px;
    height: 6px;
    border-right: 2px solid var(--text-muted);
    border-bottom: 2px solid var(--text-muted);
    border-radius: 0 0 2px 0;
  }

  .resize-handle:hover {
    opacity: 0.8;
  }
</style>
