<script lang="ts">
  import { tick } from 'svelte';
  import { getTaskTranscript, type OrchestratorTask, type ActivityKind } from '$lib/stores/orchestrator';

  let { task, open = $bindable(false) }: { task: OrchestratorTask; open?: boolean } = $props();

  let events = $derived(task.activity ?? []);
  let isLive = $derived(task.status === 'in-progress' && task.assignedSessionId != null);

  // Live transcript while running (poll the terminal buffer), stored snapshot otherwise.
  let transcript = $state('');
  $effect(() => {
    if (!open) return;
    transcript = getTaskTranscript(task);
    if (!isLive) return;
    const t = setInterval(() => { transcript = getTaskTranscript(task); }, 1200);
    return () => clearInterval(t);
  });

  // Keep the transcript pinned to the newest output while live.
  let outputEl = $state<HTMLPreElement | null>(null);
  let pinned = $state(true);
  function onScroll() {
    if (!outputEl) return;
    pinned = outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 24;
  }
  $effect(() => {
    void transcript;
    if (open && isLive && pinned && outputEl) {
      tick().then(() => { if (outputEl) outputEl.scrollTop = outputEl.scrollHeight; });
    }
  });

  const KIND_COLOR: Record<ActivityKind, string> = {
    dispatch: 'var(--accent)',
    goal: '#60a5fa',
    'follow-up': '#60a5fa',
    review: 'var(--accent)',
    finished: 'var(--success, #4ade80)',
    approved: 'var(--success, #4ade80)',
    blocked: 'var(--warning, #fbbf24)',
    changes: 'var(--warning, #fbbf24)',
    failed: 'var(--error, #f87171)',
    cancelled: 'var(--text-muted)',
    released: 'var(--text-muted)',
    info: 'var(--text-muted)',
  };

  function relTime(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
</script>

<div class="activity">
  <button class="activity-toggle" class:open onclick={() => (open = !open)} aria-expanded={open} title={open ? 'Hide history' : 'Show history'}>
    <span class="activity-head">
      <span class="activity-head-left">
        <svg class="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <svg class="history-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7"/>
          <polyline points="3 3 3 9 9 9"/>
          <path d="M12 7v5l3 2"/>
        </svg>
        <span class="activity-label">History</span>
      </span>
      <span class="activity-head-right">
        {#if events.length > 0}<span class="activity-count">{events.length}</span>{/if}
        {#if isLive}<span class="live-dot" title="Recording"></span>{/if}
      </span>
    </span>
  </button>

  {#if open}
    <div class="activity-body">
      <div class="section-head">
        <span>History</span>
        {#if events.length > 0}<span class="section-meta">{events.length} events</span>{/if}
      </div>
      {#if events.length > 0}
        <ul class="timeline">
          {#each events as ev (ev.id)}
            <li class="event">
              <span class="event-dot" style="--ec: {KIND_COLOR[ev.kind]};"></span>
              <span class="event-text">{ev.text}</span>
              <span class="event-time">{relTime(ev.ts)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="history-empty">No recorded history yet.</p>
      {/if}

      <div class="output-head">
        <span>Terminal transcript</span>
        {#if isLive}<span class="output-live">live</span>{/if}
      </div>
      {#if transcript}
        <pre class="output" bind:this={outputEl} onscroll={onScroll}>{transcript}</pre>
      {:else}
        <p class="output-empty">No terminal output captured yet.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .activity { display: flex; flex-direction: column; }

  .activity-toggle {
    display: flex; flex-direction: column; gap: 3px; align-items: stretch; width: 100%;
    font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--text-muted); background: transparent; border: 0; padding: 4px 2px 2px; margin: 0;
    cursor: pointer; transition: color 0.12s; text-align: left;
  }
  .activity-toggle:hover { color: var(--text-secondary); }
  .activity-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0;
  }
  .activity-head-left,
  .activity-head-right {
    display: inline-flex; align-items: center; gap: 5px; min-width: 0;
  }
  .chev { transition: transform 0.15s ease; flex-shrink: 0; }
  .activity-toggle.open .chev { transform: rotate(90deg); }
  .history-icon { flex-shrink: 0; opacity: 0.92; }
  .activity-label { min-width: 0; }
  .activity-count {
    font-size: 9px; font-weight: 600; color: var(--text-secondary);
    background: var(--bg-hover); border-radius: 8px; padding: 0 5px; line-height: 14px;
  }
  .live-dot {
    width: 5px; height: 5px; border-radius: 50%; background: var(--error, #f87171);
    animation: a-pulse 1.4s ease-in-out infinite;
  }
  @keyframes a-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }

  .activity-body { display: flex; flex-direction: column; gap: 7px; padding: 4px 0 2px; }
  .section-head,
  .output-head {
    display: flex; align-items: center; gap: 6px;
    font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .section-meta { font-size: 8.5px; letter-spacing: 0.02em; text-transform: none; }

  .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .event { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
  .event-dot {
    width: 6px; height: 6px; border-radius: 50%; background: var(--ec); flex-shrink: 0;
    transform: translateY(1px);
  }
  .event-text {
    flex: 1; min-width: 0; font-size: 10.5px; line-height: 1.4; color: var(--text-secondary);
    word-break: break-word;
  }
  .event-time { font-size: 9px; color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .history-empty,
  .output-empty {
    margin: 0; font-size: 10.5px; color: var(--text-muted); font-style: italic;
  }

  .output-live {
    font-size: 8.5px; color: var(--error, #f87171); border: 1px solid color-mix(in srgb, var(--error, #f87171) 40%, transparent);
    border-radius: 4px; padding: 0 4px; letter-spacing: 0.02em;
  }
  .output {
    margin: 0; max-height: 200px; overflow: auto;
    padding: 8px 9px; border-radius: 7px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.55);
    border: 1px solid var(--border);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 10.5px; line-height: 1.45; color: var(--text-secondary);
    white-space: pre-wrap; word-break: break-word;
    scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent;
  }
</style>
