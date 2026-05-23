<script lang="ts">
  import { layout, setActiveView, toggleSidebar, openSettings, toggleEditorVisible, togglePreviewVisible } from '$lib/stores/layout';
  import type { ActiveView } from '$lib/types/layout';

  type NavItem = { id: ActiveView | 'explorer'; label: string; bottom?: boolean };

  const topItems: NavItem[] = [
    { id: 'explorer', label: 'Explorer' },
    { id: 'editor',   label: 'Editor'   },
    { id: 'terminal', label: 'Terminal' },
    { id: 'preview',  label: 'Preview'  },
  ];

  const bottomItems: NavItem[] = [
    { id: 'settings', label: 'Settings', bottom: true },
  ];

  function handleClick(item: NavItem) {
    if (item.id === 'explorer') { toggleSidebar(); return; }
    if (item.id === 'settings') { openSettings(); return; }
    if (item.id === 'editor') { toggleEditorVisible(); return; }
    if (item.id === 'preview') { togglePreviewVisible(); return; }
    if (item.id === 'terminal') {
      if ($layout.editorVisible || $layout.previewVisible) {
        layout.update((l) => ({ ...l, editorVisible: false, previewVisible: false, activeView: 'terminal' }));
      } else {
        setActiveView('terminal');
      }
      return;
    }
    setActiveView(item.id as ActiveView);
  }

  function isActive(item: NavItem): boolean {
    if (item.id === 'explorer') return $layout.sidebarVisible;
    if (item.id === 'settings') return false;
    if (item.id === 'editor') return $layout.editorVisible;
    if (item.id === 'preview') return $layout.previewVisible;
    return $layout.activeView === item.id;
  }
</script>

<nav class="activitybar" aria-label="Main navigation">
  <div class="ab-top">
    {#each topItems as item}
      <button
        class="ab-btn"
        class:ab-active={isActive(item)}
        onclick={() => handleClick(item)}
        aria-label={item.label}
        title={item.label}
      >
        <!-- Explorer icon -->
        {#if item.id === 'explorer'}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
            <polyline points="13,2 13,9 20,9"/>
          </svg>

        <!-- Editor icon -->
        {:else if item.id === 'editor'}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>

        <!-- Terminal icon -->
        {:else if item.id === 'terminal'}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
            <rect x="2" y="3" width="20" height="18" rx="3"/>
            <polyline points="8,9 4,12 8,15"/>
            <line x1="12" y1="15" x2="20" y2="15"/>
          </svg>

        <!-- Preview icon -->
        {:else if item.id === 'preview'}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
            <path d="M2 12h20"/>
          </svg>
        {/if}
      </button>
    {/each}
  </div>

  <div class="ab-bottom">
    {#each bottomItems as item}
      <button
        class="ab-btn"
        class:ab-active={isActive(item)}
        onclick={() => handleClick(item)}
        aria-label={item.label}
        title={item.label}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    {/each}
  </div>
</nav>

<style>
  .activitybar {
    width: 46px;
    height: 100%;
    background: var(--activitybar-bg);
    border-right: 1px solid var(--activitybar-border);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    padding: 6px 0;
  }

  .ab-top, .ab-bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: 100%;
  }

  .ab-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    color: var(--text-muted);
    transition: color 0.15s, background 0.15s;
    position: relative;
  }

  .ab-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .ab-btn.ab-active {
    color: var(--accent);
    background: var(--accent-light);
  }

  /* Active indicator bar on left edge */
  .ab-btn.ab-active::before {
    content: '';
    position: absolute;
    left: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 16px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
  }
</style>
