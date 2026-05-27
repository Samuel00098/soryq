<script lang="ts">
  import { notes, setNoteForProject } from '$lib/stores/notes';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { createVoiceInputSession } from '$lib/services/voice-input';

  let projectId = $derived($activeProject?.id ?? '');
  let content = $derived($notes[projectId] ?? '');
  let saved = $state(true);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let panelEl = $state<HTMLDivElement | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let isListening = $state(false);

  function persistNote(val: string) {
    saved = false;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (projectId) setNoteForProject(projectId, val);
      saved = true;
    }, 600);
  }

  function handleInput(event: Event) {
    const val = (event.target as HTMLTextAreaElement).value;
    persistNote(val);
  }

  const voiceInput = createVoiceInputSession({
    onStart: () => {
      isListening = true;
      showToast('Listening for notes...', 'info');
    },
    onResult: (transcript) => {
      if (!textareaEl) return;
      const spacer = textareaEl.value.trim().length > 0 ? ' ' : '';
      const nextValue = `${textareaEl.value}${spacer}${transcript}`;
      textareaEl.value = nextValue;
      persistNote(nextValue);
      requestAnimationFrame(() => textareaEl?.focus());
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

  function handleGlobalVoiceShortcut(event: KeyboardEvent) {
    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat) return;
    const activeElement = document.activeElement;
    if (!panelEl || !activeElement || !panelEl.contains(activeElement)) return;
    event.preventDefault();
    toggleVoiceInput();
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    return () => {
      document.removeEventListener('keydown', handleGlobalVoiceShortcut);
    };
  });
</script>

<div class="notes-panel" bind:this={panelEl}>
  <div class="panel-header">
    <span class="panel-title">Notes</span>
    <div class="header-actions">
      <button
        class="voice-btn"
        class:listening={isListening}
        onclick={toggleVoiceInput}
        title={isListening ? 'Stop voice input' : 'Start voice input'}
        aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
      </button>
      <span class="save-indicator" class:saved>
        {saved ? 'Saved' : 'Saving...'}
      </span>
    </div>
  </div>

  {#if !projectId}
    <div class="empty-state">Open a project to take notes</div>
  {:else}
    <textarea
      bind:this={textareaEl}
      class="notes-textarea"
      value={content}
      oninput={handleInput}
      placeholder="Jot down notes, ideas, commands, anything...&#10;&#10;Auto-saves as you type."
      spellcheck="false"
    ></textarea>
  {/if}
</div>

<style>
  .notes-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--sidebar-bg);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .panel-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-muted);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .save-indicator {
    font-size: 10px;
    color: var(--text-muted);
    opacity: 0.5;
    transition: color 0.2s, opacity 0.2s;
  }

  .save-indicator.saved {
    color: var(--success);
    opacity: 0.8;
  }

  .voice-btn {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    background: var(--bg-secondary);
    color: var(--text-muted);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .voice-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .voice-btn.listening {
    background: rgba(239, 68, 68, 0.14);
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.28);
  }

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .notes-textarea {
    flex: 1;
    width: 100%;
    resize: none;
    background: var(--sidebar-bg);
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
    line-height: 1.65;
    padding: 12px 14px;
    box-sizing: border-box;
    caret-color: var(--accent);
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) transparent;
  }

  .notes-textarea::placeholder {
    color: var(--text-muted);
    opacity: 0.45;
    font-family: var(--font-sans, sans-serif);
    font-size: 12px;
    line-height: 1.7;
  }
</style>
