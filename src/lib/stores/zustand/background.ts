import { create } from 'zustand';

export type BackgroundMediaKind = 'image' | 'video';

export interface BackgroundMedia {
  url: string;
  kind: BackgroundMediaKind;
}

interface BackgroundState {
  backgroundImagePresent: boolean;
  backgroundMedia: BackgroundMedia | null;
  __set: (key: string, value: unknown) => void;
}

export const useBackgroundStore = create<BackgroundState>((set) => ({
  backgroundImagePresent: false,
  backgroundMedia: null,
  __set: (key, value) => set({ [key]: value } as any),
}));
