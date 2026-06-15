<script lang="ts">
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import CommandPalette from '$lib/components/shared/CommandPalette.svelte';
  import Toasts from '$lib/components/shared/Toasts.svelte';
  import BackgroundMedia from '$lib/components/shared/BackgroundMedia.svelte';
  // Modals/overlays below the always-visible shell are loaded on demand (see the
  // {#await import()} blocks in the markup) so their code — SettingsModal alone
  // is huge — stays out of the startup bundle until first opened.
  import { settingsOpen, closeSettings, quickCaptureOpen, closeQuickCapture, envManagerOpen } from '$lib/stores/layout';
  import { newWorkspacePromptOpen } from '$lib/stores/workspace';
  import { pendingPermissionRequest } from '$lib/stores/permissions';
  import { onMount } from 'svelte';
  import { loadThemes } from '$lib/stores/theme';
  import { initializeWorkspaces, saveProjectState, activeProjectId, activeProject } from '$lib/stores/workspace';
  import { openDailyNote } from '$lib/stores/dailyNote';
  import { get } from 'svelte/store';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { initDefaultCommands } from '$lib/stores/commandpalette';
  import { requestNotificationPermission } from '$lib/stores/notification';
  import { uiZoom, userShortcuts, matchShortcut, type KeyboardShortcut, onboardingCompleted, reconcileOnboardingFlag, backgroundImageEnabled, interfaceTransparency, backgroundImageOpacity, backgroundImageBlur, closeBehavior } from '$lib/stores/settings';
  import { initBackground, applyBackgroundImage, applyInterfaceFrost, applyBackgroundAppearance } from '$lib/stores/background';
  import { initNavigationHistory } from '$lib/stores/navigation';
  import { initApiKeyCache } from '$lib/services/ai-keychain';
  import { isTauriRuntime } from '$lib/utils/tauri';

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
    if (isTauriRuntime()) {
      initApiKeyCache();
      loadThemes();
      initBackground();
      // Recover the onboarding flag from the durable backend store if WebView
      // localStorage lost it on a previous abrupt shutdown.
      reconcileOnboardingFlag();
    }
    initializeWorkspaces();
    initDefaultCommands();
    if (isTauriRuntime()) {
      requestNotificationPermission();
    }
    initNavigationHistory();

    // Live-apply the global interface transparency as the slider moves, and the
    // image layer when toggled. Skip the initial synchronous fire — startup is
    // handled by initBackground().
    let bgFirstRun = true;
    const unsubFrost = interfaceTransparency.subscribe((v) => {
      if (bgFirstRun) { bgFirstRun = false; return; }
      applyInterfaceFrost(v);
    });
    const unsubBgEnabled = backgroundImageEnabled.subscribe(() => applyBackgroundImage());
    // Live-apply background image opacity/blur as their sliders move (initial
    // values are applied by initBackground()).
    let bgAppearanceRuns = 0;
    const applyAppearanceLive = () => {
      // Skip the two initial synchronous fires (one per store subscription).
      if (bgAppearanceRuns < 2) { bgAppearanceRuns++; return; }
      applyBackgroundAppearance(get(backgroundImageOpacity), get(backgroundImageBlur));
    };
    const unsubBgOpacity = backgroundImageOpacity.subscribe(applyAppearanceLive);
    const unsubBgBlur = backgroundImageBlur.subscribe(applyAppearanceLive);

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
    if (isTauriRuntime()) {
      const win = getCurrentWindow();
      win.onCloseRequested(async (event) => {
        const projectId = get(activeProjectId);
        if (projectId) saveProjectState(projectId);

        if (get(closeBehavior) === 'minimize') {
          event.preventDefault();
          await win.minimize();
        }
      }).then((u) => { unlistenClose = u; });
    }

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
      unsubFrost();
      unsubBgEnabled();
      unsubBgOpacity();
      unsubBgBlur();
    };
  });
</script>

<BackgroundMedia />
<AppShell />

<CommandPalette />
<Toasts />

{#if $settingsOpen}
  {#await import('$lib/components/shared/SettingsModal.svelte') then mod}
    {@const SettingsModal = mod.default}
    <SettingsModal onclose={closeSettings} />
  {/await}
{/if}

{#if $quickCaptureOpen}
  {#await import('$lib/components/shared/QuickCaptureModal.svelte') then mod}
    {@const QuickCaptureModal = mod.default}
    <QuickCaptureModal onclose={closeQuickCapture} />
  {/await}
{/if}

{#if $envManagerOpen}
  {#await import('$lib/components/shared/EnvManager.svelte') then mod}
    {@const EnvManager = mod.default}
    <EnvManager />
  {/await}
{/if}

{#if $newWorkspacePromptOpen}
  {#await import('$lib/components/shared/WorkspaceNameModal.svelte') then mod}
    {@const WorkspaceNameModal = mod.default}
    <WorkspaceNameModal />
  {/await}
{/if}

{#if !$onboardingCompleted}
  {#await import('$lib/components/workspace/OnboardingWalkthrough.svelte') then mod}
    {@const OnboardingWalkthrough = mod.default}
    <OnboardingWalkthrough />
  {/await}
{/if}

{#if $pendingPermissionRequest}
  {#await import('$lib/components/shared/MicrophonePermissionDialog.svelte') then mod}
    {@const MicrophonePermissionDialog = mod.default}
    <MicrophonePermissionDialog />
  {/await}
{/if}
