import { useEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { activeProjectId, activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { openFile } from '$lib/stores/editor';
import { useStore } from '$lib/react/useStore';
import FileIcon from '$lib/components/explorer/FileIcon.tsx';
import './ReviewPanel.css';

interface ChangedFile {
  path: string;
  name: string;
  status: 'modified' | 'added' | 'deleted' | 'untracked';
  additions: number;
  deletions: number;
}

interface DiffLine {
  type: 'header' | 'hunk-header' | 'addition' | 'deletion' | 'normal';
  text: string;
  marker: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

interface Token {
  type: string;
  text: string;
}

interface SplitRow {
  type: 'hunk-header' | 'split-line';
  hunkText?: string;
  left?: {
    type: 'deletion' | 'normal' | 'empty';
    lineNum: number | null;
    text: string;
  };
  right?: {
    type: 'addition' | 'normal' | 'empty';
    lineNum: number | null;
    text: string;
  };
}

function getFilename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1];
}

function parseDiff(diffText: string): DiffLine[] {
  if (!diffText) return [];
  const lines = diffText.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  let oldLineNum = 1;
  let newLineNum = 1;
  const parsed: DiffLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename ') ||
      line.startsWith('copy ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      parsed.push({ type: 'header', text: line, marker: ' ', oldLineNum: null, newLineNum: null });
      continue;
    }

    if (line.startsWith('@@')) {
      const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      parsed.push({ type: 'hunk-header', text: line, marker: ' ', oldLineNum: null, newLineNum: null });
      continue;
    }

    if (line.startsWith('+')) {
      parsed.push({
        type: 'addition',
        text: line.substring(1),
        marker: '+',
        oldLineNum: null,
        newLineNum: newLineNum,
      });
      newLineNum++;
      continue;
    }

    if (line.startsWith('-')) {
      parsed.push({
        type: 'deletion',
        text: line.substring(1),
        marker: '-',
        oldLineNum: oldLineNum,
        newLineNum: null,
      });
      oldLineNum++;
      continue;
    }

    const text = line.startsWith(' ') ? line.substring(1) : line;
    parsed.push({
      type: 'normal',
      text,
      marker: ' ',
      oldLineNum: oldLineNum,
      newLineNum: newLineNum,
    });
    oldLineNum++;
    newLineNum++;
  }

  return parsed;
}

function tokenize(text: string, filePath: string): Token[] {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';

  let commentRegex = /\/\/.*|#.*/;
  if (ext === 'rs' || ext === 'js' || ext === 'ts' || ext === 'json' || ext === 'css' || ext === 'svelte') {
    commentRegex = /\/\/.*|\/\*[\s\S]*?\*\//;
  } else if (ext === 'toml' || ext === 'yaml' || ext === 'yml' || ext === 'py' || ext === 'sh') {
    commentRegex = /#.*/;
  } else if (ext === 'html') {
    commentRegex = /<!--[\s\S]*?-->/;
  }

  let keywords = /\b(break|case|catch|class|const|continue|default|else|for|function|if|import|new|return|switch|this|throw|try|while|async|await|let|export|from)\b/;
  if (ext === 'rs') {
    keywords = /\b(as|async|await|break|const|continue|crate|dyn|else|enum|extern|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|type|union|unsafe|use|where|while|macro_rules)\b/;
  } else if (ext === 'css') {
    keywords = /@\w+|\b(important|aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateitem|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen)\b/;
  } else if (ext === 'toml') {
    keywords = /\b(true|false)\b/;
  }

  const types = /\b(String|str|Option|Result|State|AppState|Vec|HashMap|u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|f32|f64|bool|char|usize|isize|number|string|boolean|any|void|unknown|never|Record|Promise)\b/;

  const tagRule = /(<\/?[\w:\-]+)/;
  const attrRule = /\b([\w\-]+)(?=\s*=)/;

  const isHtmlSvelte = ext === 'html' || ext === 'svelte';
  const tokenRegex = new RegExp(
    `(${commentRegex.source})|` +
    `("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|` +
    `(\\b\\d+(?:\\.\\d+)?\\b)|` +
    (isHtmlSvelte ? `(${tagRule.source})|(${attrRule.source})|` : '') +
    `(${keywords.source})|` +
    `(${types.source})|` +
    `(\\b[a-zA-Z_][a-zA-Z0-9_]*(?=\\())|` +
    `([+\\-*/%&|^!=<>~?:]+)|` +
    `([a-zA-Z_][a-zA-Z0-9_]*)|` +
    `(\\s+)|` +
    `(.)`,
    'g'
  );

  const tokens: Token[] = [];
  let match;
  while ((match = tokenRegex.exec(text)) !== null) {
    if (match[1]) {
      tokens.push({ type: 'comment', text: match[1] });
    } else if (match[2]) {
      tokens.push({ type: 'string', text: match[2] });
    } else if (match[3]) {
      tokens.push({ type: 'number', text: match[3] });
    } else {
      let idx = 4;
      if (isHtmlSvelte) {
        if (match[idx]) {
          tokens.push({ type: 'tag', text: match[idx] });
          continue;
        }
        idx++;
        if (match[idx]) {
          tokens.push({ type: 'attribute', text: match[idx] });
          continue;
        }
        idx++;
      }

      if (match[idx]) {
        tokens.push({ type: 'keyword', text: match[idx] });
      } else if (match[idx + 1]) {
        tokens.push({ type: 'type', text: match[idx + 1] });
      } else if (match[idx + 2]) {
        tokens.push({ type: 'function', text: match[idx + 2] });
      } else if (match[idx + 3]) {
        tokens.push({ type: 'operator', text: match[idx + 3] });
      } else if (match[idx + 4]) {
        const w = match[idx + 4];
        if (w === w.toUpperCase() && w.length > 1 && isNaN(Number(w[0]))) {
          tokens.push({ type: 'constant', text: w });
        } else {
          tokens.push({ type: 'variable', text: w });
        }
      } else if (match[idx + 5]) {
        tokens.push({ type: 'text', text: match[idx + 5] });
      } else if (match[idx + 6]) {
        tokens.push({ type: 'text', text: match[idx + 6] });
      }
    }
  }
  return tokens;
}

function makeSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let pendingDels: DiffLine[] = [];
  let pendingAdds: DiffLine[] = [];

  const flushPending = () => {
    const maxLen = Math.max(pendingDels.length, pendingAdds.length);
    for (let i = 0; i < maxLen; i++) {
      const del = pendingDels[i];
      const add = pendingAdds[i];
      rows.push({
        type: 'split-line',
        left: del ? {
          type: 'deletion',
          lineNum: del.oldLineNum,
          text: del.text,
        } : {
          type: 'empty',
          lineNum: null,
          text: '',
        },
        right: add ? {
          type: 'addition',
          lineNum: add.newLineNum,
          text: add.text,
        } : {
          type: 'empty',
          lineNum: null,
          text: '',
        },
      });
    }
    pendingDels = [];
    pendingAdds = [];
  };

  for (const line of lines) {
    if (line.type === 'header') {
      continue;
    }

    if (line.type === 'hunk-header') {
      flushPending();
      rows.push({
        type: 'hunk-header',
        hunkText: line.text,
      });
      continue;
    }

    if (line.type === 'deletion') {
      pendingDels.push(line);
    } else if (line.type === 'addition') {
      pendingAdds.push(line);
    } else if (line.type === 'normal') {
      flushPending();
      rows.push({
        type: 'split-line',
        left: {
          type: 'normal',
          lineNum: line.oldLineNum,
          text: line.text,
        },
        right: {
          type: 'normal',
          lineNum: line.newLineNum,
          text: line.text,
        },
      });
    }
  }

  flushPending();
  return rows;
}

export default function ReviewPanel() {
  const projectId = useStore(activeProjectId);
  const project = useStore(activeProject);

  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [branch, setBranch] = useState<string>('');
  const [totalAdditions, setTotalAdditions] = useState<number>(0);
  const [totalDeletions, setTotalDeletions] = useState<number>(0);

  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [fileDiffs, setFileDiffs] = useState<Record<string, string>>({});
  const [loadingDiffs, setLoadingDiffs] = useState<Record<string, boolean>>({});

  const [isFetchingStatus, setIsFetchingStatus] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [diffMode, setDiffMode] = useState<'inline' | 'split'>(() => {
    const saved = localStorage.getItem('soryq_diff_mode');
    return (saved === 'split' || saved === 'inline') ? saved : 'inline';
  });

  useEffect(() => {
    localStorage.setItem('soryq_diff_mode', diffMode);
  }, [diffMode]);

  const handleNativeWheel = useCallback((e: WheelEvent) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      const reviewBody = (e.currentTarget as HTMLElement).closest('.review-body');
      if (reviewBody) {
        reviewBody.scrollTop += e.deltaY;
      }
    }
  }, []);

  const cardBodyRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.addEventListener('wheel', handleNativeWheel, { passive: false });
    }
  }, [handleNativeWheel]);

  // Mutable refs mirror the Svelte module-level generation counters — they
  // exist purely to dedupe/cancel stale async work and must not trigger
  // re-renders themselves, so plain state would be the wrong tool here.
  const refreshGenerationRef = useRef(0);
  const statusRequestGenerationRef = useRef(0);
  const diffRequestGenerationByFileRef = useRef(new Map<string, number>());

  // Latest-value refs so async callbacks (fetchStatus/fetchDiffForFile/refreshAll)
  // can read current state without becoming stale closures or needing to be
  // re-created (and re-effected) on every state change.
  const filesRef = useRef<ChangedFile[]>(files);
  filesRef.current = files;
  const expandedFilesRef = useRef<Record<string, boolean>>(expandedFiles);
  expandedFilesRef.current = expandedFiles;
  const fileDiffsRef = useRef<Record<string, string>>(fileDiffs);
  fileDiffsRef.current = fileDiffs;

  // Keep a ref of the latest projectId so the async helpers below (which are
  // re-created each render via closures, mirroring the Svelte functions that
  // read `$activeProjectId` directly) always see the current value.
  const projectIdRef = useRef<string | null>(projectId);
  projectIdRef.current = projectId;

  async function fetchStatus(generation: number) {
    const pid = projectIdRef.current;
    if (!pid) return;

    const requestGeneration = ++statusRequestGenerationRef.current;
    setIsFetchingStatus(true);
    try {
      const status = await invoke<{
        branch: string;
        modified: string[];
        added: string[];
        deleted: string[];
        untracked: string[];
        file_stats: Record<string, [number, number]>;
        total_additions: number;
        total_deletions: number;
      }>('workspace_git_status', { projectId: pid });
      if (generation !== refreshGenerationRef.current || requestGeneration !== statusRequestGenerationRef.current) return;

      setBranch(status.branch);
      setTotalAdditions(status.total_additions);
      setTotalDeletions(status.total_deletions);

      const list: ChangedFile[] = [];
      const getStats = (path: string): [number, number] => {
        return status.file_stats[path] || [0, 0];
      };

      status.modified.forEach((path) => {
        const [add, del] = getStats(path);
        list.push({ path, name: getFilename(path), status: 'modified', additions: add, deletions: del });
      });
      status.added.forEach((path) => {
        const [add, del] = getStats(path);
        list.push({ path, name: getFilename(path), status: 'added', additions: add, deletions: del });
      });
      status.deleted.forEach((path) => {
        const [add, del] = getStats(path);
        list.push({ path, name: getFilename(path), status: 'deleted', additions: add, deletions: del });
      });
      status.untracked.forEach((path) => {
        const [add, del] = getStats(path);
        list.push({ path, name: getFilename(path), status: 'untracked', additions: add, deletions: del });
      });

      setFiles(list);
      filesRef.current = list;
    } catch (err) {
      if (generation !== refreshGenerationRef.current || requestGeneration !== statusRequestGenerationRef.current) return;
      console.error('Failed to get git status:', err);
      setErrorMsg(String(err));
      setFiles([]);
      filesRef.current = [];
    } finally {
      if (generation === refreshGenerationRef.current && requestGeneration === statusRequestGenerationRef.current) {
        setIsFetchingStatus(false);
      }
    }
  }

  async function fetchDiffForFile(filePath: string, generation: number) {
    const pid = projectIdRef.current;
    if (!pid) return;

    const requestGeneration = (diffRequestGenerationByFileRef.current.get(filePath) ?? 0) + 1;
    diffRequestGenerationByFileRef.current.set(filePath, requestGeneration);
    setLoadingDiffs((prev) => ({ ...prev, [filePath]: true }));
    try {
      const diff = await invoke<string>('workspace_git_diff', {
        projectId: pid,
        filePath,
      });
      if (generation !== refreshGenerationRef.current || diffRequestGenerationByFileRef.current.get(filePath) !== requestGeneration) return;
      setFileDiffs((prev) => {
        const next = { ...prev, [filePath]: diff };
        fileDiffsRef.current = next;
        return next;
      });
    } catch (err) {
      if (generation !== refreshGenerationRef.current || diffRequestGenerationByFileRef.current.get(filePath) !== requestGeneration) return;
      console.error('Failed to get git diff:', err);
      showToast(`Failed to fetch diff details for ${getFilename(filePath)}`, 'error');
      setFileDiffs((prev) => {
        const next = { ...prev, [filePath]: '' };
        fileDiffsRef.current = next;
        return next;
      });
    } finally {
      if (generation === refreshGenerationRef.current && diffRequestGenerationByFileRef.current.get(filePath) === requestGeneration) {
        setLoadingDiffs((prev) => ({ ...prev, [filePath]: false }));
      }
    }
  }

  async function refreshAll() {
    const generation = ++refreshGenerationRef.current;
    setErrorMsg(null);
    await fetchStatus(generation);

    // Refresh diffs for any files that are currently expanded
    const currentExpanded = expandedFilesRef.current;
    for (const filePath of Object.keys(currentExpanded)) {
      if (generation !== refreshGenerationRef.current) return;
      if (currentExpanded[filePath]) {
        const fileStillExists = filesRef.current.some((f) => f.path === filePath);
        if (fileStillExists) {
          await fetchDiffForFile(filePath, generation);
        } else {
          setExpandedFiles((prev) => {
            const next = { ...prev };
            delete next[filePath];
            expandedFilesRef.current = next;
            return next;
          });
          setFileDiffs((prev) => {
            const next = { ...prev };
            delete next[filePath];
            fileDiffsRef.current = next;
            return next;
          });
        }
      }
    }
  }

  // Watch project changes to refresh
  useEffect(() => {
    if (projectId) {
      setFiles([]);
      setBranch('');
      setTotalAdditions(0);
      setTotalDeletions(0);
      setExpandedFiles({});
      setFileDiffs({});
      setLoadingDiffs({});
      setErrorMsg(null);
      filesRef.current = [];
      expandedFilesRef.current = {};
      fileDiffsRef.current = {};
      refreshAll();
    } else {
      setFiles([]);
      setBranch('');
      setTotalAdditions(0);
      setTotalDeletions(0);
      setExpandedFiles({});
      setFileDiffs({});
      setLoadingDiffs({});
      setErrorMsg(null);
      filesRef.current = [];
      expandedFilesRef.current = {};
      fileDiffsRef.current = {};
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function toggleFileExpansion(filePath: string) {
    if (expandedFilesRef.current[filePath]) {
      setExpandedFiles((prev) => {
        const next = { ...prev, [filePath]: false };
        expandedFilesRef.current = next;
        return next;
      });
    } else {
      setExpandedFiles((prev) => {
        const next = { ...prev, [filePath]: true };
        expandedFilesRef.current = next;
        return next;
      });
      if (fileDiffsRef.current[filePath] === undefined) {
        await fetchDiffForFile(filePath, refreshGenerationRef.current);
      }
    }
  }

  async function discardFileChanges(file: ChangedFile) {
    const pid = projectIdRef.current;
    if (!pid) return;

    const confirmDiscard = confirm(`Are you sure you want to discard changes for ${file.path}? This cannot be undone.`);
    if (!confirmDiscard) return;

    try {
      await invoke('workspace_git_discard_file', {
        projectId: pid,
        filePath: file.path,
      });
      showToast(`Discarded changes for ${file.name}`, 'success');

      // Remove from states
      setExpandedFiles((prev) => {
        const next = { ...prev };
        delete next[file.path];
        expandedFilesRef.current = next;
        return next;
      });
      setFileDiffs((prev) => {
        const next = { ...prev };
        delete next[file.path];
        fileDiffsRef.current = next;
        return next;
      });

      await refreshAll();
    } catch (err) {
      console.error('Failed to discard file changes:', err);
      showToast(`Failed to discard changes: ${err}`, 'error');
    }
  }

  async function discardAllChanges() {
    const pid = projectIdRef.current;
    if (!pid) return;

    const confirmDiscard = confirm(`Are you sure you want to discard ALL uncommitted changes? This will revert all tracked files and delete all untracked files. THIS CANNOT BE UNDONE.`);
    if (!confirmDiscard) return;

    try {
      await invoke('workspace_git_discard_all', {
        projectId: pid,
        confirmation: 'discard all changes',
      });
      showToast('Discarded all changes', 'success');
      setExpandedFiles({});
      setFileDiffs({});
      expandedFilesRef.current = {};
      fileDiffsRef.current = {};
      await refreshAll();
    } catch (err) {
      console.error('Failed to discard all changes:', err);
      showToast(`Failed to discard all changes: ${err}`, 'error');
    }
  }

  function copyFilePath(path: string, event: ReactMouseEvent) {
    event.stopPropagation();
    navigator.clipboard.writeText(path);
    showToast('Copied file path to clipboard', 'success');
  }

  async function openFileInEditor(path: string, event: ReactMouseEvent) {
    event.stopPropagation();
    const proj = project;
    if (proj) {
      const absPath = `${proj.root_path}/${path}`;
      await openFile(absPath);
    }
  }

  function handleDiscardFile(file: ChangedFile, event: ReactMouseEvent) {
    event.stopPropagation();
    discardFileChanges(file);
  }

  return (
    <div className="review-panel">
      <div className="sc-header">
        <span className="sc-title">Code review</span>
      </div>

      <div className="sc-toolbar">
        <div className="toolbar-left">
          {branch && (
            <div className="tb-item branch-item" title="Current Branch">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              <span className="branch-name">{branch}</span>
            </div>
          )}
          <div className="tb-item files-item" title="Changed Files">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="files-count">{files.length}</span>
          </div>
          {(totalAdditions > 0 || totalDeletions > 0) && (
            <>
              <span className="tb-sep">·</span>
              <div className="tb-item stats-item" title="Insertions / Deletions">
                <span className="stat-add">+{totalAdditions}</span>
                <span className="stat-del">-{totalDeletions}</span>
              </div>
            </>
          )}
        </div>

        <div className="toolbar-right">
          <div className="diff-mode-toggle">
            <button
              className={`toggle-btn ${diffMode === 'inline' ? 'active' : ''}`}
              onClick={() => setDiffMode('inline')}
              title="Inline diff"
            >
              Inline
            </button>
            <button
              className={`toggle-btn ${diffMode === 'split' ? 'active' : ''}`}
              onClick={() => setDiffMode('split')}
              title="Split diff"
            >
              Split
            </button>
          </div>

          <span className="toolbar-divider" />

          <button className="toolbar-btn" onClick={refreshAll} disabled={isFetchingStatus} title="Uncommitted changes">
            <svg className={isFetchingStatus ? 'spin' : ''} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span>Uncommitted changes</span>
          </button>

          <button className="toolbar-btn" onClick={discardAllChanges} disabled={files.length === 0} title="Discard all changes">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <polyline points="3 3 3 8 8 8" />
            </svg>
            <span>Discard all</span>
          </button>

          <button className="toolbar-btn icon-only" title="Attachments">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
        </div>
      </div>

      <div className="review-scope-note">
        <span>Project</span>
        <strong>{project?.name ?? 'No active project'}</strong>
        <em>Review and discard actions apply to this project working tree.</em>
      </div>

      <div className="review-body">
        {errorMsg ? (
          <div className="sc-error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p>{errorMsg}</p>
            <button className="btn-retry" onClick={refreshAll}>Retry</button>
          </div>
        ) : files.length === 0 ? (
          <div className="sc-clean">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p>No changes detected.</p>
            <p className="sub">Your working tree is clean.</p>
          </div>
        ) : (
          <div className="files-list-container">
            {files.map((file) => {
              const isExpanded = !!expandedFiles[file.path];
              const isLoadingDiff = !!loadingDiffs[file.path];
              const diffText = fileDiffs[file.path];
              const parsed = isExpanded && diffText ? parseDiff(diffText) : null;
              const hasHunkHeader = parsed ? parsed.some((l) => l.type === 'hunk-header') : false;

              return (
                <div key={file.path} className={`file-card${isExpanded ? ' expanded' : ''}`}>
                  {/* Card Header */}
                  <div
                    className="file-card-header"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleFileExpansion(file.path)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleFileExpansion(file.path); } }}
                  >
                    <svg className={`chevron${isExpanded ? ' expanded' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>

                    <div className="file-path-container">
                      <FileIcon name={file.name} isDir={false} />
                      <span className="file-path" title={file.path}>{file.path}</span>

                      <button className="icon-btn" onClick={(e) => copyFilePath(file.path, e)} title="Copy file path">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>

                      {(file.additions > 0 || file.deletions > 0) && (
                        <div className="stat-pill">
                          <span className="stat-add">+{file.additions}</span>
                          <span className="stat-sep">·</span>
                          <span className="stat-del">-{file.deletions}</span>
                        </div>
                      )}
                    </div>

                    <div className="header-actions">
                      <button className="icon-btn" title="Link/Attachment">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                      </button>
                      <button className="icon-btn" onClick={(e) => handleDiscardFile(file, e)} title="Discard file changes">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <polyline points="3 3 3 8 8 8" />
                        </svg>
                      </button>
                      <button className="icon-btn" onClick={(e) => openFileInEditor(file.path, e)} disabled={file.status === 'deleted'} title="Open file in editor">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Card Body / Expanded Diff */}
                  {isExpanded && (
                    <div className="file-card-body" ref={cardBodyRef}>
                      {isLoadingDiff ? (
                        <div className="diff-loading">
                          <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                            <polyline points="21 3 21 8 16 8" />
                          </svg>
                          <span>Loading changes...</span>
                        </div>
                      ) : !diffText ? (
                        <div className="diff-empty">No changes found or empty file.</div>
                      ) : (
                        diffMode === 'split' ? (
                          <table className="diff-table split-diff">
                            <colgroup>
                              <col style={{ width: '40px' }} />
                              <col style={{ width: 'calc(50% - 40px)' }} />
                              <col style={{ width: '40px' }} />
                              <col style={{ width: 'calc(50% - 40px)' }} />
                            </colgroup>
                            <tbody>
                              {makeSplitRows(parsed!).map((row, idx) => {
                                if (row.type === 'hunk-header') {
                                  return (
                                    <tr key={`hunk-${idx}`} className="hunk-header-tr">
                                      <td colSpan={4} className="hunk-decor-cell">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                                          <polyline points="18 15 12 9 6 15" />
                                        </svg>
                                        <span>{row.hunkText}</span>
                                      </td>
                                    </tr>
                                  );
                                }

                                const left = row.left!;
                                const right = row.right!;

                                return (
                                  <tr key={idx} className="diff-tr split-tr">
                                    <td className={`ln left-ln ${left.type}-ln`}>{left.lineNum ?? ''}</td>
                                    <td className={`code-cell left-code ${left.type}-code`}>
                                      {left.type !== 'empty' && tokenize(left.text, file.path).map((token, tokenIdx) =>
                                        token.type === 'text' ? (
                                          token.text
                                        ) : (
                                          <span key={tokenIdx} className={`token-${token.type}`} style={{ color: `var(--syntax-${token.type}, inherit)` }}>{token.text}</span>
                                        )
                                      )}
                                    </td>
                                    <td className={`ln right-ln ${right.type}-ln`}>{right.lineNum ?? ''}</td>
                                    <td className={`code-cell right-code ${right.type}-code`}>
                                      {right.type !== 'empty' && tokenize(right.text, file.path).map((token, tokenIdx) =>
                                        token.type === 'text' ? (
                                          token.text
                                        ) : (
                                          <span key={tokenIdx} className={`token-${token.type}`} style={{ color: `var(--syntax-${token.type}, inherit)` }}>{token.text}</span>
                                        )
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                              {hasHunkHeader && (
                                <tr className="hunk-header-tr">
                                  <td colSpan={4} className="hunk-decor-cell hunk-decor-end">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        ) : (
                          <table className="diff-table inline-diff">
                            <colgroup>
                              <col style={{ width: '40px' }} />
                              <col style={{ width: '40px' }} />
                              <col />
                            </colgroup>
                            <tbody>
                              {parsed!.map((line, idx) => {
                                if (line.type === 'header') return null;
                                if (line.type === 'hunk-header') {
                                  return (
                                    <tr key={`hunk-${idx}`} className="hunk-header-tr">
                                      <td colSpan={3} className="hunk-decor-cell">
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                                          <polyline points="18 15 12 9 6 15" />
                                        </svg>
                                        <span>{line.text}</span>
                                      </td>
                                    </tr>
                                  );
                                }

                                return (
                                  <tr key={idx} className={`diff-tr ${line.type}`}>
                                    <td className="ln old-ln">{line.oldLineNum ?? ''}</td>
                                    <td className="ln new-ln">{line.newLineNum ?? ''}</td>
                                    <td className="code-cell">
                                      {tokenize(line.text, file.path).map((token, tokenIdx) =>
                                        token.type === 'text' ? (
                                          token.text
                                        ) : (
                                          <span key={tokenIdx} className={`token-${token.type}`} style={{ color: `var(--syntax-${token.type}, inherit)` }}>{token.text}</span>
                                        )
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                              {hasHunkHeader && (
                                <tr className="hunk-header-tr">
                                  <td colSpan={3} className="hunk-decor-cell hunk-decor-end">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
