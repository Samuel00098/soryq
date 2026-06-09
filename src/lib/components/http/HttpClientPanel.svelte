<script lang="ts">
  import { savedRequests, activeRequestId, httpResponse, httpLoading, httpError,
           createRequest, deleteRequest, updateRequest, duplicateRequest, sendRequest,
           type HttpRequest, type HttpMethod, type BodyType } from '$lib/stores/http';
  import { activeProject } from '$lib/stores/workspace';

  import Dropdown, { type DropdownOption } from '$lib/components/shared/Dropdown.svelte';

  const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const METHOD_COLORS: Record<HttpMethod, string> = {
    GET: '#4ade80', POST: '#f97316', PUT: '#facc15', PATCH: '#a78bfa',
    DELETE: '#f87171', HEAD: '#60a5fa', OPTIONS: '#94a3b8',
  };
  const methodOptions: DropdownOption[] = METHODS.map((m) => ({
    value: m,
    label: m,
    color: METHOD_COLORS[m]
  }));

  let activeTab = $state<'params' | 'headers' | 'body' | 'auth'>('headers');
  let responseTab = $state<'body' | 'headers'>('body');
  let prettyJson = $state(true);
  let deleteConfirm = $state<string | null>(null);

  let projectRequests = $derived(
    $savedRequests.filter((r) => r.projectId === ($activeProject?.id ?? ''))
  );

  let activeReq = $derived($savedRequests.find((r) => r.id === $activeRequestId) ?? null);

  function patch(p: Partial<HttpRequest>) {
    if (activeReq) updateRequest(activeReq.id, p);
  }

  function addHeader() {
    if (!activeReq) return;
    patch({ headers: [...activeReq.headers, { key: '', value: '', enabled: true }] });
  }

  function updateHeader(i: number, field: 'key' | 'value' | 'enabled', val: any) {
    if (!activeReq) return;
    const headers = activeReq.headers.map((h, idx) => idx === i ? { ...h, [field]: val } : h);
    patch({ headers });
  }

  function removeHeader(i: number) {
    if (!activeReq) return;
    patch({ headers: activeReq.headers.filter((_, idx) => idx !== i) });
  }

  function tryFormatBody() {
    if (!activeReq || activeReq.bodyType !== 'json') return;
    try {
      patch({ body: JSON.stringify(JSON.parse(activeReq.body), null, 2) });
    } catch {}
  }

  function getStatusClass(status: number) {
    if (status < 300) return 'status-ok';
    if (status < 400) return 'status-redirect';
    if (status < 500) return 'status-client-err';
    return 'status-server-err';
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  function prettyPrintBody(body: string, contentType: string) {
    if (prettyJson && (contentType.includes('json') || body.trimStart().startsWith('{'))) {
      try { return JSON.stringify(JSON.parse(body), null, 2); } catch {}
    }
    return body;
  }

  const PRIVATE_IP_RE = /^https?:\/\/(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|localhost|\[::1\]|\[fe80:)/i;
  const SENSITIVE_HEADER_RE = /^(authorization|x-api-key|x-auth-token|cookie|proxy-authorization)$/i;

  let ssrfWarning = $derived(
    activeReq ? PRIVATE_IP_RE.test(activeReq.url.trim()) : false
  );
  let authHeaderWarning = $derived(
    activeReq ? activeReq.headers.some((h) => h.enabled && SENSITIVE_HEADER_RE.test(h.key.trim()) && h.value.trim()) : false
  );
</script>

<div class="http-panel">
  <!-- Left: request list -->
  <div class="req-sidebar">
    <div class="req-sidebar-header">
      <span class="req-sidebar-title">Requests</span>
      <button class="req-add-btn" onclick={() => createRequest($activeProject?.id ?? '')} title="New request">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
    </div>
    <div class="req-list">
      {#each projectRequests as req (req.id)}
        <div class="req-item" class:active={req.id === $activeRequestId}>
          <button class="req-item-btn" onclick={() => activeRequestId.set(req.id)}>
            <span class="method-badge" style="color: {METHOD_COLORS[req.method]}">{req.method}</span>
            <span class="req-item-name">{req.name || 'Untitled'}</span>
          </button>
          <div class="req-item-actions">
            {#if deleteConfirm === req.id}
              <button class="req-del-yes" onclick={() => { deleteRequest(req.id); deleteConfirm = null; }}>Del</button>
              <button class="req-del-no" onclick={() => deleteConfirm = null}>✕</button>
            {:else}
              <button class="req-action-btn" onclick={() => duplicateRequest(req.id)} title="Duplicate">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              </button>
              <button class="req-action-btn" onclick={() => deleteConfirm = req.id} title="Delete">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              </button>
            {/if}
          </div>
        </div>
      {/each}
      {#if projectRequests.length === 0}
        <div class="req-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
          </svg>
          <p>No requests yet.<br/>Click + to create one.</p>
        </div>
      {/if}
    </div>
  </div>

  <div class="req-divider"></div>

  <!-- Right: editor + response -->
  <div class="req-main">
    {#if activeReq}
      <!-- Name + URL bar -->
      <div class="req-name-row">
        <input class="req-name-input" type="text" value={activeReq.name} oninput={(e) => patch({ name: (e.target as HTMLInputElement).value })} placeholder="Request name…" />
      </div>
      <div class="url-bar">
        <div style="width: 100px; flex-shrink: 0;">
          <Dropdown options={methodOptions} value={activeReq.method} onChange={(val) => patch({ method: val as HttpMethod })} ariaLabel="HTTP Method" />
        </div>
        <input class="url-input" type="text" value={activeReq.url} oninput={(e) => patch({ url: (e.target as HTMLInputElement).value })} placeholder="https://api.example.com/endpoint" spellcheck="false" />
        <button class="send-btn" onclick={() => sendRequest(activeReq!)} disabled={$httpLoading}>
          {#if $httpLoading}
            <svg class="spin-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><polyline points="21 3 21 8 16 8"/></svg>
          {:else}
            Send
          {/if}
        </button>
      </div>

      <!-- Security warnings -->
      {#if ssrfWarning}
        <div class="sec-warning">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Targeting a local/private address — request stays on-device.
        </div>
      {/if}
      {#if authHeaderWarning}
        <div class="sec-warning sec-warning--info">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Auth header values are cleared from storage when the app closes.
        </div>
      {/if}

      <!-- Request tabs -->
      <div class="req-tabs">
        {#each (['headers', 'body', 'auth'] as const) as tab}
          <button class="req-tab" class:active={activeTab === tab} onclick={() => activeTab = tab}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {#if tab === 'headers'}<span class="tab-badge">{activeReq.headers.filter(h => h.enabled && h.key).length}</span>{/if}
          </button>
        {/each}
      </div>

      <div class="req-tab-content">
        {#if activeTab === 'headers'}
          <div class="headers-table">
            {#each activeReq.headers as header, i}
              <div class="header-row">
                <input type="checkbox" checked={header.enabled} onchange={(e) => updateHeader(i, 'enabled', (e.target as HTMLInputElement).checked)} />
                <input class="header-key" type="text" value={header.key} oninput={(e) => updateHeader(i, 'key', (e.target as HTMLInputElement).value)} placeholder="Header" />
                <input class="header-val" type="text" value={header.value} oninput={(e) => updateHeader(i, 'value', (e.target as HTMLInputElement).value)} placeholder="Value" />
                <button class="header-del" onclick={() => removeHeader(i)}>✕</button>
              </div>
            {/each}
            <button class="add-header-btn" onclick={addHeader}>+ Add Header</button>
          </div>
        {:else if activeTab === 'body'}
          <div class="body-section">
            <div class="body-type-row">
              {#each (['none', 'json', 'text', 'form'] as BodyType[]) as bt}
                <label class="body-type-label">
                  <input type="radio" name="bodyType" value={bt} checked={activeReq.bodyType === bt} onchange={() => patch({ bodyType: bt })} />
                  {bt}
                </label>
              {/each}
              {#if activeReq.bodyType === 'json'}
                <button class="format-btn" onclick={tryFormatBody}>Format</button>
              {/if}
            </div>
            {#if activeReq.bodyType !== 'none'}
              <textarea class="body-textarea" value={activeReq.body} oninput={(e) => patch({ body: (e.target as HTMLTextAreaElement).value })} placeholder={activeReq.bodyType === 'json' ? '{\n  "key": "value"\n}' : 'Request body…'} spellcheck="false"></textarea>
            {/if}
          </div>
        {:else if activeTab === 'auth'}
          <div class="auth-section">
            <p class="auth-hint">Add an Authorization header in the Headers tab (e.g. Bearer token).</p>
          </div>
        {/if}
      </div>

      <!-- Response section -->
      <div class="res-section">
        {#if $httpError}
          <div class="res-error">{$httpError}</div>
        {:else if $httpResponse}
          <div class="res-header">
            <span class="res-status {getStatusClass($httpResponse.status)}">{$httpResponse.status} {$httpResponse.statusText}</span>
            <span class="res-meta">{$httpResponse.duration}ms · {formatSize($httpResponse.size)}</span>
            <div class="res-tabs">
              <button class="res-tab" class:active={responseTab === 'body'} onclick={() => responseTab = 'body'}>Body</button>
              <button class="res-tab" class:active={responseTab === 'headers'} onclick={() => responseTab = 'headers'}>Headers</button>
            </div>
            {#if responseTab === 'body'}
              <label class="pretty-toggle">
                <input type="checkbox" bind:checked={prettyJson} /> Pretty
              </label>
            {/if}
            <button class="copy-res-btn" onclick={() => navigator.clipboard.writeText($httpResponse!.body)} title="Copy response">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            </button>
          </div>
          {#if responseTab === 'body'}
            <pre class="res-body">{prettyPrintBody($httpResponse.body, $httpResponse.headers['content-type'] ?? '')}</pre>
          {:else}
            <div class="res-headers-list">
              {#each Object.entries($httpResponse.headers) as [k, v]}
                <div class="res-header-row"><span class="res-header-key">{k}</span><span class="res-header-val">{v}</span></div>
              {/each}
            </div>
          {/if}
        {:else if !$httpLoading}
          <div class="res-placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.25">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
            <p>Send a request to see the response</p>
          </div>
        {/if}
      </div>
    {:else}
      <div class="no-req-selected">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity="0.2">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>
        <p>Select a request or create a new one</p>
        <button class="create-first-btn" onclick={() => createRequest($activeProject?.id ?? '')}>+ New Request</button>
      </div>
    {/if}
  </div>
</div>

<style>
  /* ─── Panel shell ─────────────────────────── */
  .http-panel {
    display: flex;
    flex-direction: row;
    height: 100%;
    overflow: hidden;
    /* Transparent so the parent .auxiliary-panel provides the frosted glass. */
    background: transparent;
    /* Drive the internal layout off the panel's own width (it lives inside a
       resizable aux panel), not the viewport. */
    container-type: inline-size;
  }

  /* ─── Left sidebar ─────────────────────────── */
  .req-sidebar {
    width: 220px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: rgba(var(--sidebar-bg-rgb, 18, 18, 22), 0.35);
    border-right: 1px solid var(--border);
    overflow: hidden;
  }

  /* As the panel narrows, give the request list less room so the editor never
     gets clipped. Below ~340px the rail collapses entirely. */
  @container (max-width: 520px) {
    .req-sidebar { width: 180px; }
  }
  @container (max-width: 420px) {
    .req-sidebar { width: 140px; }
  }
  @container (max-width: 340px) {
    .req-sidebar { display: none; }
  }

  .req-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .req-sidebar-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted);
  }

  .req-add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    flex-shrink: 0;
  }

  .req-add-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .req-list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
    padding: 4px 0;
  }

  .req-item {
    display: flex;
    align-items: center;
    padding: 2px 4px;
    border-radius: 6px;
    margin: 0 4px;
  }

  .req-item:hover {
    background: var(--bg-hover);
  }

  .req-item.active {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .req-item-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    border-radius: 5px;
    overflow: hidden;
    min-width: 0;
  }

  .method-badge {
    font-size: 9.5px;
    font-weight: 700;
    font-family: monospace;
    flex-shrink: 0;
    min-width: 38px;
  }

  .req-item-name {
    font-size: 11.5px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .req-item-actions {
    display: none;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    padding-right: 4px;
  }

  .req-item:hover .req-item-actions {
    display: flex;
  }

  .req-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 3px;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .req-action-btn:hover {
    color: var(--text-primary);
    background: var(--bg-active);
  }

  .req-del-yes {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--error);
    background: color-mix(in srgb, var(--error) 15%, transparent);
    border: none;
    cursor: pointer;
  }

  .req-del-no {
    font-size: 10px;
    padding: 2px 5px;
    border-radius: 3px;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
  }

  .req-del-no:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .req-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 32px 16px;
    color: var(--text-muted);
    text-align: center;
  }

  .req-empty p {
    font-size: 11px;
    line-height: 1.5;
    margin: 0;
    color: var(--text-muted);
    opacity: 0.7;
  }

  /* ─── Divider ─────────────────────────── */
  .req-divider {
    width: 1px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* ─── Right main area ─────────────────────────── */
  .req-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: transparent;
    min-width: 0;
  }

  .req-name-row {
    padding: 8px 36px 4px 12px;
    border-bottom: 1px solid var(--border-subtle, var(--border));
    flex-shrink: 0;
  }

  .req-name-input {
    width: 100%;
    background: none;
    border: none;
    outline: none;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    box-sizing: border-box;
  }

  .req-name-input::placeholder {
    color: var(--text-muted);
    font-weight: 400;
  }

  /* ─── URL bar ─────────────────────────── */
  .url-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .method-select {
    padding: 4px 8px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.6);
    border: 1px solid var(--border);
    border-radius: 5px;
    font-size: 11px;
    font-weight: 700;
    outline: none;
    cursor: pointer;
    flex-shrink: 0;
  }

  .method-select option {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }

  .url-input {
    flex: 1;
    padding: 5px 10px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.6);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    font-family: monospace;
    min-width: 0;
  }

  .url-input:focus {
    border-color: var(--accent);
  }

  .url-input::placeholder {
    color: var(--text-muted);
    font-family: sans-serif;
  }

  .send-btn {
    padding: 5px 16px;
    background: var(--accent);
    color: var(--button-text, #fff);
    border: none;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }

  .send-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .send-btn:not(:disabled):hover {
    opacity: 0.85;
  }

  .sec-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    font-size: 11px;
    color: var(--warning, #facc15);
    background: color-mix(in srgb, var(--warning, #facc15) 10%, transparent);
    border-left: 2px solid var(--warning, #facc15);
    border-radius: 0 3px 3px 0;
    margin: 0 10px 4px;
  }

  .sec-warning--info {
    color: var(--fg-muted, #94a3b8);
    background: color-mix(in srgb, var(--fg-muted, #94a3b8) 8%, transparent);
    border-color: var(--fg-muted, #94a3b8);
  }

  /* ─── Request tabs ─────────────────────────── */
  .req-tabs {
    display: flex;
    gap: 1px;
    padding: 0 12px;
    border-bottom: 1px solid var(--border);
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.25);
    flex-shrink: 0;
  }

  .req-tab {
    padding: 6px 10px;
    font-size: 11.5px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 4px;
    transition: color 0.15s;
  }

  .req-tab:hover {
    color: var(--text-secondary);
  }

  .req-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }

  .tab-badge {
    font-size: 9px;
    background: var(--accent-light, color-mix(in srgb, var(--accent) 20%, transparent));
    color: var(--accent);
    border-radius: 9999px;
    padding: 0 5px;
    line-height: 1.6;
  }

  /* ─── Tab content area ─────────────────────────── */
  .req-tab-content {
    flex: 0 0 auto;
    max-height: 200px;
    overflow-y: auto;
    border-bottom: 1px solid var(--border);
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  /* ─── Headers table ─────────────────────────── */
  .headers-table {
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .header-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-row input[type="checkbox"] {
    flex-shrink: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .header-key {
    flex: 0 0 35%;
    padding: 3px 7px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.4);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 11px;
    font-family: monospace;
    outline: none;
    min-width: 0;
  }

  .header-key:focus {
    border-color: var(--accent);
  }

  .header-val {
    flex: 1;
    padding: 3px 7px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.4);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 11px;
    font-family: monospace;
    outline: none;
    min-width: 0;
  }

  .header-val:focus {
    border-color: var(--accent);
  }

  .header-del {
    font-size: 10px;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    flex-shrink: 0;
    line-height: 1;
    transition: color 0.15s, background 0.15s;
  }

  .header-del:hover {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 12%, transparent);
  }

  .add-header-btn {
    margin-top: 4px;
    font-size: 11px;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 3px 4px;
    text-align: left;
    border-radius: 4px;
    width: fit-content;
    transition: background 0.15s;
  }

  .add-header-btn:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  /* ─── Body section ─────────────────────────── */
  .body-section {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    gap: 6px;
  }

  .body-type-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .body-type-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .body-type-label input[type="radio"] {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .format-btn {
    font-size: 10.5px;
    padding: 2px 8px;
    border-radius: 4px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    cursor: pointer;
    margin-left: auto;
    transition: border-color 0.15s, color 0.15s;
  }

  :global(:root:not(.solid-theme)) .format-btn {
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), var(--frost-chrome, 0.62));
  }

  .format-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .body-textarea {
    resize: none;
    height: 120px;
    padding: 8px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.4);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--text-primary);
    font-family: monospace;
    font-size: 11.5px;
    line-height: 1.5;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }

  .body-textarea:focus {
    border-color: var(--accent);
  }

  /* ─── Auth section ─────────────────────────── */
  .auth-section {
    padding: 16px 12px;
  }

  .auth-hint {
    font-size: 11.5px;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.5;
  }

  /* ─── Response section ─────────────────────────── */
  .res-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }

  .res-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(var(--bg-secondary-rgb, 18, 18, 22), 0.25);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .res-status {
    font-size: 12px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .status-ok {
    background: color-mix(in srgb, var(--success, #4ade80) 15%, transparent);
    color: var(--success, #4ade80);
  }

  .status-redirect {
    background: color-mix(in srgb, var(--warning, #facc15) 15%, transparent);
    color: var(--warning, #facc15);
  }

  .status-client-err {
    background: color-mix(in srgb, var(--error, #f87171) 15%, transparent);
    color: var(--error, #f87171);
  }

  .status-server-err {
    background: color-mix(in srgb, var(--error, #f87171) 15%, transparent);
    color: var(--error, #f87171);
  }

  .res-meta {
    font-size: 10.5px;
    color: var(--text-muted);
    margin-right: auto;
    flex-shrink: 0;
  }

  .res-tabs {
    display: flex;
    gap: 1px;
    flex-shrink: 0;
  }

  .res-tab {
    padding: 3px 9px;
    font-size: 11px;
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--text-muted);
    transition: color 0.15s, background 0.15s;
  }

  .res-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .res-tab.active {
    color: var(--text-primary);
    background: var(--bg-active);
  }

  .pretty-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    flex-shrink: 0;
  }

  .pretty-toggle input[type="checkbox"] {
    accent-color: var(--accent);
    cursor: pointer;
  }

  .copy-res-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }

  .copy-res-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .res-body {
    flex: 1;
    overflow: auto;
    padding: 12px;
    font-family: monospace;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-primary);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .res-error {
    padding: 16px;
    color: var(--error, #f87171);
    font-size: 12px;
    line-height: 1.5;
  }

  .res-headers-list {
    flex: 1;
    overflow: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  .res-header-row {
    display: flex;
    gap: 8px;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11px;
  }

  .res-header-row:hover {
    background: var(--bg-hover);
  }

  .res-header-key {
    font-family: monospace;
    color: var(--accent);
    flex-shrink: 0;
    min-width: 160px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .res-header-val {
    font-family: monospace;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  /* ─── Placeholder / empty states ─────────────────────────── */
  .res-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-muted);
    text-align: center;
    padding: 24px;
  }

  .res-placeholder p {
    font-size: 12px;
    margin: 0;
    opacity: 0.6;
  }

  .no-req-selected {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    color: var(--text-muted);
    text-align: center;
    padding: 32px;
  }

  .no-req-selected p {
    font-size: 12px;
    margin: 0;
    opacity: 0.6;
  }

  .create-first-btn {
    padding: 6px 16px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--button-text, #fff);
    border: none;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .create-first-btn:hover {
    opacity: 0.85;
  }

  /* ─── Spinner animation ─────────────────────────── */
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .spin-icon {
    animation: spin 1s linear infinite;
  }
</style>
