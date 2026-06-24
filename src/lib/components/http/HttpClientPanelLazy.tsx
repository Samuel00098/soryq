import { lazy, Suspense } from 'react';

// Lazy boundary for HttpClientPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready
// (matching the original `{#if Panel}` gate) so call sites stay unchanged.
const HttpClientPanel = lazy(() => import('./HttpClientPanel.tsx'));

export default function HttpClientPanelLazy() {
  return (
    <Suspense fallback={null}>
      <HttpClientPanel />
    </Suspense>
  );
}
