import { writable } from '$lib/stores/storeCompat';

// A thin command bus between the orchestrator (and any other controller) and the
// AppShell, which owns the room/ambient layout as local React state. The
// orchestrator writes commands here; AppShell applies them with its existing
// functions (switchAmbientLayout / focusRoom / minimizeRoom / …) and publishes a
// read-only snapshot back so the orchestrator brain can see the current layout.

export type AmbientLayout = 'focus' | 'split' | 'gallery' | 'preview';
export type RoomOp = 'focus' | 'minimize' | 'restore' | 'close';
// Canvas-specific controls: pan/zoom of the freeform board plus the auto-arrange
// grid toggle (lock = grid on / panels fixed, unlock = freeform drag & resize).
export type CanvasOp = 'zoom-in' | 'zoom-out' | 'fit' | 'lock' | 'unlock';

export type LayoutCommand =
  // `nonce` lets an identical command (e.g. "focus terminal" twice) re-fire.
  | { nonce: number; type: 'ambient'; mode: AmbientLayout }
  | { nonce: number; type: 'room'; op: RoomOp; room: string }
  | { nonce: number; type: 'canvas'; op: CanvasOp };

export interface LayoutRoomSnapshot {
  id: string;
  title: string;
  focused: boolean;
  minimized: boolean;
}

export interface LayoutSnapshot {
  ambient: AmbientLayout;
  rooms: LayoutRoomSnapshot[];
}

export const layoutControlCommand = writable<LayoutCommand | null>(null);
export const layoutSnapshot = writable<LayoutSnapshot>({ ambient: 'focus', rooms: [] });

let commandNonce = 0;

/** Ask the workspace to switch ambient arrangement (Focus / Split / Gallery / Preview). */
export function requestAmbientLayout(mode: AmbientLayout): void {
  layoutControlCommand.set({ nonce: ++commandNonce, type: 'ambient', mode });
}

/** Ask the workspace to focus / minimize / restore / close a room by name. */
export function requestRoomControl(op: RoomOp, room: string): void {
  layoutControlCommand.set({ nonce: ++commandNonce, type: 'room', op, room });
}

/** Ask the Canvas board to zoom, fit-to-content, or lock/unlock its grid. */
export function requestCanvasControl(op: CanvasOp): void {
  layoutControlCommand.set({ nonce: ++commandNonce, type: 'canvas', op });
}

/** AppShell publishes its current layout here so controllers can read it. */
export function publishLayoutSnapshot(snapshot: LayoutSnapshot): void {
  layoutSnapshot.set(snapshot);
}
