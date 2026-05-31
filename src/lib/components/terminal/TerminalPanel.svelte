<script lang="ts">
  import { onMount } from 'svelte';
  import TerminalPane from './TerminalPane.svelte';
  import {
    sessions,
    activeSessionId,
    paneAssignments,
    activePaneIndex,
    gridLayout,
    type GridLayout,
    createTerminalSession,
    setGridLayout,
    focusPane,
    assignToPane,
    getLayoutPaneCount,
    killSession,
    activateSessionInPane,
    registerMosaicGrow,
    swapPanes,
  } from '$lib/stores/terminal';
  import { activeProject, openProjectIds } from '$lib/stores/workspace';
  import { activeFile } from '$lib/stores/editor';

  let maximizedPaneIndex = $state<number | null>(null);
  const maximizeCache = new Map<string, number | null>();

  function setMaximizedPaneIndex(paneIndex: number | null) {
    maximizedPaneIndex = paneIndex;
    if (currentProjectId) {
      maximizeCache.set(currentProjectId, paneIndex);
    }
  }

  function togglePaneMaximize(paneIndex: number) {
    setMaximizedPaneIndex(maximizedPaneIndex === paneIndex ? null : paneIndex);
  }

  function getStartingCwd(): string | undefined {
    const file = $activeFile;
    const root = $activeProject?.root_path;
    if (!file) return root;
    const lastIndex = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
    if (lastIndex !== -1) {
      return file.slice(0, lastIndex);
    }
    return root;
  }

  // Ensure at least one session exists on mount
  onMount(async () => {
    if ($sessions.length === 0) {
      await createTerminalSession(getStartingCwd());
    } else {
      // Re-assign existing sessions to panes if pane slots are empty
      paneAssignments.update((panes) => {
        const updated = [...panes];
        for (let i = 0; i < updated.length; i++) {
          if (updated[i] === null) {
            const unassigned = $sessions.find(
              (s) => !updated.includes(s.id),
            );
            if (unassigned) updated[i] = unassigned.id;
          }
        }
        return updated;
      });
    }
  });

  // Layout options for the picker
  const layouts: { id: GridLayout; label: string; icon: string; count: number }[] = [
    { id: 'single', label: 'Single',   icon: '1',   count: 1 },
    { id: '2h',     label: 'Split H',  icon: '2H',  count: 2 },
    { id: '3h',     label: 'Triple H', icon: '3H',  count: 3 },
    { id: '2v',     label: 'Split V',  icon: '2V',  count: 2 },
    { id: '3v',     label: 'Triple V', icon: '3V',  count: 3 },
    { id: '4',      label: 'Grid 2x2', icon: '2x2', count: 4 },
    { id: '9',      label: 'Grid 3x3', icon: '3x3', count: 9 },
  ];

  let layoutPickerOpen = $state(false);

  function handleLayoutSelect(gl: GridLayout) {
    setMaximizedPaneIndex(null);
    setGridLayout(gl);
    applyGridLayout(gl);
    layoutPickerOpen = false;
  }

  let projectPath = $derived($activeProject?.root_path);

  async function handleNewTerminal() {
    if (maximizedPaneIndex !== null) {
      setMaximizedPaneIndex(null);
    }
    const panes = $paneAssignments;
    const emptyIdx = panes.findIndex((p) => p === null);
    const cwd = getStartingCwd();
    if (emptyIdx !== -1) {
      await createTerminalSession(cwd, emptyIdx);
    } else {
      await handleSplitRight();
    }
  }

  function handleEmptyPaneClick(paneIdx: number) {
    if (maximizedPaneIndex !== null) {
      setMaximizedPaneIndex(null);
    }
    focusPane(paneIdx);
    createTerminalSession(getStartingCwd(), paneIdx);
  }

  async function handleSplitRight() {
    if (maximizedPaneIndex !== null) {
      setMaximizedPaneIndex(null);
    }
    const cwd = getStartingCwd();

    // Find coordinates of active pane
    const activeIdx = $activePaneIndex;
    let found = null;
    for (let c = 0; c < columns.length; c++) {
      for (let cell = 0; cell < columns[c].cells.length; cell++) {
        if (columns[c].cells[cell].index === activeIdx) {
          found = { colIdx: c, cellIdx: cell };
          break;
        }
      }
      if (found) break;
    }

    if (!found) found = { colIdx: columns.length - 1, cellIdx: 0 };

    {
      const { colIdx } = found;
      const nextIdx = $paneAssignments.length;
      paneAssignments.update((p) => [...p, null]);

      // Insert new column next to active column
      columns.splice(colIdx + 1, 0, { cells: [{ index: nextIdx }] });
      cellHeights.splice(colIdx + 1, 0, [100]);

      // Redistribute widths equally
      const C = columns.length;
      const equalWidth = 100 / C;
      colWidths = Array(C).fill(equalWidth);

      columns = [...columns];
      colWidths = [...colWidths];
      cellHeights = [...cellHeights];

      await createTerminalSession(cwd, nextIdx);
    }
  }

  async function handleSplitBelow() {
    if (maximizedPaneIndex !== null) {
      setMaximizedPaneIndex(null);
    }
    const cwd = getStartingCwd();

    // Find coordinates of active pane
    const activeIdx = $activePaneIndex;
    let found = null;
    for (let c = 0; c < columns.length; c++) {
      for (let cell = 0; cell < columns[c].cells.length; cell++) {
        if (columns[c].cells[cell].index === activeIdx) {
          found = { colIdx: c, cellIdx: cell };
          break;
        }
      }
      if (found) break;
    }

    if (!found) found = { colIdx: 0, cellIdx: columns[0].cells.length - 1 };

    {
      const { colIdx, cellIdx } = found;
      const nextIdx = $paneAssignments.length;
      paneAssignments.update((p) => [...p, null]);

      // Insert new cell below active cell inside active column
      columns[colIdx].cells.splice(cellIdx + 1, 0, { index: nextIdx });

      // Redistribute cell heights equally inside this column
      const numCells = columns[colIdx].cells.length;
      cellHeights[colIdx] = Array(numCells).fill(100 / numCells);

      columns = [...columns];
      cellHeights = [...cellHeights];

      await createTerminalSession(cwd, nextIdx);
    }
  }

  // Grow the mosaic by exactly one pane, tiled to stay balanced (à la tmux).
  // Agent spawning calls this via registerMosaicGrow so N agents create N panes —
  // no empty filler panes and every pane stays independently resizable.
  // Append a tiled cell that renders the given pane index, keeping the mosaic
  // balanced (à la tmux). Does NOT touch paneAssignments — the caller owns that.
  function appendCellForPaneIndex(paneIndex: number) {
    const totalCells = columns.reduce((sum, col) => sum + col.cells.length, 0);
    const targetCols = Math.ceil(Math.sqrt(totalCells + 1));

    if (columns.length < targetCols) {
      // Open a new column to the right and rebalance widths.
      columns.splice(columns.length, 0, { cells: [{ index: paneIndex }] });
      cellHeights.splice(cellHeights.length, 0, [100]);
      const C = columns.length;
      colWidths = Array(C).fill(100 / C);
    } else {
      // Stack into the column with the fewest cells (leftmost on tie).
      let minCol = 0;
      for (let c = 1; c < columns.length; c += 1) {
        if (columns[c].cells.length < columns[minCol].cells.length) minCol = c;
      }
      columns[minCol].cells.push({ index: paneIndex });
      const n = columns[minCol].cells.length;
      cellHeights[minCol] = Array(n).fill(100 / n);
    }

    columns = [...columns];
    colWidths = [...colWidths];
    cellHeights = [...cellHeights];
  }

  function addTiledPane(): number {
    if (maximizedPaneIndex !== null) {
      setMaximizedPaneIndex(null);
    }
    const nextIdx = $paneAssignments.length;
    paneAssignments.update((p) => [...p, null]);
    appendCellForPaneIndex(nextIdx);
    return nextIdx;
  }

  onMount(() => {
    registerMosaicGrow(addTiledPane);
    return () => registerMosaicGrow(null);
  });

  function closePane(paneIndex: number) {
    const nextPanes = [...$paneAssignments];
    const sessionId = $paneAssignments[paneIndex];
    if (sessionId !== null && sessionId !== undefined) {
      killSession(sessionId);
    }

    paneAssignments.update((panes) => {
      const copy = [...panes];
      if (paneIndex >= 0 && paneIndex < copy.length) {
        copy[paneIndex] = null;
      }
      return copy;
    });

    activePaneIndex.update((active) => {
      if (active === paneIndex) {
        nextPanes[paneIndex] = null;
        const nextPane = nextPanes.findIndex((session, idx) => idx !== paneIndex && session !== null);
        return nextPane !== -1 ? nextPane : Math.max(0, paneIndex - 1);
      }
      return active;
    });

    if (maximizedPaneIndex === paneIndex) {
      setMaximizedPaneIndex(null);
    }
  }

  function findPanePosition(paneIndex: number): { colIdx: number; cellIdx: number } | null {
    for (let colIdx = 0; colIdx < columns.length; colIdx += 1) {
      const cellIdx = columns[colIdx].cells.findIndex((cell) => cell.index === paneIndex);
      if (cellIdx !== -1) return { colIdx, cellIdx };
    }
    return null;
  }

  function findAdjacentPaneIndex(direction: 'left' | 'right' | 'up' | 'down', paneIndex = $activePaneIndex): number | null {
    const position = findPanePosition(paneIndex);
    if (!position) return null;

    const { colIdx, cellIdx } = position;
    if (direction === 'left') {
      return colIdx > 0 ? columns[colIdx - 1]?.cells[Math.min(cellIdx, columns[colIdx - 1].cells.length - 1)]?.index ?? null : null;
    }
    if (direction === 'right') {
      return colIdx < columns.length - 1 ? columns[colIdx + 1]?.cells[Math.min(cellIdx, columns[colIdx + 1].cells.length - 1)]?.index ?? null : null;
    }
    if (direction === 'up') {
      return cellIdx > 0 ? columns[colIdx].cells[cellIdx - 1]?.index ?? null : null;
    }
    return cellIdx < columns[colIdx].cells.length - 1 ? columns[colIdx].cells[cellIdx + 1]?.index ?? null : null;
  }

  function focusAdjacentPane(direction: 'left' | 'right' | 'up' | 'down') {
    const nextPaneIndex = findAdjacentPaneIndex(direction);
    if (nextPaneIndex === null) return;
    focusPane(nextPaneIndex);
  }

  function resizeActivePane(direction: 'left' | 'right' | 'up' | 'down') {
    const position = findPanePosition($activePaneIndex);
    if (!position) return;

    const delta = 4;
    const minSize = 14;
    const { colIdx, cellIdx } = position;

    if (direction === 'left' && colIdx > 0) {
      const left = colWidths[colIdx - 1];
      const current = colWidths[colIdx];
      if (left - delta >= minSize && current + delta >= minSize) {
        colWidths[colIdx - 1] = left - delta;
        colWidths[colIdx] = current + delta;
        colWidths = [...colWidths];
      }
      return;
    }

    if (direction === 'right' && colIdx < colWidths.length - 1) {
      const current = colWidths[colIdx];
      const right = colWidths[colIdx + 1];
      if (current + delta >= minSize && right - delta >= minSize) {
        colWidths[colIdx] = current + delta;
        colWidths[colIdx + 1] = right - delta;
        colWidths = [...colWidths];
      }
      return;
    }

    const heights = cellHeights[colIdx];
    if (!heights) return;

    if (direction === 'up' && cellIdx > 0) {
      const above = heights[cellIdx - 1];
      const current = heights[cellIdx];
      if (above - delta >= minSize && current + delta >= minSize) {
        heights[cellIdx - 1] = above - delta;
        heights[cellIdx] = current + delta;
        cellHeights = [...cellHeights];
      }
      return;
    }

    if (direction === 'down' && cellIdx < heights.length - 1) {
      const current = heights[cellIdx];
      const below = heights[cellIdx + 1];
      if (current + delta >= minSize && below - delta >= minSize) {
        heights[cellIdx] = current + delta;
        heights[cellIdx + 1] = below - delta;
        cellHeights = [...cellHeights];
      }
    }
  }

  function focusLastUsedPane(reverse = false) {
    const panes = $paneAssignments
      .map((sessionId, paneIndex) => ({ sessionId, paneIndex }))
      .filter((entry) => entry.sessionId !== null) as { sessionId: number; paneIndex: number }[];
    const sessionMap = new Map($sessions.map((session) => [session.id, session]));
    const ordered = panes
      .map((entry) => ({ ...entry, session: sessionMap.get(entry.sessionId) }))
      .filter((entry) => entry.session)
      .sort((a, b) => (b.session!.lastActivatedAt ?? 0) - (a.session!.lastActivatedAt ?? 0));

    const currentIdx = ordered.findIndex((entry) => entry.paneIndex === $activePaneIndex);
    if (currentIdx === -1 || ordered.length < 2) return;
    const next = reverse
      ? ordered[(currentIdx - 1 + ordered.length) % ordered.length]
      : ordered[(currentIdx + 1) % ordered.length];
    focusPane(next.paneIndex);
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase();
    const isEditable = Boolean(target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select');
    if (isEditable) return;

    if (event.altKey && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      togglePaneMaximize($activePaneIndex);
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
      if (event.key === ']') { event.preventDefault(); focusLastUsedPane(false); }
    }
  }

  // â”€â”€ Pane resize state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  interface CellInfo {
    index: number;
  }

  interface ColumnInfo {
    cells: CellInfo[];
  }

  let columns = $state<ColumnInfo[]>([
    { cells: [{ index: 0 }] }
  ]);
  let colWidths = $state<number[]>([100]);
  let cellHeights = $state<number[][]>([[100]]);

  let currentProjectId = $state<string | null>(null);
  const gridCache = new Map<string, { columns: ColumnInfo[]; colWidths: number[]; cellHeights: number[][] }>();
  let lastAppliedLayout = $state<GridLayout | null>(null);

  // Sync custom grid dimensions on project switch
  $effect(() => {
    const project = $activeProject;
    const projectId = project ? project.id : null;
    if (projectId !== currentProjectId) {
      if (currentProjectId) {
        gridCache.set(currentProjectId, {
          columns: $state.snapshot(columns),
          colWidths: $state.snapshot(colWidths),
          cellHeights: $state.snapshot(cellHeights)
        });
        maximizeCache.set(currentProjectId, maximizedPaneIndex);
      }

      if (projectId) {
        const cached = gridCache.get(projectId);
        if (cached) {
          columns = cached.columns;
          colWidths = cached.colWidths;
          cellHeights = cached.cellHeights;
        } else {
          columns = [{ cells: [{ index: 0 }] }];
          colWidths = [100];
          cellHeights = [[100]];
        }
        maximizedPaneIndex = maximizeCache.get(projectId) ?? null;
      } else {
        columns = [{ cells: [{ index: 0 }] }];
        colWidths = [100];
        cellHeights = [[100]];
        maximizedPaneIndex = null;
      }

      currentProjectId = projectId;
      lastAppliedLayout = $gridLayout;
    }
  });

  // Clean up gridCache for closed projects. Skip while the list is empty — that
  // happens transiently mid workspace-switch, and wiping the cache there would
  // reset the mosaic to a single pane when you return, hiding still-running
  // sessions that live in panes 1+.
  $effect(() => {
    const openIds = $openProjectIds;
    if (openIds.length === 0) return;
    for (const key of gridCache.keys()) {
      if (!openIds.includes(key)) {
        gridCache.delete(key);
      }
    }
  });

  $effect(() => {
    const openIds = $openProjectIds;
    if (openIds.length === 0) return;
    for (const key of maximizeCache.keys()) {
      if (!openIds.includes(key)) {
        maximizeCache.delete(key);
      }
    }
  });

  // Reconcile the visual mosaic against paneAssignments: every assigned session
  // must have a cell to render in. Sessions can otherwise be orphaned — assigned
  // to a pane index with no cell (after restoring a multi-pane project, returning
  // to a workspace, or appending a terminal when all panes are full) — leaving
  // them running but rendered nowhere, impossible to view or close. Add a tiled
  // cell for any assigned index the mosaic is missing. Idempotent: converges once
  // every assigned index has a cell.
  $effect(() => {
    const assignments = $paneAssignments;
    const cellIndices = new Set(columns.flatMap((col) => col.cells.map((c) => c.index)));
    for (let i = 0; i < assignments.length; i += 1) {
      if (assignments[i] !== null && !cellIndices.has(i)) {
        appendCellForPaneIndex(i);
        cellIndices.add(i);
      }
    }
  });

  $effect(() => {
    if (maximizedPaneIndex !== null && !findPanePosition(maximizedPaneIndex)) {
      maximizedPaneIndex = null;
    }
  });

  function applyGridLayout(gl: GridLayout) {
    setMaximizedPaneIndex(null);
    lastAppliedLayout = gl;
    if (gl === 'single') {
      columns = [{ cells: [{ index: 0 }] }];
      colWidths = [100];
      cellHeights = [[100]];
    } else if (gl === '2h') {
      columns = [{ cells: [{ index: 0 }] }, { cells: [{ index: 1 }] }];
      colWidths = [50, 50];
      cellHeights = [[100], [100]];
    } else if (gl === '2v') {
      columns = [{ cells: [{ index: 0 }, { index: 1 }] }];
      colWidths = [100];
      cellHeights = [[50, 50]];
    } else if (gl === '3h') {
      columns = [
        { cells: [{ index: 0 }] },
        { cells: [{ index: 1 }] },
        { cells: [{ index: 2 }] }
      ];
      colWidths = [33.33, 33.33, 33.34];
      cellHeights = [[100], [100], [100]];
    } else if (gl === '3v') {
      columns = [{ cells: [{ index: 0 }, { index: 1 }, { index: 2 }] }];
      colWidths = [100];
      cellHeights = [[33.33, 33.33, 33.34]];
    } else if (gl === '4') {
      columns = [
        { cells: [{ index: 0 }, { index: 2 }] },
        { cells: [{ index: 1 }, { index: 3 }] }
      ];
      colWidths = [50, 50];
      cellHeights = [[50, 50], [50, 50]];
    } else if (gl === '9') {
      columns = [
        { cells: [{ index: 0 }, { index: 3 }, { index: 6 }] },
        { cells: [{ index: 1 }, { index: 4 }, { index: 7 }] },
        { cells: [{ index: 2 }, { index: 5 }, { index: 8 }] }
      ];
      colWidths = [33.33, 33.33, 33.34];
      cellHeights = [
        [33.33, 33.33, 33.34],
        [33.33, 33.33, 33.34],
        [33.33, 33.33, 33.34]
      ];
    }
  }

  $effect(() => {
    const gl = $gridLayout;
    if (gl !== lastAppliedLayout) {
      applyGridLayout(gl);
    }
  });

  let gridEl: HTMLDivElement | null = null;
  let activeDragType = $state<'col' | 'row' | null>(null);
  let activeDragRowIdx = 0;
  let activeDragColIdx = 0;
  let dragStartPos = 0;
  let activeDragStartSizes: number[] = [];

  // ── Pane reposition drag (pointer-based) ────────────────────
  // Native HTML5 DnD is unreliable in the Tauri webview, so we drive the drag
  // ourselves: mousedown on a pane titlebar → track movement past a threshold →
  // on mouseup, swap with whichever pane cell sits under the cursor.
  const PANE_DRAG_THRESHOLD = 5;
  let paneDrag = $state<{
    from: number;
    startX: number;
    startY: number;
    active: boolean;
    overIndex: number | null;
  } | null>(null);

  function startPaneDrag(from: number, e: MouseEvent) {
    if (e.button !== 0) return;
    paneDrag = { from, startX: e.clientX, startY: e.clientY, active: false, overIndex: null };
  }

  function paneIndexUnderPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest('[data-pane-index]') as HTMLElement | null;
    if (!el) return null;
    const idx = Number(el.dataset.paneIndex);
    return Number.isNaN(idx) ? null : idx;
  }

  function startColResize(e: MouseEvent, colIdx: number) {
    e.preventDefault();
    activeDragType = 'col';
    activeDragColIdx = colIdx;
    dragStartPos = e.clientX;
    activeDragStartSizes = [
      colWidths[colIdx],
      colWidths[colIdx + 1]
    ];
  }

  function startCellResize(e: MouseEvent, colIdx: number, cellIdx: number) {
    e.preventDefault();
    activeDragType = 'row';
    activeDragColIdx = colIdx;
    activeDragRowIdx = cellIdx;
    dragStartPos = e.clientY;
    activeDragStartSizes = [
      cellHeights[colIdx][cellIdx],
      cellHeights[colIdx][cellIdx + 1]
    ];
  }

  function onMouseMove(e: MouseEvent) {
    if (paneDrag) {
      const dx = e.clientX - paneDrag.startX;
      const dy = e.clientY - paneDrag.startY;
      if (!paneDrag.active && Math.hypot(dx, dy) < PANE_DRAG_THRESHOLD) return;
      const over = paneIndexUnderPoint(e.clientX, e.clientY);
      paneDrag = { ...paneDrag, active: true, overIndex: over };
      return;
    }

    if (!activeDragType || !gridEl) return;
    const rect = gridEl.getBoundingClientRect();
    
    if (activeDragType === 'col') {
      const deltaPx = e.clientX - dragStartPos;
      const deltaPct = (deltaPx / rect.width) * 100;
      const newCol1 = activeDragStartSizes[0] + deltaPct;
      const newCol2 = activeDragStartSizes[1] - deltaPct;
      
      if (newCol1 >= 10 && newCol2 >= 10) {
        colWidths[activeDragColIdx] = newCol1;
        colWidths[activeDragColIdx + 1] = newCol2;
        colWidths = [...colWidths];
      }
    } else if (activeDragType === 'row') {
      const deltaPx = e.clientY - dragStartPos;
      const deltaPct = (deltaPx / rect.height) * 100;
      const newCell1 = activeDragStartSizes[0] + deltaPct;
      const newCell2 = activeDragStartSizes[1] - deltaPct;
      
      if (newCell1 >= 10 && newCell2 >= 10) {
        cellHeights[activeDragColIdx][activeDragRowIdx] = newCell1;
        cellHeights[activeDragColIdx][activeDragRowIdx + 1] = newCell2;
        cellHeights = [...cellHeights];
      }
    }
  }

  function onMouseUp() {
    if (paneDrag) {
      const { from, active, overIndex } = paneDrag;
      paneDrag = null;
      if (active && overIndex !== null && overIndex !== from) {
        swapPanes(from, overIndex);
        // Geometry is unchanged but the swapped panes remount — refit them.
        document.dispatchEvent(new CustomEvent('pane-resize-end'));
      }
      return;
    }

    if (activeDragType !== null) {
      activeDragType = null;
      // Signal all panes to refit now that drag has ended
      document.dispatchEvent(new CustomEvent('pane-resize-end'));
    }
  }

  $effect(() => {
    if (typeof document !== 'undefined') {
      if (activeDragType === 'col') {
        document.body.classList.add('dragging-col');
      } else {
        document.body.classList.remove('dragging-col');
      }
      if (activeDragType === 'row') {
        document.body.classList.add('dragging-row');
      } else {
        document.body.classList.remove('dragging-row');
      }
      if (paneDrag?.active) {
        document.body.classList.add('dragging-pane');
      } else {
        document.body.classList.remove('dragging-pane');
      }
    }
  });

  // Close picker when clicking outside
  function handleOutsideClick(e: MouseEvent) {
    if (!(e.target as Element).closest('.layout-picker')) {
      layoutPickerOpen = false;
    }
  }

  // Swap the terminals living in two panes. Geometry (columns/widths/heights) is
  // keyed by pane index, so only the session assignments move — cells stay put.
  // Tab click: make session active AND focus its pane
  function handleTabClick(sessionId: number) {
    const panes = $paneAssignments;
    const idx = panes.indexOf(sessionId);
    if (idx !== -1) {
      focusPane(idx);
      return;
    }

    // Session isn't shown in any pane (orphaned). Bring it back into view by
    // placing it in an empty pane, or growing the mosaic when all panes are full
    // — never overwrite an occupied pane (that would just orphan a different one).
    if (maximizedPaneIndex !== null) {
      setMaximizedPaneIndex(null);
    }
    let target = panes.findIndex((p) => p === null);
    if (target === -1) target = addTiledPane();
    assignToPane(target, sessionId);
    focusPane(target);
    activateSessionInPane(sessionId);
  }
</script>

<svelte:window onclick={handleOutsideClick} onmousemove={onMouseMove} onmouseup={onMouseUp} onkeydown={handleWindowKeyDown} />

<div class="terminal-fullscreen">

  <!-- â”€â”€ Toolbar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
  <div class="terminal-toolbar">

    <!-- Session tabs (macOS pill style) -->
    <div class="session-tabs">
      {#each $sessions as session (session.id)}
        <div
          class="session-tab"
          class:active={$activeSessionId === session.id}
          class:dead={!session.isRunning}
        >
          <button
            class="tab-main"
            onmousedown={() => handleTabClick(session.id)}
            onclick={() => handleTabClick(session.id)}
            title={session.title}
          >
            <span class="tab-dot" class:running={session.isRunning}></span>
            <span class="tab-label">{session.title}</span>
          </button>
          <button
            class="tab-close"
            onclick={(e) => { e.stopPropagation(); killSession(session.id); }}
            title="Close terminal"
            aria-label="Close terminal"
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
              <line x1="2" y1="2" x2="8" y2="8"/>
              <line x1="8" y1="2" x2="2" y2="8"/>
            </svg>
          </button>
        </div>
      {/each}

      <!-- New tab button -->
      <button class="add-tab-btn" onclick={handleNewTerminal} title="New terminal">+</button>
    </div>

    <div class="toolbar-divider"></div>

    <!-- Toolbar actions -->
    <div class="toolbar-actions">
      <!-- Split right -->
      <button class="toolbar-btn" onclick={handleSplitRight} title="Split right">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="12" y1="3" x2="12" y2="21"/>
        </svg>
      </button>
      <!-- Split below -->
      <button class="toolbar-btn" onclick={handleSplitBelow} title="Split below">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
        </svg>
      </button>

      <div class="toolbar-divider"></div>

      <!-- Layout picker -->
      <div class="layout-picker" class:open={layoutPickerOpen}>
        <button
          class="toolbar-btn layout-btn"
          onclick={(e) => { e.stopPropagation(); layoutPickerOpen = !layoutPickerOpen; }}
          title="Terminal layout"
        >
          <span class="layout-current-icon">{layouts.find(l => l.id === $gridLayout)?.icon ?? '1'}</span>
          <svg class="layout-trigger-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <line x1="12" y1="4" x2="12" y2="20"></line>
            <line x1="3" y1="10" x2="12" y2="10"></line>
          </svg>
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="2 3 5 7 8 3"/>
          </svg>
        </button>

        {#if layoutPickerOpen}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="layout-dropdown" onclick={(e) => e.stopPropagation()}>
            {#each layouts as l}
              <button
                class="layout-option"
                class:selected={$gridLayout === l.id}
                onclick={() => handleLayoutSelect(l.id)}
              >
                <span class="lo-icon">{l.icon}</span>
                <div class="lo-info">
                  <span class="lo-label">{l.label}</span>
                  <span class="lo-count">{l.count} {l.count === 1 ? 'pane' : 'panes'}</span>
                </div>
                {#if $gridLayout === l.id}
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-6" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- â”€â”€ Terminal Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ -->
  <div
    class="terminal-grid-flex"
    bind:this={gridEl}
    class:dragging-col={activeDragType === 'col'}
    class:dragging-row={activeDragType === 'row'}
  >
    {#if maximizedPaneIndex !== null}
      {@const maximizedPane = columns.flatMap((column) => column.cells.map((cell) => ({ column, cell }))).find(({ cell }) => cell.index === maximizedPaneIndex)}
      {#if maximizedPane}
        {@const sessionId = $paneAssignments[maximizedPane.cell.index]}
        <div class="terminal-maximized-layer">
          {#if sessionId !== undefined && sessionId !== null}
            {#key sessionId}
              <TerminalPane
                {sessionId}
                paneIndex={maximizedPane.cell.index}
                isActive={true}
                isMaximized={true}
                onActivate={() => focusPane(maximizedPane.cell.index)}
                onClose={() => closePane(maximizedPane.cell.index)}
                onMaximize={() => togglePaneMaximize(maximizedPane.cell.index)}
              />
            {/key}
          {/if}
        </div>
      {/if}
    {:else}
      {#each columns as column, colIdx}
        <div class="terminal-column" style="flex: {colWidths[colIdx] ?? 100} 1 0%;">
          {#each column.cells as cell, cellIdx}
            {@const sessionId = $paneAssignments[cell.index]}
            <div
              class="terminal-cell"
              class:pane-drop-target={paneDrag?.active && paneDrag.overIndex === cell.index && paneDrag.from !== cell.index}
              class:pane-drag-source={paneDrag?.active && paneDrag.from === cell.index}
              data-pane-index={cell.index}
              style="flex: {cellHeights[colIdx]?.[cellIdx] ?? 100} 1 0%;"
            >
              {#if sessionId !== undefined && sessionId !== null}
                {#key sessionId}
                  <TerminalPane
                    {sessionId}
                    paneIndex={cell.index}
                    onPaneDragStart={startPaneDrag}
                    isActive={$activePaneIndex === cell.index}
                    isMaximized={false}
                    onActivate={() => focusPane(cell.index)}
                    onClose={() => closePane(cell.index)}
                    onMaximize={() => togglePaneMaximize(cell.index)}
                    onResizeLeft={colIdx > 0 ? (e) => startColResize(e, colIdx - 1) : undefined}
                    onResizeRight={colIdx < columns.length - 1 ? (e) => startColResize(e, colIdx) : undefined}
                    onResizeTop={cellIdx > 0 ? (e) => startCellResize(e, colIdx, cellIdx - 1) : undefined}
                    onResizeBottom={cellIdx < column.cells.length - 1 ? (e) => startCellResize(e, colIdx, cellIdx) : undefined}
                  />
                {/key}
              {:else}
                <button
                  class="empty-pane"
                  class:active={$activePaneIndex === cell.index}
                  onclick={() => handleEmptyPaneClick(cell.index)}
                  aria-label="Open terminal"
                >
                  <span class="empty-pane-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="3" width="20" height="18" rx="3"/>
                      <polyline points="8,9 4,12 8,15"/>
                      <line x1="12" y1="15" x2="20" y2="15"/>
                    </svg>
                  </span>
                  <span class="empty-pane-label">Open terminal</span>
                </button>
              {/if}
            </div>
            {#if cellIdx < column.cells.length - 1}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <div
                class="row-resize-divider"
                onmousedown={(e) => startCellResize(e, colIdx, cellIdx)}
                title="Drag to resize height"
                role="separator"
                aria-label="Row resize divider"
              ></div>
            {/if}
          {/each}
        </div>
        {#if colIdx < columns.length - 1}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div
            class="col-resize-divider"
            onmousedown={(e) => startColResize(e, colIdx)}
            title="Drag to resize width"
            role="separator"
            aria-label="Column resize divider"
          ></div>
        {/if}
      {/each}
    {/if}
  </div>
</div>

<style>
  /* ─── Outer shell ────────────────────────── */
  .terminal-fullscreen {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    /* Pure layout container — NO fill/blur of its own. The frosted .terminal-pane
       inside is the single glass surface, so the terminal reads as see-through as
       the editor (stacking a second frost layer here made it look solid). The
       toolbar/gaps show the body's ambient frost behind. */
    background: transparent;
    overflow: hidden;
  }

  /* ─── Toolbar ────────────────────────────── */
  .terminal-toolbar {
    position: relative;
    z-index: 100;
    display: flex;
    align-items: center;
    height: 38px;
    background: rgba(var(--titlebar-bg-rgb, 18, 18, 22), var(--frost-chrome, 0.62));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border-bottom: 1px solid var(--border);
    box-shadow: inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    flex-shrink: 0;
    padding: 0 8px;
    min-width: 0;
    gap: 0;
  }

  /* Session tabs — macOS pill style */
  .session-tabs {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    gap: 3px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 4px 0;
  }

  .session-tabs::-webkit-scrollbar { display: none; }

  .session-tab {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px 0 10px;
    border-radius: 20px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
    border: 1px solid transparent;
  }

  .session-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .session-tab.active {
    color: var(--text-primary);
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), 0.45);
    border-color: var(--border);
    box-shadow: 0 1px 4px rgba(0,0,0,0.12);
  }

  .session-tab.dead { opacity: 0.4; }

  .tab-main {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 2px;
    color: inherit;
    font: inherit;
    background: transparent;
    border: none;
    cursor: pointer;
    min-width: 0;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    opacity: 0;
    flex-shrink: 0;
    transition: opacity 0.15s, color 0.15s, background 0.15s;
  }

  .session-tab:hover .tab-close,
  .session-tab.active .tab-close {
    opacity: 0.7;
  }

  .tab-close:hover {
    opacity: 1;
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    opacity: 0.5;
    flex-shrink: 0;
    transition: background 0.2s, opacity 0.2s;
  }

  .tab-dot.running {
    background: #28c840;
    opacity: 1;
  }

  /* Add tab button */
  .add-tab-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    color: var(--text-muted);
    font-size: 18px;
    font-weight: 300;
    line-height: 1;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
    margin-left: 2px;
  }

  .add-tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  /* Divider */
  .toolbar-divider {
    width: 1px;
    height: 18px;
    background: var(--border);
    margin: 0 6px;
    flex-shrink: 0;
  }

  /* Toolbar actions (right side) */
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    transition: color 0.15s, background 0.15s;
  }

  .toolbar-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .layout-current-icon {
    font-size: 12px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  .layout-trigger-icon {
    color: var(--accent);
    flex-shrink: 0;
    opacity: 0.95;
  }

  .layout-btn-label {
    font-size: 11px;
  }

  /* Layout picker dropdown */
  .layout-picker {
    position: relative;
  }

  .layout-btn {
    min-width: 74px;
    padding: 0 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    background: color-mix(in srgb, var(--accent-light) 22%, var(--bg-secondary));
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03);
  }

  .layout-btn:hover {
    background: color-mix(in srgb, var(--accent-light) 40%, var(--bg-hover));
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .layout-picker.open .layout-btn {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-primary));
    border-color: var(--accent);
    color: var(--text-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 38%, transparent), 0 8px 18px rgba(0,0,0,0.16);
  }

  .layout-picker.open .layout-btn :global(svg) {
    transform: rotate(180deg);
  }

  .layout-btn :global(svg) {
    transition: transform 0.15s ease;
  }

  .layout-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 196px;
    background: color-mix(in srgb, var(--bg-secondary) 94%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--accent) 26%, var(--border));
    border-radius: 14px;
    padding: 7px;
    box-shadow: 0 18px 36px rgba(0,0,0,0.3);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 4px;
    animation: dropIn 0.15s ease;
  }

  :global(:root:not(.solid-theme)) .layout-dropdown {
    --bg-primary: rgba(var(--bg-primary-rgb, 24, 24, 30), var(--frost-base, 0.45));
    --bg-secondary: rgba(var(--bg-secondary-rgb, 18, 18, 22), var(--frost-chrome, 0.62));
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), var(--frost-chrome, 0.62));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
  }

  @keyframes dropIn {
    from { opacity: 0; transform: translateY(-5px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .layout-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border-radius: 10px;
    color: var(--text-secondary);
    border: 1px solid transparent;
    transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s;
  }

  .layout-option:hover {
    background: color-mix(in srgb, var(--accent-light) 24%, var(--bg-hover));
    border-color: color-mix(in srgb, var(--accent) 24%, transparent);
    color: var(--text-primary);
    transform: translateY(-1px);
  }

  .layout-option.selected {
    background: color-mix(in srgb, var(--accent-light) 55%, var(--bg-primary));
    border-color: color-mix(in srgb, var(--accent) 48%, transparent);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .lo-icon {
    font-size: 12px;
    width: 18px;
    text-align: center;
    flex-shrink: 0;
    color: var(--accent);
    font-weight: 700;
    letter-spacing: 0.2px;
  }

  .lo-info {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .lo-label {
    font-size: 12.5px;
    font-weight: 600;
  }

  .lo-count {
    font-size: 10.5px;
    color: var(--text-muted);
  }

  /* â”€â”€ Terminal Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  .terminal-grid-flex {
    flex: 1;
    display: flex;
    flex-direction: row;
    background: transparent;
    min-height: 0;
    width: 100%;
    position: relative;
    overflow: hidden;
  }

  .terminal-column {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .terminal-cell {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 0;
    position: relative;
  }

  /* Drag-to-reposition feedback */
  .terminal-cell.pane-drag-source {
    opacity: 0.55;
  }

  .terminal-cell.pane-drop-target::after {
    content: 'Drop to swap';
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.2px;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border: 2px solid var(--accent);
    border-radius: 6px;
    pointer-events: none;
  }

  .terminal-cell > :global(.terminal-pane) {
    flex: 1;
    width: 100%;
  }

  /* â”€â”€ Empty pane â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  .empty-pane {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
    border: 1px dashed color-mix(in srgb, var(--border) 84%, transparent);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s, color 0.15s, opacity 0.15s;
    width: 100%;
    height: 100%;
    opacity: 0.72;
  }

  .empty-pane:hover {
    background: color-mix(in srgb, var(--bg-secondary) 84%, var(--accent) 8%);
    border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
    opacity: 1;
  }

  .empty-pane.active {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    opacity: 1;
  }

  .empty-pane-icon {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
    background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .empty-pane-label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  /* â”€â”€ Resize handles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
  /* Wide transparent hit zone + thin visible line via pseudo-element */
  .col-resize-divider {
    position: relative;
    width: 1px;
    height: 100%;
    cursor: col-resize;
    background: var(--border);
    flex-shrink: 0;
    z-index: 5;
    transition: background 0.15s;
  }

  .col-resize-divider::before {
    content: '';
    position: absolute;
    inset: 0 -6px;
    cursor: col-resize;
    z-index: 6;
  }

  /* Grip dots */
  .col-resize-divider::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 3px;
    height: 24px;
    border-radius: 3px;
    background: var(--border);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }

  .col-resize-divider:hover,
  .terminal-grid-flex.dragging-col .col-resize-divider {
    background: var(--accent);
  }

  .col-resize-divider:hover::after,
  .terminal-grid-flex.dragging-col .col-resize-divider::after {
    opacity: 1;
    background: var(--accent);
  }

  .row-resize-divider {
    position: relative;
    height: 1px;
    width: 100%;
    cursor: row-resize;
    background: var(--border);
    flex-shrink: 0;
    z-index: 5;
    transition: background 0.15s;
  }

  .row-resize-divider::before {
    content: '';
    position: absolute;
    inset: -6px 0;
    cursor: row-resize;
    z-index: 6;
  }

  /* Grip dots */
  .row-resize-divider::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    height: 3px;
    width: 24px;
    border-radius: 3px;
    background: var(--border);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }

  .row-resize-divider:hover,
  .terminal-grid-flex.dragging-row .row-resize-divider {
    background: var(--accent);
  }

  .row-resize-divider:hover::after,
  .terminal-grid-flex.dragging-row .row-resize-divider::after {
    opacity: 1;
    background: var(--accent);
  }

  /* Global cursor override while dragging */
  :global(body.dragging-col) { cursor: col-resize !important; }
  :global(body.dragging-row) { cursor: row-resize !important; }
  :global(body.dragging-pane) { cursor: grabbing !important; user-select: none !important; }
  /* Don't let xterm swallow the pointer / select text while a pane is dragged */
  :global(body.dragging-pane .xterm) { pointer-events: none !important; }
</style>
