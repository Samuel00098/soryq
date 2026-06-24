import React from 'react';
import { useStore } from '$lib/react/useStore';
import { layoutSnapshot, requestAmbientLayout, type AmbientLayout } from '$lib/stores/layoutControl';

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const AMBIENT_LAYOUTS: Array<{ id: AmbientLayout; label: string; icon: React.ReactNode }> = [
  {
    id: 'focus',
    label: 'Focus',
    icon: <Icon><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h6v6H9z" /></Icon>,
  },
  {
    id: 'split',
    label: 'Split',
    icon: <Icon><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M12 4v16" /></Icon>,
  },
  {
    id: 'gallery',
    label: 'Canvas',
    icon: <Icon><rect x="2.5" y="4" width="9" height="7" rx="1.5" /><rect x="13.5" y="7" width="8" height="9" rx="1.5" /><rect x="6" y="14" width="7" height="6" rx="1.5" /></Icon>,
  },
  {
    id: 'preview',
    label: 'Preview',
    icon: <Icon><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M10 8.5l4 2.5-4 2.5z" /><path d="M8 20.5h8" /></Icon>,
  },
];

// The workspace ambient-mode switcher (Focus / Split / Canvas / Preview). It
// lives in the TitleBar but the layout state is owned by AppShell, so it talks
// to it through the layoutControl command bus: read the current mode from the
// published snapshot, request a change by dispatching a command.
export default function AmbientSwitcher() {
  const snapshot = useStore(layoutSnapshot);
  const active = snapshot.ambient;

  return (
    <div className="ambient-switcher" role="tablist" aria-label="Ambient layouts">
      {AMBIENT_LAYOUTS.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={`ambient-switch-btn${active === mode.id ? ' active' : ''}`}
          onClick={() => requestAmbientLayout(mode.id)}
          title={`${mode.label} layout`}
          aria-label={`${mode.label} layout`}
          aria-selected={active === mode.id}
          role="tab"
        >
          {mode.icon}
          <span>{mode.label}</span>
        </button>
      ))}
    </div>
  );
}
