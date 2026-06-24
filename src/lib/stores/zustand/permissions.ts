import { create } from 'zustand';

export type PermissionKind = 'microphone';

export type PermissionRequest = {
  kind: PermissionKind;
  resolve: (granted: boolean) => void;
};

interface PermissionsState {
  pendingPermissionRequest: PermissionRequest | null;
  requestPermission: (kind: PermissionKind) => Promise<boolean>;
  resolvePermission: (granted: boolean) => void;
}

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  pendingPermissionRequest: null,

  requestPermission: (kind: PermissionKind) => {
    return new Promise<boolean>((resolve) => {
      const existing = get().pendingPermissionRequest;
      existing?.resolve(false);
      set({ pendingPermissionRequest: { kind, resolve } });
    });
  },

  resolvePermission: (granted: boolean) => {
    const req = get().pendingPermissionRequest;
    if (req) req.resolve(granted);
    set({ pendingPermissionRequest: null });
  },
}));
