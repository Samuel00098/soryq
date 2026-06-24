import { create } from 'zustand';

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

interface ProjectSearchState {
  searchQuery: string;
  searchCaseSensitive: boolean;
  searchWholeWord: boolean;
  searchUseRegex: boolean;
  searchInclude: string;
  searchResults: SearchResponse | null;
  searchLoading: boolean;
  searchError: string | null;
  __set: (key: string, value: unknown) => void;
}

export const useProjectSearchStore = create<ProjectSearchState>((set) => ({
  searchQuery: '',
  searchCaseSensitive: false,
  searchWholeWord: false,
  searchUseRegex: false,
  searchInclude: '',
  searchResults: null,
  searchLoading: false,
  searchError: null,
  __set: (key, value) => set({ [key]: value } as any),
}));
