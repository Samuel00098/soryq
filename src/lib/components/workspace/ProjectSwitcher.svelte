<script lang="ts">
  import { openProjectsList, activeProjectId, switchToProject, closeProject, openProject } from '$lib/stores/workspace';
  import { setActiveView } from '$lib/stores/layout';

  async function handleOpen() {
    await openProject();
    setActiveView('editor');
  }

  function handleClose(e: MouseEvent, projectId: string) {
    e.stopPropagation();
    closeProject(projectId);
  }
</script>

{#if $openProjectsList.length > 0}
  <div class="project-switcher">
    {#each $openProjectsList as project (project.id)}
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="project-tab"
        class:active={$activeProjectId === project.id}
        onclick={() => switchToProject(project.id)}
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
    <button class="project-add" onclick={handleOpen} title="Open new folder">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
    </button>
  </div>
{:else}
  <div class="project-switcher project-switcher-empty">
    <button class="project-add-full" onclick={handleOpen} title="Open folder">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/>
        <line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      Open folder
    </button>
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

  .project-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    color: var(--text-muted);
    flex-shrink: 0;
    margin-left: 2px;
    transition: color 0.15s, background 0.15s;
  }
  .project-add:hover { color: var(--text-primary); background: var(--bg-hover); }

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
</style>
