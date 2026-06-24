import { create } from 'zustand';

export interface Command {
  id: string;
  name: string;
  category: string;
  shortcut?: string;
  action: () => void | Promise<void>;
}

interface CommandPaletteState {
  isOpen: boolean;
  search: string;
  commands: Command[];
  __set: (key: string, value: unknown) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  search: '',
  commands: [],
  __set: (key, value) => set({ [key]: value } as any),
}));
