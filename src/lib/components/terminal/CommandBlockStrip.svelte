<script lang="ts">
  import { commandBlocks, toggleCommandBlockCollapse } from '$lib/stores/terminal';

  let { sessionId }: { sessionId: number } = $props();

  let blocks = $derived(($commandBlocks.get(sessionId) ?? []).slice(-10));

  function formatDuration(start: number, end?: number): string {
    const ms = (end ?? Date.now()) - start;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*[mGKHFABCDJrsu]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  }
</script>

{#if blocks.length > 0}
  <div class="block-strip">
    {#each blocks as block (block.id)}
      <div class="cmd-block" class:running={block.endTime === undefined}>
        <div class="cmd-header">
          <span class="cmd-status">
            {#if block.endTime === undefined}
              <span class="dot dot-running"></span>
            {:else if (block.exitCode ?? 0) === 0}
              <span class="dot dot-ok"></span>
            {:else}
              <span class="dot dot-err"></span>
            {/if}
          </span>
          <span class="cmd-text">{block.command}</span>
          <span class="cmd-duration">{formatDuration(block.startTime, block.endTime)}</span>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <span
            class="cmd-toggle"
            onclick={() => toggleCommandBlockCollapse(sessionId, block.id)}
            title={block.collapsed ? 'Expand output' : 'Collapse output'}
          >
            {block.collapsed ? '▸' : '▾'}
          </span>
        </div>
        {#if !block.collapsed && block.output}
          <pre class="cmd-output">{stripAnsi(block.output)}</pre>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .block-strip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 6px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    max-height: 220px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb, rgba(128,128,128,0.3)) transparent;
    flex-shrink: 0;
  }

  .cmd-block {
    border-radius: 5px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-primary);
  }

  .cmd-block.running {
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .cmd-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    cursor: default;
    user-select: none;
  }

  .cmd-status {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot-running {
    background: var(--accent, #7c6af7);
    animation: pulse 1.2s ease-in-out infinite;
  }

  .dot-ok {
    background: var(--success, #4ade80);
  }

  .dot-err {
    background: var(--error, #f85149);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .cmd-text {
    flex: 1;
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cmd-duration {
    font-size: 10.5px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .cmd-toggle {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0 2px;
    transition: color 0.12s;
    line-height: 1;
  }

  .cmd-toggle:hover {
    color: var(--text-primary);
  }

  .cmd-output {
    margin: 0;
    padding: 6px 8px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.45;
    color: var(--text-secondary);
    background: var(--editor-bg, var(--bg-primary));
    border-top: 1px solid var(--border);
    max-height: 180px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    scrollbar-width: thin;
  }
</style>
