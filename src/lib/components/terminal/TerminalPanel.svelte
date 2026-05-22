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
  } from '$lib/stores/terminal';
  import { activeProject, openProjectIds } from '$lib/stores/workspace';

  // Ensure at least one session exists on mount
  onMount(async () => {
    if ($sessions.length === 0) {
      await createTerminalSession($activeProject?.root_path);
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
    { id: 'single', label: 'Single',     icon: '▪',     count: 1 },
    { id: '2h',     label: 'Split H',    icon: '◫',     count: 2 },
    { id: '3h',     label: 'Triple H',   icon: '☰',     count: 3 },
    { id: '2v',     label: 'Split V',    icon: '⬒',     count: 2 },
    { id: '3v',     label: 'Triple V',   icon: '≡',     count: 3 },
    { id: '4',      label: 'Grid 2×2',   icon: '▦',     count: 4 },
    { id: '9',      label: 'Grid 3×3',   icon: '⧉',     count: 9 },
  ];

  let layoutPickerOpen = $state(false);

  function handleLayoutSelect(layout: GridLayout) {
    setGridLayout(layout);
    layoutPickerOpen = false;
  }

  let projectPath = $derived($activeProject?.root_path);

  async function handleNewTerminal() {
    const panes = $paneAssignments;
    const emptyIdx = panes.findIndex((p) => p === null);
    const cwd = projectPath;
    if (emptyIdx !== -1) {
      await createTerminalSession(cwd, emptyIdx);
    } else {
      await handleSplitRight();
    }
  }

  function handleEmptyPaneClick(paneIdx: number) {
    focusPane(paneIdx);
    createTerminalSession(projectPath, paneIdx);
  }

  async function handleSplitRight() {
    const cwd = projectPath;

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

    if (found) {
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
    const cwd = projectPath;

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

    if (found) {
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

  function closePane(paneIndex: number) {
    let foundColIdx = -1;
    let foundCellIdx = -1;
    for (let c = 0; c < columns.length; c++) {
      const cell = columns[c].cells.findIndex(p => p.index === paneIndex);
      if (cell !== -1) {
        foundColIdx = c;
        foundCellIdx = cell;
        break;
      }
    }

    if (foundColIdx === -1) return;

    const sessionId = $paneAssignments[paneIndex];
    if (sessionId !== null && sessionId !== undefined) {
      killSession(sessionId);
    }

    // Remove cell from column
    columns[foundColIdx].cells.splice(foundCellIdx, 1);
    cellHeights[foundColIdx].splice(foundCellIdx, 1);

    if (columns[foundColIdx].cells.length === 0) {
      // Column is now empty, remove it completely
      columns.splice(foundColIdx, 1);
      colWidths.splice(foundColIdx, 1);
      cellHeights.splice(foundColIdx, 1);

      // Redistribute widths of remaining columns
      if (columns.length > 0) {
        const C = columns.length;
        colWidths = Array(C).fill(100 / C);
      }
    } else {
      // Redistribute heights of remaining cells in this column
      const numCells = columns[foundColIdx].cells.length;
      cellHeights[foundColIdx] = Array(numCells).fill(100 / numCells);
    }

    paneAssignments.update((panes) => {
      const copy = [...panes];
      copy.splice(paneIndex, 1);
      return copy;
    });

    // Decrement cell indices that were greater than the closed one
    for (let c = 0; c < columns.length; c++) {
      for (let cell = 0; cell < columns[c].cells.length; cell++) {
        if (columns[c].cells[cell].index > paneIndex) {
          columns[c].cells[cell].index -= 1;
        }
      }
    }

    activePaneIndex.update((active) => {
      if (active === paneIndex) {
        return Math.max(0, paneIndex - 1);
      } else if (active > paneIndex) {
        return active - 1;
      }
      return active;
    });

    if (columns.length === 0) {
      columns = [{ cells: [{ index: 0 }] }];
      colWidths = [100];
      cellHeights = [[100]];
      paneAssignments.set([null]);
      activePaneIndex.set(0);
    } else {
      columns = [...columns];
      colWidths = [...colWidths];
      cellHeights = [...cellHeights];
    }
  }

  // ── Pane resize state ──────────────────────
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
      // Save previous project's dimensions
      if (currentProjectId) {
        gridCache.set(currentProjectId, {
          columns: $state.snapshot(columns),
          colWidths: $state.snapshot(colWidths),
          cellHeights: $state.snapshot(cellHeights)
        });
      }

      // Load new project's dimensions
      if (projectId) {
        const cached = gridCache.get(projectId);
        if (cached) {
          columns = cached.columns;
          colWidths = cached.colWidths;
          cellHeights = cached.cellHeights;
        } else {
          // Defaults for a new project
          columns = [{ cells: [{ index: 0 }] }];
          colWidths = [100];
          cellHeights = [[100]];
        }
      } else {
        columns = [{ cells: [{ index: 0 }] }];
        colWidths = [100];
        cellHeights = [[100]];
      }

      currentProjectId = projectId;
      // Set lastAppliedLayout to the new gridLayout value so the layout $effect doesn't overwrite our restored dimensions
      lastAppliedLayout = $gridLayout;
    }
  });

  // Clean up gridCache for closed projects
  $effect(() => {
    const openIds = $openProjectIds;
    for (const key of gridCache.keys()) {
      if (!openIds.includes(key)) {
        gridCache.delete(key);
      }
    }
  });

  $effect(() => {
    const layout = $gridLayout;
    if (layout !== lastAppliedLayout) {
      lastAppliedLayout = layout;
      if (layout === 'single') {
        columns = [{ cells: [{ index: 0 }] }];
        colWidths = [100];
        cellHeights = [[100]];
      } else if (layout === '2h') {
        columns = [{ cells: [{ index: 0 }] }, { cells: [{ index: 1 }] }];
        colWidths = [50, 50];
        cellHeights = [[100], [100]];
      } else if (layout === '2v') {
        columns = [{ cells: [{ index: 0 }, { index: 1 }] }];
        colWidths = [100];
        cellHeights = [[50, 50]];
      } else if (layout === '3h') {
        columns = [
          { cells: [{ index: 0 }] },
          { cells: [{ index: 1 }] },
          { cells: [{ index: 2 }] }
        ];
        colWidths = [33.33, 33.33, 33.34];
        cellHeights = [[100], [100], [100]];
      } else if (layout === '3v') {
        columns = [{ cells: [{ index: 0 }, { index: 1 }, { index: 2 }] }];
        colWidths = [100];
        cellHeights = [[33.33, 33.33, 33.34]];
      } else if (layout === '4') {
        columns = [
          { cells: [{ index: 0 }, { index: 2 }] },
          { cells: [{ index: 1 }, { index: 3 }] }
        ];
        colWidths = [50, 50];
        cellHeights = [[50, 50], [50, 50]];
      } else if (layout === '9') {
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
  });

  let gridEl: HTMLDivElement | null = null;
  let activeDragType = $state<'col' | 'row' | null>(null);
  let activeDragRowIdx = 0;
  let activeDragColIdx = 0;
  let dragStartPos = 0;
  let activeDragStartSizes: number[] = [];

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
    activeDragType = null;
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
    }
  });

  // Close picker when clicking outside
  function handleOutsideClick(e: MouseEvent) {
    if (!(e.target as Element).closest('.layout-picker')) {
      layoutPickerOpen = false;
    }
  }

  // Tab click: make session active AND focus its pane
  function handleTabClick(sessionId: number) {
    const panes = $paneAssignments;
    const idx = panes.indexOf(sessionId);
    if (idx !== -1) {
      focusPane(idx);
    } else {
      // Session not in any pane: assign to active pane
      assignToPane($activePaneIndex, sessionId);
      activeSessionId.set(sessionId);
    }
  }
</script>

<svelte:window onclick={handleOutsideClick} onmousemove={onMouseMove} onmouseup={onMouseUp} />

<div class="terminal-fullscreen">

  <!-- ── Toolbar ─────────────────────────── -->
  <div class="terminal-toolbar">

    <!-- Session tabs -->
    <div class="session-tabs">
      {#each $sessions as session (session.id)}
        <button
          class="session-tab"
          class:active={$activeSessionId === session.id}
          class:dead={!session.isRunning}
          onclick={() => handleTabClick(session.id)}
          title={session.title}
        >
          <span
            class="tab-dot"
            class:running={session.isRunning}
          ></span>
          <span class="tab-label">{session.title}</span>
        </button>
      {/each}
    </div>

    <!-- Toolbar actions -->
    <div class="toolbar-actions">
      <!-- Layout picker -->
      <div class="layout-picker" class:open={layoutPickerOpen}>
        <button
          class="toolbar-btn layout-btn"
          onclick={(e) => { e.stopPropagation(); layoutPickerOpen = !layoutPickerOpen; }}
          title="Terminal layout"
        >
          <span class="layout-current-icon">
            {layouts.find(l => l.id === $gridLayout)?.icon ?? '▪'}
          </span>
          <span class="layout-btn-label">Layout</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5">
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
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-6" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Split right -->
      <button class="toolbar-btn" onclick={handleSplitRight} title="Split terminal right">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="12" y1="3" x2="12" y2="21"/>
        </svg>
      </button>
      <!-- Split below -->
      <button class="toolbar-btn" onclick={handleSplitBelow} title="Split terminal below">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
        </svg>
      </button>
      <!-- New terminal -->
      <button class="toolbar-btn" onclick={handleNewTerminal} title="New terminal">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- ── Terminal Grid ─────────────────────── -->
  <div
    class="terminal-grid-flex"
    bind:this={gridEl}
    class:dragging-col={activeDragType === 'col'}
    class:dragging-row={activeDragType === 'row'}
  >
    {#each columns as column, colIdx}
      <div class="terminal-column" style="width: {colWidths[colIdx] ?? 100}%; flex-grow: 0; flex-shrink: 0;">
        {#each column.cells as cell, cellIdx}
          {@const sessionId = $paneAssignments[cell.index]}
          <div class="terminal-cell" style="height: {cellHeights[colIdx]?.[cellIdx] ?? 100}%; flex-grow: 0; flex-shrink: 0;">
            {#if sessionId !== undefined && sessionId !== null}
              {#key sessionId}
                <TerminalPane
                  {sessionId}
                  isActive={$activePaneIndex === cell.index}
                  onActivate={() => focusPane(cell.index)}
                  onClose={() => closePane(cell.index)}
                />
              {/key}
            {:else}
              <!-- Empty pane placeholder -->
              <div class="empty-pane-wrapper">
                <button
                  class="empty-pane"
                  class:active={$activePaneIndex === cell.index}
                  onclick={() => handleEmptyPaneClick(cell.index)}
                  aria-label="New terminal in this pane"
                >
                  <div class="empty-pane-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="2" y="3" width="20" height="18" rx="3"/>
                      <polyline points="8,9 4,12 8,15"/>
                      <line x1="12" y1="15" x2="20" y2="15"/>
                    </svg>
                  </div>
                  <span class="empty-pane-label">Click to open terminal</span>
                  <span class="empty-pane-hint">or press +</span>
                </button>
                <button
                  class="empty-pane-close"
                  onclick={(e) => { e.stopPropagation(); closePane(cell.index); }}
                  aria-label="Close pane"
                  title="Close pane"
                >
                  <svg width="9" height="9" viewBox="0 0 9 9">
                    <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
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
  </div>
</div>

<style>
  /* ── Outer shell ────────────────────────── */
  .terminal-fullscreen {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
    overflow: hidden;
  }

  /* ── Toolbar ────────────────────────────── */
  .terminal-toolbar {
    display: flex;
    align-items: center;
    height: 40px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    gap: 4px;
    padding: 0 4px;
  }

  /* Session tabs */
  .session-tabs {
    display: flex;
    align-items: center;
    flex: 1;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .session-tabs::-webkit-scrollbar { display: none; }

  .session-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
    white-space: nowrap;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
  }

  .session-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .session-tab.active {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }

  .session-tab.dead { opacity: 0.4; }

  .tab-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.2s;
  }

  .tab-dot.running {
    background: var(--success);
  }

  /* Toolbar actions (right side) */
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    padding-left: 4px;
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 30px;
    padding: 0 10px;
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
    font-size: 14px;
    line-height: 1;
  }

  .layout-btn-label {
    font-size: 11px;
  }

  /* Layout picker dropdown */
  .layout-picker {
    position: relative;
  }

  .layout-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    width: 180px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 5px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: dropIn 0.15s ease;
  }

  @keyframes dropIn {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .layout-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 7px;
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s;
  }

  .layout-option:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .layout-option.selected {
    background: var(--accent-light);
    color: var(--text-primary);
  }

  .lo-icon {
    font-size: 16px;
    width: 20px;
    text-align: center;
    flex-shrink: 0;
  }

  .lo-info {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .lo-label {
    font-size: 12px;
    font-weight: 600;
  }

  .lo-count {
    font-size: 10px;
    color: var(--text-muted);
  }

  /* ── Terminal Grid ────────────────────────── */
  .terminal-grid-flex {
    flex: 1;
    display: flex;
    flex-direction: row;
    background: var(--bg-primary);
    min-height: 0;
    width: 100%;
    height: 100%;
    position: relative;
  }

  .terminal-column {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: relative;
    min-width: 10%;
  }

  .terminal-cell {
    display: flex;
    flex-direction: column;
    width: 100%;
    position: relative;
    min-height: 10%;
  }

  .terminal-cell > :global(.terminal-pane) {
    flex: 1;
    width: 100%;
    height: 100%;
  }

  /* ── Empty pane ──────────────────────────── */
  .empty-pane {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: var(--bg-secondary);
    border: 1.5px dashed var(--border);
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    width: 100%;
    height: 100%;
  }

  .empty-pane:hover {
    background: var(--accent-light);
    border-color: var(--accent);
  }

  .empty-pane.active {
    border-color: var(--accent);
  }

  .empty-pane-icon {
    color: var(--text-muted);
  }

  .empty-pane-label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .empty-pane-hint {
    font-size: 10px;
    color: var(--text-muted);
  }

  /* ── Resize handles ──────────────────────── */
  .col-resize-divider {
    width: 4px;
    height: 100%;
    cursor: col-resize;
    background: var(--border);
    flex-shrink: 0;
    transition: background 0.15s;
    z-index: 5;
  }

  .col-resize-divider:hover,
  .terminal-grid-flex.dragging-col .col-resize-divider {
    background: var(--accent);
  }

  .row-resize-divider {
    height: 4px;
    width: 100%;
    cursor: row-resize;
    background: var(--border);
    flex-shrink: 0;
    transition: background 0.15s;
    z-index: 5;
  }

  .row-resize-divider:hover,
  .terminal-grid-flex.dragging-row .row-resize-divider {
    background: var(--accent);
  }

  /* Global cursor override while dragging */
  :global(body.dragging-col) { cursor: col-resize !important; }
  :global(body.dragging-row) { cursor: row-resize !important; }

  .empty-pane-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .empty-pane-close {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    color: var(--text-muted);
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    cursor: pointer;
  }

  .empty-pane-wrapper:hover .empty-pane-close {
    opacity: 1;
  }

  .empty-pane-close:hover {
    background: rgba(239, 68, 68, 0.15);
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.3);
  }
</style>
