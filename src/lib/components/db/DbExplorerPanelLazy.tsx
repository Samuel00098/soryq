import { lazy, Suspense } from 'react';

// Lazy boundary for DbExplorerPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready
// (matching the original `{#if Panel}` gate) so call sites stay unchanged.
const DbExplorerPanel = lazy(() => import('./DbExplorerPanel.tsx'));

export default function DbExplorerPanelLazy() {
  return (
    <Suspense fallback={null}>
      <DbExplorerPanel />
    </Suspense>
  );
}
