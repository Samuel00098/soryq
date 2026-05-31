<script lang="ts">
  import { openProjectsList, activeProjectId, switchToProject, closeProject, openProject, recentWorkspaces, activeWorkspaceId, moveProjectToWorkspace } from '$lib/stores/workspace';
  import { setActiveView } from '$lib/stores/layout';
  import type { Project } from '$lib/types/workspace';

  interface ContextMenu {
    project: Project;
    x: number;
    y: number;
  }

  let contextMenu = $state<ContextMenu | null>(null);

  const otherWorkspaces = $derived(
    $recentWorkspaces.filter((w) => w.id !== $activeWorkspaceId)
  );

  async function handleOpen() {
    await openProject();
    setActiveView('editor');
  }

  function handleClose(e: MouseEvent, projectId: string) {
    e.stopPropagation();
    closeProject(projectId);
  }

  function handleContextMenu(e: MouseEvent, project: Project) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu = { project, x: e.clientX, y: e.clientY };
  }

  function handleMove(targetWorkspaceId: string) {
    if (contextMenu) {
      moveProjectToWorkspace(contextMenu.project.root_path, targetWorkspaceId);
    }
    contextMenu = null;
  }

  $effect(() => {
    if (!contextMenu) return;
    function dismiss() { contextMenu = null; }
    document.addEventListener('click', dismiss, { once: true });
    document.addEventListener('contextmenu', dismiss, { once: true });
    return () => {
      document.removeEventListener('click', dismiss);
      document.removeEventListener('contextmenu', dismiss);
    };
  });
</script>

{#if $openProjectsList.length > 0}
  <div
    class="project-switcher"
    onwheel={(e) => {
      if (e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        e.currentTarget.scrollLeft += e.deltaY;
      }
    }}
  >
    {#each $openProjectsList as project (project.id)}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="project-tab"
        class:active={$activeProjectId === project.id}
        onclick={() => switchToProject(project.id)}
        oncontextmenu={(e) => handleContextMenu(e, project)}
        role="tab"
        title={project.root_path}
      >
        <span class="project-dot" style="background: hsl({Math.abs(project.name.split('').reduce((h,c)=>c.charCodeAt(0)+((h<<5)-h),0))%360} 55% 60%)"></span>
        <span class="project-tab-name">{project.name}</span>
        <button
          class="project-close"
          onclick={(e) => handleClose(e, project.id)}
          aria-label="Close project"
        >
          <svg width="9" height="9" viewBox="0 0 9 9">
            <path d="M1 1l7 7M8 1L1 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    {/each}
    <button class="project-add-btn" onclick={handleOpen} title="Add folder to workspace">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  </div>
{:else}
  <div class="project-switcher project-switcher-empty">
    <button class="project-add-full" onclick={handleOpen} title="Add folder to workspace">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <path d="M16 5V1"/>
        <path d="M14 3h4"/>
      </svg>
      Add folder
    </button>
  </div>
{/if}

<!-- Context menu -->
{#if contextMenu}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="ctx-menu"
    style="top: {contextMenu.y}px; left: {contextMenu.x}px;"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="ctx-label">Move to workspace</div>
    {#if otherWorkspaces.length === 0}
      <div class="ctx-empty">No other workspaces</div>
    {:else}
      {#each otherWorkspaces as ws (ws.id)}
        <button class="ctx-item" onclick={() => handleMove(ws.id)}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="ctx-ws-name">{ws.name}</span>
        </button>
      {/each}
    {/if}
  </div>
{/if}

<style>
  .project-switcher {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-subtle);
    overflow-x: auto;
    scrollbar-width: none;
    flex-shrink: 0;
    min-height: 38px;
  }

  .project-switcher::-webkit-scrollbar { display: none; }

  .project-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 8px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    white-space: nowrap;
    max-width: 130px;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .project-tab:hover { color: var(--text-secondary); background: var(--bg-hover); }
  .project-tab.active { color: var(--text-primary); background: var(--bg-active); }

  .project-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    opacity: 0.8;
  }

  .project-tab-name {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .project-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    color: var(--text-muted);
    opacity: 0;
    flex-shrink: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
  }
  .project-tab:hover .project-close,
  .project-tab.active .project-close { opacity: 1; }
  .project-close:hover { background: rgba(248,113,113,0.15); color: var(--error); }

  .project-add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: color 0.15s, background 0.15s;
  }
  .project-add-btn:hover { color: var(--text-primary); background: var(--bg-hover); }

  .project-switcher-empty { padding: 6px 8px; }

  .project-add-full {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-muted);
    transition: color 0.15s, background 0.15s;
    width: 100%;
  }
  .project-add-full:hover { color: var(--text-secondary); background: var(--bg-hover); }

  /* ── Context menu ── */
  .ctx-menu {
    position: fixed;
    z-index: 9000;
    min-width: 180px;
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), var(--frost-chrome, 0.62));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: var(--glass-shadow, 0 8px 24px rgba(0, 0, 0, 0.35)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    padding: 4px;
    animation: ctx-in 0.1s ease;
  }

  @keyframes ctx-in {
    from { opacity: 0; transform: scale(0.96) translateY(-4px); }
    to   { opacity: 1; transform: scale(1)    translateY(0);    }
  }

  .ctx-label {
    padding: 6px 10px 4px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .ctx-empty {
    padding: 6px 10px 8px;
    font-size: 11px;
    color: var(--text-muted);
    opacity: 0.5;
    font-style: italic;
  }

  .ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border-radius: 5px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
    background: transparent;
    border: none;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .ctx-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .ctx-item svg { flex-shrink: 0; opacity: 0.6; }

  .ctx-ws-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
