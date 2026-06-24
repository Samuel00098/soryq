import { create } from 'zustand';

export interface ThemeColorField {
  key: string;
  label: string;
  category: 'colors' | 'syntax';
}

interface ThemeState {
  activeTheme: any | null;
  availableThemes: any[];
  __set: (key: string, value: unknown) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  activeTheme: null,
  availableThemes: [],
  __set: (key, value) => set({ [key]: value } as any),
}));
