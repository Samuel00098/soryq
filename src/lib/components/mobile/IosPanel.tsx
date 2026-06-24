import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { get } from '$lib/stores/storeCompat';
import { showToast } from '$lib/stores/notification';
import { useStore } from '$lib/react/useStore';
import { iosPanelState, patchIos } from '$lib/stores/mobilePanels';
import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.tsx';
import './MobilePanel.css';

type IosSimulator = { udid: string; name: string; state: string; runtime: string };

const FRAME_INTERVAL_MS = 500;

export default function IosPanel() {
  // selected / mirroring / frame persist across ambient-mode remounts.
  const panel = useStore(iosPanelState);
  const { selected, mirroring, frame } = panel;
  const setSelected = (v: string | null) => patchIos({ selected: v });
  const setFrame = (v: string | null) => patchIos({ frame: v });
  const setMirroring = (v: boolean) => patchIos({ mirroring: v });

  const [available, setAvailable] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<string>('');
  const [sims, setSims] = useState<IosSimulator[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [avail, plat] = await Promise.all([
        invoke<boolean>('ios_available'),
        invoke<string>('mobile_platform'),
      ]);
      setAvailable(avail);
      setPlatform(plat);
      if (avail) {
        const list = await invoke<IosSimulator[]>('ios_list_simulators');
        setSims(list);
        if (!get(iosPanelState).selected) {
          const booted = list.find((s) => s.state === 'Booted')?.udid ?? null;
          if (booted) patchIos({ selected: booted });
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

  // View-only mirror: simctl has no input-injection command, so the screenshot
  // stream is for viewing — interaction happens in the Simulator.app window.
  useEffect(() => {
    if (!mirroring || !selected) return;
    let cancelled = false;

    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const b64 = await invoke<string>('ios_screenshot', { udid: selected });
        if (!cancelled) {
          setFrame(`data:image/png;base64,${b64}`);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setMirroring(false);
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const id = window.setInterval(tick, FRAME_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [mirroring, selected]);

  async function boot(udid: string) {
    setBusy(true);
    try {
      await invoke('ios_boot', { udid });
      showToast('Booting simulator…', 'info');
      window.setTimeout(() => void refresh(), 3000);
    } catch (err) {
      showToast(`Boot failed: ${err}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function shutdown(udid: string) {
    setBusy(true);
    try {
      await invoke('ios_shutdown', { udid });
      if (selected === udid) setMirroring(false);
      window.setTimeout(() => void refresh(), 1500);
    } catch (err) {
      showToast(`Shutdown failed: ${err}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---- Gated: not macOS / tooling missing ----
  if (available === false) {
    const onMac = platform === 'macos';
    return (
      <section className="ios-panel mobile-panel">
        <div className="mobile-gate">
          <h2>iOS Simulator unavailable</h2>
          {onMac ? (
            <p>
              You're on macOS, but <code>xcrun simctl</code> wasn't found. Install Xcode and the
              command line tools (<code>xcode-select --install</code>), then re-check.
            </p>
          ) : (
            <p>
              The iOS Simulator only runs on macOS, so this panel is disabled on{' '}
              {platform || 'this platform'}. Open Soryq on a Mac with Xcode installed to boot and
              mirror simulators here.
            </p>
          )}
          <button className="mobile-btn" onClick={() => void refresh()} disabled={busy}>
            Re-check
          </button>
        </div>
      </section>
    );
  }

  const booted = sims.filter((s) => s.state === 'Booted');
  const others = sims.filter((s) => s.state !== 'Booted');

  return (
    <section className="ios-panel mobile-panel">
      <header className="mobile-toolbar">
        <div className="mobile-select-wrap">
          <Dropdown
            options={sims.map<DropdownOption>((s) => ({
              value: s.udid,
              label: s.name,
              sublabel: `${s.runtime}${s.state === 'Booted' ? ' · booted' : ''}`,
            }))}
            value={selected ?? ''}
            onChange={(v) => {
              setSelected(v || null);
              setFrame(null);
            }}
            placeholder="Select a simulator…"
            ariaLabel="iOS simulator"
          />
        </div>
        <button
          className={`mobile-btn${mirroring ? ' primary' : ''}`}
          onClick={() => setMirroring(!mirroring)}
          disabled={!selected || !booted.some((s) => s.udid === selected)}
        >
          {mirroring ? 'Stop' : 'Mirror'}
        </button>
        <button className="mobile-icon-btn" title="Refresh" onClick={() => void refresh()} disabled={busy}>
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
              <img className="mobile-screen view-only" src={frame} alt="iOS simulator screen" draggable={false} />
            ) : (
              <div className="mobile-placeholder">
                {error ? (
                  <p className="mobile-error">{error}</p>
                ) : selected && booted.some((s) => s.udid === selected) ? (
                  <p>Press <strong>Mirror</strong> to view the screen. Interact in the Simulator window.</p>
                ) : selected ? (
                  <p>Boot this simulator below, then press Mirror.</p>
                ) : (
                  <p>Select a simulator to boot and mirror.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mobile-avds">
        <div className="mobile-avds-row-head">
          <span className="mobile-avds-title">Simulators</span>
          <button className="mobile-btn small" onClick={() => void invoke('ios_open_simulator').catch(() => {})}>
            Open Simulator app
          </button>
        </div>
        <div className="mobile-avds-list scrollable">
          {[...booted, ...others].map((s) => (
            <div key={s.udid} className="mobile-avd-row">
              <span className="mobile-avd-name" title={`${s.name} · ${s.runtime}`}>
                {s.state === 'Booted' && <span className="mobile-dot" />}
                {s.name}
              </span>
              {s.state === 'Booted' ? (
                <button className="mobile-btn small" onClick={() => void shutdown(s.udid)} disabled={busy}>
                  Shutdown
                </button>
              ) : (
                <button className="mobile-btn small" onClick={() => void boot(s.udid)} disabled={busy}>
                  Boot
                </button>
              )}
            </div>
          ))}
          {sims.length === 0 && <div className="mobile-avd-empty">No simulators found.</div>}
        </div>
      </div>
    </section>
  );
}
