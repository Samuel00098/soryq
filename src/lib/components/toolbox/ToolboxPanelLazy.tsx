import { lazy, Suspense } from 'react';

// Lazy boundary for ToolboxPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready
// (matching the original `{#if Panel}` gate) so call sites stay unchanged.
const ToolboxPanel = lazy(() => import('./ToolboxPanel.tsx'));

export default function ToolboxPanelLazy() {
  return (
    <Suspense fallback={null}>
      <ToolboxPanel />
    </Suspense>
  );
}
