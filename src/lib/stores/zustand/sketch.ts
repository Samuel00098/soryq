import { create } from 'zustand';

const STORAGE_KEY = 'soryq_sketch_open_projects';

type SketchOpenByProject = Record<string, boolean>;

function loadPersisted(): SketchOpenByProject {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as SketchOpenByProject;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function persist(value: SketchOpenByProject) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch {}
}

interface SketchState {
  sketchCanvasOpenByProject: SketchOpenByProject;
  __set: (key: string, value: unknown) => void;
}

export const useSketchStore = create<SketchState>((set) => ({
  sketchCanvasOpenByProject: loadPersisted(),
  __set: (key, value) => {
    set({ [key]: value } as any);
    if (key === 'sketchCanvasOpenByProject') persist(value as SketchOpenByProject);
  },
}));
