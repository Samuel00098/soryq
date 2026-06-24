import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { loadScratchNote, saveScratchNote, closeFloatingNote } from '$lib/stores/notes';
import { activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { createVoiceInputSession, mergeVoiceTranscript } from '$lib/services/voice-input';
import { refineVoicePrompt } from '$lib/services/voice-refinement';
import { useStore } from '$lib/react/useStore';
import './FloatingNotepad.css';

/** The eight resize directions: four edges + four corners. Each string encodes
 *  which edges of the window the drag moves (n/s/e/w). */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const NOTE_MIN_W = 260;
const NOTE_MIN_H = 180;

export default function FloatingNotepad() {
  const project = useStore(activeProject);

  const [posX, setPosX] = useState(() => window.innerWidth - 420);
  const [posY, setPosY] = useState(80);
  const [width, setWidth] = useState(380);
  const [height, setHeight] = useState(480);
  const [previewMode, setPreviewMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);

  const [content, setContent] = useState('');
  const [saved, setSaved] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isRefining, setIsRefining] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Transient drag/resize bookkeeping — doesn't drive rendering, so refs avoid
  // extra re-renders on every mousemove.
  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragOriginX = useRef(0);
  const dragOriginY = useRef(0);
  const resizeStartX = useRef(0);
  const resizeStartY = useRef(0);
  const resizeOriginW = useRef(0);
  const resizeOriginH = useRef(0);
  // The window's top-left at gesture start — needed because dragging the top or
  // left edge moves the anchor so the opposite edge stays put.
  const resizeOriginX = useRef(0);
  const resizeOriginY = useRef(0);
  const resizeDir = useRef<ResizeDir>('se');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mutable mirrors of state read inside stable callbacks (voice session,
  // mousemove/mouseup) so those closures always see the latest values
  // without needing to be recreated every render.
  const contentRef = useRef(content);
  contentRef.current = content;
  const widthRef = useRef(width);
  widthRef.current = width;
  const heightRef = useRef(height);
  heightRef.current = height;
  const draggingRef = useRef(dragging);
  draggingRef.current = dragging;
  const resizingRef = useRef(resizing);
  resizingRef.current = resizing;

  const voiceLocked = useRef(false);
  const voiceHeld = useRef(false);
  const voiceStopping = useRef(false);
  const voiceBaseContent = useRef('');
  const voiceDraftText = useRef('');

  const renderedHtml = useMemo(
    () => (previewMode ? (DOMPurify.sanitize(marked.parse(content) as string)) : ''),
    [previewMode, content]
  );

  function queueSave() {
    setSaved(false);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      if (!project) { setSaved(true); return; }
      try {
        await saveScratchNote(project, contentRef.current);
        setSaved(true);
      } catch {
        // indicator stays unsaved — non-fatal
      }
    }, 400);
  }

  // Load from .soryq/scratch.md when project changes
  useEffect(() => {
    if (!project) { setContent(''); setSaved(true); return; }
    loadScratchNote(project).then(c => {
      setContent(c);
      setSaved(true);
      if (textareaRef.current) textareaRef.current.value = c;
    });
  }, [project]);

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(e.target.value);
    queueSave();
  }

  const voiceInput = useMemo(() => createVoiceInputSession({
    onStart: () => {
      setIsListening(true);
      setIsRefining(false);
      voiceBaseContent.current = contentRef.current;
      voiceDraftText.current = '';
      showToast('Listening for notes...', 'info');
    },
    onResult: (transcript) => {
      voiceDraftText.current = transcript;
    },
    onEnd: () => {
      const shouldRestart = !voiceStopping.current && (voiceLocked.current || voiceHeld.current);
      setIsListening(false);
      setIsRefining(true);

      void (async () => {
        try {
          const { text: refinedTranscript } = await refineVoicePrompt(voiceDraftText.current);
          const merged = mergeVoiceTranscript(
            voiceBaseContent.current,
            refinedTranscript,
            voiceBaseContent.current.includes('\n') ? '\n' : ' '
          );
          setContent(merged);
          queueSave();
          requestAnimationFrame(() => textareaRef.current?.focus());
        } catch (error) {
          console.error('Failed to refine floating note voice input:', error);
        } finally {
          setIsRefining(false);
          voiceStopping.current = false;
          voiceBaseContent.current = '';
          voiceDraftText.current = '';
          if (shouldRestart) {
            queueMicrotask(() => {
              if (voiceLocked.current || voiceHeld.current) {
                voiceInput.start();
              }
            });
          }
        }
      })();
    },
    onError: (message) => {
      setIsListening(false);
      setIsRefining(false);
      voiceLocked.current = false;
      voiceHeld.current = false;
      voiceStopping.current = false;
      voiceBaseContent.current = '';
      voiceDraftText.current = '';
      showToast(message, 'error');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  async function toggleVoiceInput() {
    if (isRefining) return;
    if (isListening && voiceLocked.current) {
      voiceLocked.current = false;
      voiceStopping.current = true;
      voiceInput.stop();
      return;
    }
    voiceLocked.current = true;
    await voiceInput.start();
  }

  useEffect(() => {
    function handleGlobalVoiceShortcut(event: KeyboardEvent) {
      if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat || isRefining) return;
      const activeElement = document.activeElement;
      if (!panelRef.current || !activeElement || !panelRef.current.contains(activeElement)) return;
      event.preventDefault();
      if (voiceLocked.current || voiceHeld.current) return;
      voiceHeld.current = true;
      voiceInput.start();
    }

    function handleGlobalVoiceShortcutUp(event: KeyboardEvent) {
      if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT) return;
      if (!voiceHeld.current) return;
      voiceHeld.current = false;
      voiceStopping.current = true;
      voiceInput.stop();
    }

    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    document.addEventListener('keyup', handleGlobalVoiceShortcutUp);
    return () => {
      document.removeEventListener('keydown', handleGlobalVoiceShortcut);
      document.removeEventListener('keyup', handleGlobalVoiceShortcutUp);
    };
  }, [isRefining, voiceInput]);

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    setDragging(true);
    dragStartX.current = e.clientX; dragStartY.current = e.clientY;
    dragOriginX.current = posX; dragOriginY.current = posY;
    e.preventDefault();
  }

  function startResize(e: React.MouseEvent, dir: ResizeDir) {
    setResizing(true);
    resizeDir.current = dir;
    resizeStartX.current = e.clientX; resizeStartY.current = e.clientY;
    resizeOriginW.current = width; resizeOriginH.current = height;
    resizeOriginX.current = posX; resizeOriginY.current = posY;
    e.preventDefault();
    e.stopPropagation();
  }

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (draggingRef.current) {
        setPosX(Math.max(0, Math.min(window.innerWidth - widthRef.current, dragOriginX.current + (e.clientX - dragStartX.current))));
        setPosY(Math.max(0, Math.min(window.innerHeight - 60, dragOriginY.current + (e.clientY - dragStartY.current))));
      }
      if (resizingRef.current) {
        const dir = resizeDir.current;
        const dx = e.clientX - resizeStartX.current;
        const dy = e.clientY - resizeStartY.current;
        const origX = resizeOriginX.current;
        const origY = resizeOriginY.current;
        const origW = resizeOriginW.current;
        const origH = resizeOriginH.current;

        // Right / bottom edges grow the box from its top-left anchor.
        if (dir.includes('e')) setWidth(Math.max(NOTE_MIN_W, origW + dx));
        if (dir.includes('s')) setHeight(Math.max(NOTE_MIN_H, origH + dy));
        // Left / top edges move the anchor too, so the opposite edge stays put.
        if (dir.includes('w')) {
          const w = Math.max(NOTE_MIN_W, origW - dx);
          setWidth(w);
          setPosX(origX + (origW - w));
        }
        if (dir.includes('n')) {
          const h = Math.max(NOTE_MIN_H, origH - dy);
          setHeight(h);
          setPosY(origY + (origH - h));
        }
      }
    }

    function onMouseUp() {
      setDragging(false);
      setResizing(false);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div
      ref={panelRef}
      className="floating-notepad"
      style={{ left: `${posX}px`, top: `${posY}px`, width: `${width}px`, height: `${height}px` }}
    >
      <div className="note-header" onMouseDown={startDrag} role="presentation">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="drag-icon">
          <circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/>
          <circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/>
          <circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>
        </svg>
        <span className="note-title">Notes{project ? ` - ${project.name}` : ''}</span>
        <div className="note-actions">
          <button
            className={`note-action-btn${isListening ? ' listening' : ''}${isRefining ? ' refining' : ''}`}
            onClick={toggleVoiceInput}
            title={isListening ? 'Stop listening' : isRefining ? 'Refining with AI…' : 'Start voice input'}
            aria-label={isListening ? 'Stop listening' : isRefining ? 'Refining with AI…' : 'Start voice input'}
            disabled={isRefining}
          >
            {isRefining ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spin-icon">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
            )}
          </button>
          {isRefining ? (
            <span className="refining-label">Refining…</span>
          ) : (
            <span className={`save-indicator${saved ? ' saved' : ''}`}>
              {saved ? 'Saved' : 'Saving...'}
            </span>
          )}
          <button
            className={`note-action-btn${previewMode ? ' active' : ''}`}
            onClick={() => setPreviewMode(v => !v)}
            title={previewMode ? 'Edit mode' : 'Preview markdown'}
          >MD</button>
          <button className="note-action-btn note-close-btn" onClick={closeFloatingNote} title="Close">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="note-body">
        {previewMode ? (
          <div className="note-preview markdown-body" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        ) : (
          <textarea
            ref={textareaRef}
            className="note-textarea"
            value={content}
            onChange={handleInput}
            placeholder="Write notes in markdown… saved to .soryq/scratch.md"
            spellCheck={false}
          ></textarea>
        )}
      </div>

      {/* Eight resize handles — four edges and four corners — so the notepad can
          be grabbed from any side or angle. */}
      {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDir[]).map((dir) => (
        <div
          key={dir}
          className={`note-resize note-resize-${dir}`}
          onMouseDown={(e) => startResize(e, dir)}
          role="presentation"
        ></div>
      ))}
    </div>
  );
}
