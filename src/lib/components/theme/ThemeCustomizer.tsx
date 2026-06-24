import { useEffect, useMemo, useState } from 'react';
import { activeTheme, availableThemes, switchTheme, saveTheme } from '$lib/stores/theme';
import type { Theme } from '$lib/types/theme';
import { useStore } from '$lib/react/useStore';
import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.tsx';
import './ThemeCustomizer.css';

const themeTypeOptions: DropdownOption[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

const uiColorLabels: { key: string; label: string }[] = [
  { key: 'bg-primary', label: 'Primary Background' },
  { key: 'bg-secondary', label: 'Secondary Background' },
  { key: 'bg-tertiary', label: 'Tertiary Background' },
  { key: 'bg-hover', label: 'Hover Background' },
  { key: 'text-primary', label: 'Primary Text' },
  { key: 'text-secondary', label: 'Secondary Text' },
  { key: 'accent', label: 'Accent Color' },
  { key: 'accent-hover', label: 'Accent Hover' },
  { key: 'border', label: 'Border Color' },
  { key: 'editor-bg', label: 'Editor Background' },
  { key: 'statusbar-bg', label: 'Status Bar Background' },
  { key: 'sidebar-bg', label: 'Sidebar Background' },
  { key: 'panel-bg', label: 'Panel Background' },
  { key: 'titlebar-bg', label: 'Title Bar Background' },
  { key: 'titlebar-text', label: 'Title Bar Text' },
  { key: 'titlebar-border', label: 'Title Bar Border' },
];

const syntaxColorLabels: { key: string; label: string }[] = [
  { key: 'keyword', label: 'Keywords (if, let)' },
  { key: 'string', label: 'Strings ("text")' },
  { key: 'comment', label: 'Comments (// text)' },
  { key: 'function', label: 'Functions (fn_name)' },
  { key: 'number', label: 'Numbers (42)' },
  { key: 'type', label: 'Types (struct, enum)' },
  { key: 'variable', label: 'Variables (var)' },
  { key: 'operator', label: 'Operators (+, =)' },
  { key: 'constant', label: 'Constants (MAX)' },
];

export default function ThemeCustomizer() {
  const activeThemeValue = useStore(activeTheme);
  const availableThemesValue = useStore(availableThemes);

  const [currentTheme, setCurrentTheme] = useState<Theme | null>(null);
  const [activeTab, setActiveTab] = useState<'ui' | 'syntax'>('ui');

  const isCustom = currentTheme?.id.startsWith('custom-') ?? false;

  const themeOptions = useMemo<DropdownOption[]>(
    () => availableThemesValue.map((t) => ({ value: t.id, label: t.name })),
    [availableThemesValue],
  );

  // Load active theme details locally on mount and when it changes
  useEffect(() => {
    if (activeThemeValue && (!currentTheme || currentTheme.id !== activeThemeValue.id)) {
      setCurrentTheme(JSON.parse(JSON.stringify(activeThemeValue)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThemeValue]);

  // Apply edits to current DOM elements in real-time
  function handleColorChange(key: string, value: string, isSyntax = false) {
    if (!currentTheme) return;
    if (isSyntax) {
      setCurrentTheme({ ...currentTheme, syntax: { ...currentTheme.syntax, [key]: value } });
      document.documentElement.style.setProperty(`--syntax-${key}`, value);
    } else {
      setCurrentTheme({ ...currentTheme, colors: { ...currentTheme.colors, [key]: value } });
      document.documentElement.style.setProperty(`--${key}`, value);
    }
  }

  function cloneTheme() {
    if (!currentTheme) return null;
    const newName = `${currentTheme.name} Copy`;
    const newId = `custom-${Date.now()}`;
    const cloned: Theme = {
      ...currentTheme,
      id: newId,
      name: newName,
    };
    setCurrentTheme(cloned);
    return cloned;
  }

  async function saveCustomTheme() {
    if (!currentTheme) return;

    // Ensure we are saving as a custom theme
    const themeToSave = !isCustom ? cloneTheme() : currentTheme;
    if (!themeToSave) return;

    await saveTheme(themeToSave);
  }

  function resetTheme() {
    if (activeThemeValue) {
      setCurrentTheme(JSON.parse(JSON.stringify(activeThemeValue)));
      // Re-apply original CSS
      const root = document.documentElement;
      for (const [key, value] of Object.entries(activeThemeValue.colors)) {
        root.style.setProperty(`--${key}`, value);
      }
      for (const [key, value] of Object.entries(activeThemeValue.syntax)) {
        root.style.setProperty(`--syntax-${key}`, value);
      }
    }
  }

  function handleNameChange(name: string) {
    if (!currentTheme) return;
    setCurrentTheme({ ...currentTheme, name });
  }

  function handleTypeChange(type: string) {
    if (!currentTheme) return;
    setCurrentTheme({ ...currentTheme, type: type as Theme['type'] });
  }

  if (!currentTheme) {
    return (
      <div className="theme-customizer">
        <div className="no-theme-placeholder">
          <p>Loading theme configuration...</p>
        </div>
      </div>
    );
  }

  const activeColorLabels = activeTab === 'ui' ? uiColorLabels : syntaxColorLabels;

  return (
    <div className="theme-customizer">
      <div className="customizer-section selection-section">
        <label htmlFor="theme-select" className="section-label">Active Theme</label>
        <Dropdown
          options={themeOptions}
          value={activeThemeValue?.id ?? ''}
          onChange={switchTheme}
          ariaLabel="Active Theme"
        />
      </div>

      <div className="customizer-section details-section">
        <label className="section-label" htmlFor="theme-name-input">Theme Metadata</label>
        <div className="form-group">
          <span className="form-label">Name</span>
          <input
            id="theme-name-input"
            type="text"
            value={currentTheme.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="My Custom Theme"
            className="customizer-input"
            disabled={!isCustom}
          />
        </div>
        <div className="form-group">
          <span className="form-label">Type</span>
          <div style={{ width: '100px' }}>
            <Dropdown
              options={themeTypeOptions}
              value={currentTheme.type}
              onChange={handleTypeChange}
              disabled={!isCustom}
              ariaLabel="Theme Type"
            />
          </div>
        </div>
      </div>

      <div className="customizer-tabs">
        <button
          className={`tab-btn${activeTab === 'ui' ? ' active' : ''}`}
          onClick={() => setActiveTab('ui')}
        >
          UI Colors
        </button>
        <button
          className={`tab-btn${activeTab === 'syntax' ? ' active' : ''}`}
          onClick={() => setActiveTab('syntax')}
        >
          Syntax Colors
        </button>
      </div>

      <div className="colors-list">
        {activeColorLabels.map((item) => {
          const isSyntax = activeTab === 'syntax';
          const source = isSyntax ? currentTheme.syntax : currentTheme.colors;
          return (
            <div className="color-item" key={item.key}>
              <span className="color-name">{item.label}</span>
              <div className="color-inputs">
                <input
                  type="color"
                  value={source[item.key] || '#000000'}
                  onChange={(e) => handleColorChange(item.key, e.target.value, isSyntax)}
                  className="color-picker"
                  disabled={!isCustom}
                  aria-label={`Pick ${item.label}`}
                />
                <input
                  type="text"
                  value={source[item.key] || ''}
                  onChange={(e) => handleColorChange(item.key, e.target.value, isSyntax)}
                  className="hex-input"
                  disabled={!isCustom}
                  placeholder="#000000"
                  aria-label={`${item.label} Hex Code`}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="customizer-actions">
        {!isCustom ? (
          <button className="action-btn secondary" onClick={cloneTheme}>
            Clone Theme
          </button>
        ) : (
          <>
            <button className="action-btn danger" onClick={resetTheme}>
              Reset
            </button>
            <button className="action-btn primary" onClick={saveCustomTheme}>
              Save Theme
            </button>
          </>
        )}
      </div>
    </div>
  );
}
