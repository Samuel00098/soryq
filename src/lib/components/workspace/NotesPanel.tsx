import { useEffect, useMemo, useRef, useState } from 'react';
import { loadScratchNote, saveScratchNote } from '$lib/stores/notes';
import { activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { createVoiceInputSession, mergeVoiceTranscript } from '$lib/services/voice-input';
import { refineVoicePrompt } from '$lib/services/voice-refinement';
import { useStore } from '$lib/react/useStore';
import './NotesPanel.css';

export default function NotesPanel() {
  const project = useStore(activeProject);
  const projectId = project?.id ?? '';

  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceBaseContentRef = useRef('');
  const voiceDraftTextRef = useRef('');
  const contentRef = useRef('');

  // Load from .soryq/scratch.md when project changes
  useEffect(() => {
    if (!project) {
      contentRef.current = '';
      setContent('');
      return;
    }
    loadScratchNote(project).then((c) => {
      contentRef.current = c;
      setContent(c);
    });
  }, [project]);

  function persistNote(val: string) {
    contentRef.current = val;
    setContent(val);
    setSaved(false);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      if (!project) {
        setSaved(true);
        return;
      }
      try {
        await saveScratchNote(project, val);
        setSaved(true);
      } catch {
        showToast('Failed to save note', 'error');
      }
    }, 600);
  }

  function handleInput(event: React.ChangeEvent<HTMLTextAreaElement>) {
    persistNote(event.target.value);
  }

  const voiceInput = useMemo(
    () =>
      createVoiceInputSession({
        onStart: () => {
          setIsListening(true);
          setIsRefining(false);
          voiceBaseContentRef.current = contentRef.current;
          voiceDraftTextRef.current = '';
          showToast('Listening for notes...', 'info');
        },
        onResult: (transcript) => {
          voiceDraftTextRef.current = transcript;
        },
        onProcessingStart: () => {
          setIsListening(false);
          setIsRefining(true);
        },
        onEnd: () => {
          setIsListening(false);
          setIsRefining(true);

          void (async () => {
            try {
              const { text: refinedTranscript } = await refineVoicePrompt(voiceDraftTextRef.current);
              const nextValue = mergeVoiceTranscript(
                voiceBaseContentRef.current,
                refinedTranscript,
                voiceBaseContentRef.current.includes('\n') ? '\n' : ' ',
              );
              persistNote(nextValue);
              requestAnimationFrame(() => textareaRef.current?.focus());
            } catch (error) {
              console.error('Failed to refine notes voice input:', error);
            } finally {
              setIsRefining(false);
              voiceBaseContentRef.current = '';
              voiceDraftTextRef.current = '';
            }
          })();
        },
        onError: (message) => {
          setIsListening(false);
          setIsRefining(false);
          voiceBaseContentRef.current = '';
          voiceDraftTextRef.current = '';
          showToast(message, 'error');
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }),
    [],
  );

  async function toggleVoiceInput() {
    if (isListening || isRefining) {
      voiceInput.stop();
      return;
    }
    await voiceInput.start();
  }

  useEffect(() => {
    function handleGlobalVoiceShortcut(event: KeyboardEvent) {
      if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat || isRefining)
        return;
      const activeElement = document.activeElement;
      if (!panelRef.current || !activeElement || !panelRef.current.contains(activeElement)) return;
      event.preventDefault();
      toggleVoiceInput();
    }

    if (typeof document === 'undefined') return;
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    return () => {
      document.removeEventListener('keydown', handleGlobalVoiceShortcut);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, isRefining]);

  return (
    <div className="notes-panel" ref={panelRef}>
      <div className="panel-header">
        <span className="panel-title">Notes</span>
        <div className="header-actions">
          <button
            className={`voice-btn${isListening ? ' listening' : ''}${isRefining ? ' refining' : ''}`}
            onClick={toggleVoiceInput}
            title={isListening ? 'Stop listening' : isRefining ? 'Refining with AI…' : 'Start voice input'}
            aria-label={isListening ? 'Stop listening' : isRefining ? 'Refining with AI…' : 'Start voice input'}
            disabled={isRefining}
          >
            {isRefining ? (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="spin-icon"
              >
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
              </svg>
            ) : (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            )}
          </button>
          {isRefining ? (
            <span className="refining-label">Refining…</span>
          ) : (
            <span className={`save-indicator${saved ? ' saved' : ''}`}>{saved ? 'Saved' : 'Saving...'}</span>
          )}
        </div>
      </div>

      {!projectId ? (
        <div className="empty-state">
          <svg
            width="48"
            height="48"
            viewBox="0 0 64 64"
            fill="none"
            stroke="currentColor"
            className="animated-svg-floating"
            style={{ marginBottom: '8px' }}
          >
            <circle cx="32" cy="32" r="28" fill="var(--bg-hover)" stroke="var(--border)" strokeWidth="1" />
            <rect x="22" y="18" width="20" height="28" rx="2" stroke="var(--text-secondary)" strokeWidth="1.5" />
            <path
              d="M 22,22 L 25,22 M 22,27 L 25,27 M 22,32 L 25,32 M 22,37 L 25,37 M 22,42 L 25,42"
              stroke="var(--text-muted)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <line x1="28" y1="24" x2="38" y2="24" stroke="var(--accent)" strokeWidth="1.2" />
            <line x1="28" y1="29" x2="38" y2="29" stroke="var(--text-muted)" strokeWidth="1" />
            <line x1="28" y1="34" x2="36" y2="34" stroke="var(--text-muted)" strokeWidth="1" />
            <line x1="28" y1="39" x2="38" y2="39" stroke="var(--text-muted)" strokeWidth="1" />
            <g className="animated-pencil" style={{ animation: 'writing 3s ease-in-out infinite' }}>
              <path d="M 40,40 L 48,28 L 52,32 L 44,44 Z" fill="var(--bg-secondary)" stroke="var(--accent)" strokeWidth="1" />
              <path d="M 40,40 L 41,43 L 44,44 Z" fill="var(--accent)" />
            </g>
          </svg>
          <p style={{ fontWeight: 550, color: 'var(--text-primary)', fontSize: '12px', margin: '0 0 4px 0' }}>
            No Open Workspace
          </p>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '11px',
              margin: 0,
              lineHeight: 1.4,
              textAlign: 'center',
              maxWidth: '180px',
            }}
          >
            Open a project folder to start capturing notes and scratch ideas.
          </p>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="notes-textarea"
          value={content}
          onChange={handleInput}
          placeholder={'Jot down notes, ideas, commands, anything...\n\nAuto-saves as you type.'}
          spellCheck={false}
        />
      )}
    </div>
  );
}
