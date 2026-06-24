import { create } from 'zustand';

interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  __set: (key: string, value: unknown) => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
  canGoBack: false,
  canGoForward: false,
  __set: (key, value) => set({ [key]: value } as any),
}));
