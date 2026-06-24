import { lazy, Suspense } from 'react';

// Lazy boundary for ContainersPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready
// (matching the original `{#if Panel}` gate) so call sites stay unchanged.
const ContainersPanel = lazy(() => import('./ContainersPanel.tsx'));

export default function ContainersPanelLazy() {
  return (
    <Suspense fallback={null}>
      <ContainersPanel />
    </Suspense>
  );
}
