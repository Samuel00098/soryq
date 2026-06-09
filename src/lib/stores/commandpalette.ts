import { writable, get } from 'svelte/store';

export interface Command {
  id: string;
  name: string;
  category: string;
  shortcut?: string;
  action: () => void | Promise<void>;
}

export const isOpen = writable(false);
export const search = writable('');
export const commands = writable<Command[]>([]);

export function toggleCommandPalette() {
  isOpen.update((v) => !v);
  if (get(isOpen)) {
    search.set('');
  }
}

import { newWorkspacePromptOpen, openProject, openProjectByPath } from './workspace';
import { saveActiveFile, formatActiveFile } from './editor';
import { setActiveView, toggleSidebar, toggleEditorSplitPreview, toggleSidebarTab, openEnvManager } from './layout';
import { createTerminalSession } from './terminal';
import { startProxy, stopProxy } from './preview';

export function initDefaultCommands() {
  const defaultCmds: Command[] = [
    {
      id: 'file.save',
      name: 'Save Active File',
      category: 'File',
      shortcut: 'Ctrl+S',
      action: () => saveActiveFile(),
    },
    {
      id: 'workspace.new',
      name: 'New Workspace',
      category: 'Workspace',
      shortcut: 'Ctrl+N',
      action: () => newWorkspacePromptOpen.set(true),
    },
    {
      id: 'workspace.open',
      name: 'Open Folder...',
      category: 'Workspace',
      shortcut: 'Ctrl+O',
      action: () => openProject(),
    },
    {
      id: 'sidebar.toggle',
      name: 'Toggle Sidebar',
      category: 'View',
      shortcut: 'Ctrl+B',
      action: () => toggleSidebar(),
    },
    {
      id: 'search.project',
      name: 'Search in Files',
      category: 'View',
      shortcut: 'Ctrl+Shift+F',
      action: () => toggleSidebarTab('search'),
    },
    {
      id: 'workspace.env',
      name: 'Environment Manager',
      category: 'Workspace',
      shortcut: 'Ctrl+Shift+E',
      action: () => openEnvManager(),
    },
    {
      id: 'view.editor',
      name: 'Go to Editor',
      category: 'View',
      shortcut: 'Ctrl+E',
      action: () => setActiveView('editor'),
    },
    {
      id: 'view.terminal',
      name: 'Go to Terminal',
      category: 'View',
      shortcut: 'Ctrl+`',
      action: () => setActiveView('terminal'),
    },
    {
      id: 'view.preview',
      name: 'Go to Preview',
      category: 'View',
      action: () => setActiveView('preview'),
    },
    {
      id: 'view.settings',
      name: 'Go to Settings',
      category: 'View',
      action: () => setActiveView('settings'),
    },
    {
      id: 'terminal.new',
      name: 'New Terminal',
      category: 'Terminal',
      action: async () => {
        setActiveView('terminal');
        await createTerminalSession();
      },
    },
    {
      id: 'editor.split_preview',
      name: 'Toggle Editor + Preview Split',
      category: 'Editor',
      action: () => toggleEditorSplitPreview(),
    },
    {
      id: 'editor.format',
      name: 'Format Document (Prettier)',
      category: 'Editor',
      shortcut: 'Alt+Shift+F',
      action: () => formatActiveFile(),
    },
    {
      id: 'preview.start',
      name: 'Start Dev Proxy Server',
      category: 'Preview',
      action: () => startProxy(),
    },
    {
      id: 'preview.stop',
      name: 'Stop Dev Proxy Server',
      category: 'Preview',
      action: () => stopProxy(),
    },
    {
      id: 'theme.customize',
      name: 'Customize Theme...',
      category: 'Preferences',
      action: () => setActiveView('settings'),
    },
  ];

  commands.set(defaultCmds);
}

export function registerCommand(command: Command) {
  commands.update((cmds) => {
    if (cmds.some((c) => c.id === command.id)) {
      return cmds.map((c) => (c.id === command.id ? command : c));
    }
    return [...cmds, command];
  });
}
