import { derived, get, writable } from 'svelte/store';
import { activeProjectId } from '$lib/stores/workspace';

const STORAGE_KEY = 'soryq_sketch_open_projects';

type SketchOpenByProject = Record<string, boolean>;

function loadOpenProjects(): SketchOpenByProject {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as SketchOpenByProject;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const sketchCanvasOpenByProject = writable<SketchOpenByProject>(loadOpenProjects());

sketchCanvasOpenByProject.subscribe((value) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Best-effort persistence only.
  }
});

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
