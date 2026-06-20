import { writable } from '$lib/stores/storeCompat';
import { useProjectSearchStore, type SearchResponse } from './zustand/projectsearch';

export type { SearchMatch, SearchFileResult, SearchResponse } from './zustand/projectsearch';

function syncWritable<T>(key: string, defaultValue: T): import('$lib/stores/storeCompat').Writable<T> {
  const zustandVal = (useProjectSearchStore.getState() as any)[key];
  const initial = zustandVal !== undefined ? zustandVal as T : defaultValue;
  const store = writable<T>(initial);
  void useProjectSearchStore.subscribe((state) => {
    const next = (state as any)[key] as T | undefined;
    if (next !== undefined) store.set(next);
  });
  return {
    subscribe: store.subscribe,
    set(value: T) { (useProjectSearchStore.getState() as any).__set(key, value); },
    update(fn: (val: T) => T) {
      const current = (useProjectSearchStore.getState() as any)[key] as T;
      (useProjectSearchStore.getState() as any).__set(key, fn(current));
    },
  };
}

// Persisted across sidebar-tab switches so re-opening Search keeps your results.
export const searchQuery = syncWritable<string>('searchQuery', '');
export const searchCaseSensitive = syncWritable<boolean>('searchCaseSensitive', false);
export const searchWholeWord = syncWritable<boolean>('searchWholeWord', false);
export const searchUseRegex = syncWritable<boolean>('searchUseRegex', false);
export const searchInclude = syncWritable<string>('searchInclude', '');
export const searchResults = syncWritable<SearchResponse | null>('searchResults', null);
export const searchLoading = syncWritable<boolean>('searchLoading', false);
export const searchError = syncWritable<string | null>('searchError', null);
