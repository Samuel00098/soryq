import { derived, get, writable } from '$lib/stores/storeCompat';
import { activeProjectId } from '$lib/stores/workspace';
import { useSketchStore } from './zustand/sketch';

type SketchOpenByProject = Record<string, boolean>;

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useSketchStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useSketchStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useSketchStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useSketchStore.getState() as any)[key] as T;
      (useSketchStore.getState() as any).__set(key, fn(current));
    },
  };
}

const sketchCanvasOpenByProject = syncWritable<SketchOpenByProject>('sketchCanvasOpenByProject', {});

export const sketchCanvasOpen = derived(
  [sketchCanvasOpenByProject, activeProjectId],
  ([$sketchCanvasOpenByProject, $activeProjectId]) =>
    $activeProjectId ? Boolean($sketchCanvasOpenByProject[$activeProjectId]) : false
);

function setProjectSketchCanvasOpen(open: boolean) {
  const projectId = get(activeProjectId);
  if (!projectId) return;

  sketchCanvasOpenByProject.update((state) => ({
    ...state,
    [projectId]: open
  }));
}

export function toggleSketchCanvas() {
  const projectId = get(activeProjectId);
  if (!projectId) return;

  sketchCanvasOpenByProject.update((state) => ({
    ...state,
    [projectId]: !state[projectId]
  }));
}

export function openSketchCanvas() {
  setProjectSketchCanvasOpen(true);
}

export function closeSketchCanvas() {
  setProjectSketchCanvasOpen(false);
}
