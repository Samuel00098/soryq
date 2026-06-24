import { lazy, Suspense } from 'react';

// Lazy boundary for DevPetPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready
// (matching the original `{#if Panel}` gate) so call sites stay unchanged.
const DevPetPanel = lazy(() => import('./DevPetPanel.tsx'));

export default function DevPetPanelLazy() {
  return (
    <Suspense fallback={null}>
      <DevPetPanel />
    </Suspense>
  );
}
