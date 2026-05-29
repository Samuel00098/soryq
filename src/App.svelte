<script lang="ts">
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import CommandPalette from '$lib/components/shared/CommandPalette.svelte';
  import Toasts from '$lib/components/shared/Toasts.svelte';
  import SettingsModal from '$lib/components/shared/SettingsModal.svelte';
  import QuickCaptureModal from '$lib/components/shared/QuickCaptureModal.svelte';
  import { settingsOpen, closeSettings, quickCaptureOpen, closeQuickCapture } from '$lib/stores/layout';
  import { onMount } from 'svelte';
  import { loadThemes } from '$lib/stores/theme';
  import { initializeWorkspaces, saveProjectState, activeProjectId, activeProject } from '$lib/stores/workspace';
  import { openDailyNote } from '$lib/stores/dailyNote';
  import { get } from 'svelte/store';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { initDefaultCommands } from '$lib/stores/commandpalette';
  import { requestNotificationPermission } from '$lib/stores/notification';
  import { uiZoom, userShortcuts, matchShortcut, type KeyboardShortcut, onboardingCompleted } from '$lib/stores/settings';
  import OnboardingWalkthrough from '$lib/components/workspace/OnboardingWalkthrough.svelte';

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
    initializeWorkspaces();
    initDefaultCommands();
    requestNotificationPermission();

    // Auto-open today's daily note once per project per day
    let lastDailyProjectId: string | null = null;
    const unsubDailyNote = activeProject.subscribe((project) => {
      if (project && project.id !== lastDailyProjectId) {
        lastDailyProjectId = project.id;
        openDailyNote(project).catch(() => {});
      }
    });

    // Save project state before the window closes — use Tauri's close-request hook
    // which fires reliably on all platforms (beforeunload is unreliable on macOS/Tauri).
    let unlistenClose: (() => void) | undefined;
    let isClosing = false;
    getCurrentWindow().onCloseRequested(async (event) => {
      if (isClosing) {
        return;
      }

      event.preventDefault();
      isClosing = true;
      const projectId = get(activeProjectId);
      if (projectId) saveProjectState(projectId);

      // Remove the listener before destroying the window so the forced close
      // does not re-enter this handler and leave the app stuck open.
      unlistenClose?.();
      unlistenClose = undefined;
      await getCurrentWindow().destroy();
    }).then((u) => { unlistenClose = u; });

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
      unlistenClose?.();
      unsubscribeShortcuts();
      unsubDailyNote();
    };
  });
</script>

<AppShell />

<CommandPalette />
<Toasts />

{#if $settingsOpen}
  <SettingsModal onclose={closeSettings} />
{/if}

{#if $quickCaptureOpen}
  <QuickCaptureModal onclose={closeQuickCapture} />
{/if}

{#if !$onboardingCompleted}
  <OnboardingWalkthrough />
{/if}
