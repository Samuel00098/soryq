import { writable } from 'svelte/store';

const STORAGE_KEY = 'devdock_notes';

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const notes = writable<Record<string, string>>(loadNotes());

let _notesFlushTimer: ReturnType<typeof setTimeout> | null = null;
notes.subscribe((val) => {
  if (_notesFlushTimer !== null) return;
  _notesFlushTimer = setTimeout(() => {
    _notesFlushTimer = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(val)); } catch {}
  }, 500);
});

export function getNoteForProject(projectId: string): string {
  let val = '';
  const unsub = notes.subscribe((n) => { val = n[projectId] ?? ''; });
  unsub();
  return val;
}

export function setNoteForProject(projectId: string, content: string) {
  notes.update((n) => ({ ...n, [projectId]: content }));
}

// Floating scratchpad visibility — persisted across sessions
export const floatingNoteOpen = writable<boolean>(
  typeof window !== 'undefined' ? localStorage.getItem('devdock_floating_note_open') === 'true' : false
);
floatingNoteOpen.subscribe((v) => {
  if (typeof window !== 'undefined') localStorage.setItem('devdock_floating_note_open', String(v));
});

export function toggleFloatingNote() { floatingNoteOpen.update((v) => !v); }
export function openFloatingNote() { floatingNoteOpen.set(true); }
export function closeFloatingNote() { floatingNoteOpen.set(false); }
