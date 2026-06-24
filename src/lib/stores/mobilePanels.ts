import { writable } from '$lib/stores/storeCompat';

// Module-level state for the Android/iOS device panels. Living at module scope
// (not in the components) keeps the selected device, the mirroring on/off state,
// and the last frame alive across ambient-mode switches — when the layout moves
// a panel between Focus / Split / Canvas and React remounts it, the mirror picks
// up exactly where it was instead of resetting.

export type MobilePanelState = {
  /** Selected device serial (Android) / simulator UDID (iOS). */
  selected: string | null;
  /** Whether the screen mirror is actively streaming. */
  mirroring: boolean;
  /** Last captured frame (data URL), shown immediately on remount. */
  frame: string | null;
};

function initial(): MobilePanelState {
  return { selected: null, mirroring: false, frame: null };
}

export const androidPanelState = writable<MobilePanelState>(initial());
export const iosPanelState = writable<MobilePanelState>(initial());

export function patchAndroid(patch: Partial<MobilePanelState>) {
  androidPanelState.update((s) => ({ ...s, ...patch }));
}

export function patchIos(patch: Partial<MobilePanelState>) {
  iosPanelState.update((s) => ({ ...s, ...patch }));
}
