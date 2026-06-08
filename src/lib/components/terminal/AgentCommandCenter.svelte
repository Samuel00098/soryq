<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { activeProject } from '$lib/stores/workspace';
  import {
    getProjectOrchestratorTasks,
    getProjectChat,
    loadProjectOrchestratorTasks,
    clearProjectChat,
    getDispatchableAgents,
    resumeBlockedOrchestratorTask,
    cancelOrchestratorTask,
    approveOrchestratorTask,
    requestOrchestratorTaskChanges,
    sendChatMessage,
    agentCenterOpen,
    agentForcedAgent,
    type OrchestratorTask,
  } from '$lib/stores/orchestrator';
  import { sessions, setActiveSession, getSessionLabel, getAgentDisplayName } from '$lib/stores/terminal';
  import { settingsOpen, showTerminal } from '$lib/stores/layout';
  import { showToast } from '$lib/stores/notification';
  import { detectAgentAccess, type AgentAccessStatus } from '$lib/services/agent-access';
  import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.svelte';
  import AgentActivity from '$lib/components/orchestrator/AgentActivity.svelte';

  // ── project derived state ───────────────────────────────────────────────────
  let projectId   = $derived($activeProject?.id ?? '');
  let rootPath    = $derived($activeProject?.root_path ?? '');
  let projectName = $derived($activeProject?.name ?? '');

  let chatStore  = $derived(getProjectChat(projectId));
  let messages   = $derived($chatStore);

  let tasksStore   = $derived(getProjectOrchestratorTasks(projectId));
  let runningTasks = $derived($tasksStore.filter((t) => t.status === 'in-progress'));
  let blockedTasks = $derived($tasksStore.filter((t) => t.status === 'blocked'));
  let reviewTasks  = $derived($tasksStore.filter((t) => t.status === 'in-review'));
  let historyTasks = $derived(
    $tasksStore
      .filter((t) => ['complete', 'failed', 'cancelled', 'todo'].includes(t.status))
      .sort((a, b) => (b.completedAt ?? b.startedAt ?? b.createdAt) - (a.completedAt ?? a.startedAt ?? a.createdAt))
      .slice(0, 20)
  );
  let attentionCount = $derived(blockedTasks.length + reviewTasks.length);

  // ── task management state ───────────────────────────────────────────────────
  let blockedReplyByTask   = $state<Record<string, string>>({});
  let blockedResumePending = $state<Record<string, boolean>>({});
  let reviewNoteByTask     = $state<Record<string, string>>({});
  let detailsOpen          = $state(false);

  $effect(() => {
    if (attentionCount > 0) detailsOpen = true;
  });

  // ── agent routing ───────────────────────────────────────────────────────────
  const AGENT_COLORS: Record<string, string> = {
    claude: '#d97757', codex: '#10a37f', agy: '#a78bfa', antigravity: '#a78bfa',
    opencode: '#60a5fa', pi: '#f472b6', omp: '#fbbf24', 'oh-my-pi': '#fbbf24',
    agent: '#22d3ee', cursor: '#22d3ee',
  };
  const agentColor = (cmd: string | null | undefined) => (cmd && AGENT_COLORS[cmd]) || '#9ca3af';
  const agentLabel = (cmd: string | null | undefined) => (cmd ? getAgentDisplayName(cmd) ?? cmd : '');

  let agentOptions = $derived<DropdownOption[]>([
    { value: 'auto', label: 'Auto', sublabel: 'choose for me' },
    ...getDispatchableAgents(projectId).map((a) => ({
      value: a.command, label: a.name, sublabel: a.command, color: agentColor(a.command),
    })),
  ]);

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
  let panelWidth  = $state(500);
  let panelHeight = $state(480);

  let panelStyle = $derived(
    [
      dragged  ? `left:${posLeft}px;top:${posTop}px;` : '',
      resized  ? `width:${panelWidth}px;height:${panelHeight}px;` : '',
    ].filter(Boolean).join('')
  );

  function startDrag(e: PointerEvent) {
    if (e.button !== 0) return;
    // Don't drag when clicking interactive children (buttons, inputs, etc.)
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="listbox"]')) return;

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
      posLeft = Math.max(8, Math.min(me.clientX - startClientX, window.innerWidth  - (panelEl?.offsetWidth  ?? 480) - 8));
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

  // ── helpers ──────────────────────────────────────────────────────────────────
  function formatTimestamp(ts: number | null | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function formatSecs(s: number | null | undefined): string {
    if (s == null) return '';
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  const STATUS_LABELS: Record<string, string>  = { complete: 'Done', failed: 'Failed', cancelled: 'Cancelled', todo: 'Queued' };
  const STATUS_CLASSES: Record<string, string> = { complete: 'success', failed: 'error', cancelled: 'muted', todo: 'muted' };

  async function resumeBlockedTask(taskId: string) {
    if (blockedResumePending[taskId] || !rootPath) return;
    blockedResumePending = { ...blockedResumePending, [taskId]: true };
    try {
      const resumed = await resumeBlockedOrchestratorTask(taskId, blockedReplyByTask[taskId] ?? '', rootPath);
      if (resumed) blockedReplyByTask = { ...blockedReplyByTask, [taskId]: '' };
    } finally {
      blockedResumePending = { ...blockedResumePending, [taskId]: false };
    }
  }

  async function rerunTask(task: OrchestratorTask) {
    if (!task.goal || !task.agentPreset || !rootPath) return;
    await sendChatMessage(projectId, rootPath, task.goal, { projectName, forcedAgent: task.agentPreset });
  }

  function taskSessionId(taskId: string | null | undefined): number | null {
    if (!taskId) return null;
    return $tasksStore.find((t) => t.id === taskId)?.assignedSessionId ?? null;
  }

  function owningTerminalLabel(sessionId: number | null | undefined): string | null {
    if (sessionId == null) return null;
    const session = $sessions.find((s) => s.id === sessionId);
    return session ? getSessionLabel(session, $sessions) : null;
  }

  function focusTerminal(sessionId: number | null | undefined) {
    if (sessionId == null) return;
    showTerminal();
    setActiveSession(sessionId);
  }

  onMount(() => { void refreshAgentAccess(); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="acc"
  class:dragged
  class:resized
  bind:this={panelEl}
  style={panelStyle}
  role="dialog"
  aria-label="Agent Command Center"
>
  <!-- ── Header / drag handle ──────────────────────────────────────────────── -->
  <div class="acc-header" onpointerdown={startDrag}>
    <div class="acc-title">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="11" width="18" height="10" rx="2"/>
        <path d="M12 7v4"/>
        <circle cx="12" cy="5" r="2"/>
        <path d="M8 16h.01M16 16h.01"/>
        <path d="M5 11V9a7 7 0 0 1 14 0v2"/>
      </svg>
      Agent
    </div>
    <div class="acc-header-right">
      <span class="acc-route-label">Route</span>
      <div class="acc-agent-select">
        <Dropdown
          options={agentOptions}
          value={$agentForcedAgent}
          onChange={(v) => agentForcedAgent.set(v)}
          ariaLabel="Agent routing"
        />
      </div>
      {#if messages.length > 0}
        <button
          class="acc-icon-btn"
          onclick={() => clearProjectChat(projectId)}
          title="Clear conversation"
          aria-label="Clear conversation"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      {/if}
      <button
        class="acc-icon-btn close"
        onclick={() => agentCenterOpen.set(false)}
        title="Close"
        aria-label="Close agent panel"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>

  {#if !checkingAgentAccess && !agentAccess.ready}
    <div class="acc-lock-banner">{agentAccess.message}</div>
  {/if}

  <!-- ── Scrollable body ───────────────────────────────────────────────────── -->
  <div class="acc-scroll" bind:this={scrollEl} onscroll={handleScroll}>

    <!-- Running tasks strip -->
    {#if runningTasks.length > 0}
      <div class="acc-section running-strip">
        <div class="acc-section-head">
          <span class="acc-section-label">Running</span>
          <button
            class="acc-tasks-toggle"
            onclick={() => detailsOpen = !detailsOpen}
            title={detailsOpen ? 'Hide details' : 'Show details'}
          >
            {detailsOpen ? 'Hide details' : 'Details'}
            {#if attentionCount > 0}
              <span class="acc-attn-badge">{attentionCount}</span>
            {/if}
          </button>
        </div>
        {#each runningTasks as task (task.id)}
          {@const activity = task.activity ?? []}
          {@const lastAct  = activity[activity.length - 1]}
          {@const sid      = task.assignedSessionId}
          <div class="running-item" style="--c: {agentColor(task.agentPreset)};">
            <span class="running-dot"></span>
            <div class="running-body">
              <span class="running-name">{task.name || agentLabel(task.agentPreset)}</span>
              <span class="running-title">{task.title}</span>
              <span class="running-status">{lastAct?.text ?? (task.promptSentAt == null ? 'Starting…' : 'Working…')}</span>
            </div>
            {#if sid != null}
              <button
                class="running-jump"
                onclick={() => focusTerminal(sid)}
                title="View in terminal"
                aria-label="View in terminal"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                  <line x1="5" y1="12" x2="19" y2="12"/>
                  <polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Attention banner (when tasks need review but details panel is closed) -->
    {#if attentionCount > 0 && !detailsOpen}
      <div class="acc-attention">
        <span>{attentionCount} {attentionCount === 1 ? 'agent update needs you' : 'agent updates need you'}</span>
        <button class="acc-link" onclick={() => detailsOpen = true}>View</button>
      </div>
    {/if}

    <!-- Blocked tasks -->
    {#if detailsOpen && blockedTasks.length > 0}
      <div class="acc-section">
        {#each blockedTasks as task (task.id)}
          <div class="acc-card blocked">
            <div class="acc-card-head">
              <span class="acc-badge warn">Needs you</span>
              <span class="acc-card-title" title={task.goal}>{task.title}</span>
            </div>
            {#if task.blockedReason}<span class="acc-card-reason">{task.blockedReason}</span>{/if}
            <textarea
              class="acc-note"
              rows="1"
              placeholder="Reply to continue, or leave blank…"
              bind:value={blockedReplyByTask[task.id]}
            ></textarea>
            <div class="acc-card-actions">
              <button class="acc-btn primary" disabled={blockedResumePending[task.id]} onclick={() => void resumeBlockedTask(task.id)}>
                {blockedResumePending[task.id] ? 'Resuming…' : 'Resume'}
              </button>
              <button class="acc-btn danger" onclick={() => cancelOrchestratorTask(task.id)}>Dismiss</button>
            </div>
            <AgentActivity {task} />
          </div>
        {/each}
      </div>
    {/if}

    <!-- In-review tasks -->
    {#if detailsOpen && reviewTasks.length > 0}
      <div class="acc-section">
        {#each reviewTasks as task (task.id)}
          <div class="acc-card review">
            <div class="acc-card-head">
              <span class="acc-badge accent">Review</span>
              <span class="acc-card-title" title={task.goal}>{task.title}</span>
              {#if task.worktree}<span class="acc-branch">{task.worktree.branchName}</span>{/if}
            </div>
            <textarea
              class="acc-note"
              rows="1"
              placeholder="Optional note…"
              bind:value={reviewNoteByTask[task.id]}
            ></textarea>
            <div class="acc-card-actions">
              <button class="acc-btn approve" onclick={() => { approveOrchestratorTask(task.id); reviewNoteByTask = { ...reviewNoteByTask, [task.id]: '' }; }}>Approve</button>
              <button class="acc-btn primary" onclick={() => { requestOrchestratorTaskChanges(task.id, reviewNoteByTask[task.id] ?? ''); reviewNoteByTask = { ...reviewNoteByTask, [task.id]: '' }; }}>Another pass</button>
              <button class="acc-btn danger" onclick={() => cancelOrchestratorTask(task.id)}>Cancel</button>
            </div>
            <AgentActivity {task} />
          </div>
        {/each}
      </div>
    {/if}

    <!-- Chat transcript -->
    <div class="acc-transcript">
      {#if messages.length === 0}
        <div class="acc-empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="11" width="18" height="10" rx="2"/>
            <path d="M12 7v4"/>
            <circle cx="12" cy="5" r="2"/>
            <path d="M8 16h.01M16 16h.01"/>
            <path d="M5 11V9a7 7 0 0 1 14 0v2"/>
          </svg>
          <span>Type a goal below — the agent will get to work in a terminal.</span>
        </div>
      {:else}
        {#each messages as msg (msg.id)}
          {#if msg.role === 'user'}
            <div class="acc-msg user"><div class="acc-bubble">{msg.text}</div></div>
          {:else}
            <div class="acc-msg assistant">
              <div class="acc-bubble" class:completion-bubble={!!msg.completion}>
                {#if msg.pending}
                  <span class="acc-typing"><span></span><span></span><span></span></span>
                {:else}
                  {#if msg.reconSummary}
                    <div class="acc-recon">{msg.reconSummary}</div>
                  {/if}
                  {#if msg.completion}
                    {@const c = msg.completion}
                    <div class="acc-completion acc-completion-{c.status}">
                      <span class="acc-comp-icon">{c.status === 'done' ? '✅' : c.status === 'failed' ? '❌' : '⚠️'}</span>
                      <div class="acc-comp-body">
                        <span class="acc-comp-headline">
                          {c.agentName}
                          <span class="acc-comp-status">{c.status === 'done' ? 'finished' : c.status === 'failed' ? 'failed' : 'needs input'}</span>
                          {#if c.elapsedSec != null}<span class="acc-comp-time">· {formatSecs(c.elapsedSec)}</span>{/if}
                        </span>
                        <span class="acc-comp-task" title={c.taskTitle}>{c.taskTitle}</span>
                        {#if c.reason}<span class="acc-comp-reason">{c.reason}</span>{/if}
                        {#if c.summaryPending}
                          <span class="acc-comp-loading"><span class="acc-typing-sm"><span></span><span></span><span></span></span>Summarizing…</span>
                        {:else if c.summary}
                          <p class="acc-comp-summary">{c.summary}</p>
                        {/if}
                      </div>
                    </div>
                  {:else}
                    {msg.text}
                  {/if}
                  {#if msg.dispatched && msg.dispatched.length > 0}
                    <div class="acc-chips">
                      {#each msg.dispatched as d (d.taskId)}
                        {@const sid = taskSessionId(d.taskId)}
                        {@const tlabel = owningTerminalLabel(sid)}
                        <button class="acc-chip" style="--c: {agentColor(d.agent)};" onclick={() => focusTerminal(sid)}>
                          <span class="chip-dot"></span>
                          <span>{d.via === 'send' ? 'Sent to' : 'Dispatched to'} {d.name || agentLabel(d.agent)}{tlabel ? ` · ${tlabel}` : ''}</span>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                          </svg>
                        </button>
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

    <!-- Task history -->
    {#if detailsOpen && historyTasks.length > 0}
      <div class="acc-history-section">
        <div class="acc-history-toggle">
          History
          <span class="acc-history-count">{historyTasks.length}</span>
        </div>
        <div class="acc-history-list">
          {#each historyTasks as task (task.id)}
            <div class="acc-hist-row">
              <span class="acc-hist-badge acc-hist-{STATUS_CLASSES[task.status] ?? 'muted'}">{STATUS_LABELS[task.status] ?? task.status}</span>
              <span class="acc-hist-agent" style="--c: {agentColor(task.agentPreset)};"><span class="acc-hist-dot"></span>{task.name || agentLabel(task.agentPreset)}</span>
              <span class="acc-hist-title" title={task.goal}>{task.title}</span>
              <span class="acc-hist-time">{formatTimestamp(task.completedAt ?? task.startedAt ?? task.createdAt)}</span>
              {#if (task.status === 'failed' || task.status === 'cancelled') && task.agentPreset}
                <button class="acc-hist-rerun" onclick={() => void rerunTask(task)}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  Re-run
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Resize handle ─────────────────────────────────────────────────────── -->
  <div class="acc-resize-handle" onpointerdown={startResize} aria-hidden="true"></div>
</div>

<style>
  /* ── Panel shell ─────────────────────────────────────────────────────────── */
  .acc {
    position: fixed;
    bottom: calc(160px * var(--ui-zoom-percent, 100) / 100);
    left: 50%;
    transform: translateX(-50%);
    width: min(500px, calc(100vw - 32px));
    max-height: 62vh;
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

  .acc.dragged {
    bottom: unset;
    left: unset;
    transform: none;
  }

  /* When explicitly resized, inline width/height override max-height */
  .acc.resized {
    max-height: unset;
  }

  /* ── Header ──────────────────────────────────────────────────────────────── */
  .acc-header {
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
  .acc-header:active { cursor: grabbing; }

  .acc-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--accent);
    pointer-events: none; /* title text shouldn't block drag */
  }

  .acc-header-right {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto; /* buttons ARE interactive */
    cursor: default;      /* reset grab cursor for this area */
  }

  .acc-route-label {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .acc-agent-select { width: 96px; }
  .acc-agent-select :global(.dd-menu) { right: 0; min-width: 160px; z-index: 210; bottom: unset; top: calc(100% + 4px); }

  .acc-icon-btn {
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
    pointer-events: auto;
  }
  .acc-icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .acc-icon-btn.close:hover { background: color-mix(in srgb, var(--error) 14%, var(--bg-primary)); color: var(--error); }

  /* ── Lock banner ─────────────────────────────────────────────────────────── */
  .acc-lock-banner {
    padding: 6px 12px;
    font-size: 10.5px;
    color: var(--warning, #fbbf24);
    background: color-mix(in srgb, var(--warning, #fbbf24) 8%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--warning, #fbbf24) 20%, var(--border));
    flex-shrink: 0;
  }

  /* ── Scroll body ─────────────────────────────────────────────────────────── */
  .acc-scroll {
    flex: 1;
    /* Critical: without min-height: 0, flex children won't shrink below their
       content size, making overflow-y: auto ineffective */
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb, rgba(128,128,128,0.2)) transparent;
    user-select: text;
  }

  /* ── Sections ────────────────────────────────────────────────────────────── */
  .acc-section {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle, rgba(255,255,255,0.04));
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  .acc-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }

  .acc-section-label {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .acc-tasks-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 9.5px;
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    transition: opacity 0.12s;
  }
  .acc-tasks-toggle:hover { opacity: 0.75; }

  .acc-attn-badge {
    min-width: 14px;
    height: 14px;
    padding: 0 4px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--button-text, #fff);
    font-size: 8px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  /* Running tasks */
  .running-strip { gap: 8px; }
  .running-item { display: flex; align-items: flex-start; gap: 7px; min-width: 0; }
  .running-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--c, var(--accent)); flex-shrink: 0; margin-top: 5px;
    animation: acc-blink 2s ease-in-out infinite;
  }
  @keyframes acc-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
  .running-body { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .running-name { font-size: 9.5px; font-weight: 700; color: var(--c, var(--accent)); }
  .running-title { font-size: 10.5px; font-weight: 550; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .running-status { font-size: 9.5px; color: var(--text-muted); font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .running-jump {
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
    margin-top: 2px;
  }
  .running-jump:hover {
    background: color-mix(in srgb, var(--c, var(--accent)) 12%, transparent);
    color: var(--c, var(--accent));
    border-color: color-mix(in srgb, var(--c, var(--accent)) 35%, var(--border));
  }

  /* Attention banner */
  .acc-attention {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 12px; font-size: 10.5px; color: var(--text-secondary);
    border-bottom: 1px solid var(--border-subtle); flex-shrink: 0;
  }
  .acc-link { background: none; border: 0; padding: 0; color: var(--accent); font-size: 10.5px; font-weight: 650; cursor: pointer; }
  .acc-link:hover { text-decoration: underline; }

  /* Task cards */
  .acc-card { display: flex; flex-direction: column; gap: 6px; padding: 8px 9px; border-radius: 9px; }
  .acc-card.blocked {
    background: color-mix(in srgb, var(--warning, #fbbf24) 8%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--warning, #fbbf24) 25%, var(--border));
  }
  .acc-card.review {
    background: color-mix(in srgb, var(--accent) 7%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
  }
  .acc-card-head { display: flex; align-items: center; gap: 7px; min-width: 0; flex-wrap: wrap; }
  .acc-badge { font-size: 8.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 4px; flex-shrink: 0; }
  .acc-badge.warn { color: var(--warning, #fbbf24); background: color-mix(in srgb, var(--warning, #fbbf24) 14%, transparent); }
  .acc-badge.accent { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .acc-card-title { font-size: 10.5px; font-weight: 600; color: var(--text-primary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .acc-card-reason { font-size: 10px; color: var(--text-muted); }
  .acc-branch { font-size: 9px; color: var(--text-muted); font-family: var(--font-mono, monospace); }
  .acc-note {
    resize: none; min-height: 28px; max-height: 80px;
    padding: 5px 8px; background: var(--input-bg);
    border: 1px solid var(--border); border-radius: 7px; color: var(--text-primary);
    font-size: 11px; line-height: 1.4; outline: none; box-sizing: border-box; font-family: inherit;
    transition: border-color 0.15s; width: 100%;
  }
  .acc-note:focus { border-color: var(--accent); }
  .acc-note::placeholder { color: var(--text-muted); opacity: 0.6; }
  .acc-card-actions { display: flex; gap: 5px; flex-wrap: wrap; }
  .acc-btn {
    font-size: 10.5px; font-weight: 600; border-radius: 6px; padding: 3px 9px;
    border: 1px solid var(--border); background: transparent; color: var(--text-secondary); cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .acc-btn:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--border-focus); }
  .acc-btn.primary { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
  .acc-btn.primary:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
  .acc-btn.approve { color: var(--success, #4ade80); border-color: color-mix(in srgb, var(--success, #4ade80) 30%, var(--border)); }
  .acc-btn.approve:hover { background: color-mix(in srgb, var(--success, #4ade80) 10%, transparent); border-color: color-mix(in srgb, var(--success, #4ade80) 50%, var(--border)); }
  .acc-btn.danger:hover { color: var(--error, #f87171); border-color: color-mix(in srgb, var(--error, #f87171) 50%, var(--border)); }
  .acc-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Transcript ──────────────────────────────────────────────────────────── */
  .acc-transcript { flex: 1; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }

  .acc-empty {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 20px 16px; text-align: center; color: var(--text-muted);
    font-size: 11px; line-height: 1.5; margin: auto;
  }
  .acc-empty svg { opacity: 0.3; color: var(--accent); }

  .acc-msg { display: flex; }
  .acc-msg.user { justify-content: flex-end; }
  .acc-msg.assistant { justify-content: flex-start; }
  .acc-bubble {
    max-width: 88%;
    font-size: 12px; line-height: 1.5; padding: 8px 11px; border-radius: 12px;
    word-break: break-word; white-space: pre-wrap;
  }
  .acc-msg.user .acc-bubble {
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-primary));
    color: var(--text-primary); border-radius: 12px 12px 4px 12px;
  }
  .acc-msg.assistant .acc-bubble {
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    color: var(--text-secondary); border: 1px solid var(--border); border-radius: 12px 12px 12px 4px;
  }
  .acc-msg.assistant .acc-bubble.completion-bubble { background: transparent; border: none; padding: 0; max-width: 95%; }

  /* Typing dots */
  .acc-typing { display: inline-flex; gap: 3px; padding: 2px 0; }
  .acc-typing span { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); animation: acc-dot 1.2s ease-in-out infinite; }
  .acc-typing span:nth-child(2) { animation-delay: 0.18s; }
  .acc-typing span:nth-child(3) { animation-delay: 0.36s; }
  @keyframes acc-dot { 0%,60%,100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

  /* Recon summary */
  .acc-recon {
    font-size: 10px; line-height: 1.5; color: var(--text-secondary);
    white-space: pre-wrap; word-break: break-word;
    padding: 5px 7px; margin-bottom: 4px;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    border-radius: 7px; border: 1px solid color-mix(in srgb, var(--accent) 15%, var(--border));
  }

  /* Completion cards */
  .acc-completion {
    --cc: var(--success, #4ade80);
    display: flex; align-items: flex-start; gap: 8px;
    padding: 7px 9px; border-radius: 9px;
    background: color-mix(in srgb, var(--cc) 8%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--cc) 24%, var(--border));
  }
  .acc-completion-failed  { --cc: var(--error, #f87171); }
  .acc-completion-blocked { --cc: var(--warning, #fbbf24); }
  .acc-comp-icon { font-size: 13px; flex-shrink: 0; margin-top: 1px; }
  .acc-comp-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .acc-comp-headline { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 11px; font-weight: 650; color: var(--text-primary); }
  .acc-comp-status { color: var(--cc); }
  .acc-comp-time { font-size: 10px; color: var(--text-muted); }
  .acc-comp-task { font-size: 10.5px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acc-comp-reason { font-size: 10px; color: var(--text-muted); white-space: pre-wrap; word-break: break-word; }
  .acc-comp-summary { margin: 3px 0 0; font-size: 10.5px; line-height: 1.5; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; }
  .acc-comp-loading { display: inline-flex; align-items: center; gap: 5px; margin-top: 3px; font-size: 10px; color: var(--text-muted); font-style: italic; }
  .acc-typing-sm { display: inline-flex; gap: 2px; }
  .acc-typing-sm span { width: 3px; height: 3px; border-radius: 50%; background: var(--text-muted); animation: acc-dot 1.2s ease-in-out infinite; }
  .acc-typing-sm span:nth-child(2) { animation-delay: 0.2s; }
  .acc-typing-sm span:nth-child(3) { animation-delay: 0.4s; }

  /* Dispatch chips */
  .acc-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
  .acc-chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 10px; font-weight: 550; color: var(--text-secondary);
    background: color-mix(in srgb, var(--c) 10%, var(--bg-primary));
    border: 1px solid color-mix(in srgb, var(--c) 28%, var(--border));
    border-radius: 7px; padding: 3px 8px; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .acc-chip:hover { color: var(--text-primary); background: color-mix(in srgb, var(--c) 18%, var(--bg-primary)); }
  .chip-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--c); flex-shrink: 0; }

  /* ── Task history ─────────────────────────────────────────────────────────── */
  .acc-history-section { border-top: 1px solid var(--border-subtle); flex-shrink: 0; }
  .acc-history-toggle {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 7px 12px;
    font-size: 9.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em;
  }
  .acc-history-count { font-size: 9px; background: var(--bg-hover); border-radius: 8px; padding: 0 5px; line-height: 14px; margin-left: 2px; }

  .acc-history-list { display: flex; flex-direction: column; padding: 0 10px 8px; }
  .acc-hist-row {
    display: flex; align-items: center; gap: 5px; min-width: 0;
    padding: 4px 5px; border-radius: 6px; transition: background 0.1s;
  }
  .acc-hist-row:hover { background: var(--bg-hover); }
  .acc-hist-badge { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0; padding: 1px 4px; border-radius: 4px; }
  .acc-hist-success { color: var(--success, #4ade80); background: color-mix(in srgb, var(--success, #4ade80) 12%, transparent); }
  .acc-hist-error   { color: var(--error, #f87171);   background: color-mix(in srgb, var(--error, #f87171) 12%, transparent); }
  .acc-hist-muted   { color: var(--text-muted); background: var(--bg-hover); }
  .acc-hist-agent { display: inline-flex; align-items: center; gap: 3px; font-size: 9px; font-weight: 600; color: var(--c, var(--text-muted)); flex-shrink: 0; max-width: 65px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .acc-hist-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--c, var(--text-muted)); flex-shrink: 0; }
  .acc-hist-title { flex: 1; min-width: 0; font-size: 10px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .acc-hist-time { font-size: 9px; color: var(--text-muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .acc-hist-rerun {
    display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;
    font-size: 9px; font-weight: 600; color: var(--text-muted);
    background: transparent; border: 1px solid var(--border); border-radius: 4px;
    padding: 1px 5px; cursor: pointer; transition: background 0.12s, color 0.12s;
  }
  .acc-hist-rerun:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--accent); border-color: color-mix(in srgb, var(--accent) 35%, var(--border)); }

  /* ── Resize handle ───────────────────────────────────────────────────────── */
  .acc-resize-handle {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 18px;
    height: 18px;
    cursor: se-resize;
    touch-action: none;
    /* Subtle visual indicator */
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
  .acc-resize-handle:hover { opacity: 1; }
</style>
