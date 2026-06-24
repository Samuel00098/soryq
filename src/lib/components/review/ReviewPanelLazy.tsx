import { lazy, Suspense } from 'react';

// Lazy boundary for ReviewPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready
// (matching the original `{#if Panel}` gate) so call sites stay unchanged.
const ReviewPanel = lazy(() => import('./ReviewPanel.tsx'));

export default function ReviewPanelLazy() {
  return (
    <Suspense fallback={null}>
      <ReviewPanel />
    </Suspense>
  );
}
