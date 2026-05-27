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

notes.subscribe((val) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  } catch {}
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
