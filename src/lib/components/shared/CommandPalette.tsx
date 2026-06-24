import { useEffect, useMemo, useRef, useState } from 'react';
import { isOpen, search, commands, initDefaultCommands } from '$lib/stores/commandpalette';
import { useCommandPaletteStore } from '$lib/stores/zustand/commandpalette';
import { switchTheme } from '$lib/stores/theme';
import { isTauriRuntime } from '$lib/utils/tauri';
import './CommandPalette.css';

export default function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.isOpen);
  const query = useCommandPaletteStore((s) => s.search);
  const cmds = useCommandPaletteStore((s) => s.commands);

  const inputEl = useRef<HTMLInputElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    initDefaultCommands();
    setupThemeCommands();
  }, []);

  async function setupThemeCommands() {
    if (!isTauriRuntime()) return;
    try {
      // Dynamically load themes and register command palette entries for them.
      const { invoke } = await import('@tauri-apps/api/core');
      interface ThemeInfo {
        id: string;
        name: string;
        author: string;
      }
      const themes = await invoke<ThemeInfo[]>('theme_list');
      themes.forEach((theme) => {
        commands.update((list) => {
          const id = `theme.activate.${theme.id}`;
          if (list.some((c) => c.id === id)) return list;
          return [
            ...list,
            {
              id,
              name: `Use Theme: ${theme.name}`,
              category: 'Preferences',
              action: async () => {
                await switchTheme(theme.id);
              },
            },
          ];
        });
      });
    } catch (err) {
      console.error('Failed to register theme commands:', err);
    }
  }

  // Focus input when palette opens.
  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    const t = setTimeout(() => inputEl.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const filteredCommands = useMemo(
    () =>
      cmds.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(query.toLowerCase()) ||
          cmd.category.toLowerCase().includes(query.toLowerCase()),
      ),
    [cmds, query],
  );

  function executeCommand(cmd: (typeof filteredCommands)[number]) {
    cmd.action();
    isOpen.set(false);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!open) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredCommands.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          executeCommand(filteredCommands[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        isOpen.set(false);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, filteredCommands, selectedIndex]);

  if (!open) return null;

  return (
    <div className="command-palette-overlay" onClick={() => isOpen.set(false)}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="search-container">
          <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputEl}
            type="text"
            placeholder="Type a command to execute..."
            value={query}
            onChange={(e) => search.set(e.target.value)}
            className="palette-input"
          />
        </div>

        <div className="results-container">
          {filteredCommands.length === 0 ? (
            <div className="no-results">No commands found matching "{query}"</div>
          ) : (
            filteredCommands.map((cmd, i) => (
              <div
                key={cmd.id}
                className={`command-item${i === selectedIndex ? ' selected' : ''}`}
                onClick={() => executeCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="command-details">
                  <span className="command-category">{cmd.category}</span>
                  <span className="command-name">{cmd.name}</span>
                </div>
                {cmd.shortcut && <span className="command-shortcut">{cmd.shortcut}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
