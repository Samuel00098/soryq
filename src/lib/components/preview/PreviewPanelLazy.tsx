import { lazy, Suspense } from 'react';

// Lazy boundary for PreviewPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready.
const PreviewPanel = lazy(() => import('./PreviewPanel.tsx'));

export default function PreviewPanelLazy() {
  return (
    <Suspense fallback={null}>
      <PreviewPanel />
    </Suspense>
  );
}
