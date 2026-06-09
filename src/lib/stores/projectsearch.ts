import { writable } from 'svelte/store';

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  text: string;
}

export interface SearchFileResult {
  path: string;
  rel_path: string;
  matches: SearchMatch[];
}

export interface SearchResponse {
  files: SearchFileResult[];
  total_matches: number;
  truncated: boolean;
}

// Persisted across sidebar-tab switches so re-opening Search keeps your results.
export const searchQuery = writable('');
export const searchCaseSensitive = writable(false);
export const searchWholeWord = writable(false);
export const searchUseRegex = writable(false);
export const searchInclude = writable('');
export const searchResults = writable<SearchResponse | null>(null);
export const searchLoading = writable(false);
export const searchError = writable<string | null>(null);
