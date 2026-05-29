<script lang="ts">
  import { loadScratchNote, saveScratchNote } from '$lib/stores/notes';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { createVoiceInputSession, mergeVoiceTranscript } from '$lib/services/voice-input';
  import { refineVoicePrompt } from '$lib/services/voice-refinement';

  let projectId = $derived($activeProject?.id ?? '');
  let content = $state('');
  let saved = $state(true);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let panelEl = $state<HTMLDivElement | null>(null);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let isListening = $state(false);
  let isRefining = $state(false);
  let voiceBaseContent = $state('');
  let voiceDraftText = $state('');

  // Load from .soryq/scratch.md when project changes
  $effect(() => {
    const project = $activeProject;
    if (!project) { content = ''; return; }
    loadScratchNote(project).then(c => {
      content = c;
      if (textareaEl) textareaEl.value = c;
    });
  });

  function persistNote(val: string) {
    content = val;
    saved = false;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      const project = $activeProject;
      if (!project) { saved = true; return; }
      try {
        await saveScratchNote(project, val);
        saved = true;
      } catch {
        showToast('Failed to save note', 'error');
      }
    }, 600);
  }

  function handleInput(event: Event) {
    const val = (event.target as HTMLTextAreaElement).value;
    persistNote(val);
  }

  const voiceInput = createVoiceInputSession({
    onStart: () => {
      isListening = true;
      isRefining = false;
      voiceBaseContent = content;
      voiceDraftText = '';
      showToast('Listening for notes...', 'info');
    },
    onResult: (transcript) => {
      voiceDraftText = transcript;
    },
    onEnd: () => {
      isListening = false;
      isRefining = true;

      void (async () => {
        try {
          const { text: refinedTranscript } = await refineVoicePrompt(voiceDraftText);
          const nextValue = mergeVoiceTranscript(
            voiceBaseContent,
            refinedTranscript,
            voiceBaseContent.includes('\n') ? '\n' : ' '
          );
          persistNote(nextValue);
          if (textareaEl) {
            textareaEl.value = nextValue;
            requestAnimationFrame(() => textareaEl?.focus());
          }
        } catch (error) {
          console.error('Failed to refine notes voice input:', error);
        } finally {
          isRefining = false;
          voiceBaseContent = '';
          voiceDraftText = '';
        }
      })();
    },
    onError: (message) => {
      isListening = false;
      isRefining = false;
      voiceBaseContent = '';
      voiceDraftText = '';
      showToast(message, 'error');
    },
  });

  async function toggleVoiceInput() {
    if (isListening || isRefining) {
      voiceInput.stop();
      return;
    }
    await voiceInput.start();
  }

  function handleGlobalVoiceShortcut(event: KeyboardEvent) {
    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat || isRefining) return;
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
        class:refining={isRefining}
        onclick={toggleVoiceInput}
        title={isListening ? 'Stop listening' : isRefining ? 'Refining with AI…' : 'Start voice input'}
        aria-label={isListening ? 'Stop listening' : isRefining ? 'Refining with AI…' : 'Start voice input'}
        disabled={isRefining}
      >
        {#if isRefining}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spin-icon">
            <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
          </svg>
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
            <line x1="12" x2="12" y1="19" y2="22"/>
          </svg>
        {/if}
      </button>
      {#if isRefining}
        <span class="refining-label">Refining…</span>
      {:else}
        <span class="save-indicator" class:saved>
          {saved ? 'Saved' : 'Saving...'}
        </span>
      {/if}
    </div>
  </div>

  {#if !projectId}
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 64 64" fill="none" stroke="currentColor" class="animated-svg-floating" style="margin-bottom: 8px;">
        <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" stroke-width="1" />
        <rect x="22" y="18" width="20" height="28" rx="2" stroke="var(--text-secondary)" stroke-width="1.5" />
        <path d="M 22,22 L 25,22 M 22,27 L 25,27 M 22,32 L 25,32 M 22,37 L 25,37 M 22,42 L 25,42" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" />
        <line x1="28" y1="24" x2="38" y2="24" stroke="var(--accent)" stroke-width="1.2" />
        <line x1="28" y1="29" x2="38" y2="29" stroke="var(--text-muted)" stroke-width="1" />
        <line x1="28" y1="34" x2="36" y2="34" stroke="var(--text-muted)" stroke-width="1" />
        <line x1="28" y1="39" x2="38" y2="39" stroke="var(--text-muted)" stroke-width="1" />
        <g class="animated-pencil" style="animation: writing 3s ease-in-out infinite;">
          <path d="M 40,40 L 48,28 L 52,32 L 44,44 Z" fill="var(--bg-secondary)" stroke="var(--accent)" stroke-width="1" />
          <path d="M 40,40 L 41,43 L 44,44 Z" fill="var(--accent)" />
        </g>
      </svg>
      <p style="font-weight: 550; color: var(--text-primary); font-size: 12px; margin: 0 0 4px 0;">No Open Workspace</p>
      <p style="color: var(--text-muted); font-size: 11px; margin: 0; line-height: 1.4; text-align: center; max-width: 180px;">Open a project folder to start capturing notes and scratch ideas.</p>
    </div>
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

  .voice-btn.refining {
    background: rgba(139, 92, 246, 0.14);
    color: #a78bfa;
    border-color: rgba(139, 92, 246, 0.35);
    cursor: default;
    animation: refine-glow 1.4s ease-in-out infinite;
  }

  .spin-icon {
    animation: sparkle-spin 1.6s linear infinite;
  }

  @keyframes sparkle-spin {
    0%   { transform: rotate(0deg) scale(1);    opacity: 1; }
    50%  { transform: rotate(180deg) scale(1.15); opacity: 0.7; }
    100% { transform: rotate(360deg) scale(1);  opacity: 1; }
  }

  @keyframes refine-glow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0); }
    50%       { box-shadow: 0 0 6px 2px rgba(139, 92, 246, 0.25); }
  }

  .refining-label {
    font-size: 10px;
    color: #a78bfa;
    opacity: 0.9;
    animation: refine-fade 1.2s ease-in-out infinite;
    white-space: nowrap;
  }

  @keyframes refine-fade {
    0%, 100% { opacity: 0.5; }
    50%       { opacity: 1; }
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    color: var(--text-muted);
    user-select: none;
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

  .animated-svg-floating {
    animation: floating 4s ease-in-out infinite;
    filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25));
  }

  @keyframes floating {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-4px); }
  }

  @keyframes writing {
    0%, 100% { transform: translate(0px, 0px) rotate(0deg); }
    50% { transform: translate(-3px, -2px) rotate(-6deg); }
  }
</style>
