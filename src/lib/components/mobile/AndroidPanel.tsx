import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { get } from '$lib/stores/storeCompat';
import { showToast } from '$lib/stores/notification';
import { useStore } from '$lib/react/useStore';
import { androidPanelState, patchAndroid } from '$lib/stores/mobilePanels';
import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.tsx';
import './MobilePanel.css';

type AndroidDevice = { serial: string; state: string; label: string };
type AndroidTools = { adb: boolean; emulator: boolean };
type AndroidFrame = { image: string; width: number; height: number };

// Minimum gap between frames. The capture itself (adb screencap) is the real
// bottleneck, so we run frames back-to-back and only enforce this small floor to
// avoid hammering adb when a capture returns very fast.
const MIN_FRAME_GAP_MS = 16;
// Pointer travel (in displayed px) above which a press becomes a swipe, not a tap.
const SWIPE_THRESHOLD = 12;

export default function AndroidPanel() {
  // selected / mirroring / frame live in a module store so they survive the
  // remount that happens when the panel moves between ambient modes.
  const panel = useStore(androidPanelState);
  const { selected, mirroring, frame } = panel;
  const setSelected = (v: string | null) => patchAndroid({ selected: v });
  const setFrame = (v: string | null) => patchAndroid({ frame: v });
  const setMirroring = (v: boolean) => patchAndroid({ mirroring: v });

  const [tools, setTools] = useState<AndroidTools | null>(null);
  const [devices, setDevices] = useState<AndroidDevice[]>([]);
  const [avds, setAvds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const pressRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // Real device resolution (the streamed frame is downscaled), used to map taps.
  const deviceSizeRef = useRef<{ w: number; h: number } | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const t = await invoke<AndroidTools>('android_check');
      setTools(t);
      if (t.adb) {
        const devs = await invoke<AndroidDevice[]>('android_list_devices');
        setDevices(devs);
        // Auto-select the first online device if nothing is selected yet.
        if (!get(androidPanelState).selected) {
          const first = devs.find((d) => d.state === 'device')?.serial ?? null;
          if (first) patchAndroid({ selected: first });
        }
      }
      if (t.emulator) {
        try {
          setAvds(await invoke<string[]>('android_list_avds'));
        } catch {
          setAvds([]);
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Frame pump: a continuous loop that captures the next frame as soon as the
  // previous one arrives (no fixed interval), so the mirror runs as smoothly as
  // adb allows instead of stalling on a timer. A tiny floor keeps it from
  // hammering adb when captures come back fast.
  useEffect(() => {
    if (!mirroring || !selected) return;
    let cancelled = false;
    let timer: number | null = null;

    const loop = async () => {
      if (cancelled) return;
      const started = performance.now();
      try {
        const f = await invoke<AndroidFrame>('android_screencap', { serial: selected });
        if (cancelled) return;
        deviceSizeRef.current = { w: f.width, h: f.height };
        setFrame(`data:image/jpeg;base64,${f.image}`);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setMirroring(false);
        return;
      }
      const elapsed = performance.now() - started;
      timer = window.setTimeout(loop, Math.max(0, MIN_FRAME_GAP_MS - elapsed));
    };

    void loop();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [mirroring, selected]);

  /** Map a pointer event on the displayed image to device pixel coordinates. */
  function toDeviceCoords(e: React.PointerEvent<HTMLImageElement>): { x: number; y: number } | null {
    const img = imgRef.current;
    const dev = deviceSizeRef.current;
    if (!img || !dev) return null;
    const rect = img.getBoundingClientRect();
    // The image uses object-fit: contain. Map against the REAL device size (not
    // the downscaled frame) so injected taps land at true device coordinates.
    const scale = Math.min(rect.width / dev.w, rect.height / dev.h);
    const drawW = dev.w * scale;
    const drawH = dev.h * scale;
    const offX = (rect.width - drawW) / 2;
    const offY = (rect.height - drawH) / 2;
    const px = e.clientX - rect.left - offX;
    const py = e.clientY - rect.top - offY;
    if (px < 0 || py < 0 || px > drawW || py > drawH) return null;
    return { x: Math.round(px / scale), y: Math.round(py / scale) };
  }

  function onPointerDown(e: React.PointerEvent<HTMLImageElement>) {
    const c = toDeviceCoords(e);
    if (!c) return;
    pressRef.current = { x: c.x, y: c.y, t: Date.now() };
  }

  async function onPointerUp(e: React.PointerEvent<HTMLImageElement>) {
    const start = pressRef.current;
    pressRef.current = null;
    if (!start || !selected) return;
    const end = toDeviceCoords(e);
    if (!end) return;
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    try {
      if (dist > SWIPE_THRESHOLD) {
        const duration = Math.max(80, Math.min(800, Date.now() - start.t));
        await invoke('android_swipe', {
          serial: selected,
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          durationMs: duration,
        });
      } else {
        await invoke('android_tap', { serial: selected, x: start.x, y: start.y });
      }
    } catch (err) {
      showToast(`Input failed: ${err}`, 'error');
    }
  }

  async function sendKey(keycode: number) {
    if (!selected) return;
    try {
      await invoke('android_key', { serial: selected, keycode });
    } catch (err) {
      showToast(`Key failed: ${err}`, 'error');
    }
  }

  async function launchAvd(name: string) {
    setBusy(true);
    try {
      await invoke('android_launch_avd', { name });
      showToast(`Launching ${name}… it will appear once booted.`, 'info');
      // Give the emulator a moment, then refresh the device list.
      window.setTimeout(() => void refresh(), 4000);
    } catch (err) {
      showToast(`Launch failed: ${err}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const selectedDevice = devices.find((d) => d.serial === selected) ?? null;

  // ---- Tool not installed ----
  if (tools && !tools.adb) {
    return (
      <section className="android-panel mobile-panel">
        <div className="mobile-gate">
          <h2>Android tools not found</h2>
          <p>
            The Android panel mirrors a device or emulator over <code>adb</code>. Soryq checks
            <code>ANDROID_HOME</code> and the default Android Studio SDK location automatically — if
            you have Android Studio, open its <strong>SDK Manager</strong> and install
            <strong>Android SDK Platform-Tools</strong> (and the <strong>Emulator</strong> for AVDs),
            then re-check. You can also put <code>adb</code> on your PATH.
          </p>
          <button className="mobile-btn" onClick={() => void refresh()} disabled={busy}>
            Re-check
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="android-panel mobile-panel">
      <header className="mobile-toolbar">
        <div className="mobile-select-wrap">
          <Dropdown
            options={devices.map<DropdownOption>((d) => ({
              value: d.serial,
              label: d.label,
              sublabel: d.state !== 'device' ? d.state : undefined,
            }))}
            value={selected ?? ''}
            onChange={(v) => {
              setSelected(v || null);
              setFrame(null);
            }}
            placeholder="Select a device…"
            ariaLabel="Android device"
          />
        </div>
        <button
          className={`mobile-btn${mirroring ? ' primary' : ''}`}
          onClick={() => setMirroring(!mirroring)}
          disabled={!selected || selectedDevice?.state !== 'device'}
        >
          {mirroring ? 'Stop' : 'Mirror'}
        </button>
        <button className="mobile-icon-btn" title="Refresh devices" onClick={() => void refresh()} disabled={busy}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
      </header>

      <div className="mobile-stage">
        <div className="mobile-phone">
          <span className="mobile-phone-island" />
          <div className="mobile-phone-screen">
            {mirroring && frame ? (
              <img
                ref={imgRef}
                className="mobile-screen"
                src={frame}
                alt="Android screen"
                draggable={false}
                onPointerDown={onPointerDown}
                onPointerUp={onPointerUp}
              />
            ) : (
              <div className="mobile-placeholder">
                {error ? (
                  <p className="mobile-error">{error}</p>
                ) : selected ? (
                  <p>Press <strong>Mirror</strong> to start streaming the screen.</p>
                ) : devices.length ? (
                  <p>Select a device above to begin.</p>
                ) : (
                  <p>No devices connected. Plug in a device with USB debugging, or launch an emulator below.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {mirroring && (
        <div className="mobile-navbar">
          <button className="mobile-icon-btn" title="Back" onClick={() => void sendKey(4)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button className="mobile-icon-btn" title="Home" onClick={() => void sendKey(3)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /></svg>
          </button>
          <button className="mobile-icon-btn" title="Recent apps" onClick={() => void sendKey(187)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="5" width="14" height="14" rx="2" /></svg>
          </button>
        </div>
      )}

      {avds.length > 0 && (
        <div className="mobile-avds">
          <div className="mobile-avds-title">Emulators</div>
          <div className="mobile-avds-list scrollable">
            {avds.map((name) => (
              <div key={name} className="mobile-avd-row">
                <span className="mobile-avd-name" title={name}>{name}</span>
                <button className="mobile-btn small" onClick={() => void launchAvd(name)} disabled={busy}>
                  Launch
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
