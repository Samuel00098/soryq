<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { activeProject } from '$lib/stores/workspace';
  import {
    getProjectChat,
    loadProjectOrchestratorTasks,
    clearProjectChat,
    sendChatMessage,
    agentCenterOpen,
  } from '$lib/stores/orchestrator';
  import { settingsOpen } from '$lib/stores/layout';
  import { detectAgentAccess, type AgentAccessStatus } from '$lib/services/agent-access';
  import { getAgentDisplayName } from '$lib/stores/terminal';

  // ── project derived state ───────────────────────────────────────────────────
  let projectId   = $derived($activeProject?.id ?? '');
  let rootPath    = $derived($activeProject?.root_path ?? '');
  let projectName = $derived($activeProject?.name ?? '');

  let chatStore  = $derived(getProjectChat(projectId));
  let messages   = $derived($chatStore);

  // ── agent access ────────────────────────────────────────────────────────────
  let agentAccess: AgentAccessStatus = $state({
    ready: false, via: 'none' as const, providerId: null, message: 'Checking...',
  });
  let checkingAgentAccess = $state(true);
  let settingsWereOpen    = $state(false);

  async function refreshAgentAccess() {
    checkingAgentAccess = true;
    try { agentAccess = await detectAgentAccess(); }
    finally { checkingAgentAccess = false; }
  }

  $effect(() => {
    if ($settingsOpen) { settingsWereOpen = true; return; }
    if (settingsWereOpen) { settingsWereOpen = false; void refreshAgentAccess(); }
  });

  $effect(() => {
    const project = $activeProject;
    if (project) void loadProjectOrchestratorTasks(project);
  });

  // ── scroll management ───────────────────────────────────────────────────────
  let scrollEl        = $state<HTMLDivElement | null>(null);
  let isStuckToBottom = $state(true);

  function handleScroll() {
    if (!scrollEl) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollEl;
    isStuckToBottom = scrollHeight - scrollTop - clientHeight < 60;
  }

  $effect(() => {
    void messages.length;
    if (scrollEl && isStuckToBottom) {
      tick().then(() => {
        if (scrollEl && isStuckToBottom) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  });

  // ── drag + resize state ─────────────────────────────────────────────────────
  let panelEl     = $state<HTMLDivElement | null>(null);
  let dragged     = $state(false);
  let posLeft     = $state(0);
  let posTop      = $state(0);
  let resized     = $state(false);
  let panelWidth  = $state(380);
  let panelHeight = $state(400);

  let panelStyle = $derived(
    [
      dragged  ? `left:${posLeft}px;top:${posTop}px;` : '',
      resized  ? `width:${panelWidth}px;height:${panelHeight}px;` : '',
    ].filter(Boolean).join('')
  );

  function startDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select')) return;

    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    if (!dragged && panelEl) {
      const rect = panelEl.getBoundingClientRect();
      posLeft = rect.left;
      posTop  = rect.top;
      dragged = true;
    }

    const startClientX = e.clientX - posLeft;
    const startClientY = e.clientY - posTop;

    function onMove(me: PointerEvent) {
      me.preventDefault();
      posLeft = Math.max(8, Math.min(me.clientX - startClientX, window.innerWidth  - (panelEl?.offsetWidth  ?? 440) - 8));
      posTop  = Math.max(8, Math.min(me.clientY - startClientY, window.innerHeight - (panelEl?.offsetHeight ?? 400) - 8));
    }
    function onUp() {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup',   onUp);
      handle.removeEventListener('pointercancel', onUp);
    }
    handle.addEventListener('pointermove',  onMove);
    handle.addEventListener('pointerup',    onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function startResize(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    if (!resized && panelEl) {
      const rect = panelEl.getBoundingClientRect();
      panelWidth  = rect.width;
      panelHeight = rect.height;
      resized = true;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = panelWidth;
    const startH = panelHeight;

    function onMove(me: PointerEvent) {
      panelWidth  = Math.max(320, Math.min(me.clientX - startX + startW, window.innerWidth  - 32));
      panelHeight = Math.max(200, Math.min(me.clientY - startY + startH, window.innerHeight - 80));
    }
    function onUp() {
      handle.removeEventListener('pointermove',  onMove);
      handle.removeEventListener('pointerup',    onUp);
      handle.removeEventListener('pointercancel', onUp);
    }
    handle.addEventListener('pointermove',  onMove);
    handle.addEventListener('pointerup',    onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  // ── agent colors ────────────────────────────────────────────────────────────
  const AGENT_COLORS: Record<string, string> = {
    claude: '#d97757', codex: '#10a37f', agy: '#a78bfa', antigravity: '#a78bfa',
    opencode: '#60a5fa', pi: '#f472b6', omp: '#fbbf24', 'oh-my-pi': '#fbbf24',
    agent: '#22d3ee', cursor: '#22d3ee',
  };
  const agentColor = (cmd: string | null | undefined) => (cmd && AGENT_COLORS[cmd]) || '#9ca3af';

  // ── helpers ──────────────────────────────────────────────────────────────────
  function formatSecs(s: number | null | undefined): string {
    if (s == null) return '';
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  onMount(() => { void refreshAgentAccess(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="orc"
  class:dragged
  class:resized
  bind:this={panelEl}
  style={panelStyle}
  role="dialog"
  aria-label="Orchestrator"
>
  <!-- ── Header / drag handle ──────────────────────────────────────────────── -->
  <div class="orc-header" onpointerdown={startDrag}>
    <div class="orc-title">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="10" rx="2"/>
        <path d="M12 7v4"/>
        <circle cx="12" cy="5" r="2"/>
      </svg>
      Orchestrator
    </div>
    <div class="orc-header-right">
      {#if messages.length > 0}
        <button class="orc-icon-btn" onclick={() => clearProjectChat(projectId)} title="Clear conversation" aria-label="Clear conversation">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      {/if}
      <button class="orc-icon-btn close" onclick={() => agentCenterOpen.set(false)} title="Close" aria-label="Close orchestrator panel">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>

  {#if !checkingAgentAccess && !agentAccess.ready}
    <div class="orc-lock-banner">{agentAccess.message}</div>
  {/if}

  <!-- ── Chat transcript ────────────────────────────────────────────────────── -->
  <div class="orc-scroll" bind:this={scrollEl} onscroll={handleScroll}>
    {#if messages.length === 0}
      <div class="orc-empty">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="10" rx="2"/>
          <path d="M12 7v4"/>
          <circle cx="12" cy="5" r="2"/>
        </svg>
        <span>Ask me about your project, tell me to open files or pages, or describe what to build — I'll handle it or put an agent on it.</span>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        {#if msg.role === 'user'}
          <div class="orc-msg user"><div class="orc-bubble">{msg.text}</div></div>
        {:else}
          <div class="orc-msg assistant">
            <div class="orc-bubble" class:completion-bubble={!!msg.completion}>
              {#if msg.pending}
                <span class="orc-typing"><span></span><span></span><span></span></span>
              {:else}
                {#if msg.reconSummary}
                  <div class="orc-recon">{msg.reconSummary}</div>
                {/if}
                {#if msg.completion}
                  {@const c = msg.completion}
                  <div class="orc-completion orc-completion-{c.status}">
                    <span class="orc-comp-icon">{c.status === 'done' ? '✅' : c.status === 'failed' ? '❌' : '⚠️'}</span>
                    <div class="orc-comp-body">
                      <span class="orc-comp-headline">
                        {c.agentName}
                        <span class="orc-comp-status">{c.status === 'done' ? 'finished' : c.status === 'failed' ? 'failed' : 'needs input'}</span>
                        {#if c.elapsedSec != null}<span class="orc-comp-time">· {formatSecs(c.elapsedSec)}</span>{/if}
                      </span>
                      <span class="orc-comp-task" title={c.taskTitle}>{c.taskTitle}</span>
                      {#if c.reason}<span class="orc-comp-reason">{c.reason}</span>{/if}
                      {#if c.summaryPending}
                        <span class="orc-comp-loading"><span class="orc-typing-sm"><span></span><span></span><span></span></span>Summarizing…</span>
                      {:else if c.summary}
                        <p class="orc-comp-summary">{c.summary}</p>
                      {/if}
                    </div>
                  </div>
                {:else}
                  {msg.text}
                {/if}
                {#if msg.dispatched && msg.dispatched.length > 0}
                  <div class="orc-chips">
                    {#each msg.dispatched as d (d.taskId)}
                      <span class="orc-chip" style="--c: {agentColor(d.agent)};">
                        <span class="chip-dot"></span>
                        <span>{d.via === 'send' ? 'Sent to' : 'Dispatched to'} {d.name || d.agent}</span>
                      </span>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  <!-- ── Resize handle ─────────────────────────────────────────────────────── -->
  <div class="orc-resize-handle" onpointerdown={startResize} aria-hidden="true"></div>
</div>

<style>
  /* ── Panel shell ─────────────────────────────────────────────────────────── */
  .orc {
    position: fixed;
    bottom: calc(160px * var(--ui-zoom-percent, 100) / 100);
    left: 50%;
    transform: translateX(-50%);
    width: min(380px, calc(100vw - 32px));
    height: 400px;
    max-height: calc(100vh - 180px);
    display: flex;
    flex-direction: column;
    z-index: 200;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
    backdrop-filter: blur(var(--glass-blur, 24px)) saturate(var(--glass-saturate, 140%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 24px)) saturate(var(--glass-saturate, 140%));
    box-shadow:
      var(--glass-shadow, 0 28px 64px -20px rgba(0,0,0,0.7)),
      inset 0 1px 0 var(--glass-rim-strong, rgba(255,255,255,0.13)),
      0 0 0 1px color-mix(in srgb, var(--accent) 10%, transparent);
    overflow: hidden;
  }
  .orc.dragged { bottom: unset; left: unset; transform: none; }
  .orc.resized { max-height: unset; }

  /* ── Header ──────────────────────────────────────────────────────────────── */
  .orc-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px 7px;
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 10%, var(--border));
    cursor: grab;
    flex-shrink: 0;
    touch-action: none;
    user-select: none;
  }
  .orc-header:active { cursor: grabbing; }
  .orc-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--accent);
    pointer-events: none;
  }
  .orc-header-right {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
    cursor: default;
  }
  .orc-icon-btn {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }
  .orc-icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .orc-icon-btn.close:hover { background: color-mix(in srgb, var(--error) 14%, var(--bg-primary)); color: var(--error); }

  /* ── Lock banner ─────────────────────────────────────────────────────────── */
  .orc-lock-banner {
    padding: 6px 12px;
    font-size: 10.5px;
    color: var(--warning, #fbbf24);
    background: color-mix(in srgb, var(--warning, #fbbf24) 8%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--warning, #fbbf24) 20%, var(--border));
    flex-shrink: 0;
  }

  /* ── Scroll body ─────────────────────────────────────────────────────────── */
  .orc-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb, rgba(128,128,128,0.2)) transparent;
    user-select: text;
    padding: 10px 12px;
    gap: 8px;
  }

  /* ── Empty state ─────────────────────────────────────────────────────────── */
  .orc-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 20px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.5;
    margin: auto;
  }
  .orc-empty svg { opacity: 0.3; color: var(--accent); }

  /* ── Chat bubbles ────────────────────────────────────────────────────────── */
  .orc-msg { display: flex; }
  .orc-msg.user { justify-content: flex-end; }
  .orc-msg.assistant { justify-content: flex-start; }
  .orc-bubble {
    max-width: 88%;
    font-size: 12px;
    line-height: 1.5;
    padding: 8px 11px;
    border-radius: 12px;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .orc-msg.user .orc-bubble {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-primary));
    color: var(--text-primary);
    border-radius: 12px 12px 4px 12px;
  }
  .orc-msg.assistant .orc-bubble {
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 12px 12px 12px 4px;
  }
  .orc-msg.assistant .orc-bubble.completion-bubble { background: transparent; border: none; padding: 0; max-width: 95%; }

  /* ── Typing dots ─────────────────────────────────────────────────────────── */
  .orc-typing { display: inline-flex; gap: 3px; padding: 2px 0; }
  .orc-typing span { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); animation: orc-dot 1.2s ease-in-out infinite; }
  .orc-typing span:nth-child(2) { animation-delay: 0.18s; }
  .orc-typing span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes orc-dot { 0%,60%,100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

  /* ── Recon summary ───────────────────────────────────────────────────────── */
  .orc-recon {
    font-size: 10px;
    line-height: 1.5;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    padding: 5px 7px;
    margin-bottom: 4px;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    border-radius: 7px;
    border: 1px solid color-mix(in srgb, var(--accent) 15%, var(--border));
  }

  /* ── Completion cards ────────────────────────────────────────────────────── */
  .orc-completion {
    --cc: var(--success, #4ade80);
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 9px;
    background: color-mix(in srgb, var(--cc) 8%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--cc) 24%, var(--border));
  }
  .orc-completion-failed  { --cc: var(--error, #f87171); }
  .orc-completion-blocked { --cc: var(--warning, #fbbf24); }
  .orc-comp-icon { font-size: 13px; flex-shrink: 0; margin-top: 1px; }
  .orc-comp-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .orc-comp-headline { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 11px; font-weight: 650; color: var(--text-primary); }
  .orc-comp-status { color: var(--cc); }
  .orc-comp-time { font-size: 10px; color: var(--text-muted); }
  .orc-comp-task { font-size: 10.5px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .orc-comp-reason { font-size: 10px; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; }
  .orc-comp-summary { margin: 3px 0 0; font-size: 10.5px; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; }
  .orc-comp-loading { display: inline-flex; align-items: center; gap: 5px; margin-top: 3px; font-size: 10px; color: var(--text-muted); font-style: italic; }
  .orc-typing-sm { display: inline-flex; gap: 2px; }
  .orc-typing-sm span { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); animation: orc-dot 1.2s ease-in-out infinite; }
  .orc-typing-sm span:nth-child(2) { animation-delay: 0.2s; }
  .orc-typing-sm span:nth-child(3) { animation-delay: 0.4s; }

  /* ── Dispatch chips ──────────────────────────────────────────────────────── */
  .orc-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
  .orc-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 550;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--c, var(--accent)) 10%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--c, var(--accent)) 28%, var(--border));
    border-radius: 7px;
    padding: 3px 8px;
  }
  .chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c, var(--accent)); flex-shrink: 0; }

  /* ── Resize handle ───────────────────────────────────────────────────────── */
  .orc-resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 18px;
    height: 18px;
    cursor: se-resize;
    touch-action: none;
    background: linear-gradient(
      135deg,
      transparent 40%,
      color-mix(in srgb, var(--border) 60%, transparent) 41%,
      color-mix(in srgb, var(--border) 60%, transparent) 43%,
      transparent 44%,
      transparent 57%,
      color-mix(in srgb, var(--border) 60%, transparent) 58%,
      color-mix(in srgb, var(--border) 60%, transparent) 60%,
      transparent 61%,
      transparent 74%,
      color-mix(in srgb, var(--border) 60%, transparent) 75%,
      color-mix(in srgb, var(--border) 60%, transparent) 77%,
      transparent 78%
    );
    border-bottom-right-radius: 16px;
    z-index: 5;
    opacity: 0.5;
    transition: opacity 0.15s;
  }
  .orc-resize-handle:hover { opacity: 1; }
</style>
