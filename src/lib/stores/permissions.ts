import { writable } from '$lib/stores/storeCompat';

export type PermissionKind = 'microphone';

export type PermissionRequest = {
  kind: PermissionKind;
  resolve: (granted: boolean) => void;
};

export const pendingPermissionRequest = writable<PermissionRequest | null>(null);

export function requestPermission(kind: PermissionKind): Promise<boolean> {
  return new Promise((resolve) => {
    pendingPermissionRequest.update((existing) => {
      // Deny any in-flight request so its promise doesn't hang
      existing?.resolve(false);
      return { kind, resolve };
    });
  });
}

export function resolvePermission(granted: boolean) {
  pendingPermissionRequest.update((req) => {
    if (req) req.resolve(granted);
    return null;
  });
}
