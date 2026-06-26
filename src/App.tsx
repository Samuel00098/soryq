import { useEffect, lazy, Suspense } from 'react';
import { get } from '$lib/stores/storeCompat';
import { getCurrentWindow } from '@tauri-apps/api/window';
import AppShell from '$lib/components/layout/AppShell.tsx';
import BackgroundMedia from '$lib/components/shared/BackgroundMedia.tsx';
import CommandPalette from '$lib/components/shared/CommandPalette.tsx';
import Toasts from '$lib/components/shared/Toasts.tsx';
import QuickCaptureModal from '$lib/components/shared/QuickCaptureModal.tsx';
import WorkspaceNameModal from '$lib/components/shared/WorkspaceNameModal.tsx';
import MicrophonePermissionDialog from '$lib/components/shared/MicrophonePermissionDialog.tsx';
import SettingsModal from '$lib/components/shared/SettingsModal.tsx';
import { useStore } from '$lib/react/useStore';
import {
  settingsOpen,
  closeSettings,
  quickCaptureOpen,
  closeQuickCapture,
} from '$lib/stores/layout';
import {
  newWorkspacePromptOpen,
  initializeWorkspaces,
  saveProjectState,
  activeProjectId,
} from '$lib/stores/workspace';
import { usePermissionsStore } from '$lib/stores/zustand/permissions';
import { loadThemes } from '$lib/stores/theme';
import { initDefaultCommands } from '$lib/stores/commandpalette';
import { requestNotificationPermission } from '$lib/stores/notification';
import {
  uiZoom,
  userShortcuts,
  matchShortcut,
  type KeyboardShortcut,
  onboardingCompleted,
  reconcileOnboardingFlag,
  backgroundImageEnabled,
  interfaceTransparency,
  backgroundImageOpacity,
  backgroundImageBlur,
  closeBehavior,
} from '$lib/stores/settings';
import {
  initBackground,
  applyBackgroundImage,
  applyInterfaceFrost,
  applyBackgroundAppearance,
} from '$lib/stores/background';
import { initNavigationHistory } from '$lib/stores/navigation';
import { initApiKeyCache } from '$lib/services/ai-keychain';
import { isTauriRuntime } from '$lib/utils/tauri';

const ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200] as const;

const OnboardingWalkthrough = lazy(() => import('$lib/components/workspace/OnboardingWalkthrough.tsx'));

function zoomIn() {
  uiZoom.update((z) => {
    const next = ZOOM_LEVELS.find((level) => level > z);
    return next ?? z;
  });
}

function zoomOut() {
  uiZoom.update((z) => {
    const next = [...ZOOM_LEVELS].reverse().find((level) => level < z);
    return next ?? z;
  });
}

export default function App() {
  const isSettingsOpen = useStore(settingsOpen);
  const isQuickCaptureOpen = useStore(quickCaptureOpen);
  const isNewWorkspacePromptOpen = useStore(newWorkspacePromptOpen);
  const permissionRequest = usePermissionsStore((s) => s.pendingPermissionRequest);
  const hasCompletedOnboarding = useStore(onboardingCompleted);

  useEffect(() => {
    if (isTauriRuntime()) {
      initApiKeyCache();
      loadThemes();
      initBackground();
      reconcileOnboardingFlag();
    }

    initializeWorkspaces();
    initDefaultCommands();
    if (isTauriRuntime()) {
      requestNotificationPermission();
    }
    initNavigationHistory();

    const unsubFrost = interfaceTransparency.subscribe((value) => {
      applyInterfaceFrost(value);
    });

    const unsubBgEnabled = backgroundImageEnabled.subscribe(() => applyBackgroundImage());

    let bgAppearanceRuns = 0;
    const applyAppearanceLive = () => {
      if (bgAppearanceRuns < 2) {
        bgAppearanceRuns += 1;
        return;
      }
      applyBackgroundAppearance(get(backgroundImageOpacity), get(backgroundImageBlur));
    };
    const unsubBgOpacity = backgroundImageOpacity.subscribe(applyAppearanceLive);
    const unsubBgBlur = backgroundImageBlur.subscribe(applyAppearanceLive);

    let unlistenClose: (() => void) | undefined;
    if (isTauriRuntime()) {
      const win = getCurrentWindow();
      win
        .onCloseRequested(async (event) => {
          const projectId = get(activeProjectId);
          if (projectId) saveProjectState(projectId);

          if (get(closeBehavior) === 'minimize') {
            event.preventDefault();
            await win.minimize();
          }
        })
        .then((unlisten) => {
          unlistenClose = unlisten;
        });
    }

    const handleScroll = () => {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    const unsubscribeZoom = uiZoom.subscribe((zoom) => {
      document.documentElement.style.setProperty('--ui-zoom-percent', `${zoom}`);
    });

    let activeShortcuts: KeyboardShortcut[] = [];
    const unsubscribeShortcuts = userShortcuts.subscribe((value) => {
      activeShortcuts = value || [];
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const zoomInShortcut = activeShortcuts.find((shortcut) => shortcut?.id === 'zoomIn');
      const zoomOutShortcut = activeShortcuts.find((shortcut) => shortcut?.id === 'zoomOut');
      const resetZoomShortcut = activeShortcuts.find((shortcut) => shortcut?.id === 'resetZoom');

      if (zoomInShortcut && matchShortcut(event, zoomInShortcut.keys)) {
        event.preventDefault();
        zoomIn();
      } else if (zoomOutShortcut && matchShortcut(event, zoomOutShortcut.keys)) {
        event.preventDefault();
        zoomOut();
      } else if (resetZoomShortcut && matchShortcut(event, resetZoomShortcut.keys)) {
        event.preventDefault();
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
      unsubFrost();
      unsubBgEnabled();
      unsubBgOpacity();
      unsubBgBlur();
    };
  }, []);

  return (
    <>
      <BackgroundMedia />
      <AppShell />

      <CommandPalette />
      <Toasts />

      {isSettingsOpen && <SettingsModal onclose={closeSettings} />}

      {isQuickCaptureOpen && <QuickCaptureModal onclose={closeQuickCapture} />}

      {isNewWorkspacePromptOpen && <WorkspaceNameModal />}

      {!hasCompletedOnboarding && (
        <Suspense fallback={null}>
          <OnboardingWalkthrough />
        </Suspense>
      )}

      {permissionRequest && <MicrophonePermissionDialog />}
    </>
  );
}
