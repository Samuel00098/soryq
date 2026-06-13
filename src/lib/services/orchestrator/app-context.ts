import { get } from 'svelte/store';
import { layout, settingsOpen } from '$lib/stores/layout';
import { openFiles, activeFile, fileCache, activeLine, activeColumn, activeSelection } from '$lib/stores/editor';
import { getTerminalProjectState, getAgentDisplayName, getSessionOutputBuffer } from '$lib/stores/terminal';
import { currentUrl, proxyStarted } from '$lib/stores/preview';
import { branchInfo } from '$lib/stores/gitBranch';
import { getPresetRuns } from '$lib/stores/runs';
import { captureTranscript } from '$lib/services/orchestrator/activity-log';
import type { LayoutState } from '$lib/types/layout';
import type { AppStateRef } from '$lib/services/orchestrator-brain';

// Caps so feeding live content every chat turn stays affordable on tokens.
const MAX_FILE_CONTENT = 4000;
const MAX_SELECTION = 1500;
const MAX_TERMINAL_TAIL = 500;

// The aux panels the assistant can reason about / navigate to, mapped from the
// layout visibility flags to the plain names the brain uses in `navigate`.
const PANEL_FLAGS: Array<{ flag: keyof LayoutState; label: string }> = [
  { flag: 'editorVisible', label: 'editor' },
  { flag: 'previewVisible', label: 'preview' },
  { flag: 'reviewVisible', label: 'review' },
  { flag: 'httpVisible', label: 'http' },
  { flag: 'tasksVisible', label: 'tasks' },
  { flag: 'dbVisible', label: 'db' },
  { flag: 'containersVisible', label: 'containers' },
  { flag: 'toolboxVisible', label: 'toolbox' },
  { flag: 'petVisible', label: 'pet' },
];

/** Every view the assistant may `navigate` to (matches layout's known views). */
export const NAVIGABLE_VIEWS = [
  'editor',
  'terminal',
  'preview',
  'review',
  'http',
  'tasks',
  'db',
  'containers',
  'toolbox',
  'pet',
  'settings',
] as const;

function relativise(path: string | null | undefined, rootPath: string): string | null {
  if (!path) return null;
  const norm = path.replace(/\\/g, '/');
  const root = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
  if (root && norm.startsWith(root + '/')) return norm.slice(root.length + 1);
  return norm;
}

/**
 * A full, structured read of what the user is currently looking at and working
 * with across the whole application — the active page, open editor files +
 * cursor, unsaved changes, visible panels, terminals, preview, git branch, and
 * the run presets available. Fed to the orchestrator brain so it can answer
 * questions about the app and decide which app-control action to take.
 */
export function getAppContextSnapshot(projectId: string, rootPath = ''): AppStateRef {
  const l = get(layout);
  const cache = get(fileCache);
  const open = get(openFiles);
  const active = get(activeFile);

  const dirtyFiles = open.filter((p) => cache.get(p)?.isDirty);

  const sessions = getTerminalProjectState(projectId).sessions;
  const terminals = sessions.map((s) => {
    const tail = captureTranscript(getSessionOutputBuffer(s.id), MAX_TERMINAL_TAIL);
    return {
      label: (s.agentName?.trim() || s.role || s.title || `Terminal ${s.id}`),
      agent: s.agentPreset ? (getAgentDisplayName(s.agentPreset) ?? s.agentPreset) : null,
      cwd: relativise(s.cwd, rootPath),
      running: s.isRunning,
      busy: !!s.isExecuting,
      recentOutput: tail || null,
    };
  });

  const visiblePanels = PANEL_FLAGS.filter(({ flag }) => !!l[flag]).map(({ label }) => label);

  const branch = get(branchInfo)?.current ?? null;
  const previewUrl = get(currentUrl);

  const availableRuns = getPresetRuns(projectId)
    .map((r) => ({ name: r.name, command: r.command }))
    .slice(0, 12);

  // Live content of the active file (skipped for images/binaries) + the user's
  // current selection — only while the editor is the focused view, so the
  // assistant reasons about what the user is actually looking at.
  const activeEntry = active ? get(fileCache).get(active) : undefined;
  const editorFocused = l.activeView === 'editor' && l.editorVisible;
  const rawContent = activeEntry && activeEntry.kind !== 'image' ? (activeEntry.content ?? '') : '';
  const truncatedContent = rawContent.length > MAX_FILE_CONTENT;
  const selectionText = editorFocused ? get(activeSelection).trim() : '';

  return {
    activeView: l.activeView,
    settingsOpen: get(settingsOpen),
    visiblePanels,
    sidebar: { open: l.sidebarVisible, tab: l.sidebarTab },
    editor: {
      activeFile: relativise(active, rootPath),
      openFiles: open.map((p) => relativise(p, rootPath) ?? p),
      dirtyFiles: dirtyFiles.map((p) => relativise(p, rootPath) ?? p),
      cursor: active ? { line: get(activeLine), col: get(activeColumn) } : null,
      language: activeEntry?.language ?? null,
      content: editorFocused && rawContent ? rawContent.slice(0, MAX_FILE_CONTENT) : null,
      contentTruncated: editorFocused && truncatedContent,
      selection: selectionText ? selectionText.slice(0, MAX_SELECTION) : null,
    },
    terminals,
    preview: { url: previewUrl || null, running: get(proxyStarted) },
    branch,
    availableViews: [...NAVIGABLE_VIEWS],
    availableRuns,
  };
}
