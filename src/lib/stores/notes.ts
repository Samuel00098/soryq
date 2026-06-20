import { writable } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';
import { loadBoolean } from '$lib/utils/storage';

const FLOATING_NOTE_OPEN_KEY = 'soryq_floating_note_open';

// In-memory cache — keeps NotesPanel and FloatingNotepad in sync
export const notes = writable<Record<string, string>>({});

export function getScratchPath(rootPath: string): string {
  return `${rootPath}/.soryq/scratch.md`;
}

export async function loadScratchNote(project: { id: string; root_path: string }): Promise<string> {
  const path = getScratchPath(project.root_path);
  let content = '';
  try {
    content = await invoke<string>('fs_read_file', { path });
  } catch {
    // file doesn't exist yet — empty scratch is fine
  }
  notes.update(n => ({ ...n, [project.id]: content }));
  return content;
}

export async function saveScratchNote(
  project: { id: string; root_path: string },
  content: string
): Promise<void> {
  const dir = `${project.root_path}/.soryq`;
  const path = getScratchPath(project.root_path);
  try {
    try { await invoke('fs_create_dir', { path: dir }); } catch { /* already exists */ }
    await invoke('fs_write_file', { path, content });
  } catch (err) {
    console.error('Failed to save scratch note:', err);
    throw err;
  }
  notes.update(n => ({ ...n, [project.id]: content }));
}

export function getNoteForProject(projectId: string): string {
  let val = '';
  const unsub = notes.subscribe(n => { val = n[projectId] ?? ''; });
  unsub();
  return val;
}

// Syncs in-memory store only — used for real-time cross-component updates
export function setNoteForProject(projectId: string, content: string) {
  notes.update(n => ({ ...n, [projectId]: content }));
}

export const floatingNoteOpen = writable<boolean>(
  loadBoolean(FLOATING_NOTE_OPEN_KEY, false)
);

floatingNoteOpen.subscribe(v => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(FLOATING_NOTE_OPEN_KEY, String(v));
  }
});

export function toggleFloatingNote() { floatingNoteOpen.update(v => !v); }
export function openFloatingNote() { floatingNoteOpen.set(true); }
export function closeFloatingNote() { floatingNoteOpen.set(false); }
