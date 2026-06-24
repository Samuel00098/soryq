import { lazy, Suspense } from 'react';

// Lazy boundary for IosPanel — code-split so the simctl-driven panel only loads
// on first open. Renders nothing until ready.
const IosPanel = lazy(() => import('./IosPanel.tsx'));

export default function IosPanelLazy() {
  return (
    <Suspense fallback={null}>
      <IosPanel />
    </Suspense>
  );
}
