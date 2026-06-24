import { lazy, Suspense } from 'react';

// Lazy boundary for AndroidPanel — code-split so the adb-mirroring panel only
// loads on first open. Renders nothing until ready.
const AndroidPanel = lazy(() => import('./AndroidPanel.tsx'));

export default function AndroidPanelLazy() {
  return (
    <Suspense fallback={null}>
      <AndroidPanel />
    </Suspense>
  );
}
