<script lang="ts">
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import CommandPalette from '$lib/components/shared/CommandPalette.svelte';
  import Toasts from '$lib/components/shared/Toasts.svelte';
  import SettingsModal from '$lib/components/shared/SettingsModal.svelte';
  import { settingsOpen, closeSettings } from '$lib/stores/layout';
  import { onMount } from 'svelte';
  import { loadThemes } from '$lib/stores/theme';
  import { loadRecentProjects } from '$lib/stores/workspace';
  import { initDefaultCommands } from '$lib/stores/commandpalette';
  import { uiZoom, userShortcuts, matchShortcut, type KeyboardShortcut } from '$lib/stores/settings';

  const ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

  function zoomIn() {
    uiZoom.update(z => {
      const next = ZOOM_LEVELS.find(l => l > z);
      return next ?? z;
    });
  }

  function zoomOut() {
    uiZoom.update(z => {
      const next = [...ZOOM_LEVELS].reverse().find(l => l < z);
      return next ?? z;
    });
  }

  onMount(() => {
    loadThemes();
    loadRecentProjects();
    initDefaultCommands();

    // Lock window scrolling to prevent viewport shifting when dragging elements/selection
    const handleScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // Apply persistent zoom level via container transform
    const unsubscribeZoom = uiZoom.subscribe((zoom) => {
      if (typeof document !== 'undefined') {
        document.documentElement.style.setProperty('--ui-zoom-percent', `${zoom}`);
      }
    });

    let activeShortcuts: KeyboardShortcut[] = [];
    const unsubscribeShortcuts = userShortcuts.subscribe((val) => {
      activeShortcuts = val || [];
    });

    // Intercept zoom keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const zoomInShortcut = activeShortcuts.find(s => s && s.id === 'zoomIn');
      const zoomOutShortcut = activeShortcuts.find(s => s && s.id === 'zoomOut');
      const resetZoomShortcut = activeShortcuts.find(s => s && s.id === 'resetZoom');

      if (zoomInShortcut && matchShortcut(e, zoomInShortcut.keys)) {
        e.preventDefault();
        zoomIn();
      } else if (zoomOutShortcut && matchShortcut(e, zoomOutShortcut.keys)) {
        e.preventDefault();
        zoomOut();
      } else if (resetZoomShortcut && matchShortcut(e, resetZoomShortcut.keys)) {
        e.preventDefault();
        uiZoom.set(100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('keydown', handleKeyDown);
      unsubscribeZoom();
      unsubscribeShortcuts();
    };
  });
</script>

<AppShell />

<CommandPalette />
<Toasts />

{#if $settingsOpen}
  <SettingsModal onclose={closeSettings} />
{/if}

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

  :global(.theme-transitioning),
  :global(.theme-transitioning *) {
    transition: background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                stroke 0.3s cubic-bezier(0.4, 0, 0.2, 1),
                fill 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
  }

  :global(:root) {
    /* ── Core Palette ───────────────────────── */
    --bg-primary:      #08080a;
    --bg-secondary:    #0c0c0e;
    --bg-tertiary:     #121214;
    --bg-hover:        rgba(255, 255, 255, 0.04);
    --bg-active:       rgba(255, 255, 255, 0.07);
    --bg-glass:        rgba(255, 255, 255, 0.015);

    /* ── Text ───────────────────────────────── */
    --text-primary:    #f3f3f6;
    --text-secondary:  #9494a6;
    --text-muted:      #555566;
    --text-placeholder:#3a3a46;

    /* ── Accent (cyan) ──────────────────────── */
    --accent:          #06b6d4;
    --accent-hover:    #0891b2;
    --accent-light:    rgba(6, 182, 212, 0.15);
    --accent-glow:     rgba(6, 182, 212, 0.06);

    /* ── Semantic ───────────────────────────── */
    --error:           #f87171;
    --warning:         #fbbf24;
    --success:         #4ade80;
    --info:            #60a5fa;

    /* ── Borders & Surfaces ─────────────────── */
    --border:          rgba(255, 255, 255, 0.06);
    --border-subtle:   rgba(255, 255, 255, 0.03);
    --border-focus:    var(--accent);
    --scrollbar-thumb:      rgba(255, 255, 255, 0.08);
    --scrollbar-thumb-hover: rgba(255, 255, 255, 0.2);
    --scrollbar-track:      transparent;
    --selection-bg:         rgba(6, 182, 212, 0.2);
    --editor-lineHighlight: rgba(255, 255, 255, 0.03);
    --shadow-sm:       0 1px 2px rgba(0, 0, 0, 0.5);
    --shadow-md:       0 4px 8px rgba(0, 0, 0, 0.6);
    --shadow-lg:       0 8px 24px rgba(0, 0, 0, 0.7);
    --radius-sm:       4px;
    --radius-md:       8px;
    --radius-lg:       12px;

    /* ── TitleBar ───────────────────────────── */
    --titlebar-bg:     #08080a;
    --titlebar-text:   #e2e2eb;
    --titlebar-border: rgba(255, 255, 255, 0.04);

    /* ── Activity Bar ───────────────────────── */
    --activitybar-bg:        #08080a;
    --activitybar-border:    rgba(255, 255, 255, 0.04);

    /* ── Sidebar ────────────────────────────── */
    --sidebar-bg:      #0c0c0e;
    --sidebar-border:  rgba(255, 255, 255, 0.05);

    /* ── Editor ─────────────────────────────── */
    --editor-bg:       #08080a;
    --editor-gutter:   #08080a;

    /* ── Tabs ───────────────────────────────── */
    --tab-active-bg:   #08080a;
    --tab-inactive-bg: #0c0c0e;
    --tab-border:      rgba(255, 255, 255, 0.05);

    /* ── Panel / Terminal ───────────────────── */
    --panel-bg:        #08080a;
    --panel-border:    rgba(255, 255, 255, 0.05);
    --terminal-bg:     #040405;

    /* ── Input / Form ───────────────────────── */
    --input-bg:        #121214;
    --input-border:    rgba(255, 255, 255, 0.08);
    --input-focus-border: var(--accent);

    /* ── Buttons ────────────────────────────── */
    --button-bg:       #0e7490;
    --button-hover-bg: #0891b2;
    --button-text:     #ffffff;

    /* ── Status Bar ─────────────────────────── */
    --statusbar-bg:    #08080a;
    --statusbar-border:rgba(255, 255, 255, 0.04);
    --statusbar-text:  #9494a6;

    /* ── Syntax ─────────────────────────────── */
    --syntax-keyword:    #c792ea;
    --syntax-string:     #a5d6ff;
    --syntax-number:     #f78c6c;
    --syntax-comment:    #4a4a7a;
    --syntax-function:   #82aaff;
    --syntax-variable:   #f07178;
    --syntax-type:       #ffcb6b;
    --syntax-operator:   #89ddff;
    --syntax-punctuation:#a0a0c0;
    --syntax-constant:   #ff9cac;
  }

  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }

  :global(html) {
    height: 100%;
    width: 100%;
    overflow: hidden;
    background-color: var(--bg-primary);
  }

  :global(body) {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    overscroll-behavior: none;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 15px;
    color: var(--text-primary);
    background-color: var(--bg-primary);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  :global(button) {
    cursor: pointer;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    outline: none;
  }

  :global(::-webkit-scrollbar) { width: 5px; height: 5px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) {
    background: var(--scrollbar-thumb);
    border-radius: 99px;
    transition: background 0.15s;
  }
  :global(::-webkit-scrollbar-thumb:hover) {
    background: var(--scrollbar-thumb-hover, rgba(255, 255, 255, 0.2));
  }

  :global(::selection) {
    background: var(--selection-bg);
  }
</style>
