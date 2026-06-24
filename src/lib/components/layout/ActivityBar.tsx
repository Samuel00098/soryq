import { useLayoutStore, type ActiveView } from '$lib/stores/zustand/layout';
import './ActivityBar.css';

type NavItem = { id: ActiveView | 'explorer'; label: string; bottom?: boolean };

const topItems: NavItem[] = [
  { id: 'explorer', label: 'Explorer' },
  { id: 'terminal', label: 'Terminal' },
];

const bottomItems: NavItem[] = [{ id: 'settings', label: 'Settings', bottom: true }];

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

export default function ActivityBar() {
  const layoutState = useLayoutStore();

  function handleClick(item: NavItem) {
    if (item.id === 'explorer') {
      useLayoutStore.getState().toggleSidebar();
      return;
    }
    if (item.id === 'settings') {
      useLayoutStore.getState().openSettings();
      return;
    }
    useLayoutStore.getState().setActiveView(item.id as ActiveView);
  }

  function isActive(item: NavItem): boolean {
    if (item.id === 'explorer') return layoutState.sidebarVisible;
    if (item.id === 'settings') return false;
    return layoutState.activeView === item.id;
  }

  return (
    <nav className="activitybar" aria-label="Main navigation">
      <div className="ab-top">
        {topItems.map((item) => (
          <button
            key={item.id}
            className={`ab-btn${isActive(item) ? ' ab-active' : ''}`}
            onClick={() => handleClick(item)}
            aria-label={item.label}
            title={item.label}
          >
            {item.id === 'explorer' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                <polyline points="13,2 13,9 20,9" />
              </svg>
            )}
            {item.id === 'terminal' && (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <rect x="2" y="3" width="20" height="18" rx="3" />
                <polyline points="8,9 4,12 8,15" />
                <line x1="12" y1="15" x2="20" y2="15" />
              </svg>
            )}
          </button>
        ))}
      </div>

      <div className="ab-bottom">
        {bottomItems.map((item) => (
          <button
            key={item.id}
            className={`ab-btn${isActive(item) ? ' ab-active' : ''}`}
            onClick={() => handleClick(item)}
            aria-label={item.label}
            title={item.label}
          >
            <SettingsIcon />
          </button>
        ))}
      </div>
    </nav>
  );
}
