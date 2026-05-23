<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import {
    targetPort,
    proxyPort,
    proxyStarted,
    currentUrl,
    isConnecting,
    loadProxyState,
    startProxy,
    stopProxy,
    setTargetPort,
    ensureProxyRunning
  } from '$lib/stores/preview';
  import { showToast } from '$lib/stores/notification';

  let iframeElement = $state<HTMLIFrameElement>();
  let tempPort = $state($targetPort);
  let inputUrl = $state($currentUrl);
  let isLoading = $state(false);
  let iframeError = $state(false);

  let unsubscribePort: () => void;
  let unsubscribeUrl: () => void;

  onMount(async () => {
    await loadProxyState();
    tempPort = $targetPort;
    // Always silently ensure the background proxy server is running.
    // This is needed for both external web browsing AND local dev proxying.
    // We do NOT auto-start proxyStarted (dev mode) — user can toggle that manually.
    await ensureProxyRunning();

    unsubscribePort = targetPort.subscribe((val) => {
      tempPort = val;
    });

    unsubscribeUrl = currentUrl.subscribe((val) => {
      inputUrl = val;
    });
  });

  onDestroy(() => {
    if (unsubscribePort) unsubscribePort();
    if (unsubscribeUrl) unsubscribeUrl();
  });

  // When the user navigates to an external absolute URL, ensure the background
  // proxy server is running (for iframe embedding) but do NOT change proxyStarted.
  // proxyStarted only controls local dev server forwarding.
  $effect(() => {
    const url = $currentUrl;
    if (isAbsoluteUrl(url) && !$proxyPort) {
      ensureProxyRunning();
    }
  });

  function handlePortChange() {
    if (tempPort >= 1 && tempPort <= 65535) {
      setTargetPort(tempPort);
    }
  }

  async function openInBrowser() {
    // Get the real URL (not the proxied version)
    const url = $currentUrl;
    const norm = normalizeUrl(url);
    if (!norm || norm === 'about:blank' || norm === '/') return;
    try {
      await invoke('preview_open_in_browser', { url: norm });
    } catch (err) {
      showToast(`Could not open browser: ${err}`, 'error');
    }
  }

  function toggleProxy() {
    if ($proxyStarted) {
      // Stop dev mode — go back to a blank local path so the web panel stays clean
      stopProxy();
      if (!isAbsoluteUrl($currentUrl)) {
        currentUrl.set('/');
      }
    } else {
      // Start dev mode — navigate to the root of the local dev server
      startProxy();
      currentUrl.set('/');
    }
  }

  function transformYouTubeUrl(url: string): string {
    const trimmed = url.trim();
    if (!/youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(trimmed)) {
      return url;
    }

    let videoId = '';

    // 1. Check youtu.be/ID
    const youtubeBeMatch = trimmed.match(/youtu\.be\/([^"&?\/\s]{11})/i);
    if (youtubeBeMatch && youtubeBeMatch[1]) {
      videoId = youtubeBeMatch[1];
    }

    // 2. Check youtube.com/shorts/ID
    if (!videoId) {
      const shortsMatch = trimmed.match(/youtube\.com\/shorts\/([^"&?\/\s]{11})/i);
      if (shortsMatch && shortsMatch[1]) {
        videoId = shortsMatch[1];
      }
    }

    // 3. Check youtube.com/live/ID
    if (!videoId) {
      const liveMatch = trimmed.match(/youtube\.com\/live\/([^"&?\/\s]{11})/i);
      if (liveMatch && liveMatch[1]) {
        videoId = liveMatch[1];
      }
    }

    // 4. Check standard v=ID query param
    if (!videoId) {
      const vQueryMatch = trimmed.match(/[?&]v=([^"&?\/\s]{11})/i);
      if (vQueryMatch && vQueryMatch[1]) {
        videoId = vQueryMatch[1];
      }
    }

    // 5. Check paths like /v/ID or /embed/ID or /e/ID
    if (!videoId) {
      const pathMatch = trimmed.match(/(?:\/v\/|\/embed\/|\/e\/)([^"&?\/\s]{11})/i);
      if (pathMatch && pathMatch[1]) {
        videoId = pathMatch[1];
      }
    }

    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`;
    }

    return url;
  }

  let showYoutubeHomepageWarning = $derived(
    !$proxyStarted &&
    ($currentUrl.includes('youtube.com') || $currentUrl.includes('youtu.be')) &&
    !$currentUrl.includes('/embed/')
  );

  function normalizeUrl(url: string): string {
    let trimmed = url.trim();
    if (!trimmed) return 'about:blank';

    // Auto-transform YouTube watch links to embed format to allow loading in iframe
    trimmed = transformYouTubeUrl(trimmed);

    // If it has a protocol already, return it
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    // If it starts with a slash, it's relative to the proxy
    if (trimmed.startsWith('/')) {
      return trimmed;
    }

    // Check if it looks like an absolute domain/IP
    const firstSegment = trimmed.split('/')[0];
    const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:|\/|$)/i.test(firstSegment);
    const hasDot = firstSegment.includes('.');

    if (isLocal) {
      return 'http://' + trimmed;
    } else if (hasDot || firstSegment === 'localhost') {
      return 'https://' + trimmed;
    }

    // Search with Google if it doesn't look like a URL
    return 'https://www.google.com/search?q=' + encodeURIComponent(trimmed);
  }

  function isAbsoluteUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  function handleNavigate(e: Event) {
    e.preventDefault();
    const normalized = normalizeUrl(inputUrl);
    currentUrl.set(normalized);
    inputUrl = normalized;
    isLoading = true;
  }

  function goBack() {
    try {
      if (iframeElement && iframeElement.contentWindow) {
        iframeElement.contentWindow.history.back();
      }
    } catch (err) {
      console.warn('Could not navigate history:', err);
    }
  }

  function goForward() {
    try {
      if (iframeElement && iframeElement.contentWindow) {
        iframeElement.contentWindow.history.forward();
      }
    } catch (err) {
      console.warn('Could not navigate history:', err);
    }
  }

  function refresh() {
    if (iframeElement) {
      isLoading = true;
      iframeElement.src = iframeElement.src;
    }
  }

  let iframeSrc = $derived.by(() => {
    const norm = normalizeUrl($currentUrl);
    if (norm === 'about:blank') {
      return norm;
    }
    // External/absolute URLs: always proxy through background server (needed for iframe embedding)
    if (isAbsoluteUrl(norm)) {
      if ($proxyPort) {
        return `http://127.0.0.1:${$proxyPort}/proxy?url=${encodeURIComponent(norm)}`;
      }
      // Background proxy server not yet ready — show blank
      return '';
    }
    // For local/relative URLs, only route to local dev server when dev mode is active
    if ($proxyStarted && $proxyPort) {
      return `http://127.0.0.1:${$proxyPort}${norm}`;
    }
    // Not in dev mode and no external URL — show placeholder
    return '';
  });

  let protocolBadge = $derived.by(() => {
    const norm = normalizeUrl($currentUrl);
    if (norm.startsWith('https://')) return 'HTTPS';
    if (norm.startsWith('http://')) return 'HTTP';
    return 'DEV';
  });



  function handleIframeLoad() {
    isLoading = false;
    try {
      if (iframeElement && iframeElement.contentWindow) {
        const href = iframeElement.contentWindow.location.href;
        // Don't overwrite the address bar when loading via our proxy
        if (href && !href.includes('/proxy?')) {
          const path = iframeElement.contentWindow.location.pathname;
          const search = iframeElement.contentWindow.location.search;
          if (path) {
            currentUrl.set(path + search);
            inputUrl = path + search;
          }
        }
      }
    } catch (err) {
      // Cross-origin expected
    }
  }

  function handleInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      inputUrl = $currentUrl;
      (e.target as HTMLInputElement).blur();
    }
  }
</script>

<div class="preview-panel">
  <div class="browser-bar">
    <div class="nav-controls">
      <button class="nav-btn" onclick={goBack} title="Back (Alt+Left)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <button class="nav-btn" onclick={goForward} title="Forward (Alt+Right)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      <button class="nav-btn {isLoading ? 'spinning' : ''}" onclick={refresh} title="Refresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
          <path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16"/>
          <path d="M8 16H3v5"/>
        </svg>
      </button>
    </div>

    <form class="address-bar" onsubmit={handleNavigate}>
      <span class="protocol-badge {protocolBadge.toLowerCase()}">{protocolBadge}</span>
      <input
        type="text"
        bind:value={inputUrl}
        placeholder="Enter URL or search…"
        class="address-input"
        onkeydown={handleInputKeydown}
        onclick={(e) => (e.target as HTMLInputElement).select()}
        spellcheck="false"
        autocomplete="off"
      />
      <button type="submit" class="go-btn" title="Navigate">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </form>

    <!-- Open in system browser button -->
    {#if isAbsoluteUrl($currentUrl)}
      <button
        class="nav-btn open-external-btn"
        onclick={openInBrowser}
        title="Open in system browser"
        aria-label="Open in system browser"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </button>
    {/if}

    <div class="proxy-settings">
      <span class="label">Local port:</span>
      <input
        type="number"
        bind:value={tempPort}
        onchange={handlePortChange}
        min="1"
        max="65535"
        class="port-input"
        title="Port of your local dev server (e.g. 5173 for Vite, 3000 for Next.js)"
      />
      
      <button
        class="proxy-btn"
        class:running={$proxyStarted}
        onclick={toggleProxy}
        disabled={$isConnecting}
        title={$proxyStarted ? 'Stop local dev preview' : 'Start local dev preview on this port'}
      >
        {#if $isConnecting}
          <svg class="spin-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
          </svg>
          Connecting
        {:else if $proxyStarted}
          <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
          Dev: On
        {:else}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
          </svg>
          Dev: Off
        {/if}
      </button>
    </div>
  </div>

  {#if isLoading}
    <div class="loading-bar">
      <div class="loading-progress"></div>
    </div>
  {/if}

  {#if showYoutubeHomepageWarning}
    <div class="youtube-warning-banner">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="warning-icon">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>
        YouTube's homepage/search cannot be embedded. Please enter a specific video URL (e.g., <code>youtube.com/watch?v=...</code>) to preview it here.
      </span>
      <button class="banner-open-btn" onclick={openInBrowser} title="Open in system browser">
        Open in browser
      </button>
    </div>
  {/if}

  {#if !showYoutubeHomepageWarning && isAbsoluteUrl($currentUrl) && ($currentUrl.includes('google.com') || $currentUrl.includes('google.co'))}
    <div class="google-warning-banner">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="warning-icon">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>Google may show a CAPTCHA in the built-in browser. Use the <strong>↗ button</strong> in the toolbar to open in your system browser for the best experience.</span>
      <button class="banner-open-btn" onclick={openInBrowser} title="Open Google in system browser">
        Open in browser
      </button>
    </div>
  {/if}

  <div class="preview-content">
    {#if iframeSrc}
      <iframe
        bind:this={iframeElement}
        src={iframeSrc}
        title="Web Preview"
        class="preview-iframe"
        onload={handleIframeLoad}
        allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; microphone; payment; usb"
        sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"
      ></iframe>
    {:else}
      <div class="proxy-placeholder">
        <div class="placeholder-globe">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 014-10z"/>
          </svg>
        </div>
        <h3>Web Preview</h3>
        <p>Type any URL in the address bar to browse the web, or click <strong>Dev: Off</strong> to preview your local dev server running on port {$targetPort}.</p>
        <div class="placeholder-actions">
          <button class="action-btn web-btn" onclick={() => { currentUrl.set('https://www.google.com'); inputUrl = 'https://www.google.com'; }}
            title="Open browser">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
            </svg>
            Browse Web
          </button>
          <button class="action-btn" onclick={startProxy}
            title="Preview local dev server">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
            </svg>
            Local Dev ({$targetPort})
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .preview-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
    overflow: hidden;
    container-type: inline-size;
  }

  /* Browser bar */
  .browser-bar {
    height: 42px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 8px;
    flex-shrink: 0;
  }

  .nav-controls {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--text-secondary);
    transition: background 0.15s, color 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .nav-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  :global(.nav-btn.spinning svg) { animation: spin 0.7s linear infinite; }

  .address-bar {
    flex: 1;
    display: flex;
    align-items: center;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 9999px;
    height: 30px;
    padding: 0 4px 0 12px;
    gap: 6px;
    transition: border-color 0.15s;
    min-width: 0;
  }

  .address-bar:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-glow);
  }

  .protocol-badge {
    font-size: 8.5px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 4px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .protocol-badge.dev  { background: var(--accent-light); color: var(--accent); }
  .protocol-badge.http { background: rgba(251,191,36,0.15); color: var(--warning); }
  .protocol-badge.https { background: rgba(74,222,128,0.15); color: var(--success); }

  .address-input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    font-family: inherit;
    min-width: 0;
  }

  .address-input::placeholder { color: var(--text-muted); }

  .go-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    color: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .go-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .proxy-settings {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .label {
    font-size: 10.5px;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .port-input {
    width: 52px;
    height: 28px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 11px;
    text-align: center;
    outline: none;
    font-family: inherit;
    transition: border-color 0.15s;
  }
  .port-input:focus { border-color: var(--accent); }

  .proxy-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    background: var(--accent);
    color: white;
    border: none;
    transition: background 0.15s, transform 0.1s;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .proxy-btn:hover:not(:disabled) { background: var(--accent-hover); }
  .proxy-btn:active:not(:disabled) { transform: scale(0.97); }
  .proxy-btn.running { background: rgba(248,113,113,0.25); color: var(--error); border: 1px solid rgba(248,113,113,0.3); }
  .proxy-btn.running:hover { background: rgba(248,113,113,0.35); }
  .proxy-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  @keyframes spin-proxy { to { transform: rotate(360deg); } }
  .spin-icon { animation: spin-proxy 1s linear infinite; }

  /* Loading bar */
  .loading-bar {
    height: 2px;
    background: var(--border);
    flex-shrink: 0;
    overflow: hidden;
  }

  .loading-progress {
    height: 100%;
    width: 40%;
    background: var(--accent);
    border-radius: 1px;
    animation: loading-slide 1.2s ease-in-out infinite;
  }

  @keyframes loading-slide {
    0% { transform: translateX(-100%); width: 40%; }
    50% { width: 60%; }
    100% { transform: translateX(350%); width: 40%; }
  }

  /* Preview area */
  .preview-content {
    flex: 1;
    background: #ffffff;
    position: relative;
    overflow: hidden;
  }

  .preview-iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #ffffff;
    display: block;
  }

  /* Placeholder */
  .proxy-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 40px;
    text-align: center;
    background: var(--bg-primary);
    color: var(--text-primary);
    gap: 12px;
  }

  .placeholder-globe { margin-bottom: 4px; }

  .proxy-placeholder h3 {
    font-weight: 600;
    font-size: 17px;
    color: var(--text-secondary);
  }

  .proxy-placeholder p {
    color: var(--text-muted);
    font-size: 12.5px;
    max-width: 380px;
    line-height: 1.6;
  }

  .placeholder-actions {
    display: flex;
    gap: 10px;
    margin-top: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 36px;
    padding: 0 20px;
    border-radius: 8px;
    background: var(--accent);
    color: white;
    font-weight: 600;
    font-size: 13px;
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  }

  .action-btn:hover { background: var(--accent-hover); }
  .action-btn:active { transform: scale(0.97); }

  .action-btn.web-btn {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border: 1px solid var(--border);
    box-shadow: none;
  }
  .action-btn.web-btn:hover { background: var(--bg-hover); }


  .youtube-warning-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.08);
    border-bottom: 1px solid var(--border);
    color: var(--error);
    font-size: 11px;
    line-height: 1.4;
    flex-shrink: 0;
  }
  
  .youtube-warning-banner code {
    background: rgba(239, 68, 68, 0.12);
    padding: 1px 4px;
    border-radius: 4px;
    font-family: var(--editor-font-family, monospace);
  }

  .warning-icon {
    flex-shrink: 0;
    color: var(--error);
  }

  .open-external-btn {
    color: var(--accent);
    opacity: 0.85;
    flex-shrink: 0;
  }
  .open-external-btn:hover {
    background: var(--accent-light);
    color: var(--accent);
    opacity: 1;
  }

  .google-warning-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    background: rgba(251, 191, 36, 0.07);
    border-bottom: 1px solid var(--border);
    color: var(--warning);
    font-size: 11px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .google-warning-banner .warning-icon {
    color: var(--warning);
    flex-shrink: 0;
  }

  .banner-open-btn {
    margin-left: auto;
    flex-shrink: 0;
    padding: 3px 10px;
    border-radius: 5px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
    font-family: inherit;
  }
  .banner-open-btn:hover { background: var(--bg-secondary); }

  /* Container queries for responsive toolbar */
  @container (max-width: 480px) {
    .label {
      display: none;
    }
    .browser-bar {
      gap: 6px;
      padding: 0 6px;
    }
  }

  @container (max-width: 380px) {
    .protocol-badge {
      display: none;
    }
    .browser-bar {
      gap: 4px;
      padding: 0 4px;
    }
    .proxy-settings {
      gap: 4px;
    }
    .address-bar {
      padding: 0 4px 0 8px;
      gap: 4px;
    }
  }

  @container (max-width: 320px) {
    .port-input {
      width: 44px;
      padding: 0;
    }
    .proxy-btn {
      padding: 0 6px;
      font-size: 10.5px;
      gap: 3px;
    }
  }
</style>
