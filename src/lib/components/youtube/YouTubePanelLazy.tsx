import { lazy, Suspense } from 'react';

// Lazy boundary for YouTubePanel — code-split so the panel (and its iframe
// machinery) only loads when first opened. Renders nothing until ready.
const YouTubePanel = lazy(() => import('./YouTubePanel.tsx'));

export default function YouTubePanelLazy() {
  return (
    <Suspense fallback={null}>
      <YouTubePanel />
    </Suspense>
  );
}
