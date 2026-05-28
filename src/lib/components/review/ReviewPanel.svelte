<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { activeProjectId, activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { openFile } from '$lib/stores/editor';
  import FileIcon from '$lib/components/explorer/FileIcon.svelte';

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

  let files = $state<ChangedFile[]>([]);
  let branch = $state<string>('');
  let totalAdditions = $state<number>(0);
  let totalDeletions = $state<number>(0);
  
  let expandedFiles = $state<Record<string, boolean>>({});
  let fileDiffs = $state<Record<string, string>>({});
  let loadingDiffs = $state<Record<string, boolean>>({});
  
  let isFetchingStatus = $state(false);
  let errorMsg = $state<string | null>(null);
  let refreshGeneration = 0;
  let statusRequestGeneration = 0;
  const diffRequestGenerationByFile = new Map<string, number>();

  // Watch project changes to refresh
  $effect(() => {
    const projectId = $activeProjectId;
    if (projectId) {
      files = [];
      branch = '';
      totalAdditions = 0;
      totalDeletions = 0;
      expandedFiles = {};
      fileDiffs = {};
      loadingDiffs = {};
      errorMsg = null;
      refreshAll();
    } else {
      files = [];
      branch = '';
      totalAdditions = 0;
      totalDeletions = 0;
      expandedFiles = {};
      fileDiffs = {};
      loadingDiffs = {};
      errorMsg = null;
    }
  });

  async function refreshAll() {
    const generation = ++refreshGeneration;
    errorMsg = null;
    await fetchStatus(generation);
    
    // Refresh diffs for any files that are currently expanded
    for (const filePath of Object.keys(expandedFiles)) {
      if (generation !== refreshGeneration) return;
      if (expandedFiles[filePath]) {
        const fileStillExists = files.some((f) => f.path === filePath);
        if (fileStillExists) {
          await fetchDiffForFile(filePath, generation);
        } else {
          delete expandedFiles[filePath];
          delete fileDiffs[filePath];
        }
      }
    }
  }

  async function fetchStatus(generation: number) {
    const id = $activeProjectId;
    if (!id) return;

    const requestGeneration = ++statusRequestGeneration;
    isFetchingStatus = true;
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
      }>('workspace_git_status', { projectId: id });
      if (generation !== refreshGeneration || requestGeneration !== statusRequestGeneration) return;

      branch = status.branch;
      totalAdditions = status.total_additions;
      totalDeletions = status.total_deletions;

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

      files = list;
    } catch (err) {
      if (generation !== refreshGeneration || requestGeneration !== statusRequestGeneration) return;
      console.error('Failed to get git status:', err);
      errorMsg = String(err);
      files = [];
    } finally {
      if (generation === refreshGeneration && requestGeneration === statusRequestGeneration) {
        isFetchingStatus = false;
      }
    }
  }

  async function fetchDiffForFile(filePath: string, generation: number) {
    const id = $activeProjectId;
    if (!id) return;

    const requestGeneration = (diffRequestGenerationByFile.get(filePath) ?? 0) + 1;
    diffRequestGenerationByFile.set(filePath, requestGeneration);
    loadingDiffs[filePath] = true;
    try {
      const diff = await invoke<string>('workspace_git_diff', {
        projectId: id,
        filePath
      });
      if (generation !== refreshGeneration || diffRequestGenerationByFile.get(filePath) !== requestGeneration) return;
      fileDiffs[filePath] = diff;
    } catch (err) {
      if (generation !== refreshGeneration || diffRequestGenerationByFile.get(filePath) !== requestGeneration) return;
      console.error('Failed to get git diff:', err);
      showToast(`Failed to fetch diff details for ${getFilename(filePath)}`, 'error');
      fileDiffs[filePath] = '';
    } finally {
      if (generation === refreshGeneration && diffRequestGenerationByFile.get(filePath) === requestGeneration) {
        loadingDiffs[filePath] = false;
      }
    }
  }

  async function toggleFileExpansion(filePath: string) {
    if (expandedFiles[filePath]) {
      expandedFiles[filePath] = false;
    } else {
      expandedFiles[filePath] = true;
      if (fileDiffs[filePath] === undefined) {
        await fetchDiffForFile(filePath, refreshGeneration);
      }
    }
  }

  async function discardFileChanges(file: ChangedFile) {
    const id = $activeProjectId;
    if (!id) return;

    const confirmDiscard = confirm(`Are you sure you want to discard changes for ${file.path}? This cannot be undone.`);
    if (!confirmDiscard) return;

    try {
      await invoke('workspace_git_discard_file', {
        projectId: id,
        filePath: file.path
      });
      showToast(`Discarded changes for ${file.name}`, 'success');
      
      // Remove from states
      delete expandedFiles[file.path];
      delete fileDiffs[file.path];
      
      await refreshAll();
    } catch (err) {
      console.error('Failed to discard file changes:', err);
      showToast(`Failed to discard changes: ${err}`, 'error');
    }
  }

  async function discardAllChanges() {
    const id = $activeProjectId;
    if (!id) return;

    const confirmDiscard = confirm(`Are you sure you want to discard ALL uncommitted changes? This will revert all tracked files and delete all untracked files. THIS CANNOT BE UNDONE.`);
    if (!confirmDiscard) return;

    try {
      await invoke('workspace_git_discard_all', {
        projectId: id
      });
      showToast('Discarded all changes', 'success');
      expandedFiles = {};
      fileDiffs = {};
      await refreshAll();
    } catch (err) {
      console.error('Failed to discard all changes:', err);
      showToast(`Failed to discard all changes: ${err}`, 'error');
    }
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
    let parsed: DiffLine[] = [];

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
          newLineNum: newLineNum
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
          newLineNum: null
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
        newLineNum: newLineNum
      });
      oldLineNum++;
      newLineNum++;
    }

    return parsed;
  }

  function copyFilePath(path: string, event: MouseEvent) {
    event.stopPropagation();
    navigator.clipboard.writeText(path);
    showToast('Copied file path to clipboard', 'success');
  }

  async function openFileInEditor(path: string, event: MouseEvent) {
    event.stopPropagation();
    const proj = $activeProject;
    if (proj) {
      const absPath = `${proj.root_path}/${path}`;
      await openFile(absPath);
    }
  }

  function handleDiscardFile(file: ChangedFile, event: MouseEvent) {
    event.stopPropagation();
    discardFileChanges(file);
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

    let types = /\b(String|str|Option|Result|State|AppState|Vec|HashMap|u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|f32|f64|bool|char|usize|isize|number|string|boolean|any|void|unknown|never|Record|Promise)\b/;

    let tagRule = /(<\/?[\w:\-]+)/;
    let attrRule = /\b([\w\-]+)(?=\s*=)/;

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

    let tokens: Token[] = [];
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
        } else if (match[idx+1]) {
          tokens.push({ type: 'type', text: match[idx+1] });
        } else if (match[idx+2]) {
          tokens.push({ type: 'function', text: match[idx+2] });
        } else if (match[idx+3]) {
          tokens.push({ type: 'operator', text: match[idx+3] });
        } else if (match[idx+4]) {
          const w = match[idx+4];
          if (w === w.toUpperCase() && w.length > 1 && isNaN(Number(w[0]))) {
            tokens.push({ type: 'constant', text: w });
          } else {
            tokens.push({ type: 'variable', text: w });
          }
        } else if (match[idx+5]) {
          tokens.push({ type: 'text', text: match[idx+5] });
        } else if (match[idx+6]) {
          tokens.push({ type: 'text', text: match[idx+6] });
        }
      }
    }
    return tokens;
  }
</script>

<div class="review-panel">
  <div class="sc-header">
    <span class="sc-title">Code review</span>
  </div>

  <div class="sc-toolbar">
    <div class="toolbar-left">
      {#if branch}
        <div class="tb-item branch-item" title="Current Branch">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span class="branch-name">{branch}</span>
        </div>
      {/if}
      <div class="tb-item files-item" title="Changed Files">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="files-count">{files.length}</span>
      </div>
      {#if totalAdditions > 0 || totalDeletions > 0}
        <span class="tb-sep">·</span>
        <div class="tb-item stats-item" title="Insertions / Deletions">
          <span class="stat-add">+{totalAdditions}</span>
          <span class="stat-del">-{totalDeletions}</span>
        </div>
      {/if}
    </div>
    
    <div class="toolbar-right">
      <button class="toolbar-btn" onclick={refreshAll} disabled={isFetchingStatus} title="Uncommitted changes">
        <svg class:spin={isFetchingStatus} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
        <span>Uncommitted changes</span>
      </button>
      
      <button class="toolbar-btn" onclick={discardAllChanges} disabled={files.length === 0} title="Discard all changes">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <polyline points="3 3 3 8 8 8" />
        </svg>
        <span>Discard all</span>
      </button>

      <button class="toolbar-btn icon-only" title="Attachments">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
    </div>
  </div>

  <div class="review-body">
    {#if errorMsg}
      <div class="sc-error">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>{errorMsg}</p>
        <button class="btn-retry" onclick={refreshAll}>Retry</button>
      </div>
    {:else if files.length === 0}
      <div class="sc-clean">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <p>No changes detected.</p>
        <p class="sub">Your working tree is clean.</p>
      </div>
    {:else}
      <div class="files-list-container">
        {#each files as file}
          <div class="file-card" class:expanded={expandedFiles[file.path]}>
            <!-- Card Header -->
            <div class="file-card-header" 
                 role="button" 
                 tabindex="0" 
                 onclick={() => toggleFileExpansion(file.path)}
                 onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { toggleFileExpansion(file.path); } }}>
              <svg class="chevron" class:expanded={expandedFiles[file.path]} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
              
              <div class="file-path-container">
                <FileIcon name={file.name} isDir={false} />
                <span class="file-path" title={file.path}>{file.path}</span>
                
                <button class="icon-btn" onclick={(e) => copyFilePath(file.path, e)} title="Copy file path">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                
                {#if file.additions > 0 || file.deletions > 0}
                  <div class="stat-pill">
                    <span class="stat-add">+{file.additions}</span>
                    <span class="stat-sep">·</span>
                    <span class="stat-del">-{file.deletions}</span>
                  </div>
                {/if}
              </div>
              
              <div class="header-actions">
                <button class="icon-btn" title="Link/Attachment">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <button class="icon-btn" onclick={(e) => handleDiscardFile(file, e)} title="Discard file changes">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <polyline points="3 3 3 8 8 8" />
                  </svg>
                </button>
                <button class="icon-btn" onclick={(e) => openFileInEditor(file.path, e)} disabled={file.status === 'deleted'} title="Open file in editor">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
              </div>
            </div>
            
            <!-- Card Body / Expanded Diff -->
            {#if expandedFiles[file.path]}
              <div class="file-card-body">
                {#if loadingDiffs[file.path]}
                  <div class="diff-loading">
                    <svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                      <polyline points="21 3 21 8 16 8"/>
                    </svg>
                    <span>Loading changes...</span>
                  </div>
                {:else if !fileDiffs[file.path]}
                  <div class="diff-empty">No changes found or empty file.</div>
                {:else}
                  {@const parsed = parseDiff(fileDiffs[file.path])}
                  <div class="diff-lines-container">
                    {#each parsed as line, idx}
                      {#if line.type === 'hunk-header'}
                        <div class="hunk-decor-row">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right: 4px;">
                            <polyline points="18 15 12 9 6 15"/>
                          </svg>
                          <span>{line.text}</span>
                        </div>
                      {:else if line.type !== 'header'}
                        <div class="diff-row {line.type}">
                          <div class="diff-num-col">
                            {#if line.type === 'addition'}
                              {line.newLineNum}
                            {:else if line.type === 'deletion'}
                              {line.oldLineNum}
                            {:else}
                              {line.newLineNum}
                            {/if}
                          </div>
                          <div class="diff-text-col">
                            {#each tokenize(line.text, file.path) as token}
                              {#if token.type === 'text'}
                                {token.text}
                              {:else}
                                <span class="token-{token.type}" style="color: var(--syntax-{token.type}, inherit)">{token.text}</span>
                              {/if}
                            {/each}
                          </div>
                        </div>
                      {/if}
                      {#if idx === parsed.length - 1 && parsed.some(l => l.type === 'hunk-header')}
                        <div class="hunk-decor-row">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .review-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    overflow: hidden;
    container-type: inline-size;
    container-name: review;
  }

  .sc-header {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    user-select: none;
  }

  .sc-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  /* Toolbar */
  .sc-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--bg-primary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tb-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    color: var(--text-secondary);
    height: 20px;
  }

  .branch-name {
    font-weight: 500;
  }

  .files-count {
    font-family: var(--editor-font-family, monospace);
  }

  .stats-item {
    font-family: var(--editor-font-family, monospace);
    font-weight: 600;
    gap: 8px;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar-btn.icon-only {
    padding: 0;
    width: 22px;
    justify-content: center;
  }

  /* Body */
  .review-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--bg-primary);
  }

  .files-list-container {
    display: flex;
    flex-direction: column;
    padding: 12px;
    padding-bottom: 50vh;
  }

  /* File Card */
  .file-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 12px;
    overflow: visible;
    display: flex;
    flex-direction: column;
    transition: border-color 0.15s;
  }

  .file-card:hover {
    border-color: var(--text-muted);
  }

  .file-card.expanded {
    border-color: var(--border);
  }

  .file-card-header {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 6px 10px;
    background: var(--bg-secondary);
    border: none;
    text-align: left;
    cursor: pointer;
    user-select: none;
    gap: 8px;
    border-radius: 6px;
    border-bottom: 1px solid transparent;
    transition: border-radius 0.15s, border-color 0.15s;
  }

  .file-card.expanded .file-card-header {
    border-radius: 6px 6px 0 0;
    border-bottom-color: var(--border);
  }

  .chevron {
    color: var(--text-muted);
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .file-path-container {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }

  .file-path {
    font-family: var(--editor-font-family, monospace);
    font-size: 12px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .stat-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    font-family: var(--editor-font-family, monospace);
    font-weight: 500;
  }

  .stat-add {
    color: var(--success);
  }

  .stat-del {
    color: var(--error);
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* File Card Body / Diff */
  .file-card-body {
    overflow-x: auto;
    background: var(--bg-primary);
    border-radius: 0 0 6px 6px;
  }

  .diff-lines-container {
    display: flex;
    flex-direction: column;
    padding: 6px 0;
    font-family: var(--editor-font-family, monospace);
    font-size: 11.5px;
    line-height: 1.5;
  }

  .diff-row {
    display: flex;
    width: 100%;
    min-width: fit-content;
  }

  .diff-num-col {
    width: 36px;
    min-width: 36px;
    text-align: right;
    padding-right: 8px;
    color: var(--text-muted);
    user-select: none;
    border-right: 1px solid var(--border);
    margin-right: 6px;
  }

  .diff-marker-col {
    width: 12px;
    min-width: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    font-weight: bold;
    margin-right: 4px;
  }

  .diff-text-col {
    flex: 1;
    white-space: pre;
  }

  /* Hunk Decorations */
  .hunk-decor-row {
    display: flex;
    align-items: center;
    padding: 4px 10px;
    color: var(--text-muted);
    background: var(--bg-secondary);
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    user-select: none;
    font-size: 11px;
    font-family: var(--editor-font-family, monospace);
  }

  /* Colors and Backgrounds */
  .diff-row.deletion {
    background: rgba(239, 68, 68, 0.08);
  }
  .diff-row.deletion .diff-text-col {
    color: var(--error);
  }
  .diff-row.deletion .diff-marker-col {
    color: var(--error);
  }

  .diff-row.addition {
    background: rgba(34, 197, 94, 0.08);
  }
  .diff-row.addition .diff-text-col {
    color: var(--success);
  }
  .diff-row.addition .diff-marker-col {
    color: var(--success);
  }

  .diff-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: var(--text-muted);
    gap: 8px;
    font-size: 12px;
  }

  .diff-empty {
    padding: 16px;
    color: var(--text-muted);
    font-size: 11.5px;
    text-align: center;
  }

  /* States */
  .sc-clean {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 12px;
    gap: 8px;
    flex: 1;
  }

  .sc-clean p {
    font-weight: 500;
  }

  .sc-clean .sub {
    font-size: 11px;
    color: var(--text-muted);
  }

  .sc-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 12px;
    gap: 8px;
    flex: 1;
  }

  .sc-error p {
    color: var(--error);
    font-size: 11px;
    word-break: break-word;
  }

  .btn-retry {
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    transition: background 0.15s;
    margin-top: 4px;
  }

  .btn-retry:hover {
    background: var(--bg-hover);
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  /* ── Responsiveness via Container Queries ── */
  @container review (max-width: 450px) {
    .toolbar-btn span {
      display: none;
    }
    .toolbar-btn {
      padding: 0;
      width: 22px;
      justify-content: center;
    }
  }

  @container review (max-width: 360px) {
    .stat-pill {
      display: none !important;
    }
    .file-card-header {
      padding: 6px;
      gap: 4px;
    }
    .header-actions {
      gap: 0px;
    }
    .file-path-container .icon-btn {
      display: none;
    }
    .tb-sep,
    .tb-item.stats-item {
      display: none !important;
    }
  }

  @container review (max-width: 320px) {
    .tb-item.branch-item {
      max-width: 70px;
    }
    .branch-name {
      max-width: 40px;
      text-overflow: ellipsis;
      overflow: hidden;
      white-space: nowrap;
    }
    .sc-toolbar {
      padding: 6px 8px;
    }
    .toolbar-left {
      gap: 4px;
    }
  }

  @container review (max-width: 280px) {
    .tb-item.branch-item .branch-name {
      display: none !important;
    }
    .tb-item.branch-item {
      padding: 0;
      width: 22px;
      justify-content: center;
      max-width: 22px !important;
    }
  }
</style>
