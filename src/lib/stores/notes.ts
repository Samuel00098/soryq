import { writable } from 'svelte/store';
import { loadBoolean, loadJson } from '$lib/utils/storage';

const STORAGE_KEY = 'soryq_notes';
const FLOATING_NOTE_OPEN_KEY = 'soryq_floating_note_open';

function loadNotes(): Record<string, string> {
  return loadJson(STORAGE_KEY, {});
}

export const notes = writable<Record<string, string>>(loadNotes());

let notesFlushTimer: ReturnType<typeof setTimeout> | null = null;
notes.subscribe((val) => {
  if (notesFlushTimer !== null) return;
  notesFlushTimer = setTimeout(() => {
    notesFlushTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    } catch {}
  }, 500);
});

export function getNoteForProject(projectId: string): string {
  let val = '';
  const unsub = notes.subscribe((n) => {
    val = n[projectId] ?? '';
  });
  unsub();
  return val;
}

export function setNoteForProject(projectId: string, content: string) {
  notes.update((n) => ({ ...n, [projectId]: content }));
}

export const floatingNoteOpen = writable<boolean>(
  loadBoolean(FLOATING_NOTE_OPEN_KEY, false)
);

floatingNoteOpen.subscribe((v) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(FLOATING_NOTE_OPEN_KEY, String(v));
  }
});

export function toggleFloatingNote() {
  floatingNoteOpen.update((v) => !v);
}

export function openFloatingNote() {
  floatingNoteOpen.set(true);
}

export function closeFloatingNote() {
  floatingNoteOpen.set(false);
}
