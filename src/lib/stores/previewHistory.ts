import { writable, get } from 'svelte/store';
import { loadJson } from '$lib/utils/storage';

/**
 * Persistent browsing state for the web preview, kept in localStorage so the
 * panel can recall where the user was after a reload or app restart:
 *
 *  - `browsingHistory` — a flat, most-recent-first log of visited pages, used to
 *    power the "history" dropdown that lets the user jump back to any prior page
 *    (beyond a single tab's linear back/forward stack).
 *  - scroll positions — the last scroll offset per URL, restored after the page
 *    (re)loads in the cross-origin preview iframe. These are NOT a Svelte store:
 *    scroll fires constantly, so keeping them as plain module state avoids
 *    triggering reactive re-renders on every wheel tick. They're flushed to
 *    localStorage on a short debounce instead.
 */

export type HistoryEntry = {
  url: string;
  title: string;
  ts: number;
};

export type ScrollPos = { x: number; y: number };

const HISTORY_KEY = 'soryq_preview_history';
const SCROLL_KEY = 'soryq_preview_scroll';
const HISTORY_LIMIT = 200;
const SCROLL_LIMIT = 400;

function isRecordableUrl(url: string): boolean {
  const trimmed = (url || '').trim();
  if (!trimmed) return false;
  if (trimmed === 'about:blank') return false;
  if (trimmed === '/') return false;
  return true;
}

// ── Browsing history ──────────────────────────────────────────────────────
export const browsingHistory = writable<HistoryEntry[]>(
  loadJson<HistoryEntry[]>(HISTORY_KEY, [])
);

browsingHistory.subscribe((entries) => {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {}
});

/**
 * Record a visit. Collapses an immediately repeated URL into a single entry
 * (just refreshing its timestamp/title) so reloads and back/forward churn don't
 * flood the list, and caps the log at HISTORY_LIMIT.
 */
export function recordHistoryVisit(url: string, title: string) {
  if (!isRecordableUrl(url)) return;
  browsingHistory.update((entries) => {
    const cleanTitle = (title || '').trim() || url;
    if (entries.length && entries[0].url === url) {
      const [, ...rest] = entries;
      return [{ url, title: cleanTitle, ts: Date.now() }, ...rest];
    }
    return [{ url, title: cleanTitle, ts: Date.now() }, ...entries].slice(0, HISTORY_LIMIT);
  });
}

export function removeHistoryEntry(url: string) {
  browsingHistory.update((entries) => entries.filter((entry) => entry.url !== url));
}

export function clearBrowsingHistory() {
  browsingHistory.set([]);
}

// ── Per-URL scroll position ───────────────────────────────────────────────
const scrollPositions: Record<string, ScrollPos> = loadJson<Record<string, ScrollPos>>(
  SCROLL_KEY,
  {}
);

let scrollSaveTimer: ReturnType<typeof setTimeout> | null = null;
function persistScrollSoon() {
  if (scrollSaveTimer !== null) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    scrollSaveTimer = null;
    try {
      // Trim oldest-inserted keys if the map grows unbounded.
      const keys = Object.keys(scrollPositions);
      if (keys.length > SCROLL_LIMIT) {
        for (const key of keys.slice(0, keys.length - SCROLL_LIMIT)) {
          delete scrollPositions[key];
        }
      }
      localStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions));
    } catch {}
  }, 400);
}

export function saveScrollPosition(url: string, pos: ScrollPos) {
  if (!isRecordableUrl(url)) return;
  const x = Number(pos.x) || 0;
  const y = Number(pos.y) || 0;
  // Don't bother storing a fresh "top of page" — it just adds noise and would
  // override a meaningful position if the page briefly reports 0 during reflow.
  if (x === 0 && y === 0 && !scrollPositions[url]) return;
  scrollPositions[url] = { x, y };
  persistScrollSoon();
}

export function getScrollPosition(url: string): ScrollPos | null {
  return scrollPositions[url] ?? null;
}
