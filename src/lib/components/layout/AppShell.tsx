import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import TitleBar from './TitleBar.tsx';
import UpdateBanner from '$lib/components/shared/UpdateBanner.tsx';
import { useAction } from '$lib/react/useAction';
import { useStore } from '$lib/react/useStore';
import { useWorkspaceStore } from '$lib/stores/zustand/workspace';
import FileExplorer from '$lib/components/explorer/FileExplorer.tsx';
import SearchPanel from '$lib/components/explorer/SearchPanel.tsx';
import SourceControl from '$lib/components/explorer/SourceControl.tsx';
import SnapshotsPanel from './SnapshotsPanel.tsx';
import TerminalSnippetsPanel from '$lib/components/explorer/TerminalSnippetsPanel.tsx';
import TerminalPanel from '$lib/components/terminal/TerminalPanel.tsx';
import TerminalPane from '$lib/components/terminal/TerminalPane.tsx';
import WelcomeScreen from '$lib/components/workspace/WelcomeScreen.tsx';
import FloatingPromptBar from '$lib/components/terminal/FloatingPromptBar.tsx';
import AgentCommandCenter from '$lib/components/terminal/AgentCommandCenter.tsx';
import AgentWorktreeBadge from '$lib/components/orchestrator/AgentWorktreeBadge.tsx';
import ContainersPanel from '$lib/components/containers/ContainersPanelLazy.tsx';
import DbExplorerPanel from '$lib/components/db/DbExplorerPanelLazy.tsx';
import HttpClientPanel from '$lib/components/http/HttpClientPanelLazy.tsx';
import DevPetPanel from '$lib/components/pet/DevPetPanelLazy.tsx';
import ReviewPanel from '$lib/components/review/ReviewPanelLazy.tsx';
import ToolboxPanel from '$lib/components/toolbox/ToolboxPanelLazy.tsx';
import TasksPanel from '$lib/components/workspace/TasksPanelLazy.tsx';
import PreviewPanel from '$lib/components/preview/PreviewPanelLazy.tsx';
import YouTubePanel from '$lib/components/youtube/YouTubePanelLazy.tsx';
import AndroidPanel from '$lib/components/mobile/AndroidPanelLazy.tsx';
import IosPanel from '$lib/components/mobile/IosPanelLazy.tsx';
import { useLayoutStore } from '$lib/stores/zustand/layout';
import { useEditorStore } from '$lib/stores/zustand/editor';
import {
  toggleSidebar,
  setActiveView,
  openSettings,
  toggleSidebarTab,
  toggleEditorVisible,
  togglePreviewVisible,
  toggleTerminal,
  toggleReviewVisible,
  toggleHttpVisible,
  toggleTasksVisible,
  toggleDbVisible,
  toggleContainersVisible,
  toggleToolboxVisible,
  toggleOrchestratorVisible,
  togglePetVisible,
  toggleYoutubeVisible,
  toggleAndroidVisible,
  toggleIosVisible,
  openQuickCapture,
  openEnvManager,
  envManagerOpen,
} from '$lib/stores/layout';
import { sketchCanvasOpen, toggleSketchCanvas } from '$lib/stores/sketch';
import { openDailyNote } from '$lib/stores/dailyNote';
import { openProject } from '$lib/stores/workspace';
import { toggleCommandPalette } from '$lib/stores/commandpalette';
import { saveActiveFile, formatActiveFile } from '$lib/stores/editor';
import { startProxy, stopProxy } from '$lib/stores/preview';
import { useSettingsStore } from '$lib/stores/zustand/settings';
import { matchShortcut } from '$lib/stores/settings';
import {
  createTerminalSession,
  launchPromptBarVoiceMode,
  activeSessionId,
  getSessionPromptTargetLabel,
  isAgentSession,
  killSession,
  paneAssignments,
  setActiveSession,
  sessions as terminalSessions,
  writeToSession,
  commandHistory,
} from '$lib/stores/terminal';
import { agentCenterOpen } from '$lib/stores/orchestrator';
import { useUpdaterStore } from '$lib/stores/zustand/updater';
import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';
import type { ActiveView, SidebarTab } from '$lib/types/layout';
import { layoutControlCommand, publishLayoutSnapshot } from '$lib/stores/layoutControl';
import './AppShell.css';

type AuxPanelId =
  | 'editor'
  | 'preview'
  | 'review'
  | 'http'
  | 'tasks'
  | 'db'
  | 'containers'
  | 'toolbox'
  | 'pet'
  | 'youtube'
  | 'android'
  | 'ios';

type AgentRoomId = `agent:${number}`;
type RoomId = 'workspace' | 'terminal' | 'orchestrator' | AuxPanelId | AgentRoomId;
type AmbientLayout = 'focus' | 'split' | 'gallery' | 'preview';
type GallerySize = { width: number; height: number };

type ActivityItem = {
  id: string;
  title: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
};

const ROOM_TITLES: Record<Exclude<RoomId, AgentRoomId>, string> = {
  workspace: 'Workspace',
  terminal: 'Terminal',
  orchestrator: 'Orchestrator',
  editor: 'Editor',
  preview: 'Preview',
  review: 'Review',
  http: 'HTTP',
  tasks: 'Tasks',
  db: 'Database',
  containers: 'Containers',
  toolbox: 'Toolbox',
  pet: 'DevPet',
  youtube: 'YouTube',
  android: 'Android',
  ios: 'iOS Simulator',
};

function isAgentRoomId(id: RoomId): id is AgentRoomId {
  return id.startsWith('agent:');
}

function getAgentRoomSessionId(id: AgentRoomId): number {
  return Number(id.slice('agent:'.length));
}

const PANEL_VISIBILITY_KEYS: Record<AuxPanelId, keyof ReturnType<typeof useLayoutStore.getState>> = {
  editor: 'editorVisible',
  preview: 'previewVisible',
  review: 'reviewVisible',
  http: 'httpVisible',
  tasks: 'tasksVisible',
  db: 'dbVisible',
  containers: 'containersVisible',
  toolbox: 'toolboxVisible',
  pet: 'petVisible',
  youtube: 'youtubeVisible',
  android: 'androidVisible',
  ios: 'iosVisible',
};

const GALLERY_MIN_WIDTH = 280;
const GALLERY_MIN_HEIGHT = 200;
// Wide landscape rectangles (~16:9) so panels read as rectangles, not squares.
const GALLERY_DEFAULT_WIDTH = 760;
const GALLERY_DEFAULT_HEIGHT = 430;

// Freeform canvas ("gallery" mode) — pan/zoom of an infinite board of panels.
const CANVAS_MIN_ZOOM = 0.3;
const CANVAS_MAX_ZOOM = 2.4;
const CANVAS_ZOOM_STEP = 1.2;
// Small gutter between tiled panels so the grid reads as a tight, near-seamless
// block (panels almost touching) rather than loose, widely-spaced tiles.
const CANVAS_TILE_GAP = 8;
// At/beyond this many open rooms, the auto-grid packs them into a squarer,
// multi-column block (instead of the default two-wide) so the board matches the
// screen shape when its panels are sized to fit the window.
const CANVAS_FIT_ALL_THRESHOLD = 8;
const CANVAS_MOVE_THRESHOLD = 4; // px of pointer travel before a header press becomes a drag

function getRoomGridPos(index: number, count: number): { col: number; row: number } {
  if (index < 4) {
    if (count === 2) {
      return { col: index, row: 0 };
    }
    return { col: index % 2, row: Math.floor(index / 2) };
  }
  if (index < 6) {
    return { col: 2, row: index - 4 };
  }
  if (index < 9) {
    return { col: index - 6, row: 2 };
  }
  return { col: 3 + Math.floor((index - 9) / 3), row: (index - 9) % 3 };
}

function getGridSize(count: number): { columns: number; rows: number } {
  if (count === 0) return { columns: 0, rows: 0 };
  if (count === 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  if (count === 3) return { columns: 2, rows: 2 };
  if (count === 4) return { columns: 2, rows: 2 };
  if (count === 5) return { columns: 3, rows: 2 };
  if (count === 6) return { columns: 3, rows: 2 };
  if (count === 7) return { columns: 3, rows: 3 };
  if (count === 8) return { columns: 3, rows: 3 };
  return { columns: 3 + Math.ceil((count - 9) / 3), rows: 3 };
}

type CanvasPos = { x: number; y: number };
type CanvasView = { x: number; y: number; zoom: number };
type RoomClusterInfo = { anchorRoomId: string; localIndex: number };

function clampZoom(zoom: number) {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, zoom));
}

// Auto-arrange the canvas as a tidy aligned grid: rooms flow left→right and wrap
// down into rows. Each column is as wide as its widest panel and each row as tall
// as its tallest, so resizing one panel pushes the rest of its column/row along —
// the whole board behaves like a single connected grid rather than loose tiles.
function computeGalleryGrid<T extends string>(
  rooms: T[],
  sizes: Record<string, GallerySize>,
  defaultSize: GallerySize = { width: GALLERY_DEFAULT_WIDTH, height: GALLERY_DEFAULT_HEIGHT },
): Record<string, CanvasPos> {
  const out: Record<string, CanvasPos> = {};
  const count = rooms.length;
  if (count === 0) return out;
  const { columns, rows: rowCount } = getGridSize(count);
  const sizeOf = (room: T) => sizes[room] ?? defaultSize;

  const colWidth = new Array<number>(columns).fill(0);
  const rowHeight = new Array<number>(rowCount).fill(0);
  rooms.forEach((room, i) => {
    const { width, height } = sizeOf(room);
    const { col, row } = getRoomGridPos(i, count);
    colWidth[col] = Math.max(colWidth[col], width);
    rowHeight[row] = Math.max(rowHeight[row], height);
  });

  const colX = new Array<number>(columns).fill(0);
  for (let c = 1; c < columns; c += 1) colX[c] = colX[c - 1] + colWidth[c - 1] + CANVAS_TILE_GAP;
  const rowY = new Array<number>(rowCount).fill(0);
  for (let r = 1; r < rowCount; r += 1) rowY[r] = rowY[r - 1] + rowHeight[r - 1] + CANVAS_TILE_GAP;

  rooms.forEach((room, i) => {
    const { col, row } = getRoomGridPos(i, count);
    out[room] = { x: colX[col], y: rowY[row] };
  });
  return out;
}

function getFreeformCoordinates(count: number): Array<{ col: number; row: number }> {
  const predefined = [
    { col: 0, row: 0 },   // 1
    { col: -1, row: 0 },  // 2
    { col: 0, row: 1 },   // 3
    { col: -1, row: 1 },  // 4
    { col: -2, row: 0 },  // 5
    { col: -1, row: 2 },  // 6
    { col: -2, row: 1 },  // 7
    { col: 0, row: 2 },   // 8
    { col: -3, row: 0 },  // 9
    { col: -2, row: 2 },  // 10
    { col: -1, row: 3 },  // 11
    { col: 0, row: 3 },   // 12
    { col: -4, row: 0 },  // 13
    { col: -3, row: 1 },  // 14
    { col: -2, row: 3 },  // 15
    { col: -1, row: 4 },  // 16
    { col: 0, row: 4 },   // 17
  ];

  if (count <= predefined.length) {
    return predefined.slice(0, count);
  }

  const res = [...predefined];
  let col = -5;
  let row = 0;
  while (res.length < count) {
    res.push({ col, row });
    row += 1;
    if (row > 4) {
      row = 0;
      col -= 1;
    }
  }
  return res;
}

function computeFreeformGrid<T extends string>(
  rooms: T[],
  sizes: Record<string, GallerySize>,
  defaultSize: GallerySize = { width: GALLERY_DEFAULT_WIDTH, height: GALLERY_DEFAULT_HEIGHT },
  centerX: number = 0,
  centerY: number = 0,
): Record<string, CanvasPos> {
  const out: Record<string, CanvasPos> = {};
  const count = rooms.length;
  if (count === 0) return out;

  const coords = getFreeformCoordinates(count);
  const sizeOf = (room: T) => sizes[room] ?? defaultSize;

  let minCol = 0;
  let maxRow = 0;
  coords.forEach((coord) => {
    if (coord.col < minCol) minCol = coord.col;
    if (coord.row > maxRow) maxRow = coord.row;
  });

  const colCount = Math.abs(minCol) + 1;
  const rowCount = maxRow + 1;

  const colWidth = new Array<number>(colCount).fill(0);
  const rowHeight = new Array<number>(rowCount).fill(0);

  rooms.forEach((room, i) => {
    const { col, row } = coords[i];
    const { width, height } = sizeOf(room);
    const colIdx = Math.abs(col);
    colWidth[colIdx] = Math.max(colWidth[colIdx], width);
    rowHeight[row] = Math.max(rowHeight[row], height);
  });

  const colX = new Array<number>(colCount).fill(0);
  for (let c = 1; c < colCount; c += 1) {
    colX[c] = colX[c - 1] - colWidth[c] - CANVAS_TILE_GAP;
  }

  const rowY = new Array<number>(rowCount).fill(0);
  for (let r = 1; r < rowCount; r += 1) {
    rowY[r] = rowY[r - 1] + rowHeight[r - 1] + CANVAS_TILE_GAP;
  }

  const firstRoom = rooms[0];
  const firstSize = sizeOf(firstRoom);
  const offsetX = centerX - firstSize.width / 2;
  const offsetY = centerY - firstSize.height / 2;

  rooms.forEach((room, i) => {
    const { col, row } = coords[i];
    const colIdx = Math.abs(col);
    out[room] = {
      x: offsetX + colX[colIdx],
      y: offsetY + rowY[row],
    };
  });

  return out;
}

function isPanelInViewport(
  pos: CanvasPos,
  size: GallerySize,
  view: CanvasView,
  viewportRect: DOMRect,
): boolean {
  const screenX = pos.x * view.zoom + view.x;
  const screenY = pos.y * view.zoom + view.y;
  const screenW = size.width * view.zoom;
  const screenH = size.height * view.zoom;

  const pad = 50; // padding tolerance
  return (
    screenX + screenW >= -pad &&
    screenX <= viewportRect.width + pad &&
    screenY + screenH >= -pad &&
    screenY <= viewportRect.height + pad
  );
}



// Reflow free-form panels around a change: push every panel that overlaps
// (within CANVAS_TILE_GAP of) another apart along its axis of least penetration.
// The just-resized/moved `anchor` is held fixed so the rest of the board shifts
// to accommodate it; a few iterations let cascades settle. Panels not in `rooms`
// (or without a position) are left untouched.
function resolveCanvasOverlaps(
  rooms: string[],
  anchor: string,
  positions: Record<string, CanvasPos>,
  sizeOf: (room: string) => GallerySize,
): Record<string, CanvasPos> {
  const pos: Record<string, CanvasPos> = { ...positions };
  const present = rooms.filter((r) => pos[r]);
  const gap = CANVAS_TILE_GAP;

  for (let iter = 0; iter < 16; iter += 1) {
    let moved = false;
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        const a = present[i];
        const b = present[j];
        const sa = sizeOf(a);
        const sb = sizeOf(b);
        const pa = pos[a];
        const pb = pos[b];
        // Penetration depth (incl. the gap) on each axis; ≤0 means no overlap.
        const penX = Math.min(pa.x + sa.width, pb.x + sb.width) - Math.max(pa.x, pb.x) + gap;
        const penY = Math.min(pa.y + sa.height, pb.y + sb.height) - Math.max(pa.y, pb.y) + gap;
        if (penX <= 0 || penY <= 0) continue;

        let dx = 0;
        let dy = 0;
        if (penX < penY) {
          dx = pa.x + sa.width / 2 <= pb.x + sb.width / 2 ? penX : -penX;
        } else {
          dy = pa.y + sa.height / 2 <= pb.y + sb.height / 2 ? penY : -penY;
        }

        const aFixed = a === anchor;
        const bFixed = b === anchor;
        if (aFixed && bFixed) continue;
        if (aFixed) {
          pos[b] = { x: pb.x + dx, y: pb.y + dy };
        } else if (bFixed) {
          pos[a] = { x: pa.x - dx, y: pa.y - dy };
        } else {
          // Neither is the anchor — split the push so both give a little.
          pos[a] = { x: pa.x - dx / 2, y: pa.y - dy / 2 };
          pos[b] = { x: pb.x + dx / 2, y: pb.y + dy / 2 };
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return pos;
}

// Nearest vertically-scrollable ancestor of `el` within (and excluding) `stop`.
// The canvas uses this so a wheel over a panel/terminal scrolls that content
// first and only pans the board once the content can't scroll further.
function findScrollableY(el: HTMLElement, stop: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node && node !== stop) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

const SketchCanvas = lazy(() => import('$lib/components/workspace/SketchCanvas.tsx'));
const EditorPanel = lazy(() => import('$lib/components/editor/EditorPanel.tsx'));
const EnvManager = lazy(() => import('$lib/components/shared/EnvManager.tsx'));

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ActivityButton({ item }: { item: ActivityItem }) {
  return (
    <button
      className={`svt-btn${item.active ? ' svt-active' : ''}`}
      onClick={item.onClick}
      title={item.title}
      aria-label={item.title}
    >
      {item.icon}
    </button>
  );
}

function AuxTab({
  id,
  active,
  title,
  children,
}: {
  id: ActiveView;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button className={`aux-tab${active ? ' active' : ''}`} onClick={() => setActiveView(id)} title={title}>
      {children}
    </button>
  );
}

function PanelHost({ id }: { id: AuxPanelId }) {
  if (id === 'editor') {
    return (
      <Suspense fallback={null}>
        <EditorPanel />
      </Suspense>
    );
  }

  if (id === 'containers') return <ContainersPanel />;
  if (id === 'db') return <DbExplorerPanel />;
  if (id === 'http') return <HttpClientPanel />;
  if (id === 'pet') return <DevPetPanel />;
  if (id === 'review') return <ReviewPanel />;
  if (id === 'toolbox') return <ToolboxPanel />;
  if (id === 'tasks') return <TasksPanel />;
  if (id === 'preview') return <PreviewPanel />;
  if (id === 'youtube') return <YouTubePanel />;
  if (id === 'android') return <AndroidPanel />;
  if (id === 'ios') return <IosPanel />;

  return null;
}

function SidebarContent({ tab }: { tab: SidebarTab }) {
  if (tab === 'search') return <SearchPanel />;
  if (tab === 'git') return <SourceControl />;
  if (tab === 'snapshots') return <SnapshotsPanel />;
  if (tab === 'snippets') return <TerminalSnippetsPanel />;
  return <FileExplorer />;
}

import { useGlobalTooltips } from '$lib/react/useGlobalTooltips.ts';

export default function AppShell() {
  useGlobalTooltips();

  function withTransition(action: () => void) {
    const startViewTransition = (document as Document & {
      startViewTransition?: (callback: () => void) => { finished?: Promise<unknown> };
    }).startViewTransition;

    if (
      startViewTransition &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !(window as any).__soryq_transitioning
    ) {
      (window as any).__soryq_transitioning = true;
      try {
        const transition = startViewTransition.call(document, () => {
          flushSync(action);
        });
        transition.finished?.finally(() => {
          (window as any).__soryq_transitioning = false;
        }).catch(() => {
          (window as any).__soryq_transitioning = false;
        });
        setTimeout(() => {
          (window as any).__soryq_transitioning = false;
        }, 1000);
      } catch (e) {
        (window as any).__soryq_transitioning = false;
        action();
      }
    } else {
      action();
    }
  }

  // On the canvas, opening/closing/minimizing a room reflows the grid via the
  // panels' own CSS left/top/width/height transitions. A page-wide view
  // transition layered on top of that fights the glide and makes the rearrange
  // look broken (panels jump), so skip it in gallery mode and let the canvas
  // animate itself.
  function withRoomTransition(action: () => void) {
    if (ambientLayout === 'gallery') action();
    else withTransition(action);
  }

  const layoutState = useLayoutStore();
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const project = useWorkspaceStore((s) => (s.activeProjectId ? s.projects.get(s.activeProjectId) ?? null : null));
  const projectSwitching = useWorkspaceStore((s) => s.isProjectSwitching);
  const shortcuts = useSettingsStore((s) => s.userShortcuts);
  const currentActiveSessionId = useStore(activeSessionId);
  const activeSessionIdRef = useRef(currentActiveSessionId);
  useEffect(() => {
    activeSessionIdRef.current = currentActiveSessionId;
  }, [currentActiveSessionId]);
  const zoom = useSettingsStore((s) => s.uiZoom);
  const showSnapshotsTab = useSettingsStore((s) => s.showSnapshotsTab);

  useEffect(() => {
    if (!showSnapshotsTab && layoutState.sidebarTab === 'snapshots') {
      toggleSidebarTab('files');
    }
  }, [showSnapshotsTab, layoutState.sidebarTab]);
  const sketchOpen = useStore(sketchCanvasOpen);
  const centerOpen = useStore(agentCenterOpen);
  const activeFile = useEditorStore((s) => s.activeFile);
  const auxTabsRef = useAction<HTMLDivElement>(clampHorizontalScroll);
  const layoutCommand = useStore(layoutControlCommand);
  const isEnvManagerOpen = useStore(envManagerOpen);

  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [auxResizing, setAuxResizing] = useState(false);
  const [auxRowResizing, setAuxRowResizing] = useState(false);
  const [auxPanelWidth, setAuxPanelWidth] = useState(layoutState.auxPanelWidth);
  const [auxEditorHeight, setAuxEditorHeight] = useState(layoutState.auxEditorHeight);
  const [focusedRoom, setFocusedRoom] = useState<RoomId | null>('terminal');
  const [minimizedRooms, setMinimizedRooms] = useState<Set<RoomId>>(() => new Set());
  const [ambientLayout, setAmbientLayout] = useState<AmbientLayout>('focus');
  const [layoutSwitching, setLayoutSwitching] = useState(false);
  const [terminalRoomOpen, setTerminalRoomOpen] = useState(true);
  const [roomOrder, setRoomOrder] = useState<RoomId[]>(['workspace', 'terminal']);
  const [draggingRoom, setDraggingRoom] = useState<RoomId | null>(null);
  const [resizingRoom, setResizingRoom] = useState<RoomId | null>(null);
  const [secondaryRoom, setSecondaryRoom] = useState<RoomId | null>(null);
  const [galleryScrollRoom, setGalleryScrollRoom] = useState<RoomId | null>(null);
  const [gallerySizes, setGallerySizes] = useState<Record<string, GallerySize>>({});
  const galleryAutoGrid = false;
  const setGalleryAutoGrid = (_val: boolean) => {};
  const lastActiveRoomRef = useRef<RoomId | null>(null);
  const [canvasPositions, setCanvasPositions] = useState<Record<string, CanvasPos>>({});
  const [canvasRoomClusters, setCanvasRoomClusters] = useState<Record<string, RoomClusterInfo>>({});
  const [canvasView, setCanvasView] = useState<CanvasView>({ x: 0, y: 0, zoom: 1 });
  const [canvasPanning, setCanvasPanning] = useState(false);
  // Live size of the canvas viewport, so the auto-grid can size its panels to fit
  // the whole board on screen at 100% zoom (fit-by-sizing, not fit-by-zoom).
  const [canvasViewportSize, setCanvasViewportSize] = useState({ width: 0, height: 0 });

  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const canvasViewRef = useRef(canvasView);
  const canvasPositionsRef = useRef(canvasPositions);
  const canvasRoomClustersRef = useRef(canvasRoomClusters);
  const canvasPanRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const canvasMoveRef = useRef<{
    room: RoomId;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    zoom: number;
    moved: boolean;
  } | null>(null);
  const canvasMoveSuppressClickRef = useRef(false);

  useEffect(() => {
    canvasViewRef.current = canvasView;
  }, [canvasView]);

  useEffect(() => {
    canvasPositionsRef.current = canvasPositions;
  }, [canvasPositions]);

  useEffect(() => {
    canvasRoomClustersRef.current = canvasRoomClusters;
  }, [canvasRoomClusters]);

  const sidebarResizeRef = useRef({ startX: 0, startWidth: 0 });
  const auxResizeRef = useRef({ startX: 0, startWidth: 0 });
  const auxRowResizeRef = useRef({ startY: 0, startHeight: 0 });
  const galleryResizeRef = useRef<{
    room: RoomId;
    startX: number;
    startY: number;
    width: number;
    height: number;
    zoom: number;
    element: HTMLElement;
    nextWidth: number;
    nextHeight: number;
    rafId: number | null;
    // In grid mode, the other rooms sharing this room's column (whose width should
    // follow) and its row (whose height should follow). Empty in freeform mode.
    columnRooms: RoomId[];
    rowRooms: RoomId[];
    freeform: boolean;
    allRooms: RoomId[];
    sizeSnapshot: Record<string, GallerySize>;
    defaultSize: GallerySize;
    shiftPanels: Array<{ room: RoomId; dir: 'left' | 'down' | 'both'; origX: number; origY: number }>;
  } | null>(null);
  const layoutSwitchTimerRef = useRef<number | null>(null);
  const lastLayoutCommandNonce = useRef(0);

  const roomsTableRef = useRef<HTMLElement | null>(null);
  const allTerminalSessions = useStore(terminalSessions);
  const terminalPaneAssignments = useStore(paneAssignments);
  const history = useStore(commandHistory);

  useEffect(() => () => {
    if (layoutSwitchTimerRef.current !== null) window.clearTimeout(layoutSwitchTimerRef.current);
  }, []);



  const visiblePanels = useMemo(
    () =>
      [
        { id: 'editor' as const, visible: layoutState.editorVisible },
        { id: 'preview' as const, visible: layoutState.previewVisible },
        { id: 'review' as const, visible: layoutState.reviewVisible },
        { id: 'http' as const, visible: layoutState.httpVisible },
        { id: 'tasks' as const, visible: layoutState.tasksVisible },
        { id: 'db' as const, visible: layoutState.dbVisible },
        { id: 'containers' as const, visible: layoutState.containersVisible },
        { id: 'toolbox' as const, visible: layoutState.toolboxVisible },
        { id: 'pet' as const, visible: layoutState.petVisible },
        { id: 'youtube' as const, visible: layoutState.youtubeVisible },
        { id: 'android' as const, visible: layoutState.androidVisible },
        { id: 'ios' as const, visible: layoutState.iosVisible },
      ].filter((panel) => panel.visible),
    [layoutState],
  );

  const agentSessions = useMemo(
    () => allTerminalSessions.filter((session) => session.isRunning && isAgentSession(session)),
    [allTerminalSessions],
  );
  const agentRoomIds = useMemo<AgentRoomId[]>(
    () => agentSessions.map((session) => `agent:${session.id}` as AgentRoomId),
    [agentSessions],
  );

  const openRooms = useMemo<RoomId[]>(
    () => [
      ...(layoutState.sidebarVisible ? (['workspace'] as RoomId[]) : []),
      ...(terminalRoomOpen ? (['terminal'] as RoomId[]) : []),
      ...(centerOpen ? (['orchestrator'] as RoomId[]) : []),
      ...agentRoomIds,
      ...visiblePanels.map((panel) => panel.id),
    ],
    [agentRoomIds, centerOpen, layoutState.sidebarVisible, terminalRoomOpen, visiblePanels],
  );

  const visibleRooms = useMemo(
    () => openRooms.filter((room) => !minimizedRooms.has(room)),
    [minimizedRooms, openRooms],
  );

  const orderedVisibleRooms = useMemo(
    () => roomOrder.filter((room) => visibleRooms.includes(room)),
    [roomOrder, visibleRooms],
  );

  const getRoomDefaultSizeHelper = useCallback((room: RoomId, clusters: Record<string, RoomClusterInfo>): GallerySize => {
    const fallback = { width: GALLERY_DEFAULT_WIDTH, height: GALLERY_DEFAULT_HEIGHT };
    if (ambientLayout !== 'gallery') return fallback;

    const clusterId = clusters[room]?.anchorRoomId;
    if (!clusterId) return fallback;

    const clusterRooms = orderedVisibleRooms.filter(
      (r) => clusters[r]?.anchorRoomId === clusterId
    );
    const count = clusterRooms.length;
    const { width: vpW, height: vpH } = canvasViewportSize;
    if (count === 0 || vpW <= 0 || vpH <= 0) return fallback;

    const coords = clusterRooms.map(r => {
      const idx = clusters[r]?.localIndex ?? 0;
      return getFreeformCoordinates(idx + 1)[idx];
    });

    let minCol = 0;
    let maxRow = 0;
    coords.forEach((coord) => {
      if (coord.col < minCol) minCol = coord.col;
      if (coord.row > maxRow) maxRow = coord.row;
    });

    const colCount = Math.abs(minCol) + 1;
    const rowCount = maxRow + 1;

    const pad = 16;
    const availW = vpW - pad * 2 - (colCount - 1) * CANVAS_TILE_GAP;
    const availH = vpH - pad * 2 - (rowCount - 1) * CANVAS_TILE_GAP;

    const cellW = availW / colCount;
    const cellH = availH / rowCount;

    const scale = Math.min(cellW / GALLERY_DEFAULT_WIDTH, cellH / GALLERY_DEFAULT_HEIGHT, 1);
    return {
      width: Math.max(GALLERY_MIN_WIDTH, GALLERY_DEFAULT_WIDTH * scale),
      height: Math.max(GALLERY_MIN_HEIGHT, GALLERY_DEFAULT_HEIGHT * scale),
    };
  }, [ambientLayout, orderedVisibleRooms, canvasViewportSize]);

  const getRoomDefaultSize = useCallback((room: RoomId): GallerySize => {
    return getRoomDefaultSizeHelper(room, canvasRoomClusters);
  }, [canvasRoomClusters, getRoomDefaultSizeHelper]);

  const activeRoom = focusedRoom && visibleRooms.includes(focusedRoom)
    ? focusedRoom
    : (visibleRooms[0] ?? null);
  if (activeRoom && canvasPositions[activeRoom]) {
    lastActiveRoomRef.current = activeRoom;
  }
  const sideRooms = activeRoom ? visibleRooms.filter((room) => room !== activeRoom) : visibleRooms;
  const splitRoom = activeRoom ? ((secondaryRoom && sideRooms.includes(secondaryRoom)) ? secondaryRoom : (sideRooms[0] ?? null)) : null;
  const stackedRooms = ambientLayout === 'split' && splitRoom
    ? sideRooms.filter((room) => room !== splitRoom)
    : sideRooms;

  // Apply layout commands from the orchestrator (or any other controller). The
  // nonce guard makes a repeated identical command (e.g. "focus terminal" twice)
  // still fire, while ensuring each command is applied exactly once.
  useEffect(() => {
    if (!layoutCommand || layoutCommand.nonce === lastLayoutCommandNonce.current) return;
    lastLayoutCommandNonce.current = layoutCommand.nonce;

    if (layoutCommand.type === 'ambient') {
      switchAmbientLayout(layoutCommand.mode);
      return;
    }

    if (layoutCommand.type === 'canvas') {
      // Canvas controls only make sense on the freeform board, so switch to it
      // first if we're not already there.
      if (ambientLayout !== 'gallery') switchAmbientLayout('gallery');
      switch (layoutCommand.op) {
        case 'zoom-in': zoomCanvasBy(CANVAS_ZOOM_STEP); break;
        case 'zoom-out': zoomCanvasBy(1 / CANVAS_ZOOM_STEP); break;
        case 'fit': fitCanvasToContent(); break;
        case 'lock': setGalleryAutoGrid(true); break;
        case 'unlock': setGalleryAutoGrid(false); break;
      }
      return;
    }

    const wanted = layoutCommand.room.trim().toLowerCase();
    const resolveRoom = (): RoomId | null => {
      if (!wanted) return null;
      if (['last', 'it', 'that', 'that one', 'focused', 'active', 'current'].includes(wanted)) {
        return activeRoom;
      }
      const direct = openRooms.find((id) => id.toLowerCase() === wanted);
      if (direct) return direct;
      const synonyms: Record<string, RoomId> = {
        files: 'workspace', sidebar: 'workspace', explorer: 'workspace',
        console: 'terminal', shell: 'terminal',
      };
      if (synonyms[wanted] && openRooms.includes(synonyms[wanted])) return synonyms[wanted];
      return (
        openRooms.find((id) => {
          const labels = [roomTitle(id), roomKind(id), id].map((label) => label.toLowerCase());
          return labels.some((label) => label === wanted || label.includes(wanted) || wanted.includes(label));
        }) ?? null
      );
    };

    const room = resolveRoom();
    if (!room) return;
    switch (layoutCommand.op) {
      case 'focus': focusRoom(room); break;
      case 'minimize': minimizeRoom(room); break;
      case 'restore': restoreRoom(room); break;
      case 'close': closeRoom(room); break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutCommand]);

  // Publish the live layout back so the orchestrator brain can see and reason
  // about the current arrangement (ambient mode + which rooms are open/focused).
  useEffect(() => {
    publishLayoutSnapshot({
      ambient: ambientLayout,
      rooms: openRooms.map((id) => ({
        id,
        title: roomTitle(id),
        focused: id === activeRoom,
        minimized: minimizedRooms.has(id),
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientLayout, openRooms, activeRoom, minimizedRooms, allTerminalSessions]);

  // Preview mode is built around the preview browser; if it gets closed (its X),
  // the mode has nothing to show, so fall back to Focus.
  useEffect(() => {
    if (ambientLayout === 'preview' && !layoutState.previewVisible) {
      switchAmbientLayout('focus');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientLayout, layoutState.previewVisible]);

  const auxTabsNarrow = auxPanelWidth < 300;
  const resizing = sidebarResizing || auxResizing || auxRowResizing;

  function auxMaxWidth(width = windowWidth) {
    const sidebar = 48 + (layoutState.sidebarVisible ? layoutState.sidebarWidth : 0);
    return width / (zoom / 100) - sidebar - 250 - 60;
  }

  useEffect(() => {
    setAuxPanelWidth(layoutState.auxPanelWidth);
    setAuxEditorHeight(layoutState.auxEditorHeight);
  }, [layoutState.auxEditorHeight, layoutState.auxPanelWidth]);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (windowWidth < 500 || document.hidden) return;
    const effectiveWindowWidth = windowWidth / (zoom / 100);
    if (effectiveWindowWidth < 640) {
      if (layoutState.sidebarVisible) {
        useLayoutStore.setState({ sidebarVisible: false });
      }
      return;
    }

    const maxAllowedWidth = Math.min(600, effectiveWindowWidth - 250 - 48);
    if (layoutState.sidebarWidth > maxAllowedWidth) {
      useLayoutStore.setState({ sidebarWidth: Math.max(180, maxAllowedWidth) });
    }
  }, [layoutState.sidebarVisible, layoutState.sidebarWidth, windowWidth, zoom]);

  useEffect(() => {
    if (windowWidth < 500 || document.hidden) return;
    if (visiblePanels.length > 0 && auxPanelWidth > auxMaxWidth()) {
      setAuxPanelWidth(Math.max(200, auxMaxWidth()));
    }
  }, [auxPanelWidth, layoutState.sidebarVisible, layoutState.sidebarWidth, visiblePanels.length, windowWidth, zoom]);

  useEffect(() => {
    if (focusedRoom && !openRooms.includes(focusedRoom)) {
      setFocusedRoom(ambientLayout === 'focus' ? null : (openRooms[0] ?? null));
    }

    setMinimizedRooms((current) => {
      const open = new Set(openRooms);
      const next = new Set(Array.from(current).filter((room) => open.has(room)));
      return next.size === current.size ? current : next;
    });

    setSecondaryRoom((current) => {
      if (!current || !openRooms.includes(current) || current === focusedRoom) return null;
      return current;
    });
  }, [ambientLayout, focusedRoom, openRooms]);

  // When the editor panel becomes visible or the active file changes, focus
  // the editor room so it appears in the primary position. This handles both
  // the initial open and subsequent file clicks while the editor is already
  // visible (where editorVisible stays true but activeFile changes).
  useEffect(() => {
    if (layoutState.editorVisible && activeFile) {
      setFocusedRoom('editor');
    }
  }, [layoutState.editorVisible, activeFile]);

  useEffect(() => {
    setRoomOrder((current) => {
      const currentOpen = current.filter((room) => openRooms.includes(room));
      const additions = openRooms.filter((room) => !currentOpen.includes(room));
      const next = [...currentOpen, ...additions];
      return next.length === current.length && next.every((room, index) => room === current[index])
        ? current
        : next;
    });
  }, [openRooms]);

  useEffect(() => {
    setGallerySizes((current) => {
      const open = new Set(openRooms);
      const next = Object.fromEntries(Object.entries(current).filter(([room]) => open.has(room as RoomId)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setCanvasPositions((current) => {
      const open = new Set(openRooms);
      const next = Object.fromEntries(Object.entries(current).filter(([room]) => open.has(room as RoomId)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setGalleryScrollRoom((current) => (current && openRooms.includes(current) ? current : null));
  }, [openRooms]);

  // Track the canvas viewport's live size so the auto-grid can fit every panel on
  // screen at 100% zoom. Re-attaches when entering Canvas (the element mounts then).
  useEffect(() => {
    const el = canvasViewportRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setCanvasViewportSize((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ambientLayout]);

  // Give every room on the canvas a starting position. The first batch (an empty
  // board) flows into a tidy two-column grid; any room opened afterwards drops into
  // the centre of whatever the user is currently looking at, so a freshly opened
  // tab never lands off-screen or hidden behind the floating dock. Once placed,
  // the user is free to drag rooms anywhere and the saved position sticks.
  useEffect(() => {
    if (ambientLayout !== 'gallery') return;

    const currentPositions = canvasPositionsRef.current;
    const currentClusters = canvasRoomClustersRef.current;

    const missing = orderedVisibleRooms.filter((room) => !(room in currentPositions));
    if (missing.length === 0) {
      // Check if we need to clean up deleted rooms from states
      const activeKeys = new Set(orderedVisibleRooms);
      let needsCleanup = false;
      Object.keys(currentPositions).forEach(key => {
        if (!activeKeys.has(key)) needsCleanup = true;
      });
      if (needsCleanup) {
        setCanvasPositions(current => {
          const next = { ...current };
          Object.keys(next).forEach(key => {
            if (!activeKeys.has(key)) delete next[key];
          });
          return next;
        });
        setCanvasRoomClusters(current => {
          const next = { ...current };
          Object.keys(next).forEach(key => {
            if (!activeKeys.has(key)) delete next[key];
          });
          return next;
        });
      }
      return;
    }

    const view = canvasViewRef.current;
    const rect = canvasViewportRef.current?.getBoundingClientRect();
    const centerX = rect ? (rect.width / 2 - view.x) / view.zoom : 0;
    const centerY = rect ? (rect.height / 2 - view.y) / view.zoom : 0;

    const nextPositions = { ...currentPositions };
    const nextClusters = { ...currentClusters };

    // Clean up closed rooms first
    const activeKeys = new Set(orderedVisibleRooms);
    Object.keys(nextPositions).forEach(key => {
      if (!activeKeys.has(key)) delete nextPositions[key];
    });
    Object.keys(nextClusters).forEach(key => {
      if (!activeKeys.has(key)) delete nextClusters[key];
    });

    const placedCount = Object.keys(nextPositions).length;

    if (placedCount === 0) {
      // Initial population: lay rooms out in the sequence pattern starting from the center
      const initialCount = orderedVisibleRooms.length;
      const coords = getFreeformCoordinates(initialCount);
      let minCol = 0;
      let maxRow = 0;
      coords.forEach((coord) => {
        if (coord.col < minCol) minCol = coord.col;
        if (coord.row > maxRow) maxRow = coord.row;
      });
      const colCount = Math.abs(minCol) + 1;
      const rowCount = maxRow + 1;

      const pad = 16;
      const { width: vpW, height: vpH } = canvasViewportSize;
      const availW = vpW > 0 ? (vpW - pad * 2 - (colCount - 1) * CANVAS_TILE_GAP) : (GALLERY_DEFAULT_WIDTH * colCount);
      const availH = vpH > 0 ? (vpH - pad * 2 - (rowCount - 1) * CANVAS_TILE_GAP) : (GALLERY_DEFAULT_HEIGHT * rowCount);
      const cellW = availW / colCount;
      const cellH = availH / rowCount;
      const scale = vpW > 0 && vpH > 0 ? Math.min(cellW / GALLERY_DEFAULT_WIDTH, cellH / GALLERY_DEFAULT_HEIGHT, 1) : 1;
      const defaultSize = {
        width: Math.max(GALLERY_MIN_WIDTH, GALLERY_DEFAULT_WIDTH * scale),
        height: Math.max(GALLERY_MIN_HEIGHT, GALLERY_DEFAULT_HEIGHT * scale),
      };

      const initialPositions = computeFreeformGrid(orderedVisibleRooms, gallerySizes, defaultSize, centerX, centerY);
      orderedVisibleRooms.forEach((room, i) => {
        nextClusters[room] = {
          anchorRoomId: orderedVisibleRooms[0],
          localIndex: i,
        };
      });

      setCanvasPositions(initialPositions);
      setCanvasRoomClusters(nextClusters);
      return;
    }

    // Otherwise, place missing rooms one by one.
    missing.forEach((room) => {
      let anchorRoom: string | null = null;
      const viewport = canvasViewportRef.current;
      if (viewport) {
        const viewportRect = viewport.getBoundingClientRect();
        // A room is visible in viewport if it is in nextPositions and in viewport
        const visiblePlacedRooms = orderedVisibleRooms.filter(
          (r) =>
            r !== room &&
            (r in nextPositions) &&
            isPanelInViewport(nextPositions[r], gallerySizes[r] ?? getRoomDefaultSizeHelper(r, nextClusters), view, viewportRect),
        );

        if (visiblePlacedRooms.length > 0) {
          if (activeRoom && visiblePlacedRooms.includes(activeRoom)) {
            anchorRoom = activeRoom;
          } else if (lastActiveRoomRef.current && visiblePlacedRooms.includes(lastActiveRoomRef.current)) {
            anchorRoom = lastActiveRoomRef.current;
          } else {
            anchorRoom = visiblePlacedRooms[visiblePlacedRooms.length - 1];
          }
        }
      }

      if (anchorRoom) {
        const anchorCluster = nextClusters[anchorRoom];
        const anchorRoomId = anchorCluster?.anchorRoomId ?? anchorRoom;
        const anchorLocalIndex = anchorCluster?.localIndex ?? 0;

        // Count how many rooms are currently in this cluster
        const clusterRooms = Object.keys(nextClusters).filter(
          (r) => nextClusters[r]?.anchorRoomId === anchorRoomId
        );
        const newLocalIndex = clusterRooms.length;

        // Assign cluster info first
        nextClusters[room] = {
          anchorRoomId,
          localIndex: newLocalIndex,
        };

        // Now calculate size and position
        const anchorPos = nextPositions[anchorRoom];

        // Perform relative offset computation using all rooms in the cluster
        const roomsInCluster = [...clusterRooms, room];
        const coords = roomsInCluster.map(r => {
          const idx = nextClusters[r].localIndex;
          return getFreeformCoordinates(idx + 1)[idx];
        });

        let minCol = 0;
        let maxRow = 0;
        coords.forEach((coord) => {
          if (coord.col < minCol) minCol = coord.col;
          if (coord.row > maxRow) maxRow = coord.row;
        });
        const colCount = Math.abs(minCol) + 1;
        const rowCount = maxRow + 1;

        const colWidth = new Array<number>(colCount).fill(0);
        const rowHeight = new Array<number>(rowCount).fill(0);

        roomsInCluster.forEach((r, i) => {
          const coord = coords[i];
          const rSize = gallerySizes[r] ?? getRoomDefaultSizeHelper(r, nextClusters);
          const colIdx = Math.abs(coord.col);
          colWidth[colIdx] = Math.max(colWidth[colIdx], rSize.width);
          rowHeight[coord.row] = Math.max(rowHeight[coord.row], rSize.height);
        });

        const colX = new Array<number>(colCount).fill(0);
        for (let c = 1; c < colCount; c += 1) {
          colX[c] = colX[c - 1] - colWidth[c] - CANVAS_TILE_GAP;
        }

        const rowY = new Array<number>(rowCount).fill(0);
        for (let r = 1; r < rowCount; r += 1) {
          rowY[r] = rowY[r - 1] + rowHeight[r - 1] + CANVAS_TILE_GAP;
        }

        const newCoords = getFreeformCoordinates(newLocalIndex + 1)[newLocalIndex];
        const anchorCoords = getFreeformCoordinates(anchorLocalIndex + 1)[anchorLocalIndex];

        const idealXNew = colX[Math.abs(newCoords.col)];
        const idealYNew = rowY[newCoords.row];
        const idealXAnchor = colX[Math.abs(anchorCoords.col)];
        const idealYAnchor = rowY[anchorCoords.row];

        nextPositions[room] = {
          x: anchorPos.x + (idealXNew - idealXAnchor),
          y: anchorPos.y + (idealYNew - idealYAnchor),
        };
      } else {
        // Start a new cluster!
        nextClusters[room] = {
          anchorRoomId: room,
          localIndex: 0,
        };

        const size = gallerySizes[room] ?? getRoomDefaultSizeHelper(room, nextClusters);
        nextPositions[room] = {
          x: centerX - size.width / 2,
          y: centerY - size.height / 2,
        };
      }
    });

    setCanvasPositions(nextPositions);
    setCanvasRoomClusters(nextClusters);
  }, [ambientLayout, orderedVisibleRooms]);

  useEffect(() => {
    function handleGalleryResizeMove(event: MouseEvent) {
      const drag = galleryResizeRef.current;
      if (!drag) return;
      const scale = drag.zoom || 1;
      drag.nextWidth = Math.max(GALLERY_MIN_WIDTH, drag.width + (event.clientX - drag.startX) / scale);
      drag.nextHeight = Math.max(GALLERY_MIN_HEIGHT, drag.height + (event.clientY - drag.startY) / scale);

      if (drag.rafId !== null) return;
      drag.rafId = requestAnimationFrame(() => {
        const latest = galleryResizeRef.current;
        if (!latest) return;
        latest.rafId = null;
        latest.element.style.width = `${latest.nextWidth}px`;
        latest.element.style.height = `${latest.nextHeight}px`;

        const dW = latest.nextWidth - latest.width;
        const dH = latest.nextHeight - latest.height;

        latest.shiftPanels.forEach((shift) => {
          const el = document.querySelector(`[data-room-id="${shift.room}"]`) as HTMLElement;
          if (el) {
            if (shift.dir === 'left') {
              el.style.left = `${shift.origX - dW}px`;
            } else if (shift.dir === 'down') {
              el.style.top = `${shift.origY + dH}px`;
            } else if (shift.dir === 'both') {
              el.style.left = `${shift.origX - dW}px`;
              el.style.top = `${shift.origY + dH}px`;
            }
          }
        });
      });
    }

    function handleGalleryResizeEnd() {
      const drag = galleryResizeRef.current;
      if (!drag) return;
      if (drag.rafId !== null) {
        cancelAnimationFrame(drag.rafId);
      }
      drag.element.style.width = `${drag.nextWidth}px`;
      drag.element.style.height = `${drag.nextHeight}px`;

      const dW = drag.nextWidth - drag.width;
      const dH = drag.nextHeight - drag.height;

      setGallerySizes((current) => ({
        ...current,
        [drag.room]: { width: drag.nextWidth, height: drag.nextHeight },
      }));

      setCanvasPositions((current) => {
        const next = { ...current };
        drag.shiftPanels.forEach((shift) => {
          if (shift.dir === 'left') {
            next[shift.room] = { x: shift.origX - dW, y: shift.origY };
          } else if (shift.dir === 'down') {
            next[shift.room] = { x: shift.origX, y: shift.origY + dH };
          } else if (shift.dir === 'both') {
            next[shift.room] = { x: shift.origX - dW, y: shift.origY + dH };
          }
        });
        return next;
      });

      drag.shiftPanels.forEach((shift) => {
        const el = document.querySelector(`[data-room-id="${shift.room}"]`) as HTMLElement;
        if (el) {
          el.style.left = '';
          el.style.top = '';
        }
      });

      galleryResizeRef.current = null;
      setResizingRoom(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.dispatchEvent(new CustomEvent('pane-resize-end'));
    }

    window.addEventListener('mousemove', handleGalleryResizeMove);
    window.addEventListener('mouseup', handleGalleryResizeEnd);
    return () => {
      window.removeEventListener('mousemove', handleGalleryResizeMove);
      window.removeEventListener('mouseup', handleGalleryResizeEnd);
    };
  }, []);

  // Canvas panning (drag empty board) and panel moving (drag a panel header).
  // Both are pointer-driven and share one set of window listeners, mirroring
  // the gallery-resize pattern above.
  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const pan = canvasPanRef.current;
      if (pan) {
        setCanvasView((view) => ({
          ...view,
          x: pan.origX + (event.clientX - pan.startX),
          y: pan.origY + (event.clientY - pan.startY),
        }));
        return;
      }

      const move = canvasMoveRef.current;
      if (move) {
        const dx = event.clientX - move.startX;
        const dy = event.clientY - move.startY;
        if (!move.moved && Math.hypot(dx, dy) < CANVAS_MOVE_THRESHOLD) return;
        move.moved = true;
        const scale = move.zoom || 1;
        const nextX = move.origX + dx / scale;
        const nextY = move.origY + dy / scale;
        setCanvasPositions((current) => ({ ...current, [move.room]: { x: nextX, y: nextY } }));
      }
    }

    function handlePointerUp() {
      if (canvasPanRef.current) {
        canvasPanRef.current = null;
        setCanvasPanning(false);
      }
      const move = canvasMoveRef.current;
      if (move) {
        // Swallow the click that fires right after a real drag so releasing a
        // moved panel doesn't also fling it into Focus mode.
        canvasMoveSuppressClickRef.current = move.moved;
        canvasMoveRef.current = null;
        setDraggingRoom(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  // Wheel = pan; Ctrl/⌘+wheel = zoom toward the cursor. Bound natively (not via
  // React) so the canvas board claims the wheel for pan/zoom. Inner panels that
  // can still scroll keep their own wheel.
  useEffect(() => {
    if (ambientLayout !== 'gallery') return;
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      // Always claim the gesture so it can never bubble out to switch modes.
      event.stopPropagation();

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        setCanvasView((view) => {
          const nextZoom = clampZoom(view.zoom * Math.exp(-event.deltaY * 0.0015));
          if (nextZoom === view.zoom) return view;
          // Keep the world point under the cursor pinned while scaling.
          const worldX = (px - view.x) / view.zoom;
          const worldY = (py - view.y) / view.zoom;
          return { zoom: nextZoom, x: px - worldX * nextZoom, y: py - worldY * nextZoom };
        });
        return;
      }

      // Pan the canvas even over a panel — but be polite about it:
      //  • Horizontal scroll always pans (panels rarely scroll sideways, and the
      //    user wants left/right panning to keep working on top of a panel).
      //  • Vertical scroll lets a scrollable panel/terminal consume the gesture
      //    until it bottoms/tops out, then the canvas pans. A non-scrollable
      //    panel pans straight away.
      const target = event.target instanceof HTMLElement ? event.target : null;
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && target) {
        const panel = target.closest('.room-panel');
        if (panel instanceof HTMLElement) {
          const scroller = findScrollableY(target, panel);
          if (scroller) {
            const down = event.deltaY > 0;
            const atTop = scroller.scrollTop <= 0;
            const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
            // Still room to scroll in this direction → let the panel have it.
            if (down ? !atBottom : !atTop) return;
          }
        }
      }

      event.preventDefault();
      setCanvasView((view) => ({ ...view, x: view.x - event.deltaX, y: view.y - event.deltaY }));
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [ambientLayout]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void useUpdaterStore.getState().checkForUpdate().catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    function handleMouseMove(event: MouseEvent) {
      const scale = zoom / 100;
      if (sidebarResizing) {
        const delta = (event.clientX - sidebarResizeRef.current.startX) / scale;
        const maxAllowedWidth = Math.min(600, windowWidth / scale - 250 - 48);
        useLayoutStore.setState({
          sidebarWidth: Math.max(180, Math.min(maxAllowedWidth, sidebarResizeRef.current.startWidth + delta)),
        });
      } else if (auxResizing) {
        const delta = (event.clientX - auxResizeRef.current.startX) / scale;
        const nextWidth = auxResizeRef.current.startWidth - delta;
        setAuxPanelWidth(Math.max(200, Math.min(auxMaxWidth(), nextWidth)));
      } else if (auxRowResizing) {
        const deltaY = (event.clientY - auxRowResizeRef.current.startY) / scale;
        const container = document.querySelector('.auxiliary-panel');
        if (!container) return;
        const totalHeight = container.clientHeight;
        if (totalHeight <= 0) return;
        const deltaPercent = (deltaY / totalHeight) * 100;
        setAuxEditorHeight(Math.max(10, Math.min(90, auxRowResizeRef.current.startHeight + deltaPercent)));
      }
    }

    function handleMouseUp() {
      const wasAuxResize = auxResizing || auxRowResizing;
      setSidebarResizing(false);
      setAuxResizing(false);
      setAuxRowResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (wasAuxResize) {
        useLayoutStore.setState({ auxPanelWidth, auxEditorHeight });
      }
    }

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [auxEditorHeight, auxPanelWidth, auxResizing, auxRowResizing, sidebarResizing, windowWidth, zoom]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const matched = (shortcuts || []).find((shortcut) => shortcut && matchShortcut(event, shortcut.keys));
      if (!matched) return;

      if (matched.id.startsWith('custom_') && matched.command) {
        event.preventDefault();
        const runCustomCommand = async () => {
          setTerminalRoomOpen(true);
          setFocusedRoom('terminal');
          let sesId = activeSessionIdRef.current;
          if (sesId === null) {
            sesId = await createTerminalSession();
          }
          if (sesId !== null) {
            writeToSession(sesId, matched.command + '\r');
          }
        };
        runCustomCommand().catch(console.error);
        return;
      }

      event.preventDefault();

      switch (matched.id) {
        case 'commandPalette':
          toggleCommandPalette();
          break;
        case 'openSettings':
          openSettings();
          break;
        case 'newWorkspace':
          withTransition(() => {
            useWorkspaceStore.getState().__set('newWorkspacePromptOpen', true);
          });
          break;
        case 'goToTerminal':
          setActiveView('terminal');
          setTerminalRoomOpen(true);
          setFocusedRoom('terminal');
          break;
        case 'goToEditor':
          setActiveView('editor');
          setFocusedRoom('editor');
          break;
        case 'goToPreview':
          setActiveView('preview');
          setFocusedRoom('preview');
          break;
        case 'goToOrchestrator':
          toggleOrchestratorVisible();
          break;
        case 'goToReview':
          toggleReviewVisible();
          break;
        case 'goToHttp':
          toggleHttpVisible();
          break;
        case 'goToTasks':
          toggleTasksVisible();
          break;
        case 'goToDb':
          toggleDbVisible();
          break;
        case 'goToContainers':
          toggleContainersVisible();
          break;
        case 'goToToolbox':
          toggleToolboxVisible();
          break;
        case 'goToPet':
          togglePetVisible();
          break;
        case 'goToYoutube':
          toggleYoutubeVisible();
          break;
        case 'goToAndroid':
          toggleAndroidVisible();
          break;
        case 'goToIos':
          toggleIosVisible();
          break;
        case 'openSearch':
          toggleSidebarTab('search');
          break;
        case 'openEnvManager':
          openEnvManager();
          break;
        case 'saveFile':
          saveActiveFile();
          break;
        case 'openFolder':
          openProject();
          break;
        case 'newTerminal':
          setActiveView('terminal');
          setTerminalRoomOpen(true);
          setFocusedRoom('terminal');
          createTerminalSession();
          break;
        case 'formatDocument':
          formatActiveFile();
          break;
        case 'startProxy':
          startProxy();
          break;
        case 'stopProxy':
          stopProxy();
          break;
        case 'quickCapture':
          openQuickCapture();
          break;
        case 'openDailyNote':
          if (project) openDailyNote(project, true).catch(() => {});
          break;
        case 'toggleSketch':
          toggleSketchCanvas();
          break;
        case 'launchVoiceMode':
          launchPromptBarVoiceMode();
          break;
        case 'cycleAmbientLayout': {
          const MODE_ORDER: AmbientLayout[] = ['focus', 'split', 'gallery', 'preview'];
          const currentIdx = MODE_ORDER.indexOf(ambientLayout);
          const nextIdx = (currentIdx + 1) % MODE_ORDER.length;
          switchAmbientLayout(MODE_ORDER[nextIdx]);
          break;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project, shortcuts, ambientLayout]);

  function startSidebarResize(event: React.MouseEvent) {
    setSidebarResizing(true);
    sidebarResizeRef.current = { startX: event.clientX, startWidth: layoutState.sidebarWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function startAuxResize(event: React.MouseEvent) {
    setAuxResizing(true);
    auxResizeRef.current = { startX: event.clientX, startWidth: auxPanelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function startAuxRowResize(event: React.MouseEvent) {
    setAuxRowResizing(true);
    auxRowResizeRef.current = { startY: event.clientY, startHeight: auxEditorHeight };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }

  function persistLayoutPatch(patch: Partial<ReturnType<typeof useLayoutStore.getState>>) {
    useLayoutStore.setState((state) => {
      const next = { ...state, ...patch };
      if (typeof window !== 'undefined') {
        localStorage.setItem('soryq_layout', JSON.stringify(next));
      }
      return next;
    });
  }

  function setPanelRoomOpen(id: AuxPanelId, open: boolean) {
    withRoomTransition(() => {
      const key = PANEL_VISIBILITY_KEYS[id];
      persistLayoutPatch({
        [key]: open,
        activeView: open ? id : 'terminal',
        lastAuxView: id,
        editorSplitPreview: false,
      });

      setMinimizedRooms((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });

      if (open) {
        setFocusedRoom(id);
        // On the canvas, arm the freshly opened panel so it lifts to the top and
        // is immediately ready to scroll/edit in place (matching a direct click).
        if (ambientLayout === 'gallery') setGalleryScrollRoom(id);
      } else if (focusedRoom === id) {
        setFocusedRoom(nextVisibleRoom(id));
      }
    });
  }

  function togglePanelRoom(id: AuxPanelId) {
    const isOpen = Boolean(layoutState[PANEL_VISIBILITY_KEYS[id]]);
    if (isOpen && activeRoom !== id) {
      focusRoom(id);
      return;
    }
    setPanelRoomOpen(id, !isOpen);
  }

  function nextVisibleRoom(excluding: RoomId, minimized = minimizedRooms) {
    return openRooms.find((room) => room !== excluding && !minimized.has(room)) ?? null;
  }

  function focusRoom(id: RoomId) {
    withRoomTransition(() => {
      setMinimizedRooms((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setFocusedRoom(id);
      if (id === 'terminal') setTerminalRoomOpen(true);
    });
  }

  function showRoomInPrimary(id: RoomId) {
    withRoomTransition(() => {
      setMinimizedRooms((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (id === 'terminal') setTerminalRoomOpen(true);
      if (activeRoom && activeRoom !== id) {
        setSecondaryRoom(activeRoom);
      }
      setFocusedRoom(id);
    });
  }

  function showRoomInSecondary(id: RoomId) {
    withRoomTransition(() => {
      setMinimizedRooms((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (id === 'terminal') setTerminalRoomOpen(true);
      if (id === activeRoom) {
        if (splitRoom) {
          setFocusedRoom(splitRoom);
          setSecondaryRoom(id);
        }
        return;
      }
      setSecondaryRoom(id);
    });
  }

  function activateGalleryPanel(id: RoomId) {
    // No view transition here. In gallery the panels live inside a scrollable,
    // clipped grid; a page-wide view transition lifts every panel into the
    // (unclipped) transition overlay, so partially-scrolled panels briefly
    // render full-size over the title bar and past the bottom edge. Setting
    // state directly just re-styles the active panel in place.
    setMinimizedRooms((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    if (id === 'terminal') setTerminalRoomOpen(true);
    setFocusedRoom(id);
    setGalleryScrollRoom(id);
  }

  function minimizeRoom(id: RoomId) {
    withRoomTransition(() => {
      setMinimizedRooms((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });
      if (focusedRoom === id) {
        setFocusedRoom(nextVisibleRoom(id));
      }
    });
  }

  function restoreRoom(id: RoomId) {
    withRoomTransition(() => {
      setMinimizedRooms((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setFocusedRoom(id);
    });
  }

  function focusRoomMode(id: RoomId) {
    // Maximizing a gallery panel into Focus: set the target room directly and
    // let switchAmbientLayout drive the (overlay-free) settle animation, instead
    // of a page-wide view transition that would un-clip the gallery panels.
    setMinimizedRooms((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    if (id === 'terminal') setTerminalRoomOpen(true);
    setFocusedRoom(id);
    switchAmbientLayout('focus');
  }

  function handleFocusModeClick(event: React.MouseEvent, id: RoomId) {
    event.preventDefault();
    event.stopPropagation();
    // A press that turned into a panel drag must not also open Focus on release.
    if (canvasMoveSuppressClickRef.current) {
      canvasMoveSuppressClickRef.current = false;
      return;
    }
    focusRoomMode(id);
  }

  function closeRoom(id: RoomId) {
    withRoomTransition(() => {
      if (id === 'workspace') {
        toggleSidebar();
        if (focusedRoom === id) setFocusedRoom(nextVisibleRoom(id));
        return;
      }
      if (id === 'terminal') {
        setTerminalRoomOpen(false);
        if (focusedRoom === id) setFocusedRoom(nextVisibleRoom(id));
        return;
      }
      if (id === 'orchestrator') {
        agentCenterOpen.set(false);
        if (focusedRoom === id) setFocusedRoom(nextVisibleRoom(id));
        return;
      }
      if (isAgentRoomId(id)) {
        void killSession(getAgentRoomSessionId(id));
        if (focusedRoom === id) setFocusedRoom(nextVisibleRoom(id));
        return;
      }
      setPanelRoomOpen(id, false);
    });
  }

  function startGalleryResize(event: React.MouseEvent, room: RoomId) {
    if (ambientLayout !== 'gallery') return;
    event.preventDefault();
    event.stopPropagation();
    const element = (event.currentTarget as HTMLElement).closest('.room-panel');
    if (!(element instanceof HTMLElement)) return;
    const current = gallerySizes[room] ?? {
      width: element.offsetWidth || GALLERY_DEFAULT_WIDTH,
      height: element.offsetHeight || GALLERY_DEFAULT_HEIGHT,
    };
    let columnRooms: RoomId[] = [];
    let rowRooms: RoomId[] = [];
    if (galleryAutoGrid) {
      const rooms = orderedVisibleRooms;
      const index = rooms.indexOf(room);
      if (index >= 0) {
        const { col, row: gridRow } = getRoomGridPos(index, rooms.length);
        columnRooms = rooms.filter((peer, i) => {
          if (peer === room) return false;
          const pos = getRoomGridPos(i, rooms.length);
          return pos.col === col;
        });
        rowRooms = rooms.filter((peer, i) => {
          if (peer === room) return false;
          const pos = getRoomGridPos(i, rooms.length);
          return pos.row === gridRow;
        });
      }
    }

    const shiftPanels: Array<{ room: RoomId; dir: 'left' | 'down' | 'both'; origX: number; origY: number }> = [];
    const clusterId = canvasRoomClusters[room]?.anchorRoomId;
    if (clusterId) {
      const roomInfo = canvasRoomClusters[room];
      const roomCoord = getFreeformCoordinates(roomInfo.localIndex + 1)[roomInfo.localIndex];
      orderedVisibleRooms.forEach((peer) => {
        if (peer === room) return;
        const peerInfo = canvasRoomClusters[peer];
        if (!peerInfo || peerInfo.anchorRoomId !== clusterId) return;

        const peerCoord = getFreeformCoordinates(peerInfo.localIndex + 1)[peerInfo.localIndex];
        const peerPos = canvasPositions[peer] ?? { x: 0, y: 0 };
        const isLeft = peerCoord.col < roomCoord.col;
        const isBelow = peerCoord.row > roomCoord.row;
        if (isLeft && isBelow) {
          shiftPanels.push({ room: peer, dir: 'both', origX: peerPos.x, origY: peerPos.y });
        } else if (isLeft) {
          shiftPanels.push({ room: peer, dir: 'left', origX: peerPos.x, origY: peerPos.y });
        } else if (isBelow) {
          shiftPanels.push({ room: peer, dir: 'down', origX: peerPos.x, origY: peerPos.y });
        }
      });
    }

    galleryResizeRef.current = {
      room,
      startX: event.clientX,
      startY: event.clientY,
      width: current.width,
      height: current.height,
      zoom: canvasView.zoom,
      element,
      nextWidth: current.width,
      nextHeight: current.height,
      rafId: null,
      columnRooms,
      rowRooms,
      freeform: !galleryAutoGrid,
      allRooms: orderedVisibleRooms,
      sizeSnapshot: gallerySizes,
      defaultSize: getRoomDefaultSize(room),
      shiftPanels,
    };
    setResizingRoom(room);
    focusRoom(room);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  }

  function startCanvasPan(event: React.PointerEvent) {
    if (ambientLayout !== 'gallery') return;
    // Only the empty board pans — presses on a panel or a floating overlay
    // (zoom controls, minimized chips) are handled by those elements.
    if ((event.target as HTMLElement).closest('.room-panel, .ambient-canvas-controls, .minimized-room-stack')) return;
    if (event.button !== 0) return;
    setGalleryScrollRoom(null);
    canvasPanRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: canvasView.x,
      origY: canvasView.y,
    };
    setCanvasPanning(true);
  }

  function startPanelMove(event: React.PointerEvent, room: RoomId) {
    if (ambientLayout !== 'gallery') return;
    if (event.button !== 0) return;
    // Dragging a panel breaks the board out of auto-grid into free-form so the
    // moved position sticks (the grid would otherwise snap it straight back).
    // Resizing, by contrast, stays in grid and flows the whole column/row.
    if (galleryAutoGrid) setGalleryAutoGrid(false);
    // Buttons and the resize grip opt out so they stay clickable.
    if ((event.target as HTMLElement).closest('.room-action, .room-resize-grip')) return;
    const pos = canvasPositions[room] ?? { x: 0, y: 0 };
    canvasMoveRef.current = {
      room,
      startX: event.clientX,
      startY: event.clientY,
      origX: pos.x,
      origY: pos.y,
      zoom: canvasView.zoom,
      moved: false,
    };
    setDraggingRoom(room);
    document.body.style.userSelect = 'none';
  }

  function zoomCanvasBy(factor: number) {
    const viewport = canvasViewportRef.current;
    setCanvasView((view) => {
      const nextZoom = clampZoom(view.zoom * factor);
      if (nextZoom === view.zoom) return view;
      // Zoom toward the viewport centre when driven by the buttons.
      const rect = viewport?.getBoundingClientRect();
      const px = rect ? rect.width / 2 : 0;
      const py = rect ? rect.height / 2 : 0;
      const worldX = (px - view.x) / view.zoom;
      const worldY = (py - view.y) / view.zoom;
      return { zoom: nextZoom, x: px - worldX * nextZoom, y: py - worldY * nextZoom };
    });
  }

  function fitCanvasToContent() {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    const rooms = orderedVisibleRooms;
    if (rooms.length === 0) {
      setCanvasView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const room of rooms) {
      const pos = canvasPositions[room] ?? { x: 0, y: 0 };
      const size = gallerySizes[room] ?? getRoomDefaultSize(room);
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + size.width);
      maxY = Math.max(maxY, pos.y + size.height);
    }
    const rect = viewport.getBoundingClientRect();
    const pad = 48;
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const zoom = clampZoom(Math.min((rect.width - pad * 2) / contentW, (rect.height - pad * 2) / contentH, 1));
    const x = (rect.width - contentW * zoom) / 2 - minX * zoom;
    const y = (rect.height - contentH * zoom) / 2 - minY * zoom;
    setCanvasView({ x, y, zoom });
  }

  function resetCanvasLayout() {
    setGallerySizes({});
    const view = canvasViewRef.current;
    const rect = canvasViewportRef.current?.getBoundingClientRect();
    const centerX = rect ? (rect.width / 2 - view.x) / view.zoom : 0;
    const centerY = rect ? (rect.height / 2 - view.y) / view.zoom : 0;

    // Resetting everything to a single cluster anchored by the first room
    const initialCount = orderedVisibleRooms.length;
    const coords = getFreeformCoordinates(initialCount);
    let minCol = 0;
    let maxRow = 0;
    coords.forEach((coord) => {
      if (coord.col < minCol) minCol = coord.col;
      if (coord.row > maxRow) maxRow = coord.row;
    });
    const colCount = Math.abs(minCol) + 1;
    const rowCount = maxRow + 1;

    const pad = 16;
    const { width: vpW, height: vpH } = canvasViewportSize;
    const availW = vpW > 0 ? (vpW - pad * 2 - (colCount - 1) * CANVAS_TILE_GAP) : (GALLERY_DEFAULT_WIDTH * colCount);
    const availH = vpH > 0 ? (vpH - pad * 2 - (rowCount - 1) * CANVAS_TILE_GAP) : (GALLERY_DEFAULT_HEIGHT * rowCount);
    const cellW = availW / colCount;
    const cellH = availH / rowCount;
    const scale = vpW > 0 && vpH > 0 ? Math.min(cellW / GALLERY_DEFAULT_WIDTH, cellH / GALLERY_DEFAULT_HEIGHT, 1) : 1;
    const defaultSize = {
      width: Math.max(GALLERY_MIN_WIDTH, GALLERY_DEFAULT_WIDTH * scale),
      height: Math.max(GALLERY_MIN_HEIGHT, GALLERY_DEFAULT_HEIGHT * scale),
    };

    setCanvasPositions(computeFreeformGrid(orderedVisibleRooms, {}, defaultSize, centerX, centerY));
    
    const initialClusters: Record<string, RoomClusterInfo> = {};
    orderedVisibleRooms.forEach((room, i) => {
      initialClusters[room] = {
        anchorRoomId: orderedVisibleRooms[0],
        localIndex: i,
      };
    });
    setCanvasRoomClusters(initialClusters);
    setCanvasView({ x: 0, y: 0, zoom: 1 });
  }

  const topItems: ActivityItem[] = [
    {
      id: 'files',
      title: 'Files',
      active: layoutState.sidebarVisible && layoutState.sidebarTab === 'files',
      onClick: () => { toggleSidebarTab('files'); setFocusedRoom('workspace'); },
      icon: <Icon><path d="M3 7a2 2 0 0 1 2-2h3.586a2 2 0 0 1 1.414.586L11.414 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></Icon>,
    },
    {
      id: 'search',
      title: 'Search',
      active: layoutState.sidebarVisible && layoutState.sidebarTab === 'search',
      onClick: () => { toggleSidebarTab('search'); setFocusedRoom('workspace'); },
      icon: <Icon><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></Icon>,
    },
    {
      id: 'git',
      title: 'Source Control',
      active: layoutState.sidebarVisible && layoutState.sidebarTab === 'git',
      onClick: () => { toggleSidebarTab('git'); setFocusedRoom('workspace'); },
      icon: <Icon><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 15V9a4 4 0 0 0-4-4H9" /><line x1="6" y1="9" x2="6" y2="15" /></Icon>,
    },
    ...(showSnapshotsTab
      ? [
          {
            id: 'snapshots',
            title: 'Workspace Snapshots',
            active: layoutState.sidebarVisible && layoutState.sidebarTab === 'snapshots',
            onClick: () => { toggleSidebarTab('snapshots'); setFocusedRoom('workspace'); },
            icon: <Icon><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><circle cx="12" cy="10" r="3" /></Icon>,
          },
        ]
      : []),
    {
      id: 'snippets',
      title: 'Shell Snippets',
      active: layoutState.sidebarVisible && layoutState.sidebarTab === 'snippets',
      onClick: () => { toggleSidebarTab('snippets'); setFocusedRoom('workspace'); },
      icon: <Icon><path d="M4 17l6-6-6-6M12 19h8" /></Icon>,
    },
  ];

  const panelItems: ActivityItem[] = [
    {
      id: 'orchestrator',
      title: 'Orchestrator',
      active: centerOpen,
      onClick: () => { agentCenterOpen.set(!centerOpen); if (!centerOpen) focusRoom('orchestrator'); },
      icon: <Icon><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M12 7v4" /><circle cx="12" cy="5" r="2" /><path d="M8 16h.01M16 16h.01" /></Icon>,
    },
    {
      id: 'editor',
      title: 'Editor',
      active: layoutState.editorVisible,
      onClick: () => togglePanelRoom('editor'),
      icon: <Icon><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Icon>,
    },
    {
      id: 'terminal',
      title: 'Terminal',
      active: terminalRoomOpen && activeRoom === 'terminal',
      onClick: () => { setTerminalRoomOpen(true); focusRoom('terminal'); },
      icon: <Icon><rect x="2" y="3" width="20" height="18" rx="3" /><polyline points="8,9 4,12 8,15" /><line x1="12" y1="15" x2="20" y2="15" /></Icon>,
    },
    {
      id: 'preview',
      title: 'Preview',
      active: layoutState.previewVisible,
      onClick: () => togglePanelRoom('preview'),
      icon: <Icon><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></Icon>,
    },
    {
      id: 'review',
      title: 'Code Review',
      active: layoutState.reviewVisible,
      onClick: () => togglePanelRoom('review'),
      icon: <Icon><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 18H8a2 2 0 0 1-2-2V9" /></Icon>,
    },
    {
      id: 'http',
      title: 'HTTP Client',
      active: layoutState.httpVisible,
      onClick: () => togglePanelRoom('http'),
      icon: <Icon><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>,
    },
    {
      id: 'tasks',
      title: 'Tasks',
      active: layoutState.tasksVisible,
      onClick: () => togglePanelRoom('tasks'),
      icon: <Icon><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="5" height="8" rx="1" /></Icon>,
    },
    {
      id: 'db',
      title: 'Database Explorer',
      active: layoutState.dbVisible,
      onClick: () => togglePanelRoom('db'),
      icon: <Icon><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></Icon>,
    },
    {
      id: 'containers',
      title: 'Containers',
      active: layoutState.containersVisible,
      onClick: () => togglePanelRoom('containers'),
      icon: <Icon><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" /><path d="M4 12.5 12 17l8-4.5" /><path d="M4 17.5 12 22l8-4.5" /></Icon>,
    },
    {
      id: 'toolbox',
      title: 'Dev Toolbox',
      active: layoutState.toolboxVisible,
      onClick: () => togglePanelRoom('toolbox'),
      icon: <Icon><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></Icon>,
    },
    {
      id: 'pet',
      title: 'DevPet',
      active: layoutState.petVisible,
      onClick: () => togglePanelRoom('pet'),
      icon: <Icon><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></Icon>,
    },
    {
      id: 'youtube',
      title: 'YouTube',
      active: layoutState.youtubeVisible,
      onClick: () => togglePanelRoom('youtube'),
      icon: <Icon><rect x="2" y="5" width="20" height="14" rx="4" /><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" /></Icon>,
    },
    {
      id: 'android',
      title: 'Android',
      active: layoutState.androidVisible,
      onClick: () => togglePanelRoom('android'),
      icon: (
        <Icon>
          <path d="M5 12a7 7 0 0 1 14 0v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
          <path d="M7.6 5 6.1 2.6M16.4 5l1.5-2.4" />
          <circle cx="9.5" cy="10" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy="10" r="0.6" fill="currentColor" stroke="none" />
        </Icon>
      ),
    },
    {
      id: 'ios',
      title: 'iOS Simulator',
      active: layoutState.iosVisible,
      onClick: () => togglePanelRoom('ios'),
      icon: <Icon><rect x="6" y="2" width="12" height="20" rx="3" /><line x1="10" y1="18" x2="14" y2="18" /></Icon>,
    },
  ];

  const bottomItems: ActivityItem[] = [
    {
      id: 'sketch',
      title: 'Toggle Sketch Canvas (Ctrl+Shift+N)',
      active: sketchOpen,
      onClick: toggleSketchCanvas,
      icon: <Icon><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 9.5-9.5z" /></Icon>,
    },
    ...(project
      ? [{
          id: 'daily-note',
          title: "Open Today's Note (Ctrl+Shift+D)",
          active: false,
          onClick: () => openDailyNote(project, true).catch(() => {}),
          icon: <Icon><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="15" x2="16" y2="15" /></Icon>,
        } satisfies ActivityItem]
      : []),
  ];

  function renderAuxPanes() {
    if (visiblePanels.length === 3) {
      return (
        <>
          <div className="aux-pane split-pane-third" style={{ height: '33.3%', minHeight: '10%' }}>
            <PanelHost id={visiblePanels[0].id} />
          </div>
          <div className="aux-separator-line" />
          <div className="aux-pane split-pane-third" style={{ height: '33.3%', minHeight: '10%' }}>
            <PanelHost id={visiblePanels[1].id} />
          </div>
          <div className="aux-separator-line" />
          <div className="aux-pane split-pane-third" style={{ height: '33.4%', minHeight: '10%' }}>
            <PanelHost id={visiblePanels[2].id} />
          </div>
        </>
      );
    }

    if (visiblePanels.length === 2) {
      return (
        <>
          <div className="aux-pane split-pane-top" style={{ height: `${auxEditorHeight}%`, minHeight: '10%' }}>
            <PanelHost id={visiblePanels[0].id} />
          </div>
          <div
            className={`aux-row-resize-handle${auxRowResizing ? ' resizing' : ''}`}
            onMouseDown={startAuxRowResize}
            role="separator"
            aria-label="Resize panels"
          />
          <div className="aux-pane split-pane-bottom" style={{ height: `${100 - auxEditorHeight}%`, minHeight: '10%' }}>
            <PanelHost id={visiblePanels[1].id} />
          </div>
        </>
      );
    }

    if (visiblePanels.length === 1) {
      return (
        <div className="aux-pane full-pane">
          <PanelHost id={visiblePanels[0].id} />
        </div>
      );
    }

    return null;
  }

  function getAgentSessionForRoom(id: AgentRoomId) {
    const sessionId = getAgentRoomSessionId(id);
    return allTerminalSessions.find((session) => session.id === sessionId) ?? null;
  }

  function roomTitle(id: RoomId) {
    if (isAgentRoomId(id)) {
      const session = getAgentSessionForRoom(id);
      return session ? getSessionPromptTargetLabel(session, allTerminalSessions) : 'Agent';
    }
    if (id === 'workspace') {
      const tab = layoutState.sidebarTab;
      if (tab === 'git') return 'Source Control';
      if (tab === 'files') return 'Explorer';
      if (tab === 'search') return 'Search';
      if (tab === 'snapshots') return 'Snapshots';
      if (tab === 'history') return 'History';
      if (tab === 'snippets') return 'Snippets';
      return 'Explorer';
    }
    return ROOM_TITLES[id];
  }

  function roomKind(id: RoomId) {
    if (isAgentRoomId(id)) {
      const session = getAgentSessionForRoom(id);
      return session?.agentPreset ?? 'agent';
    }
    if (id === 'terminal') return 'terminal';
    if (id === 'orchestrator') return 'assistant';
    if (id === 'workspace') return layoutState.sidebarTab;
    return 'tool';
  }

  function roomIcon(id: RoomId) {
    if (isAgentRoomId(id)) {
      return <Icon><path d="M12 8V4H8" /><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M8 14h.01M16 14h.01" /><path d="M9 18h6" /></Icon>;
    }
    switch (id) {
      case 'workspace':
        return <Icon><path d="M3 7a2 2 0 0 1 2-2h3.586a2 2 0 0 1 1.414.586L11.414 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></Icon>;
      case 'terminal':
        return <Icon><rect x="2" y="3" width="20" height="18" rx="3" /><polyline points="8,9 4,12 8,15" /><line x1="12" y1="15" x2="20" y2="15" /></Icon>;
      case 'orchestrator':
        return <Icon><rect x="3" y="11" width="18" height="10" rx="2" /><path d="M12 7v4" /><circle cx="12" cy="5" r="2" /><path d="M8 16h.01M16 16h.01" /></Icon>;
      case 'editor':
        return <Icon><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Icon>;
      case 'preview':
        return <Icon><circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" /></Icon>;
      case 'review':
        return <Icon><circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 18H8a2 2 0 0 1-2-2V9" /></Icon>;
      case 'http':
        return <Icon><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></Icon>;
      case 'tasks':
        return <Icon><rect x="3" y="3" width="5" height="18" rx="1" /><rect x="10" y="3" width="5" height="12" rx="1" /><rect x="17" y="3" width="5" height="8" rx="1" /></Icon>;
      case 'db':
        return <Icon><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" /></Icon>;
      case 'containers':
        return <Icon><path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" /><path d="M4 12.5 12 17l8-4.5" /><path d="M4 17.5 12 22l8-4.5" /></Icon>;
      case 'toolbox':
        return <Icon><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></Icon>;
      case 'pet':
        return <Icon><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></Icon>;
      default:
        return null;
    }
  }

  function renderRoomContent(id: RoomId) {
    if (id === 'workspace') return <SidebarContent tab={layoutState.sidebarTab} />;
    if (id === 'orchestrator') return <AgentCommandCenter />;
    if (isAgentRoomId(id)) {
      const sessionId = getAgentRoomSessionId(id);
      const session = allTerminalSessions.find((entry) => entry.id === sessionId);
      if (!session) {
        return <div className="agent-panel-empty">Agent session closed</div>;
      }
      return (
        <div className="agent-terminal-room">
          <AgentWorktreeBadge sessionId={sessionId} />
          <TerminalPane
            sessionId={sessionId}
            paneIndex={terminalPaneAssignments.indexOf(sessionId)}
            isActive={currentActiveSessionId === sessionId}
            onActivate={() => setActiveSession(sessionId)}
            onClose={() => void killSession(sessionId)}
            onMaximize={() => focusRoom(id)}
          />
        </div>
      );
    }
    if (id === 'terminal') {
      // The terminal room is the user's personal terminal only. Agents never
      // surface here — each runs in its own `agent:N` room (reachable from the
      // room dock / stack), keeping this grid free of agent panes and churn.
      return (
        <div className="terminal-room-body">
          <TerminalPanel />
          {projectSwitching && <div className="project-switch-overlay" />}
        </div>
      );
    }
    return <PanelHost id={id} />;
  }

  // Rendered as a plain function call (not <RoomFrame/>), so its identity never
  // changes between AppShell re-renders. Defining it as a component and using it
  // as a JSX element remounts the whole room subtree — including the xterm
  // terminal — on every store-driven re-render, which caused the click flicker
  // and terminal churn.
  function renderRoomFrame(id: RoomId, featured = false, arrangeable = false) {
    const title = roomTitle(id);
    // On the canvas every panel is absolutely positioned at its world (x, y)
    // with an explicit size, so it can be dragged and zoomed freely.
    const canvasStyle = arrangeable
      ? (() => {
          const pos = canvasPositions[id] ?? { x: 0, y: 0 };
          const size = gallerySizes[id] ?? getRoomDefaultSize(id);
          return {
            position: 'absolute',
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            width: `${size.width}px`,
            height: `${size.height}px`,
            zIndex: id === activeRoom ? 5 : draggingRoom === id ? 6 : 1,
          } as React.CSSProperties;
        })()
      : undefined;
    const roomStyle = {
      ...(canvasStyle ?? {}),
      viewTransitionName: `soryq-room-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    } as React.CSSProperties;
    return (
      <section
        key={id}
        className={`room-panel bento-card${featured ? ' featured active-glow' : ''}${arrangeable ? ' arrangeable' : ''}${draggingRoom === id ? ' dragging' : ''}${resizingRoom === id ? ' resizing' : ''}${galleryScrollRoom === id ? ' scroll-armed' : ''}`}
        data-room-id={id}
        style={roomStyle}
        onMouseDown={arrangeable ? () => activateGalleryPanel(id) : undefined}
      >
        <header
          className={`room-header${arrangeable ? ' canvas-drag-handle' : ''}`}
          onPointerDown={arrangeable ? (event) => startPanelMove(event, id) : undefined}
        >
          <button
            className="room-title"
            onClick={(event) => (arrangeable ? handleFocusModeClick(event, id) : focusRoom(id))}
            title={
              arrangeable
                ? galleryAutoGrid
                  ? `Click to open ${title} in Focus`
                  : `Drag to move · click to open ${title} in Focus`
                : `Focus ${title}`
            }
          >
            <span className="room-kind">{roomKind(id)}</span>
            <span className="room-name">{title}</span>
          </button>
          <div className="room-actions">
            {arrangeable && (
              <button
                className="room-action"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => handleFocusModeClick(event, id)}
                title={`Focus ${title}`}
                aria-label={`Focus ${title}`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            )}
            <button className="room-action" onClick={() => minimizeRoom(id)} title="Minimize" aria-label={`Minimize ${title}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button className="room-action danger" onClick={() => closeRoom(id)} title="Close" aria-label={`Close ${title}`}>
              <XIcon />
            </button>
          </div>
        </header>
        <div className="room-content">{renderRoomContent(id)}</div>
        {arrangeable && (
          <button
            className="room-resize-grip"
            onMouseDown={(event) => startGalleryResize(event, id)}
            title={`Resize ${title}`}
            aria-label={`Resize ${title}`}
          />
        )}
      </section>
    );
  }

  function getRoomPreview(id: RoomId) {
    if (id === 'editor') {
      const editorStore = useEditorStore.getState();
      const fileEntry = activeFile ? editorStore.fileCache.get(activeFile) : null;
      const fileLines = fileEntry?.kind === 'text' && fileEntry.content
        ? fileEntry.content.split('\n').filter(line => line.trim().length > 0).slice(0, 3)
        : [];
      return (
        <div className="room-card-preview">
          {fileLines.length > 0 ? (
            <pre className="room-card-code-snippet">
              {fileLines.join('\n')}
            </pre>
          ) : (
            <span className="room-card-empty-snippet">
              {activeFile ? activeFile.split(/[/\\]/).pop() : 'No active file'}
            </span>
          )}
        </div>
      );
    }
    if (id === 'terminal') {
      const lastCommands = (history || []).slice(0, 2);
      return (
        <div className="room-card-preview">
          {lastCommands.length > 0 ? (
            <div className="room-card-terminal-snippet">
              {lastCommands.map((cmd, i) => (
                <div key={i} className="terminal-cmd-line">
                  <span className="terminal-prompt">$</span> {cmd}
                </div>
              ))}
            </div>
          ) : (
            <span className="room-card-empty-snippet">
              {allTerminalSessions.length > 0
                ? `${allTerminalSessions.length} active session${allTerminalSessions.length > 1 ? 's' : ''}`
                : 'No active shells'}
            </span>
          )}
        </div>
      );
    }
    if (id === 'workspace') {
      const openFilesList = useEditorStore.getState().openFiles || [];
      const openFilesPreview = openFilesList.slice(0, 2);
      return (
        <div className="room-card-preview">
          <div className="room-card-workspace-snippet">
            <div className="workspace-project-title">{project ? project.name : 'Empty workspace'}</div>
            {openFilesPreview.length > 0 && (
              <div className="workspace-open-files">
                {openFilesPreview.map(f => (
                  <div key={f} className="workspace-file-item">• {f.split(/[/\\]/).pop()}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }
    if (id === 'orchestrator') {
      return <div className="room-card-preview">Agent chat mode active</div>;
    }
    if (id === 'preview') {
      return <div className="room-card-preview">Live markdown & web preview</div>;
    }
    if (id === 'review') {
      return <div className="room-card-preview">Code review & diff viewer</div>;
    }
    if (id === 'tasks') {
      return <div className="room-card-preview">View & run task checklist</div>;
    }
    if (id === 'http') {
      return <div className="room-card-preview">Compose REST HTTP requests</div>;
    }
    if (id === 'db') {
      return <div className="room-card-preview">Explore connected databases</div>;
    }
    if (id === 'containers') {
      return <div className="room-card-preview">Docker containers & images</div>;
    }
    if (id === 'toolbox') {
      return <div className="room-card-preview">Dev utility toolbox</div>;
    }
    if (id === 'pet') {
      return <div className="room-card-preview">DevPet companion</div>;
    }
    return null;
  }

  function renderRoomCard(id: RoomId) {
    return (
      <button key={id} className="room-card bento-card" onClick={() => focusRoom(id)} title={`Open ${roomTitle(id)}`}>
        <div className="room-card-header">
          <span className="room-card-icon">{roomIcon(id)}</span>
          <span className="room-card-kind">{roomKind(id)}</span>
        </div>
        <span className="room-card-name">{roomTitle(id)}</span>
        {getRoomPreview(id)}
      </button>
    );
  }

  function renderMinimizedRooms() {
    if (minimizedRooms.size === 0) return null;
    const orderedMinimized = [
      ...roomOrder.filter((room) => minimizedRooms.has(room)),
      ...Array.from(minimizedRooms).filter((room) => !roomOrder.includes(room)),
    ];
    return (
      <div className="minimized-room-stack" aria-label="Minimized rooms">
        {orderedMinimized.map((room) => (
          <button
            key={room}
            className="minimized-room"
            onClick={() => restoreRoom(room)}
            title={`Restore ${roomTitle(room)}`}
            aria-label={`Restore ${roomTitle(room)}`}
          >
            <span className="minimized-room-icon" aria-hidden="true">{roomIcon(room)}</span>
            <span className="minimized-room-label">{roomTitle(room)}</span>
          </button>
        ))}
      </div>
    );
  }

  function finishLayoutSwitch() {
    if (layoutSwitchTimerRef.current !== null) {
      window.clearTimeout(layoutSwitchTimerRef.current);
      layoutSwitchTimerRef.current = null;
    }
    setLayoutSwitching(false);
  }

  function switchAmbientLayout(nextLayout: AmbientLayout) {
    if (nextLayout === ambientLayout) return;

    // Preview mode tests the live web app: make sure the preview browser and a
    // terminal are open and un-minimized, with the preview focused.
    if (nextLayout === 'preview') {
      if (!layoutState.previewVisible) {
        persistLayoutPatch({ previewVisible: true, activeView: 'preview', lastAuxView: 'preview' });
      }
      setTerminalRoomOpen(true);
      setMinimizedRooms((current) => {
        if (!current.has('preview') && !current.has('terminal')) return current;
        const next = new Set(current);
        next.delete('preview');
        next.delete('terminal');
        return next;
      });
      setFocusedRoom('preview');
    }

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (layoutSwitchTimerRef.current !== null) window.clearTimeout(layoutSwitchTimerRef.current);

    // Animate the switch by letting the new (live) DOM settle in via the
    // `.layout-switching` CSS pass, NOT the View Transition API. View
    // transitions froze a bitmap of the previous layout; when a second switch
    // landed while one was mid-flight, that frozen snapshot of the old panels
    // stayed ghosting on screen. The settle pass only ever touches elements that
    // are actually in the new layout, so nothing from the former mode can linger.
    flushSync(() => {
      setLayoutSwitching(!prefersReducedMotion);
      setAmbientLayout(nextLayout);
    });

    if (prefersReducedMotion) {
      setLayoutSwitching(false);
      return;
    }

    layoutSwitchTimerRef.current = window.setTimeout(finishLayoutSwitch, 360);
  }

  function renderSplitSwitcher() {
    return (
      <aside className="split-switcher" aria-label="Switch split rooms">
        <div className="split-switcher-rooms">
          {visibleRooms.map((room) => {
            const isPrimary = room === activeRoom;
            const isSecondary = room === splitRoom;
            return (
              <div
                key={room}
                className={`split-switch-item${isPrimary ? ' primary' : ''}${isSecondary ? ' secondary' : ''}`}
              >
                <span className="split-switch-summary">
                  <span className="split-switch-icon" aria-hidden="true">{roomIcon(room)}</span>
                  <span className="split-switch-copy">
                    <span className="split-switch-name">{roomTitle(room)}</span>
                    <span className="split-switch-role">
                      {isPrimary ? 'Primary' : isSecondary ? 'Secondary' : roomKind(room)}
                    </span>
                  </span>
                </span>
                <span className="split-target-actions">
                  <button
                    type="button"
                    className={`split-target-btn${isPrimary ? ' active' : ''}`}
                    onClick={() => showRoomInPrimary(room)}
                    title={`Show ${roomTitle(room)} on the left`}
                    aria-label={`Show ${roomTitle(room)} on the left`}
                  >
                    Left
                  </button>
                  <button
                    type="button"
                    className={`split-target-btn${isSecondary ? ' active' : ''}`}
                    onClick={() => showRoomInSecondary(room)}
                    title={`Show ${roomTitle(room)} on the right`}
                    aria-label={`Show ${roomTitle(room)} on the right`}
                  >
                    Right
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        {renderMinimizedRooms()}
      </aside>
    );
  }

  function renderAmbientLayout() {
    if (ambientLayout === 'gallery') {
      const zoomPct = Math.round(canvasView.zoom * 100);
      return (
        <div
          ref={canvasViewportRef}
          className={`ambient-canvas${canvasPanning ? ' panning' : ''}${galleryAutoGrid ? ' auto-grid' : ''}`}
          onPointerDown={startCanvasPan}
        >
          <div
            className="ambient-canvas-world"
            style={{
              transform: `translate(${canvasView.x}px, ${canvasView.y}px) scale(${canvasView.zoom})`,
            }}
          >
            {orderedVisibleRooms.map((room) => renderRoomFrame(room, room === activeRoom, true))}
          </div>

          <div className="ambient-canvas-controls bento-card" aria-label="Canvas zoom">
             <button
              type="button"
              className="canvas-zoom-btn canvas-reset-btn"
              onClick={resetCanvasLayout}
              title="Reset layout — re-arrange all panels into the clean sequence"
              aria-label="Reset canvas layout"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
            <div className="canvas-control-divider" />
            <button
              type="button"
              className="canvas-zoom-btn"
              onClick={() => zoomCanvasBy(1 / CANVAS_ZOOM_STEP)}
              title="Zoom out"
              aria-label="Zoom out"
              disabled={canvasView.zoom <= CANVAS_MIN_ZOOM + 0.001}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 12h14" /></svg>
            </button>
            <button
              type="button"
              className="canvas-zoom-label"
              onClick={fitCanvasToContent}
              title="Fit all panels"
              aria-label="Fit all panels to view"
            >
              {zoomPct}%
            </button>
            <button
              type="button"
              className="canvas-zoom-btn"
              onClick={() => zoomCanvasBy(CANVAS_ZOOM_STEP)}
              title="Zoom in"
              aria-label="Zoom in"
              disabled={canvasView.zoom >= CANVAS_MAX_ZOOM - 0.001}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>

          {renderMinimizedRooms()}
        </div>
      );
    }

    if (ambientLayout === 'preview') {
      // The live app preview is the stage; the terminal rides alongside so you can
      // watch the dev server / run commands while testing.
      return (
        <>
          <div className="focused-room">
            {renderRoomFrame('preview', true)}
          </div>
          {terminalRoomOpen && (
            <div className="ambient-secondary-room">
              {renderRoomFrame('terminal', true)}
            </div>
          )}
          {renderMinimizedRooms()}
        </>
      );
    }

    if (ambientLayout === 'split' && activeRoom && splitRoom) {
      return (
        <>
          <div className="focused-room">
            {renderRoomFrame(activeRoom, true)}
          </div>
          <div className="ambient-secondary-room">
            {renderRoomFrame(splitRoom, true)}
          </div>
          {renderSplitSwitcher()}
        </>
      );
    }

    return (
      <>
        {activeRoom ? (
          <>
            <div className="focused-room">
              {renderRoomFrame(activeRoom, true)}
            </div>
            <aside className="room-stack" aria-label="Open rooms">
              {stackedRooms.map((room) => renderRoomCard(room))}
              {renderMinimizedRooms()}
            </aside>
          </>
        ) : (
          <>
            <div className="focused-room empty-stage" aria-label="Empty workspace" />
            {renderMinimizedRooms()}
          </>
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar />
      <UpdateBanner />

      <div className="zoom-wrapper">
        {workspaceId ? (
          <div className="zoom-content">
            <div className={`app-body rooms-workspace${resizing ? ' resizing' : ''}`}>
              {resizing && <div className={`resize-overlay${auxRowResizing ? ' row-resize' : ''}`} />}

              <main ref={roomsTableRef} className={`rooms-table ambient-${ambientLayout}${layoutSwitching ? ' layout-switching' : ''}${ambientLayout === 'preview' && !terminalRoomOpen ? ' preview-solo' : ''}`} aria-label="Soryq ambient layout">
                {renderAmbientLayout()}
                {sketchOpen && (
                  <Suspense fallback={null}>
                    <SketchCanvas />
                  </Suspense>
                )}
              </main>

              <div className="workspace-overlays">
              <nav className="room-dock bento-card" aria-label="Room launcher">
                <div className="room-dock-group">
                  {topItems.map((item) => <ActivityButton key={item.id} item={item} />)}
                </div>
                <div className="room-dock-separator" />
                <div className="room-dock-group tools">
                  {panelItems.map((item) => <ActivityButton key={item.id} item={item} />)}
                </div>
                <div className="room-dock-separator" />
                <div className="room-dock-group">
                  {bottomItems.map((item) => <ActivityButton key={item.id} item={item} />)}
                </div>
              </nav>
              <div className="composer-strip">
                <FloatingPromptBar />
              </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="zoom-content">
            <div className={`welcome-fullpage${layoutState.petVisible ? ' with-pet-panel' : ''}`}>
              <div className="welcome-main">
                <WelcomeScreen />
              </div>
              {layoutState.petVisible && (
                <aside className="welcome-pet-panel bento-card" aria-label="DevPet Playground">
                  <button className="aux-close-btn" onClick={toggleTerminal} title="Close pet playground" aria-label="Close pet playground">
                    <XIcon />
                  </button>
                  <DevPetPanel />
                </aside>
              )}
            </div>
          </div>
        )}

        {isEnvManagerOpen && (
          <Suspense fallback={null}>
            <EnvManager />
          </Suspense>
        )}
      </div>
    </div>
  );
}
