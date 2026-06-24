import { lazy, Suspense } from 'react';

// Lazy boundary for TasksPanel — the React lazy boundary for
// dynamic import. Loaded on demand; renders nothing until ready
// (matching the original `{#if Panel}` gate) so call sites stay unchanged.
const TasksPanel = lazy(() => import('./TasksPanel.tsx'));

export default function TasksPanelLazy() {
  return (
    <Suspense fallback={null}>
      <TasksPanel />
    </Suspense>
  );
}
