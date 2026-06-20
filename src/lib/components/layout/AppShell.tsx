import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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
  | 'pet';

type AgentRoomId = `agent:${number}`;
type RoomId = 'workspace' | 'terminal' | 'orchestrator' | AuxPanelId | AgentRoomId;
type AmbientLayout = 'focus' | 'split' | 'gallery';
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
};

const AMBIENT_LAYOUTS: Array<{ id: AmbientLayout; label: string; icon: React.ReactNode }> = [
  {
    id: 'focus',
    label: 'Focus',
    icon: <Icon><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9z" /></Icon>,
  },
  {
    id: 'split',
    label: 'Split',
    icon: <Icon><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M12 4v16" /></Icon>,
  },
  {
    id: 'gallery',
    label: 'Gallery',
    icon: <Icon><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></Icon>,
  },
];

const GALLERY_MIN_WIDTH = 280;
const GALLERY_MIN_HEIGHT = 220;
const GALLERY_DEFAULT_WIDTH = 430;
const GALLERY_DEFAULT_HEIGHT = 320;

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
  const swipeNavEnabled = useSettingsStore((s) => s.swipeNavigationEnabled);
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
  const [ambientLayout, setAmbientLayout] = useState<AmbientLayout>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('soryq_ambient_layout');
      if (saved === 'focus' || saved === 'split' || saved === 'gallery') {
        return saved;
      }
    }
    return 'gallery';
  });
  const [layoutSwitching, setLayoutSwitching] = useState(false);
  const [terminalRoomOpen, setTerminalRoomOpen] = useState(true);
  const [roomOrder, setRoomOrder] = useState<RoomId[]>(['workspace', 'terminal']);
  const [draggingRoom, setDraggingRoom] = useState<RoomId | null>(null);
  const [resizingRoom, setResizingRoom] = useState<RoomId | null>(null);
  const [secondaryRoom, setSecondaryRoom] = useState<RoomId | null>(null);
  const [galleryScrollRoom, setGalleryScrollRoom] = useState<RoomId | null>(null);
  const [gallerySizes, setGallerySizes] = useState<Record<string, GallerySize>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('soryq_gallery_sizes');
        return saved ? JSON.parse(saved) : {};
      } catch {
        return {};
      }
    }
    return {};
  });

  const [galleryPositions, setGalleryPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('soryq_gallery_positions');
        return saved ? JSON.parse(saved) : {};
      } catch {
        return {};
      }
    }
    return {};
  });

  const [pan, setPan] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('soryq_gallery_pan');
        return saved ? JSON.parse(saved) : { x: 0, y: 0 };
      } catch {
        return { x: 0, y: 0 };
      }
    }
    return { x: 0, y: 0 };
  });

  const [canvasZoom, setCanvasZoom] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('soryq_gallery_zoom');
        return saved ? parseFloat(saved) : 1;
      } catch {
        return 1;
      }
    }
    return 1;
  });

  const [snapToGrid, setSnapToGrid] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('soryq_gallery_snap') === 'true';
    }
    return false;
  });

  const [draggingRoomId, setDraggingRoomId] = useState<RoomId | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const sidebarResizeRef = useRef({ startX: 0, startWidth: 0 });
  const auxResizeRef = useRef({ startX: 0, startWidth: 0 });
  const auxRowResizeRef = useRef({ startY: 0, startHeight: 0 });
  const galleryResizeRef = useRef<{
    room: RoomId;
    startX: number;
    startY: number;
    width: number;
    height: number;
    element: HTMLElement;
    nextWidth: number;
    nextHeight: number;
    rafId: number | null;
  } | null>(null);

  const roomDragRef = useRef<{
    room: RoomId;
    startX: number;
    startY: number;
    roomX: number;
    roomY: number;
    nextX: number;
    nextY: number;
    rafId: number | null;
  } | null>(null);

  const dragHasMovedRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  const canvasZoomRef = useRef(canvasZoom);
  const snapToGridRef = useRef(snapToGrid);

  useEffect(() => {
    canvasZoomRef.current = canvasZoom;
  }, [canvasZoom]);

  useEffect(() => {
    snapToGridRef.current = snapToGrid;
  }, [snapToGrid]);

  useEffect(() => {
    function handleRoomDragMove(event: MouseEvent) {
      const drag = roomDragRef.current;
      if (!drag) return;

      const scale = canvasZoomRef.current;
      const snap = snapToGridRef.current;

      const deltaX = (event.clientX - drag.startX) / scale;
      const deltaY = (event.clientY - drag.startY) / scale;

      let nextX = drag.roomX + deltaX;
      let nextY = drag.roomY + deltaY;

      if (snap) {
        nextX = Math.round(nextX / 20) * 20;
        nextY = Math.round(nextY / 20) * 20;
      }

      drag.nextX = nextX;
      drag.nextY = nextY;

      const dist = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (dist > 5) {
        dragHasMovedRef.current = true;
      }

      if (drag.rafId !== null) return;
      drag.rafId = requestAnimationFrame(() => {
        const latest = roomDragRef.current;
        if (!latest) return;
        latest.rafId = null;
        const element = document.querySelector(`.room-panel[data-room-id="${latest.room}"]`);
        if (element instanceof HTMLElement) {
          element.style.left = `${latest.nextX}px`;
          element.style.top = `${latest.nextY}px`;
        }
      });
    }

    function handleRoomDragEnd() {
      const drag = roomDragRef.current;
      if (!drag) return;

      if (drag.rafId !== null) {
        cancelAnimationFrame(drag.rafId);
      }

      setGalleryPositions((current) => {
        const updated = {
          ...current,
          [drag.room]: { x: drag.nextX, y: drag.nextY },
        };
        localStorage.setItem('soryq_gallery_positions', JSON.stringify(updated));
        return updated;
      });

      roomDragRef.current = null;
      setDraggingRoomId(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      setTimeout(() => {
        dragHasMovedRef.current = false;
      }, 50);
    }

    window.addEventListener('mousemove', handleRoomDragMove);
    window.addEventListener('mouseup', handleRoomDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleRoomDragMove);
      window.removeEventListener('mouseup', handleRoomDragEnd);
    };
  }, []);

  const layoutSwitchTimerRef = useRef<number | null>(null);
  const lastLayoutCommandNonce = useRef(0);

  // Trackpad/mouse swipe-to-switch-mode state. A horizontal two-finger swipe (or
  // shift + wheel) slides between the ambient layouts, deferring to any inner
  // content that can still scroll horizontally so it only kicks in at the edge.
  const roomsTableRef = useRef<HTMLElement | null>(null);
  const swipeAccumRef = useRef(0);
  const swipeCooldownRef = useRef(false);
  const swipeResetTimerRef = useRef<number | null>(null);
  const lastWheelTsRef = useRef(0);
  const streamEligibleRef = useRef(true);
  const swipeGestureRef = useRef<{
    ambientLayout: AmbientLayout;
    switchAmbientLayout: (next: AmbientLayout) => void;
    sketchOpen: boolean;
    swipeEnabled: boolean;
  }>({ ambientLayout: 'focus', switchAmbientLayout: () => {}, sketchOpen: false, swipeEnabled: true });
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

  const resolvedPositions = useMemo(() => {
    const positions = { ...galleryPositions };
    orderedVisibleRooms.forEach((room, index) => {
      if (!positions[room]) {
        const col = index % 3;
        const row = Math.floor(index / 3);
        const gap = 24;
        positions[room] = {
          x: col * (GALLERY_DEFAULT_WIDTH + gap) + 40,
          y: row * (GALLERY_DEFAULT_HEIGHT + gap) + 40,
        };
      }
    });
    return positions;
  }, [orderedVisibleRooms, galleryPositions]);

  const resolvedPositionsRef = useRef(resolvedPositions);
  useEffect(() => {
    resolvedPositionsRef.current = resolvedPositions;
  }, [resolvedPositions]);

  const activeRoom = focusedRoom && visibleRooms.includes(focusedRoom)
    ? focusedRoom
    : (visibleRooms[0] ?? null);
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
      const changed = Object.keys(next).length !== Object.keys(current).length;
      if (changed) {
        localStorage.setItem('soryq_gallery_sizes', JSON.stringify(next));
      }
      return changed ? next : current;
    });
    setGalleryPositions((current) => {
      const open = new Set(openRooms);
      const next = Object.fromEntries(Object.entries(current).filter(([room]) => open.has(room as RoomId)));
      const changed = Object.keys(next).length !== Object.keys(current).length;
      if (changed) {
        localStorage.setItem('soryq_gallery_positions', JSON.stringify(next));
      }
      return changed ? next : current;
    });
    setGalleryScrollRoom((current) => (current && openRooms.includes(current) ? current : null));
  }, [openRooms]);

  useEffect(() => {
    function handleGalleryResizeMove(event: MouseEvent) {
      const drag = galleryResizeRef.current;
      if (!drag) return;
      
      const scale = canvasZoomRef.current;
      
      drag.nextWidth = Math.max(GALLERY_MIN_WIDTH, drag.width + (event.clientX - drag.startX) / scale);
      drag.nextHeight = Math.max(GALLERY_MIN_HEIGHT, drag.height + (event.clientY - drag.startY) / scale);

      if (drag.rafId !== null) return;
      drag.rafId = requestAnimationFrame(() => {
        const latest = galleryResizeRef.current;
        if (!latest) return;
        latest.rafId = null;
        latest.element.style.width = `${latest.nextWidth}px`;
        latest.element.style.height = `${latest.nextHeight}px`;
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
      setGallerySizes((current) => {
        const updated = {
          ...current,
          [drag.room]: { width: drag.nextWidth, height: drag.nextHeight },
        };
        localStorage.setItem('soryq_gallery_sizes', JSON.stringify(updated));
        return updated;
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
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project, shortcuts]);

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
    withTransition(() => {
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

      if (open) setFocusedRoom(id);
      else if (focusedRoom === id) setFocusedRoom(nextVisibleRoom(id));
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
    withTransition(() => {
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
    withTransition(() => {
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
    withTransition(() => {
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
    withTransition(() => {
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
    withTransition(() => {
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
    if (dragHasMovedRef.current) {
      return;
    }
    focusRoomMode(id);
  }

  function closeRoom(id: RoomId) {
    withTransition(() => {
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

  function startRoomDrag(event: React.MouseEvent, room: RoomId) {
    if (ambientLayout !== 'gallery') return;
    if (event.button !== 0) return; // Only left click
    if (
      (event.target as HTMLElement).closest('.room-actions') || 
      (event.target as HTMLElement).closest('.room-action')
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const currentPos = resolvedPositions[room] || { x: 0, y: 0 };
    roomDragRef.current = {
      room,
      startX: event.clientX,
      startY: event.clientY,
      roomX: currentPos.x,
      roomY: currentPos.y,
      nextX: currentPos.x,
      nextY: currentPos.y,
      rafId: null,
    };

    setDraggingRoomId(room);
    focusRoom(room);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (ambientLayout !== 'gallery') return;
    const isBg = e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-background-grid');
    const isMiddleClick = e.button === 1;

    if (isBg || isMiddleClick) {
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX - pan.x,
        y: e.clientY - pan.y,
      };
      e.preventDefault();
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!isPanning) return;
    const newPan = {
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    };
    setPan(newPan);
    localStorage.setItem('soryq_gallery_pan', JSON.stringify(newPan));
  }

  function handleMouseUp() {
    setIsPanning(false);
  }

  function handleWheel(e: React.WheelEvent) {
    if (ambientLayout !== 'gallery') return;
    const isOverBackground = e.target === e.currentTarget || 
      (e.target as HTMLElement).classList.contains('ambient-room-grid') ||
      (e.target as HTMLElement).classList.contains('canvas-background-grid');
      
    if (!isOverBackground && !e.ctrlKey && !e.metaKey) {
      return;
    }

    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const cx = (mx - pan.x) / canvasZoom;
      const cy = (my - pan.y) / canvasZoom;

      const zoomFactor = 1.1;
      let newZoom = e.deltaY < 0 ? canvasZoom * zoomFactor : canvasZoom / zoomFactor;
      newZoom = Math.max(0.15, Math.min(newZoom, 3));

      const newPanX = mx - cx * newZoom;
      const newPanY = my - cy * newZoom;

      setCanvasZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
      localStorage.setItem('soryq_gallery_zoom', newZoom.toString());
      localStorage.setItem('soryq_gallery_pan', JSON.stringify({ x: newPanX, y: newPanY }));
    } else {
      const deltaX = e.shiftKey ? e.deltaY : e.deltaX;
      const deltaY = e.shiftKey ? 0 : e.deltaY;
      const newPan = {
        x: pan.x - deltaX,
        y: pan.y - deltaY,
      };
      setPan(newPan);
      localStorage.setItem('soryq_gallery_pan', JSON.stringify(newPan));
    }
  }

  function zoomInCanvas() {
    setCanvasZoom((z) => {
      const next = Math.min(3, z + 0.1);
      localStorage.setItem('soryq_gallery_zoom', next.toString());
      return next;
    });
  }

  function zoomOutCanvas() {
    setCanvasZoom((z) => {
      const next = Math.max(0.15, z - 0.1);
      localStorage.setItem('soryq_gallery_zoom', next.toString());
      return next;
    });
  }

  function resetCanvas() {
    setCanvasZoom(1);
    setPan({ x: 0, y: 0 });
    localStorage.setItem('soryq_gallery_zoom', '1');
    localStorage.setItem('soryq_gallery_pan', JSON.stringify({ x: 0, y: 0 }));
  }

  function toggleSnapToGrid() {
    setSnapToGrid((prev) => {
      const next = !prev;
      localStorage.setItem('soryq_gallery_snap', next.toString());
      return next;
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
    galleryResizeRef.current = {
      room,
      startX: event.clientX,
      startY: event.clientY,
      width: current.width,
      height: current.height,
      element,
      nextWidth: current.width,
      nextHeight: current.height,
      rafId: null,
    };
    setResizingRoom(room);
    focusRoom(room);
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
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
    const pos = arrangeable ? resolvedPositions[id] : undefined;
    const size = arrangeable ? (gallerySizes[id] ?? { width: GALLERY_DEFAULT_WIDTH, height: GALLERY_DEFAULT_HEIGHT }) : undefined;
    const roomStyle = {
      ...(size ? { width: `${size.width}px`, height: `${size.height}px` } : {}),
      ...(pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : {}),
      viewTransitionName: `soryq-room-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    } as React.CSSProperties;
    return (
      <section
        key={id}
        className={`room-panel bento-card${featured ? ' featured active-glow' : ''}${arrangeable ? ' arrangeable' : ''}${draggingRoomId === id ? ' dragging' : ''}${resizingRoom === id ? ' resizing' : ''}${galleryScrollRoom === id ? ' scroll-armed' : ''}`}
        data-room-id={id}
        style={roomStyle}
        onMouseDown={arrangeable ? () => activateGalleryPanel(id) : undefined}
      >
        <header className="room-header" onMouseDown={arrangeable ? (e) => startRoomDrag(e, id) : undefined}>
          <button
            className="room-title"
            onClick={(event) => (arrangeable ? handleFocusModeClick(event, id) : focusRoom(id))}
            title={arrangeable ? `Open ${title} in Focus` : `Focus ${title}`}
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

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (layoutSwitchTimerRef.current !== null) window.clearTimeout(layoutSwitchTimerRef.current);

    // Animate the switch by letting the new (live) DOM settle in via the
    // `.layout-switching` CSS pass, NOT the View Transition API. View
    // transitions froze a bitmap of the previous layout; when a second switch
    // landed while one was mid-flight — trivially easy now that you can swipe
    // between modes — that frozen snapshot of the old panels stayed ghosting on
    // screen. The settle pass only ever touches elements that are actually in
    // the new layout, so nothing from the former mode can linger.
    flushSync(() => {
      setLayoutSwitching(!prefersReducedMotion);
      setAmbientLayout(nextLayout);
      localStorage.setItem('soryq_ambient_layout', nextLayout);
    });

    if (prefersReducedMotion) {
      setLayoutSwitching(false);
      return;
    }

    layoutSwitchTimerRef.current = window.setTimeout(finishLayoutSwitch, 360);
  }

  // Keep the latest layout + switcher available to the (mount-stable) wheel
  // listener without re-binding it on every render.
  swipeGestureRef.current = { ambientLayout, switchAmbientLayout, sketchOpen, swipeEnabled: swipeNavEnabled };

  // Slide between ambient modes with a horizontal trackpad swipe (or shift +
  // mouse wheel). We defer to any inner element that can still scroll
  // horizontally in the swipe direction, so this only takes over at the edge —
  // editors, terminals and the gallery board keep their own scrolling.
  useEffect(() => {
    const el = roomsTableRef.current;
    if (!el) return;

    const MODE_ORDER: AmbientLayout[] = AMBIENT_LAYOUTS.map((m) => m.id);
    const SWIPE_THRESHOLD = 130; // accumulated px before a mode change fires

    // A swipe that starts inside the code editor must never switch modes — the
    // editor owns left/right (caret moves, horizontal scroll) and users found the
    // layout sliding out from under them while they worked. Walk up to the editor
    // root if the gesture began on any element within it.
    const startedInEditor = (start: EventTarget | null): boolean => {
      const node = start instanceof HTMLElement ? start : null;
      return !!node?.closest('.cm-editor, .code-editor-container');
    };

    const innerCanAbsorb = (start: EventTarget | null, dir: number): boolean => {
      let node = start instanceof HTMLElement ? start : null;
      while (node && node !== el) {
        const overflowX = window.getComputedStyle(node).overflowX;
        if (
          (overflowX === 'auto' || overflowX === 'scroll') &&
          node.scrollWidth > node.clientWidth + 1
        ) {
          const atStart = node.scrollLeft <= 0;
          const atEnd = node.scrollLeft >= node.scrollWidth - node.clientWidth - 1;
          if (dir > 0 ? !atEnd : !atStart) return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // reserved for zoom / shortcuts
      // Honour the user's "Swipe between layouts" setting — when off, scrolling
      // never slides between modes.
      if (!swipeGestureRef.current.swipeEnabled) return;
      // The sketch canvas owns its own pan/zoom while open — never let a swipe
      // over it switch modes and drag the whole layout sideways underneath it.
      if (swipeGestureRef.current.sketchOpen) return;
      // The code editor owns left/right while you're working in it.
      if (startedInEditor(e.target)) return;

      // A plain mouse usually only has a vertical wheel; treat shift + wheel as
      // a horizontal swipe so mouse users can slide between modes too.
      const horizontal = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const vertical = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;

      // Only react to clearly horizontal intent — let vertical scrolling pass.
      if (Math.abs(horizontal) < 2 || Math.abs(horizontal) <= Math.abs(vertical) * 1.2) {
        swipeAccumRef.current = 0;
        return;
      }

      const dir = horizontal > 0 ? 1 : -1;

      // A wheel "stream" is one continuous gesture; a lull marks a new one. Decide
      // at the start of each stream whether it may switch modes — a stream that
      // began by scrolling an inner panel stays ineligible, so its inertial tail
      // can't fling us into another mode once that panel hits its edge.
      const NEW_GESTURE_GAP = 120; // ms of quiet that marks a fresh, deliberate swipe
      if (e.timeStamp - lastWheelTsRef.current > NEW_GESTURE_GAP) {
        streamEligibleRef.current = !innerCanAbsorb(e.target, dir);
        swipeAccumRef.current = 0;
      }
      lastWheelTsRef.current = e.timeStamp;

      if (innerCanAbsorb(e.target, dir)) {
        swipeAccumRef.current = 0;
        return;
      }

      // Momentum tail of an inner-scroll gesture — let it die, don't switch.
      if (!streamEligibleRef.current) {
        swipeAccumRef.current = 0;
        return;
      }

      e.preventDefault();
      if (swipeCooldownRef.current) return;

      // Reset if the swipe direction reversed mid-gesture.
      if (swipeAccumRef.current !== 0 && Math.sign(swipeAccumRef.current) !== dir) {
        swipeAccumRef.current = 0;
      }
      swipeAccumRef.current += horizontal;

      if (swipeResetTimerRef.current !== null) window.clearTimeout(swipeResetTimerRef.current);
      swipeResetTimerRef.current = window.setTimeout(() => {
        swipeAccumRef.current = 0;
      }, 220);

      if (Math.abs(swipeAccumRef.current) >= SWIPE_THRESHOLD) {
        const { ambientLayout: current, switchAmbientLayout: switchTo } = swipeGestureRef.current;
        const idx = MODE_ORDER.indexOf(current);
        const nextIdx = Math.min(MODE_ORDER.length - 1, Math.max(0, idx + dir));
        if (nextIdx !== idx) switchTo(MODE_ORDER[nextIdx]);
        swipeAccumRef.current = 0;
        swipeCooldownRef.current = true;
        window.setTimeout(() => {
          swipeCooldownRef.current = false;
        }, 500);
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (swipeResetTimerRef.current !== null) window.clearTimeout(swipeResetTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

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
      return (
        <div
          className={`ambient-room-grid${isPanning ? ' dragging-canvas' : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <div
            className="canvas-content"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${canvasZoom})`,
              transformOrigin: '0 0',
            }}
          >
            <div className="canvas-background-grid" />
            {orderedVisibleRooms.map((room) => renderRoomFrame(room, room === activeRoom, true))}
          </div>
          {renderMinimizedRooms()}

          <div className="canvas-toolbar bento-card">
            <div className="canvas-zoom-controls">
              <button className="canvas-tool-btn" onClick={zoomOutCanvas} title="Zoom Out">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <span className="canvas-zoom-value">{Math.round(canvasZoom * 100)}%</span>
              <button className="canvas-tool-btn" onClick={zoomInCanvas} title="Zoom In">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
            <div className="canvas-toolbar-separator" />
            <button className="canvas-tool-btn" onClick={resetCanvas} title="Reset Pan & Zoom">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
              </svg>
            </button>
            <button className={`canvas-tool-btn${snapToGrid ? ' active' : ''}`} onClick={toggleSnapToGrid} title="Snap to Grid">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                <circle cx="5" cy="12" r="1" /><circle cx="5" cy="5" r="1" /><circle cx="5" cy="19" r="1" />
                <circle cx="19" cy="12" r="1" /><circle cx="19" cy="5" r="1" /><circle cx="19" cy="19" r="1" />
              </svg>
            </button>
          </div>
        </div>
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

              <main ref={roomsTableRef} className={`rooms-table ambient-${ambientLayout}${layoutSwitching ? ' layout-switching' : ''}`} aria-label="Soryq ambient layout">
                {renderAmbientLayout()}
                {sketchOpen && (
                  <Suspense fallback={null}>
                    <SketchCanvas />
                  </Suspense>
                )}
              </main>

              <nav className="room-dock bento-card" aria-label="Room launcher">
                <div className="ambient-switcher" role="tablist" aria-label="Ambient layouts">
                  {AMBIENT_LAYOUTS.map((mode) => (
                    <button
                      key={mode.id}
                      className={`ambient-switch-btn${ambientLayout === mode.id ? ' active' : ''}`}
                      onClick={() => switchAmbientLayout(mode.id)}
                      title={`${mode.label} layout`}
                      aria-label={`${mode.label} layout`}
                      aria-selected={ambientLayout === mode.id}
                      role="tab"
                    >
                      {mode.icon}
                      <span>{mode.label}</span>
                    </button>
                  ))}
                </div>
                <div className="room-dock-separator" />
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

      {workspaceId && (
        <div className="composer-strip">
          <FloatingPromptBar />
        </div>
      )}
    </div>
  );
}
