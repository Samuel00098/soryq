import { useCallback, useEffect, useRef, useState } from 'react';
import YouTubePanel from './YouTubePanel.tsx';
import './FloatingYouTube.css';

// A free-floating, draggable / resizable / transparent YouTube window — the
// Opera-style picture-in-picture pop-up. It is mounted once at the app root
// (NOT inside the ambient rooms grid), so switching Focus / Split / Canvas
// modes never unmounts it: the window — and the playing video — survive. The
// player's own state (current video + position) lives in the youtube store at
// module scope, so even a close/reopen resumes where you left off.

type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Video-player opacity (0.3–1). Applied to the body so the video fades and
   *  the app shows through, while the title bar/controls stay opaque. */
  opacity: number;
  /** Collapsed to just the title bar. The player stays mounted underneath (only
   *  visually hidden) so audio keeps playing while minimized. */
  minimized: boolean;
};

/** The eight resize directions: four edges + four corners. Each maps to which
 *  edges of the window the drag moves. */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const STORAGE_KEY = 'soryq_youtube_window';
const MIN_W = 320;
const MIN_H = 220;
const MIN_OPACITY = 0.3;

function defaultState(): WindowState {
  const width = 440;
  const height = 320;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  return {
    width,
    height,
    x: Math.max(16, vw - width - 24),
    y: Math.max(16, vh - height - 96),
    opacity: 1,
    minimized: false,
  };
}

function loadState(): WindowState {
  if (typeof window === 'undefined') return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    const base = defaultState();
    return {
      x: typeof parsed.x === 'number' ? parsed.x : base.x,
      y: typeof parsed.y === 'number' ? parsed.y : base.y,
      width: typeof parsed.width === 'number' ? Math.max(MIN_W, parsed.width) : base.width,
      height: typeof parsed.height === 'number' ? Math.max(MIN_H, parsed.height) : base.height,
      opacity:
        typeof parsed.opacity === 'number'
          ? Math.min(1, Math.max(MIN_OPACITY, parsed.opacity))
          : base.opacity,
      minimized: parsed.minimized === true,
    };
  } catch {
    return defaultState();
  }
}

/** Keep the window's top-left inside the viewport (with a little slack). */
function clampToViewport(s: WindowState): WindowState {
  if (typeof window === 'undefined') return s;
  const maxX = window.innerWidth - 80;
  const maxY = window.innerHeight - 60;
  return {
    ...s,
    x: Math.min(Math.max(0, s.x), Math.max(0, maxX)),
    y: Math.min(Math.max(0, s.y), Math.max(0, maxY)),
  };
}

export default function FloatingYouTube({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<WindowState>(loadState);
  const [interacting, setInteracting] = useState<null | 'move' | 'resize'>(null);

  // Drag/resize bookkeeping — the live gesture writes here, committing to React
  // state on each pointermove so the window tracks the cursor 1:1.
  const gestureRef = useRef<{
    mode: 'move' | 'resize';
    /** For resize gestures: which edges/corner the drag moves. */
    dir: ResizeDir | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  // Persist geometry + opacity (debounced via rAF would be overkill — this only
  // fires at the end of gestures and on opacity changes, not per pointermove
  // because state updates already batch within a frame).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota / serialization errors */
    }
  }, [state]);

  // Re-clamp if the OS window shrinks so the pop-up can't get stranded off-screen.
  useEffect(() => {
    const onResize = () => setState((s) => clampToViewport(s));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const startMove = useCallback(
    (e: React.PointerEvent) => {
      // Ignore drags that start on a control (close button, opacity slider).
      if ((e.target as HTMLElement).closest('.fy-control')) return;
      e.preventDefault();
      gestureRef.current = {
        mode: 'move',
        dir: null,
        startX: e.clientX,
        startY: e.clientY,
        origX: state.x,
        origY: state.y,
        origW: state.width,
        origH: state.height,
      };
      setInteracting('move');
    },
    [state],
  );

  const startResize = useCallback(
    (e: React.PointerEvent, dir: ResizeDir) => {
      e.preventDefault();
      e.stopPropagation();
      gestureRef.current = {
        mode: 'resize',
        dir,
        startX: e.clientX,
        startY: e.clientY,
        origX: state.x,
        origY: state.y,
        origW: state.width,
        origH: state.height,
      };
      setInteracting('resize');
    },
    [state],
  );

  // One shared set of window listeners drives both gestures. They run only while
  // `interacting` so the iframe shield (below) is mounted to keep pointermove
  // events from being swallowed by the YouTube iframe.
  useEffect(() => {
    if (!interacting) return;

    function onMove(e: PointerEvent) {
      const g = gestureRef.current;
      if (!g) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (g.mode === 'move') {
        setState((s) => clampToViewport({ ...s, x: g.origX + dx, y: g.origY + dy }));
      } else {
        const dir = g.dir ?? 'se';
        const east = dir.includes('e');
        const west = dir.includes('w');
        const north = dir.includes('n');
        const south = dir.includes('s');

        let { x, y, width, height } = { x: g.origX, y: g.origY, width: g.origW, height: g.origH };
        // Right / bottom edges grow the box outward from its top-left anchor.
        if (east) width = Math.max(MIN_W, g.origW + dx);
        if (south) height = Math.max(MIN_H, g.origH + dy);
        // Left / top edges move the anchor too, so the opposite edge stays put.
        if (west) {
          width = Math.max(MIN_W, g.origW - dx);
          x = g.origX + (g.origW - width);
        }
        if (north) {
          height = Math.max(MIN_H, g.origH - dy);
          y = g.origY + (g.origH - height);
        }
        setState((s) => ({ ...s, x, y, width, height }));
      }
    }

    function onUp() {
      gestureRef.current = null;
      setInteracting(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [interacting]);

  const { minimized } = state;

  return (
    <section
      className={`floating-youtube${interacting ? ' fy-interacting' : ''}${minimized ? ' fy-minimized' : ''}`}
      style={{
        left: `${state.x}px`,
        top: `${state.y}px`,
        width: `${state.width}px`,
        // When minimized the window collapses to its title bar — let height be
        // intrinsic rather than forcing the saved player height.
        ...(minimized ? {} : { height: `${state.height}px` }),
      }}
      role="dialog"
      aria-label="YouTube pop-up player"
    >
      <header className="fy-titlebar" onPointerDown={startMove}>
        <span className="fy-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <rect x="2" y="5" width="20" height="14" rx="4" />
            <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
          </svg>
          YouTube
        </span>
        <div className="fy-titlebar-controls">
          <label className="fy-control fy-opacity" title="Video transparency">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
            </svg>
            <input
              type="range"
              min={MIN_OPACITY}
              max={1}
              step={0.05}
              value={state.opacity}
              onChange={(e) => setState((s) => ({ ...s, opacity: Number(e.target.value) }))}
              aria-label="Video transparency"
            />
          </label>
          <button
            className="fy-control fy-minimize"
            onClick={() => setState((s) => ({ ...s, minimized: !s.minimized }))}
            title={minimized ? 'Restore player' : 'Minimize player'}
            aria-label={minimized ? 'Restore player' : 'Minimize player'}
            aria-pressed={minimized}
          >
            {minimized ? (
              // Restore: a small box, suggesting the window expands back out.
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            ) : (
              // Minimize: a single bottom rule.
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="6" y1="18" x2="18" y2="18" />
              </svg>
            )}
          </button>
          <button
            className="fy-control fy-close"
            onClick={onClose}
            title="Close YouTube"
            aria-label="Close YouTube"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </header>

      {/* Opacity is applied to the body only — so the slider visibly fades the
          video player itself (revealing the app behind it) while the title bar
          and its controls stay fully opaque and usable. The body stays mounted
          even when minimized (just collapsed via CSS) so audio keeps playing. */}
      <div className="fy-body" style={{ opacity: state.opacity }}>
        <YouTubePanel />
        {/* While dragging/resizing, this transparent shield sits over the iframe
            so the gesture's pointermove events aren't captured by the embedded
            YouTube player and lost. */}
        {interacting && <div className="fy-shield" />}
      </div>

      {/* Eight resize handles — four edges and four corners — so the window can
          be grabbed from any side or angle. Hidden while minimized. */}
      {!minimized &&
        (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeDir[]).map((dir) => (
          <div
            key={dir}
            className={`fy-resize fy-resize-${dir}`}
            onPointerDown={(e) => startResize(e, dir)}
            aria-hidden="true"
          />
        ))}
    </section>
  );
}
