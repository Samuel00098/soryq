<!-- DiffViewer.svelte — unified-diff viewer with inline / side-by-side modes
     and basic merge-conflict resolution. Rendered as a full-window overlay. -->
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { showToast } from '$lib/stores/notification';

  interface Props {
    projectId: string;
    filePath: string;
    conflicted?: boolean;
    onClose: () => void;
    onResolved?: () => void;
  }

  let { projectId, filePath, conflicted = false, onClose, onResolved }: Props = $props();

  type DiffLineType = 'context' | 'add' | 'del' | 'hunk';
  interface DiffLine {
    type: DiffLineType;
    oldNo: number | null;
    newNo: number | null;
    text: string;
  }

  let loading = $state(true);
  let error = $state<string | null>(null);
  let diffLines = $state<DiffLine[]>([]);
  let mode = $state<'inline' | 'split'>('inline');
  let resolving = $state(false);

  let fileName = $derived(filePath.split('/').pop() || filePath);
  let added = $derived(diffLines.filter((l) => l.type === 'add').length);
  let removed = $derived(diffLines.filter((l) => l.type === 'del').length);

  function parseDiff(diff: string): DiffLine[] {
    const lines = diff.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const out: DiffLine[] = [];
    let oldNo = 0;
    let newNo = 0;
    for (const line of lines) {
      if (line.startsWith('@@')) {
        const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) {
          oldNo = parseInt(m[1], 10);
          newNo = parseInt(m[2], 10);
        }
        out.push({ type: 'hunk', oldNo: null, newNo: null, text: line });
        continue;
      }
      if (
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('new file') ||
        line.startsWith('deleted file') ||
        line.startsWith('old mode') ||
        line.startsWith('new mode') ||
        line.startsWith('similarity ') ||
        line.startsWith('rename ')
      ) {
        continue;
      }
      if (line.startsWith('\\')) continue; // "\ No newline at end of file"
      if (line.startsWith('+')) {
        out.push({ type: 'add', oldNo: null, newNo: newNo++, text: line.slice(1) });
      } else if (line.startsWith('-')) {
        out.push({ type: 'del', oldNo: oldNo++, newNo: null, text: line.slice(1) });
      } else {
        const text = line.startsWith(' ') ? line.slice(1) : line;
        out.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text });
      }
    }
    return out;
  }

  interface SplitRow {
    left: DiffLine | null;
    right: DiffLine | null;
    hunk?: boolean;
  }

  let splitRows = $derived.by<SplitRow[]>(() => {
    const rows: SplitRow[] = [];
    let i = 0;
    while (i < diffLines.length) {
      const l = diffLines[i];
      if (l.type === 'hunk') {
        rows.push({ left: l, right: l, hunk: true });
        i++;
        continue;
      }
      if (l.type === 'context') {
        rows.push({ left: l, right: l });
        i++;
        continue;
      }
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < diffLines.length && diffLines[i].type === 'del') dels.push(diffLines[i++]);
      while (i < diffLines.length && diffLines[i].type === 'add') adds.push(diffLines[i++]);
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) {
        rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
      }
      if (dels.length === 0 && adds.length === 0) i++; // safety against loops
    }
    return rows;
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const diff = await invoke<string>('workspace_git_diff', { projectId, filePath });
      diffLines = parseDiff(diff);
    } catch (err) {
      error = String(err);
    } finally {
      loading = false;
    }
  }

  async function resolve(resolution: 'ours' | 'theirs' | 'both') {
    resolving = true;
    try {
      await invoke('workspace_resolve_conflict', { projectId, filePath, resolution });
      showToast('Conflict resolved', 'success');
      onResolved?.();
      onClose();
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      resolving = false;
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  $effect(() => {
    // re-load whenever the target file changes
    filePath;
    projectId;
    void load();
  });
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="diff-overlay" role="presentation" onclick={onClose}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="diff-modal" role="dialog" aria-modal="true" aria-label="Diff for {fileName}" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <div class="diff-header">
      <div class="diff-title">
        <span class="diff-file" title={filePath}>{fileName}</span>
        <span class="diff-path">{filePath}</span>
      </div>
      <div class="diff-stats">
        {#if conflicted}
          <span class="badge conflict">conflict</span>
        {/if}
        <span class="stat add">+{added}</span>
        <span class="stat del">−{removed}</span>
      </div>
      <div class="diff-actions">
        <div class="mode-toggle" role="tablist" aria-label="Diff view mode">
          <button class:active={mode === 'inline'} onclick={() => (mode = 'inline')} role="tab" aria-selected={mode === 'inline'}>Inline</button>
          <button class:active={mode === 'split'} onclick={() => (mode = 'split')} role="tab" aria-selected={mode === 'split'}>Split</button>
        </div>
        <button class="close-btn" onclick={onClose} title="Close (Esc)" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>

    {#if conflicted}
      <div class="conflict-bar">
        <span class="conflict-note">Merge conflict — choose how to resolve:</span>
        <div class="conflict-btns">
          <button onclick={() => resolve('ours')} disabled={resolving}>Accept Current</button>
          <button onclick={() => resolve('theirs')} disabled={resolving}>Accept Incoming</button>
          <button onclick={() => resolve('both')} disabled={resolving}>Accept Both</button>
        </div>
      </div>
    {/if}

    <div class="diff-body scrollable">
      {#if loading}
        <div class="diff-message">Loading diff…</div>
      {:else if error}
        <div class="diff-message error">{error}</div>
      {:else if diffLines.length === 0}
        <div class="diff-message">No changes to display.</div>
      {:else if mode === 'inline'}
        <table class="diff-table">
          <tbody>
            {#each diffLines as line}
              {#if line.type === 'hunk'}
                <tr class="row-hunk"><td class="ln"></td><td class="ln"></td><td class="code">{line.text}</td></tr>
              {:else}
                <tr class="row-{line.type}">
                  <td class="ln">{line.oldNo ?? ''}</td>
                  <td class="ln">{line.newNo ?? ''}</td>
                  <td class="code"
                    ><span class="sign">{line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}</span>{line.text}</td
                  >
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {:else}
        <table class="diff-table split">
          <tbody>
            {#each splitRows as row}
              {#if row.hunk}
                <tr class="row-hunk"><td class="ln"></td><td class="code" colspan="3">{row.left?.text}</td></tr>
              {:else}
                <tr>
                  <td class="ln">{row.left?.oldNo ?? ''}</td>
                  <td class="code side {row.left ? `row-${row.left.type}` : 'row-empty'}">{row.left ? row.left.text : ''}</td>
                  <td class="ln">{row.right?.newNo ?? ''}</td>
                  <td class="code side {row.right ? `row-${row.right.type}` : 'row-empty'}">{row.right ? row.right.text : ''}</td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
</div>

<style>
  .diff-overlay {
    position: fixed;
    inset: 0;
    background: var(--bg-glass, rgba(4, 4, 6, 0.6));
    backdrop-filter: blur(8px);
    z-index: 9998;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(12px, 4vh, 48px) clamp(12px, 4vw, 48px);
  }

  .diff-modal {
    width: 100%;
    max-width: 1100px;
    height: 100%;
    max-height: 900px;
    display: flex;
    flex-direction: column;
    background: rgba(var(--editor-bg-rgb, 24, 24, 30), var(--frost-chrome, 0.72));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--glass-shadow, var(--shadow-lg)), inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07));
    overflow: hidden;
  }

  .diff-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .diff-title {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .diff-file {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-path {
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff-stats {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .stat {
    font-size: 11.5px;
    font-weight: 600;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .stat.add {
    color: var(--success, #4ade80);
  }
  .stat.del {
    color: var(--error, #f87171);
  }

  .badge.conflict {
    font-size: 9.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--warning);
    background: color-mix(in srgb, var(--warning) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--warning) 40%, transparent);
    border-radius: 5px;
    padding: 1px 6px;
  }

  .diff-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .mode-toggle {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 7px;
    overflow: hidden;
  }

  .mode-toggle button {
    font-size: 11px;
    padding: 4px 10px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    cursor: pointer;
  }

  .mode-toggle button.active {
    background: var(--accent);
    color: var(--button-text, #fff);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--text-muted);
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .conflict-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--warning) 10%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--warning) 30%, transparent);
    flex-shrink: 0;
  }

  .conflict-note {
    font-size: 11.5px;
    color: var(--text-secondary);
  }

  .conflict-btns {
    display: flex;
    gap: 6px;
  }

  .conflict-btns button {
    font-size: 11px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
  }
  .conflict-btns button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .conflict-btns button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .diff-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .diff-message {
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }
  .diff-message.error {
    color: var(--error);
    white-space: pre-wrap;
    text-align: left;
    font-family: var(--font-mono, ui-monospace, monospace);
  }

  .diff-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 12px;
    line-height: 1.5;
  }

  .diff-table td {
    padding: 0 6px;
    vertical-align: top;
  }

  .ln {
    width: 1%;
    white-space: nowrap;
    text-align: right;
    color: var(--text-muted);
    opacity: 0.6;
    user-select: none;
    font-size: 10.5px;
    padding: 0 8px;
    border-right: 1px solid var(--border-subtle, var(--border));
  }

  .code {
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
  }

  .sign {
    display: inline-block;
    width: 1ch;
    user-select: none;
    opacity: 0.7;
  }

  .row-add .code,
  .code.row-add {
    background: color-mix(in srgb, var(--success, #4ade80) 14%, transparent);
    color: var(--text-primary);
  }
  .row-del .code,
  .code.row-del {
    background: color-mix(in srgb, var(--error, #f87171) 14%, transparent);
    color: var(--text-primary);
  }
  .row-hunk td,
  .row-hunk .code {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    font-size: 11px;
  }
  .code.row-empty {
    background: color-mix(in srgb, var(--text-muted) 6%, transparent);
  }

  .split .code.side {
    border-right: 1px solid var(--border-subtle, var(--border));
  }

  .scrollable::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .scrollable::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.15));
    border-radius: 4px;
  }
</style>
