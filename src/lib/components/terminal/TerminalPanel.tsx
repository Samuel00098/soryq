import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TerminalPane from './TerminalPane.tsx';
import {
  activePaneIndex,
  activeSessionId,
  activateSessionInPane,
  assignToPane,
  createTerminalSession,
  focusPane,
  getLayoutPaneCount,
  gridLayout,
  isAgentSession,
  killSession,
  paneAssignments,
  registerMosaicClose,
  registerMosaicGrow,
  sessions,
  setGridLayout,
  setTerminalMosaic,
  terminalMosaic,
  type GridLayout,
} from '$lib/stores/terminal';
import { activeProject } from '$lib/stores/workspace';
import { activeFile } from '$lib/stores/editor';
import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';
import { useAction } from '$lib/react/useAction';
import { useStore } from '$lib/react/useStore';
import './TerminalPanel.css';

type CellInfo = { index: number };
type ColumnInfo = { cells: CellInfo[] };

const layouts: { id: GridLayout; label: string; icon: string; count: number }[] = [
  { id: 'single', label: 'Single', icon: '1', count: 1 },
  { id: '2h', label: 'Split H', icon: '2H', count: 2 },
  { id: '3h', label: 'Triple H', icon: '3H', count: 3 },
  { id: '2v', label: 'Split V', icon: '2V', count: 2 },
  { id: '3v', label: 'Triple V', icon: '3V', count: 3 },
  { id: '4', label: 'Grid 2x2', icon: '2x2', count: 4 },
  { id: '9', label: 'Grid 3x3', icon: '3x3', count: 9 },
];

function layoutToColumns(layout: GridLayout): { columns: ColumnInfo[]; colWidths: number[]; cellHeights: number[][] } {
  if (layout === '2h') return { columns: [{ cells: [{ index: 0 }] }, { cells: [{ index: 1 }] }], colWidths: [50, 50], cellHeights: [[100], [100]] };
  if (layout === '2v') return { columns: [{ cells: [{ index: 0 }, { index: 1 }] }], colWidths: [100], cellHeights: [[50, 50]] };
  if (layout === '3h') return { columns: [{ cells: [{ index: 0 }] }, { cells: [{ index: 1 }] }, { cells: [{ index: 2 }] }], colWidths: [33.33, 33.33, 33.34], cellHeights: [[100], [100], [100]] };
  if (layout === '3v') return { columns: [{ cells: [{ index: 0 }, { index: 1 }, { index: 2 }] }], colWidths: [100], cellHeights: [[33.33, 33.33, 33.34]] };
  if (layout === '4') return { columns: [{ cells: [{ index: 0 }, { index: 2 }] }, { cells: [{ index: 1 }, { index: 3 }] }], colWidths: [50, 50], cellHeights: [[50, 50], [50, 50]] };
  if (layout === '9') {
    return {
      columns: [
        { cells: [{ index: 0 }, { index: 3 }, { index: 6 }] },
        { cells: [{ index: 1 }, { index: 4 }, { index: 7 }] },
        { cells: [{ index: 2 }, { index: 5 }, { index: 8 }] },
      ],
      colWidths: [33.33, 33.33, 33.34],
      cellHeights: [[33.33, 33.33, 33.34], [33.33, 33.33, 33.34], [33.33, 33.33, 33.34]],
    };
  }
  return { columns: [{ cells: [{ index: 0 }] }], colWidths: [100], cellHeights: [[100]] };
}

function normalize(values: number[]) {
  if (values.length === 0) return [];
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map((value) => (value / total) * 100) : values.map(() => 100 / values.length);
}

function dispatchPaneResizeEnd() {
  requestAnimationFrame(() => {
    document.dispatchEvent(new CustomEvent('pane-resize-end'));
  });
}

// Pointer-drag distance (px) before a pane titlebar grab becomes a reposition
// drag. Native HTML5 DnD is unreliable in the Tauri webview, so the panel drives
// the drag itself from a plain mousedown on the pane titlebar.
const PANE_DRAG_THRESHOLD = 5;

export default function TerminalPanel() {
  const allSessions = useStore(sessions);
  const activeId = useStore(activeSessionId);
  const assignments = useStore(paneAssignments);
  const activePane = useStore(activePaneIndex);
  const currentLayout = useStore(gridLayout);
  const storeMosaic = useStore(terminalMosaic);
  const project = useStore(activeProject);
  const file = useStore(activeFile);
  const tabsRef = useAction<HTMLDivElement>(clampHorizontalScroll);

  // Prefer a persisted hand-built arrangement so it survives a remount (e.g. the
  // workspace ambient mode switching tears this panel down and rebuilds it
  // elsewhere). Fall back to the named preset when there's no custom mosaic.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialGrid = useMemo(() => storeMosaic ?? layoutToColumns(currentLayout), []);
  const [columns, setColumns] = useState<ColumnInfo[]>(initialGrid.columns);
  const [colWidths, setColWidths] = useState<number[]>(initialGrid.colWidths);
  const [cellHeights, setCellHeights] = useState<number[][]>(initialGrid.cellHeights);
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [maximizedPaneIndex, setMaximizedPaneIndex] = useState<number | null>(null);

  const columnsRef = useRef(columns);
  const colWidthsRef = useRef(colWidths);
  const cellHeightsRef = useRef(cellHeights);
  const assignmentsRef = useRef(assignments);
  const activePaneRef = useRef(activePane);
  const projectRef = useRef(project);
  const fileRef = useRef(file);

  const gridElRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingCol, setIsDraggingCol] = useState(false);
  const [isDraggingRow, setIsDraggingRow] = useState(false);
  const activeDragType = useRef<'col' | 'row' | null>(null);
  const activeDragColIdx = useRef(0);
  const activeDragRowIdx = useRef(0);
  const dragStartPos = useRef(0);
  const activeDragStartSizes = useRef<number[]>([]);

  type PaneDropEdge = 'left' | 'right' | 'top' | 'bottom';
  const paneDrag = useRef<{
    from: number;
    startX: number;
    startY: number;
    active: boolean;
    over: { index: number; edge: PaneDropEdge } | null;
  } | null>(null);
  // Render mirror of the live drag — drives the drop-target/source highlights.
  const [paneDropState, setPaneDropState] = useState<{
    from: number;
    active: boolean;
    over: { index: number; edge: PaneDropEdge } | null;
  } | null>(null);

  columnsRef.current = columns;
  colWidthsRef.current = colWidths;
  cellHeightsRef.current = cellHeights;
  assignmentsRef.current = assignments;
  activePaneRef.current = activePane;
  projectRef.current = project;
  fileRef.current = file;

  const totalCells = columns.reduce((sum, column) => sum + column.cells.length, 0);
  const currentLayoutIcon = layouts.find((layout) => layout.id === currentLayout)?.icon ?? '1';
  const shellSessions = useMemo(
    () => allSessions.filter((session) => !isAgentSession(session)),
    [allSessions],
  );

  function getStartingCwd(): string | undefined {
    const active = fileRef.current;
    const root = projectRef.current?.root_path;
    if (!active) return root;
    const lastIndex = Math.max(active.lastIndexOf('/'), active.lastIndexOf('\\'));
    return lastIndex !== -1 ? active.slice(0, lastIndex) : root;
  }

  function clampMinimums(values: number[], minValue = 10) {
    const clamped = values.map((value) => Math.max(value, minValue));
    const total = clamped.reduce((sum, value) => sum + value, 0);
    return total > 0 ? clamped.map((value) => (value / total) * 100) : clamped.map(() => 100 / clamped.length);
  }

  function findAdjacentPaneIndex(paneIndex: number, direction: 'left' | 'right' | 'up' | 'down'): number | null {
    const position = findPanePosition(paneIndex);
    if (!position) return null;
    const { colIdx, cellIdx } = position;
    if (direction === 'left') {
      return colIdx > 0
        ? columns[colIdx - 1]?.cells[Math.min(cellIdx, columns[colIdx - 1].cells.length - 1)]?.index ?? null
        : null;
    }
    if (direction === 'right') {
      return colIdx < columns.length - 1
        ? columns[colIdx + 1]?.cells[Math.min(cellIdx, columns[colIdx + 1].cells.length - 1)]?.index ?? null
        : null;
    }
    if (direction === 'up') {
      return cellIdx > 0 ? columns[colIdx].cells[cellIdx - 1]?.index ?? null : null;
    }
    return cellIdx < columns[colIdx].cells.length - 1 ? columns[colIdx].cells[cellIdx + 1]?.index ?? null : null;
  }

  function focusAdjacentPane(direction: 'left' | 'right' | 'up' | 'down') {
    const nextPaneIndex = findAdjacentPaneIndex(activePane, direction);
    if (nextPaneIndex === null) return;
    focusPane(nextPaneIndex);
  }

  function resizeActivePane(direction: 'left' | 'right' | 'up' | 'down') {
    const position = findPanePosition(activePane);
    if (!position) return;

    const delta = 4;
    const minSize = 14;
    const { colIdx, cellIdx } = position;

    if (direction === 'left' && colIdx > 0) {
      const left = colWidths[colIdx - 1];
      const current = colWidths[colIdx];
      if (left - delta >= minSize && current + delta >= minSize) {
        const next = [...colWidths];
        next[colIdx - 1] = left - delta;
        next[colIdx] = current + delta;
        setColWidths(next);
      }
      return;
    }

    if (direction === 'right' && colIdx < colWidths.length - 1) {
      const current = colWidths[colIdx];
      const right = colWidths[colIdx + 1];
      if (current + delta >= minSize && right - delta >= minSize) {
        const next = [...colWidths];
        next[colIdx] = current + delta;
        next[colIdx + 1] = right - delta;
        setColWidths(next);
      }
      return;
    }

    const heights = cellHeights[colIdx];
    if (!heights) return;

    if (direction === 'up' && cellIdx > 0) {
      const above = heights[cellIdx - 1];
      const current = heights[cellIdx];
      if (above - delta >= minSize && current + delta >= minSize) {
        const next = [...cellHeights];
        const nextHeights = [...next[colIdx]];
        nextHeights[cellIdx - 1] = above - delta;
        nextHeights[cellIdx] = current + delta;
        next[colIdx] = nextHeights;
        setCellHeights(next);
      }
      return;
    }

    if (direction === 'down' && cellIdx < heights.length - 1) {
      const current = heights[cellIdx];
      const below = heights[cellIdx + 1];
      if (current + delta >= minSize && below - delta >= minSize) {
        const next = [...cellHeights];
        const nextHeights = [...next[colIdx]];
        nextHeights[cellIdx] = current + delta;
        nextHeights[cellIdx + 1] = below - delta;
        next[colIdx] = nextHeights;
        setCellHeights(next);
      }
    }
  }

  function focusLastUsedPane(reverse = false) {
    const panes = assignments
      .map((sessionId, paneIndex) => ({ sessionId, paneIndex }))
      .filter((entry) => entry.sessionId !== null) as { sessionId: number; paneIndex: number }[];
    const sessionMap = new Map(allSessions.map((session) => [session.id, session]));
    const ordered = panes
      .map((entry) => ({ ...entry, session: sessionMap.get(entry.sessionId) }))
      .filter((entry) => entry.session)
      .sort((a, b) => (b.session!.lastActivatedAt ?? 0) - (a.session!.lastActivatedAt ?? 0));

    const currentIdx = ordered.findIndex((entry) => entry.paneIndex === activePane);
    if (currentIdx === -1 || ordered.length < 2) return;
    const next = reverse
      ? ordered[(currentIdx - 1 + ordered.length) % ordered.length]
      : ordered[(currentIdx + 1) % ordered.length];
    focusPane(next.paneIndex);
  }

  function startColResize(e: React.MouseEvent, colIdx: number) {
    e.preventDefault();
    activeDragType.current = 'col';
    activeDragColIdx.current = colIdx;
    dragStartPos.current = e.clientX;
    activeDragStartSizes.current = [colWidths[colIdx], colWidths[colIdx + 1]];
    setIsDraggingCol(true);
  }

  function startCellResize(e: React.MouseEvent, colIdx: number, cellIdx: number) {
    e.preventDefault();
    activeDragType.current = 'row';
    activeDragColIdx.current = colIdx;
    activeDragRowIdx.current = cellIdx;
    dragStartPos.current = e.clientY;
    activeDragStartSizes.current = [cellHeights[colIdx][cellIdx], cellHeights[colIdx][cellIdx + 1]];
    setIsDraggingRow(true);
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (paneDrag.current) {
      const dx = e.clientX - paneDrag.current.startX;
      const dy = e.clientY - paneDrag.current.startY;
      if (!paneDrag.current.active && Math.hypot(dx, dy) < PANE_DRAG_THRESHOLD) return;
      const over = getPaneDropAtPoint(e.clientX, e.clientY);
      paneDrag.current = { ...paneDrag.current, active: true, over };
      document.body.classList.add('dragging-pane');
      setPaneDropState({ from: paneDrag.current.from, active: true, over });
      return;
    }

    if (!activeDragType.current || !gridElRef.current) return;

    const rect = gridElRef.current.getBoundingClientRect();

    if (activeDragType.current === 'col') {
      const deltaPx = e.clientX - dragStartPos.current;
      const deltaPct = (deltaPx / rect.width) * 100;
      const newCol1 = activeDragStartSizes.current[0] + deltaPct;
      const newCol2 = activeDragStartSizes.current[1] - deltaPct;

      if (newCol1 >= 10 && newCol2 >= 10) {
        colWidthsRef.current[activeDragColIdx.current] = newCol1;
        colWidthsRef.current[activeDragColIdx.current + 1] = newCol2;
        setColWidths([...colWidthsRef.current]);
      }
    } else if (activeDragType.current === 'row') {
      const deltaPx = e.clientY - dragStartPos.current;
      const deltaPct = (deltaPx / rect.height) * 100;
      const newCell1 = activeDragStartSizes.current[0] + deltaPct;
      const newCell2 = activeDragStartSizes.current[1] - deltaPct;

      if (newCell1 >= 10 && newCell2 >= 10) {
        const col = activeDragColIdx.current;
        const row = activeDragRowIdx.current;
        cellHeightsRef.current[col][row] = newCell1;
        cellHeightsRef.current[col][row + 1] = newCell2;
        const nextHeights = cellHeightsRef.current.map((h) => [...h]);
        setCellHeights(nextHeights);
      }
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (paneDrag.current) {
      const { from, active, over } = paneDrag.current;
      paneDrag.current = null;
      document.body.classList.remove('dragging-pane');
      setPaneDropState(null);
      if (active && over && over.index !== from) {
        movePaneToEdge(from, over.index, over.edge);
        document.dispatchEvent(new CustomEvent('pane-resize-end'));
      }
      return;
    }

    if (activeDragType.current !== null) {
      activeDragType.current = null;
      setIsDraggingCol(false);
      setIsDraggingRow(false);
      const nextWidths = normalize(colWidthsRef.current);
      const nextHeights = cellHeightsRef.current.map((h) => normalize(h));
      setColWidths(nextWidths);
      setCellHeights(nextHeights);
      // Persist the resized splitter positions too, not just drag-split changes.
      setTerminalMosaic({ columns: columnsRef.current, colWidths: nextWidths, cellHeights: nextHeights });
      dispatchPaneResizeEnd();
    }
  }, []);

  function findPanePosition(paneIndex: number, sourceColumns = columnsRef.current) {
    for (let colIdx = 0; colIdx < sourceColumns.length; colIdx += 1) {
      const cellIdx = sourceColumns[colIdx].cells.findIndex((cell) => cell.index === paneIndex);
      if (cellIdx !== -1) return { colIdx, cellIdx };
    }
    return null;
  }

  function setGrid(nextColumns: ColumnInfo[], nextWidths: number[], nextHeights: number[][]) {
    setColumns(nextColumns);
    setColWidths(nextWidths);
    setCellHeights(nextHeights);
    // Persist the arrangement so it survives a remount. We hand the store the
    // very same references we set locally, so the sync effect's re-application
    // is a no-op (React bails on identical state) rather than an extra render.
    setTerminalMosaic({ columns: nextColumns, colWidths: nextWidths, cellHeights: nextHeights });
    dispatchPaneResizeEnd();
  }

  function addTiledPane() {
    const nextIdx = assignmentsRef.current.length;
    paneAssignments.update((current) => [...current, null]);

    const nextColumns = columnsRef.current.map((column) => ({ cells: [...column.cells] }));
    const nextWidths = [...colWidthsRef.current];
    const nextHeights = cellHeightsRef.current.map((heights) => [...heights]);
    const total = nextColumns.reduce((sum, column) => sum + column.cells.length, 0);
    const targetCols = Math.ceil(Math.sqrt(total + 1));

    if (nextColumns.length < targetCols) {
      nextColumns.push({ cells: [{ index: nextIdx }] });
      nextHeights.push([100]);
      const width = 100 / nextColumns.length;
      setGrid(nextColumns, Array(nextColumns.length).fill(width), nextHeights);
    } else {
      let minCol = 0;
      for (let col = 1; col < nextColumns.length; col += 1) {
        if (nextColumns[col].cells.length < nextColumns[minCol].cells.length) minCol = col;
      }
      nextColumns[minCol].cells.push({ index: nextIdx });
      nextHeights[minCol] = Array(nextColumns[minCol].cells.length).fill(100 / nextColumns[minCol].cells.length);
      setGrid(nextColumns, nextWidths, nextHeights);
    }

    return nextIdx;
  }

  function removePaneCell(paneIndex: number) {
    const nextColumns = columnsRef.current.map((column) => ({ cells: [...column.cells] }));
    const nextWidths = [...colWidthsRef.current];
    const nextHeights = cellHeightsRef.current.map((heights) => [...heights]);
    const position = findPanePosition(paneIndex, nextColumns);
    if (!position) return false;

    const { colIdx, cellIdx } = position;
    nextColumns[colIdx].cells.splice(cellIdx, 1);
    nextHeights[colIdx].splice(cellIdx, 1);

    if (nextColumns[colIdx].cells.length === 0) {
      nextColumns.splice(colIdx, 1);
      nextWidths.splice(colIdx, 1);
      nextHeights.splice(colIdx, 1);
    } else {
      nextHeights[colIdx] = normalize(nextHeights[colIdx]);
    }

    setGrid(nextColumns, normalize(nextWidths), nextHeights);
    return true;
  }

  // Remove several mosaic cells in ONE pass. Calling removePaneCell in a loop
  // doesn't work here: it reads columnsRef (only refreshed on the next render),
  // so back-to-back calls in the same tick each start from the original mosaic
  // and only the last setGrid survives. Rebuilding once keeps all removals.
  function removePaneCells(paneIndices: number[]) {
    const toRemove = new Set(paneIndices);
    if (toRemove.size === 0) return;
    const nextColumns: ColumnInfo[] = [];
    const nextWidths: number[] = [];
    const nextHeights: number[][] = [];
    columnsRef.current.forEach((column, colIdx) => {
      const keptCells: CellInfo[] = [];
      const keptHeights: number[] = [];
      column.cells.forEach((cell, cellIdx) => {
        if (toRemove.has(cell.index)) return;
        keptCells.push(cell);
        keptHeights.push(cellHeightsRef.current[colIdx]?.[cellIdx] ?? 100);
      });
      if (keptCells.length === 0) return; // collapse a column emptied by removal
      nextColumns.push({ cells: keptCells });
      nextWidths.push(colWidthsRef.current[colIdx] ?? 100);
      nextHeights.push(normalize(keptHeights));
    });
    if (nextColumns.length === 0) return; // never blank the mosaic entirely
    setGrid(nextColumns, normalize(nextWidths), nextHeights);
  }

  // ── Pane reposition drag ────────────────────────────────────────────────
  function startPaneDrag(_paneIndex: number, e: React.MouseEvent) {
    if (e.button !== 0) return;
    paneDrag.current = { from: _paneIndex, startX: e.clientX, startY: e.clientY, active: false, over: null };
  }

  function paneElementUnderPoint(x: number, y: number): HTMLElement | null {
    return (document.elementFromPoint(x, y)?.closest('[data-pane-index]') as HTMLElement | null) ?? null;
  }

  function getPaneDropAtPoint(x: number, y: number): { index: number; edge: PaneDropEdge } | null {
    const el = paneElementUnderPoint(x, y);
    if (!el) return null;
    const idx = Number(el.dataset.paneIndex);
    if (Number.isNaN(idx)) return null;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const dx = (x - rect.left) / rect.width - 0.5;
    const dy = (y - rect.top) / rect.height - 0.5;
    const edge: PaneDropEdge = Math.abs(dx) > Math.abs(dy)
      ? (dx < 0 ? 'left' : 'right')
      : (dy < 0 ? 'top' : 'bottom');

    return { index: idx, edge };
  }

  // Drops the dragged pane (`from`) into a half of the target pane's cell,
  // splitting it along the hovered edge. Mirrors the Svelte original: remove the
  // source cell first, then re-locate the target (indices shift) and insert.
  function movePaneToEdge(from: number, targetIndex: number, edge: PaneDropEdge) {
    if (from === targetIndex) return;
    const nextColumns = columnsRef.current.map((column) => ({ cells: [...column.cells] }));
    let nextWidths = [...colWidthsRef.current];
    const nextHeights = cellHeightsRef.current.map((heights) => [...heights]);

    if (!findPanePosition(from, nextColumns) || !findPanePosition(targetIndex, nextColumns)) return;

    // Remove the source cell, collapsing its column if it becomes empty.
    const src = findPanePosition(from, nextColumns)!;
    nextColumns[src.colIdx].cells.splice(src.cellIdx, 1);
    nextHeights[src.colIdx].splice(src.cellIdx, 1);
    if (nextColumns[src.colIdx].cells.length === 0) {
      nextColumns.splice(src.colIdx, 1);
      nextWidths.splice(src.colIdx, 1);
      nextHeights.splice(src.colIdx, 1);
      nextWidths = normalize(nextWidths);
    } else {
      nextHeights[src.colIdx] = normalize(nextHeights[src.colIdx]);
    }

    // Re-locate the target now that removal may have shifted indices.
    const tgt = findPanePosition(targetIndex, nextColumns);
    if (!tgt) return;
    const { colIdx, cellIdx } = tgt;

    if (edge === 'left' || edge === 'right') {
      const targetWidth = nextWidths[colIdx] ?? 100 / Math.max(nextColumns.length, 1);
      const insertedWidth = targetWidth / 2;
      const remainingWidth = targetWidth - insertedWidth;
      const insertAt = edge === 'left' ? colIdx : colIdx + 1;
      nextColumns.splice(insertAt, 0, { cells: [{ index: from }] });
      nextHeights.splice(insertAt, 0, [100]);
      nextWidths.splice(colIdx, 1, ...(edge === 'left'
        ? [insertedWidth, remainingWidth]
        : [remainingWidth, insertedWidth]));
    } else {
      const heights = [...(nextHeights[colIdx] ?? [])];
      const targetHeight = heights[cellIdx] ?? 100 / Math.max(nextColumns[colIdx].cells.length, 1);
      const insertedHeight = targetHeight / 2;
      const remainingHeight = targetHeight - insertedHeight;
      if (edge === 'top') {
        nextColumns[colIdx].cells.splice(cellIdx, 0, { index: from });
        heights.splice(cellIdx, 1, insertedHeight, remainingHeight);
      } else {
        nextColumns[colIdx].cells.splice(cellIdx + 1, 0, { index: from });
        heights.splice(cellIdx, 1, remainingHeight, insertedHeight);
      }
      nextHeights[colIdx] = heights;
    }

    setGrid(nextColumns, nextWidths, nextHeights);
    focusPane(from);
  }

  function closePane(paneIndex: number) {
    const currentSessionId = assignmentsRef.current[paneIndex];
    if (totalCells > 1) removePaneCell(paneIndex);
    if (currentSessionId !== null && currentSessionId !== undefined) killSession(currentSessionId);
    paneAssignments.update((current) => {
      const next = [...current];
      if (paneIndex >= 0 && paneIndex < next.length) next[paneIndex] = null;
      return next;
    });
    if (activePaneRef.current === paneIndex) {
      const survivor = columnsRef.current.flatMap((column) => column.cells).find((cell) => cell.index !== paneIndex);
      focusPane(survivor?.index ?? Math.max(0, paneIndex - 1));
    }
    if (maximizedPaneIndex === paneIndex) setMaximizedPaneIndex(null);
  }

  function closeSession(sessionId: number) {
    const paneIndex = assignmentsRef.current.indexOf(sessionId);
    if (paneIndex === -1) killSession(sessionId);
    else closePane(paneIndex);
  }

  async function ensureSessionsForLayout(layout: GridLayout) {
    const count = getLayoutPaneCount(layout);
    const cwd = getStartingCwd();
    for (let i = 0; i < count; i += 1) {
      if (assignmentsRef.current[i] == null) {
        await createTerminalSession(cwd, i);
      }
    }
  }

  async function handleLayoutSelect(layout: GridLayout) {
    setMaximizedPaneIndex(null);
    setGridLayout(layout);
    const next = layoutToColumns(layout);
    setGrid(next.columns, next.colWidths, next.cellHeights);
    setLayoutPickerOpen(false);
    await ensureSessionsForLayout(layout);
  }

  async function handleNewTerminal() {
    setMaximizedPaneIndex(null);
    const empty = assignmentsRef.current.findIndex((sessionId) => sessionId === null);
    if (empty !== -1) {
      await createTerminalSession(getStartingCwd(), empty);
      return;
    }
    const target = addTiledPane();
    await createTerminalSession(getStartingCwd(), target);
  }

  async function handleSplitRight() {
    setMaximizedPaneIndex(null);
    const nextIdx = assignmentsRef.current.length;
    paneAssignments.update((current) => [...current, null]);
    const nextColumns = columnsRef.current.map((column) => ({ cells: [...column.cells] }));
    const insertAfter = Math.max(0, findPanePosition(activePaneRef.current)?.colIdx ?? nextColumns.length - 1);
    nextColumns.splice(insertAfter + 1, 0, { cells: [{ index: nextIdx }] });
    const width = 100 / nextColumns.length;
    // Insert the new column's cell heights at the same position as the column itself,
    // not always at the end — otherwise heights become misaligned with columns when
    // the split inserts in the middle.
    const nextHeights = [...cellHeightsRef.current];
    nextHeights.splice(insertAfter + 1, 0, [100]);
    setGrid(nextColumns, Array(nextColumns.length).fill(width), nextHeights);
    await createTerminalSession(getStartingCwd(), nextIdx);
  }

  async function handleSplitBelow() {
    setMaximizedPaneIndex(null);
    const nextIdx = assignmentsRef.current.length;
    paneAssignments.update((current) => [...current, null]);
    const nextColumns = columnsRef.current.map((column) => ({ cells: [...column.cells] }));
    const nextHeights = cellHeightsRef.current.map((heights) => [...heights]);
    const position = findPanePosition(activePaneRef.current, nextColumns) ?? { colIdx: 0, cellIdx: nextColumns[0].cells.length - 1 };
    nextColumns[position.colIdx].cells.splice(position.cellIdx + 1, 0, { index: nextIdx });
    nextHeights[position.colIdx] = Array(nextColumns[position.colIdx].cells.length).fill(100 / nextColumns[position.colIdx].cells.length);
    setGrid(nextColumns, colWidthsRef.current, nextHeights);
    await createTerminalSession(getStartingCwd(), nextIdx);
  }

  function handleTabClick(sessionId: number) {
    const paneIndex = assignmentsRef.current.indexOf(sessionId);
    if (paneIndex !== -1) {
      focusPane(paneIndex);
      activateSessionInPane(sessionId);
      return;
    }

    const empty = assignmentsRef.current.findIndex((value) => value === null);
    const target = empty === -1 ? addTiledPane() : empty;
    assignToPane(target, sessionId);
    focusPane(target);
    activateSessionInPane(sessionId);
  }

  useEffect(() => {
    const evictedAgentPanes: number[] = [];
    paneAssignments.update((current) => {
      let changed = false;
      const agentIndices: number[] = [];
      const next = current.map((sessionId, i) => {
        const session = sessionId !== null ? allSessions.find((entry) => entry.id === sessionId) : null;
        if (session && isAgentSession(session)) {
          changed = true;
          agentIndices.push(i);
          return null;
        }
        return sessionId;
      });

      for (let i = 0; i < next.length; i += 1) {
        if (next[i] === null) {
          const unassigned = shellSessions.find((session) => !next.includes(session.id));
          if (unassigned) {
            next[i] = unassigned.id;
            changed = true;
          }
        }
      }

      // An agent must never occupy a mosaic cell. If one slipped into a pane and
      // wasn't backfilled by a real shell above, its cell would linger as a ghost
      // empty "Open terminal" pane (the add-only mosaic reconcile never drops it).
      // Collect those so we can remove the cells once the store update is done.
      for (const i of agentIndices) {
        if (next[i] === null) evictedAgentPanes.push(i);
      }
      return changed ? next : current;
    });

    if (evictedAgentPanes.length > 0) {
      removePaneCells(evictedAgentPanes);
    }
  }, [allSessions, shellSessions]);

  useEffect(() => {
    registerMosaicGrow(addTiledPane);
    registerMosaicClose((paneIndex) => {
      if (columnsRef.current.reduce((sum, column) => sum + column.cells.length, 0) > 1) {
        removePaneCell(paneIndex);
      }
    });
    return () => {
      registerMosaicGrow(null);
      registerMosaicClose(null);
    };
  }, []);

  // Keep the visible grid in sync with the canonical layout. A persisted custom
  // mosaic wins; otherwise fall back to the named preset. This reacts to the
  // store (project switch, a named-preset pick that clears the mosaic) rather
  // than rebuilding from the preset on every mount, which used to discard a
  // hand-built split whenever the panel remounted (e.g. ambient mode switch).
  // The effect only writes local state — never the store — so there's no loop.
  useEffect(() => {
    const next = storeMosaic ?? layoutToColumns(currentLayout);
    setColumns(next.columns);
    setColWidths(next.colWidths);
    setCellHeights(next.cellHeights);
  }, [storeMosaic, currentLayout]);

  useEffect(() => {
    const cellIndices = new Set(columnsRef.current.flatMap((column) => column.cells.map((cell) => cell.index)));
    for (let i = 0; i < assignments.length; i += 1) {
      if (assignments[i] !== null && !cellIndices.has(i)) {
        const nextColumns = columnsRef.current.map((column) => ({ cells: [...column.cells] }));
        nextColumns.push({ cells: [{ index: i }] });
        setGrid(nextColumns, Array(nextColumns.length).fill(100 / nextColumns.length), [...cellHeightsRef.current, [100]]);
        cellIndices.add(i);
      }
    }
  }, [assignments]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!(event.target as Element).closest('.layout-picker')) setLayoutPickerOpen(false);
    }
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      // Drop the drag cursor class if we unmount mid-drag.
      document.body.classList.remove('dragging-pane');
    };
  }, [handleMouseMove, handleMouseUp]);

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable = Boolean(target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select');
      if (isEditable) return;

      if (event.altKey && event.shiftKey && event.key === 'Enter') {
        event.preventDefault();
        setMaximizedPaneIndex((current) => {
          const next = current === activePaneRef.current ? null : activePaneRef.current;
          return next;
        });
        return;
      }

      if (event.altKey && event.shiftKey) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); resizeActivePane('left'); return; }
        if (event.key === 'ArrowRight') { event.preventDefault(); resizeActivePane('right'); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); resizeActivePane('up'); return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); resizeActivePane('down'); return; }
      }

      if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); focusAdjacentPane('left'); return; }
        if (event.key === 'ArrowRight') { event.preventDefault(); focusAdjacentPane('right'); return; }
        if (event.key === 'ArrowUp') { event.preventDefault(); focusAdjacentPane('up'); return; }
        if (event.key === 'ArrowDown') { event.preventDefault(); focusAdjacentPane('down'); return; }
        if (event.key === '[') { event.preventDefault(); focusLastUsedPane(true); return; }
        if (event.key === ']') { event.preventDefault(); focusLastUsedPane(false); return; }
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [activePane]);

  const maximizedCell = maximizedPaneIndex !== null
    ? columns.flatMap((column) => column.cells).find((cell) => cell.index === maximizedPaneIndex)
    : null;

  return (
    <div className="terminal-fullscreen">
      <div className="terminal-toolbar">
        <div className="session-tabs" ref={tabsRef}>
          {shellSessions.map((session) => (
            <div key={session.id} className={`session-tab${activeId === session.id ? ' active' : ''}${session.isRunning ? '' : ' dead'}`}>
              <button className="tab-main" onClick={() => handleTabClick(session.id)} title={session.title}>
                <span className={`tab-dot${session.isRunning ? ' running' : ''}`} />
                <span className="tab-label">{session.title}</span>
              </button>
              <button className="tab-close" onClick={(event) => { event.stopPropagation(); closeSession(session.id); }} title="Close terminal" aria-label="Close terminal">
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            </div>
          ))}
          <button className="add-tab-btn" onClick={() => void handleNewTerminal()} title="New terminal">+</button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-actions">
          <button className="toolbar-btn" onClick={() => void handleSplitRight()} title="Split right">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />
            </svg>
          </button>
          <button className="toolbar-btn" onClick={() => void handleSplitBelow()} title="Split below">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="12" x2="21" y2="12" />
            </svg>
          </button>

          <div className="toolbar-divider" />

          <div className={`layout-picker${layoutPickerOpen ? ' open' : ''}`}>
            <button
              className="toolbar-btn layout-btn"
              onClick={(event) => {
                event.stopPropagation();
                setLayoutPickerOpen((open) => !open);
              }}
              title="Terminal layout"
            >
              <span className="layout-current-icon">{currentLayoutIcon}</span>
              <svg className="layout-trigger-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" /><line x1="12" y1="4" x2="12" y2="20" /><line x1="3" y1="10" x2="12" y2="10" />
              </svg>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="2 3 5 7 8 3" />
              </svg>
            </button>

            {layoutPickerOpen && (
              <div className="layout-dropdown" onClick={(event) => event.stopPropagation()}>
                {layouts.map((layout) => (
                  <button key={layout.id} className={`layout-option${currentLayout === layout.id ? ' selected' : ''}`} onClick={() => void handleLayoutSelect(layout.id)}>
                    <span className="lo-icon">{layout.icon}</span>
                    <div className="lo-info">
                      <span className="lo-label">{layout.label}</span>
                      <span className="lo-count">{layout.count} {layout.count === 1 ? 'pane' : 'panes'}</span>
                    </div>
                    {currentLayout === layout.id && (
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-6" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`terminal-grid-flex${isDraggingCol ? ' dragging-col' : ''}${isDraggingRow ? ' dragging-row' : ''}`}
        ref={gridElRef}
      >
        {maximizedCell ? (
          <div className="terminal-maximized-layer">
            {assignments[maximizedCell.index] != null && (
              <TerminalPane
                key={assignments[maximizedCell.index] ?? undefined}
                sessionId={assignments[maximizedCell.index] as number}
                paneIndex={maximizedCell.index}
                isActive
                isMaximized
                onActivate={() => focusPane(maximizedCell.index)}
                onClose={() => closePane(maximizedCell.index)}
                onMaximize={() => setMaximizedPaneIndex(null)}
              />
            )}
          </div>
        ) : (
          columns.map((column, colIdx) => (
            <React.Fragment key={colIdx}>
              <div className="terminal-column" style={{ flex: `${colWidths[colIdx] ?? 100} 1 0%` }}>
                {column.cells.map((cell, cellIdx) => {
                  const sessionId = assignments[cell.index];
                  const assignedSession = sessionId != null ? allSessions.find((session) => session.id === sessionId) : null;
                  const isAgentCell = Boolean(assignedSession && isAgentSession(assignedSession));
                  const isDropTarget = Boolean(paneDropState?.active) && paneDropState?.over?.index === cell.index && paneDropState?.from !== cell.index;
                  const isDragSource = Boolean(paneDropState?.active) && paneDropState?.from === cell.index;
                  const cellClassName = `terminal-cell${isDropTarget ? ' pane-drop-target' : ''}${isDragSource ? ' pane-drag-source' : ''}`;
                  return (
                    <React.Fragment key={cell.index}>
                      <div
                        className={cellClassName}
                        data-pane-index={cell.index}
                        data-drop-edge={isDropTarget ? paneDropState!.over!.edge : undefined}
                        data-drop-label={isDropTarget ? `Insert ${paneDropState!.over!.edge}` : undefined}
                        style={{ flex: `${cellHeights[colIdx]?.[cellIdx] ?? 100} 1 0%` }}
                      >
                        {sessionId != null && !isAgentCell ? (
                          <TerminalPane
                            key={sessionId}
                            sessionId={sessionId}
                            paneIndex={cell.index}
                            isActive={activePane === cell.index}
                            onActivate={() => focusPane(cell.index)}
                            onClose={() => closePane(cell.index)}
                            onMaximize={() => setMaximizedPaneIndex((current) => current === cell.index ? null : cell.index)}
                            onPaneDragStart={startPaneDrag}
                            onResizeLeft={colIdx > 0 ? (e) => startColResize(e, colIdx - 1) : undefined}
                            onResizeRight={colIdx < columns.length - 1 ? (e) => startColResize(e, colIdx) : undefined}
                            onResizeTop={cellIdx > 0 ? (e) => startCellResize(e, colIdx, cellIdx - 1) : undefined}
                            onResizeBottom={cellIdx < column.cells.length - 1 ? (e) => startCellResize(e, colIdx, cellIdx) : undefined}
                          />
                        ) : (
                          <>
                            <button className={`empty-pane${activePane === cell.index ? ' active' : ''}`} onClick={() => { focusPane(cell.index); void createTerminalSession(getStartingCwd(), cell.index); }} aria-label="Open terminal">
                              <span className="empty-pane-icon" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                                  <rect x="2" y="3" width="20" height="18" rx="3" /><polyline points="8,9 4,12 8,15" /><line x1="12" y1="15" x2="20" y2="15" />
                                </svg>
                              </span>
                              <span className="empty-pane-label">{isAgentCell ? 'Agent is open as a panel' : 'Open terminal'}</span>
                            </button>
                            {totalCells > 1 && (
                              <button className="empty-pane-close" onClick={(event) => { event.stopPropagation(); closePane(cell.index); }} title="Close pane" aria-label="Close pane">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {cellIdx < column.cells.length - 1 && (
                        <div
                          className="row-resize-divider"
                          onMouseDown={(e) => startCellResize(e, colIdx, cellIdx)}
                          title="Drag to resize height"
                          role="separator"
                          aria-label="Row resize divider"
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              {colIdx < columns.length - 1 && (
                <div
                  className="col-resize-divider"
                  onMouseDown={(e) => startColResize(e, colIdx)}
                  title="Drag to resize width"
                  role="separator"
                  aria-label="Column resize divider"
                />
              )}
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}
