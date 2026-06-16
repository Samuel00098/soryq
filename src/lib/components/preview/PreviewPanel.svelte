<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';
  import {
    targetPort,
    proxyPort,
    proxyStarted,
    preferredLocalHost,
    localDevProxyPorts,
    currentUrl,
    previewTabs,
    activePreviewTabId,
    isConnecting,
    loadProxyState,
    startProxy,
    stopProxy,
    setTargetPort,
    ensureProxyRunning,
    ensureLocalDevProxy,
    setPreferredLocalHost,
    clearProxyTarget,
    clearPreviewData,
    localDevProxyKey,
    navigatePreviewTab,
    commitInternalNavigation,
    goBackPreviewTab,
    goForwardPreviewTab,
    createBlankPreviewBrowserTab,
    selectPreviewBrowserTab,
    closePreviewBrowserTab
  } from '$lib/stores/preview';
  import { showToast } from '$lib/stores/notification';
  import {
    browsingHistory,
    recordHistoryVisit,
    removeHistoryEntry,
    clearBrowsingHistory,
    saveScrollPosition,
    getScrollPosition,
  } from '$lib/stores/previewHistory';
  import { promptBarInput, promptBarImage, focusPromptBar } from '$lib/stores/terminal';
  import { activeProject } from '$lib/stores/workspace';

  import { extractExternalUrlFromProxyUrl } from '$lib/utils/proxy-url';

  let iframeElements = $state<Record<string, HTMLIFrameElement | undefined>>({});
  let previewContentEl = $state<HTMLDivElement>();
  let deviceShellEl = $state<HTMLDivElement>();
  let screenshotting = $state(false);
  let clearingData = $state(false);
  let tempPort = $state($targetPort);
  let inputUrl = $state($currentUrl);
  let inspectMode = $state(false);
  let showHistory = $state(false);
  let activeTab = $derived(($previewTabs || []).find((tab) => tab.id === $activePreviewTabId) ?? null);
  let canGoBack = $derived((activeTab?.historyIndex ?? 0) > 0);
  let canGoForward = $derived(
    activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false
  );
  let activeIframeSrc = $derived(activeTab ? buildIframeSrc(activeTab.loadUrl ?? activeTab.url) : '');
  type ViewportMode = 'responsive' | 'tablet' | 'mobile';
  let viewportMode = $state<ViewportMode>('responsive');
  const VIEWPORT_WIDTHS: Record<ViewportMode, number | null> = {
    responsive: null,
    tablet: 768,
    mobile: 375,
  };
  type SelectedElementInfo = {
    selector: string;
    tag: string;
    text: string;
    html?: string;
    attributes?: Record<string, string>;
    classes?: string[];
    styles?: Record<string, string>;
    ancestorPath?: string[];
    page?: { url: string; title: string };
    rect: { x: number; y: number; width: number; height: number };
  };
  type PreviewConsoleLog = {
    id: number;
    level: 'log' | 'info' | 'warn' | 'error' | 'debug';
    message: string;
    url?: string;
    timestamp: string;
  };
  let selectedElementInfo = $state<SelectedElementInfo | null>(null);
  let consoleLogs = $state<PreviewConsoleLog[]>([]);
  let showConsole = $state(false);
  let consoleLogId = 0;
  let loadFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let tabLoadState = $state<Record<string, { isLoading: boolean; slowLoad: boolean; iframeError: boolean }>>({});

  let unsubscribePort: () => void;
  let unsubscribeUrl: () => void;

  const commonPorts = [
    3000,
    3001,
    4173,
    4200,
    5000,
    5173,
    6006,
    7000,
    8000,
    8080,
    8081,
    8888,
    9000,
    9229,
    1234,
  ];

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

    window.addEventListener('message', handleInspectorMessage);
  });

  onDestroy(() => {
    if (unsubscribePort) unsubscribePort();
    if (unsubscribeUrl) unsubscribeUrl();
    window.removeEventListener('message', handleInspectorMessage);
    clearLoadFeedbackTimer();
  });

  function ensureTabLoadState(tabId: string) {
    return (
      tabLoadState[tabId] ?? {
        isLoading: false,
        slowLoad: false,
        iframeError: false,
      }
    );
  }

  function updateTabLoadState(tabId: string, patch: Partial<{ isLoading: boolean; slowLoad: boolean; iframeError: boolean }>) {
    tabLoadState = {
      ...tabLoadState,
      [tabId]: {
        ...ensureTabLoadState(tabId),
        ...patch,
      },
    };
  }

  function getActiveTabLoadState() {
    return activeTab ? ensureTabLoadState(activeTab.id) : { isLoading: false, slowLoad: false, iframeError: false };
  }

  function setIframeElement(tabId: string, element: HTMLIFrameElement | null) {
    iframeElements = {
      ...iframeElements,
      [tabId]: element ?? undefined,
    };
  }

  function registerIframe(node: HTMLIFrameElement, tabId: string) {
    setIframeElement(tabId, node);

    return {
      update(nextTabId: string) {
        if (nextTabId === tabId) return;
        setIframeElement(tabId, null);
        tabId = nextTabId;
        setIframeElement(tabId, node);
      },
      destroy() {
        setIframeElement(tabId, null);
      },
    };
  }

  function getActiveIframeElement() {
    return activeTab ? iframeElements[activeTab.id] : undefined;
  }

  // When the user navigates to an external absolute URL, ensure the background
  // proxy server is running (for iframe embedding) but do NOT change proxyStarted.
  // proxyStarted only controls local dev server forwarding.
  $effect(() => {
    const url = $currentUrl;
    if (isAbsoluteUrl(url) && !$proxyPort) {
      ensureProxyRunning();
    }
  });

  $effect(() => {
    const localDev = parseLocalDevUrl($currentUrl);
    if (!localDev) {
      setPreferredLocalHost(null);
      return;
    }
    setPreferredLocalHost(localDev.host);
    ensureLocalDevProxy(localDev.port, localDev.host);
    untrack(() => {
      if ($targetPort !== localDev.port) {
        setTargetPort(localDev.port);
      }
    });
  });

  $effect(() => {
    for (const tab of $previewTabs || []) {
      const localDev = parseLocalDevUrl(normalizeUrl(tab.url));
      if (localDev) {
        ensureLocalDevProxy(localDev.port, localDev.host);
      }
    }
  });

  // Log every real navigation into the persistent browsing history so the
  // history dropdown can recall any prior page (beyond a single tab's linear
  // back/forward stack). recordHistoryVisit ignores about:blank / "/" and
  // collapses immediately repeated URLs.
  $effect(() => {
    const url = $currentUrl;
    const title = activeTab?.title ?? '';
    recordHistoryVisit(url, title);
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

  async function toggleProxy() {
    if ($proxyStarted) {
      // Stop dev mode — go back to a blank local path so the web panel stays clean
      stopProxy();
      if (!isAbsoluteUrl($currentUrl) || parseLocalDevUrl(normalizeUrl($currentUrl))) {
        navigatePreviewTab('/');
      }
    } else {
      // Start dev mode — navigate to the root of the local dev server
      await clearProxyTarget();
      await startProxy();
      const host = $preferredLocalHost || 'localhost';
      await ensureLocalDevProxy($targetPort, host);
      navigatePreviewTab(`http://${host}:${$targetPort}/`);
    }
  }

  async function autoDetectPort() {
    const projectPath = $activeProject?.root_path;
    if (!projectPath) {
      showToast('No active project — open a project folder first', 'info');
      return;
    }
    try {
      const detected = await invoke<number>('workspace_detect_port', { path: projectPath });
      await setTargetPort(detected);
    } catch (err) {
      showToast('Could not detect dev server port', 'error');
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
    if (trimmed.toLowerCase() === 'about:blank') return 'about:blank';

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

    // Search if it doesn't look like a URL. Use DuckDuckGo's server-rendered HTML
    // endpoint (html.duckduckgo.com/html), NOT the main duckduckgo.com SPA: the
    // SPA fetches results via cross-origin XHR to links.duckduckgo.com, which the
    // path-rewriting preview proxy can't serve, so the results page stays blank.
    // The HTML endpoint returns plain <a> links that navigate fine through the
    // proxy. (Google CAPTCHAs proxied requests, so it's unusable here.)
    return 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(trimmed);
  }

  function isAbsoluteUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  function buildLocalProxyUrl(path: string, localDev?: { host: string; port: number }): string {
    const port = localDev
      ? $localDevProxyPorts[localDevProxyKey(localDev.host, localDev.port)]
      : $proxyPort;
    if (!port) return '';
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `http://127.0.0.1:${port}${normalizedPath}`;
  }

  function buildExternalProxyUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const scheme = parsed.protocol.replace(':', '');
      const authority = parsed.host;
      const path = parsed.pathname || '/';
      const search = parsed.search || '';
      return `http://127.0.0.1:${$proxyPort}/proxy/${scheme}/${authority}${path}${search}`;
    } catch {
      return `http://127.0.0.1:${$proxyPort}/proxy?url=${encodeURIComponent(url)}`;
    }
  }

  function parseLocalDevUrl(url: string): { host: string; port: number; path: string } | null {
    try {
      const parsed = new URL(url);
      const isLocalHost =
        parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '0.0.0.0';

      if (!isLocalHost || !parsed.port) {
        return null;
      }

      const port = Number(parsed.port);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        return null;
      }

      return {
        host: parsed.hostname,
        port,
        path: `${parsed.pathname}${parsed.search}${parsed.hash}` || '/',
      };
    } catch {
      return null;
    }
  }

  function getLocalDevProxyOrigin(localDev: { host: string; port: number }): string | null {
    const port = $localDevProxyPorts[localDevProxyKey(localDev.host, localDev.port)];
    return port ? `http://127.0.0.1:${port}` : null;
  }

  function isYouTubeUrl(url: string): boolean {
    return /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(url);
  }

  async function navigateTo(rawUrl: string) {
    const normalized = normalizeUrl(rawUrl);
    const localDev = parseLocalDevUrl(normalized);
    if (localDev) {
      await clearProxyTarget();
      await setPreferredLocalHost(localDev.host);
      await ensureLocalDevProxy(localDev.port, localDev.host);
      if ($targetPort !== localDev.port) {
        await setTargetPort(localDev.port);
      }
    } else {
      await setPreferredLocalHost(null);
      // Ensure the background proxy is running BEFORE updating the store and
      // triggering the iframe src binding, so buildIframeSrc sees the port set.
      await ensureProxyRunning();
    }
    navigatePreviewTab(normalized);
    inputUrl = normalized;
    startLoadFeedback();
  }

  async function handleNavigate(e: Event) {
    e.preventDefault();
    await navigateTo(inputUrl);
  }

  function openHistoryEntry(url: string) {
    showHistory = false;
    void navigateTo(url);
  }

  function handleWindowClickForHistory(e: MouseEvent) {
    if (!showHistory) return;
    const target = e.target as HTMLElement;
    if (!target.closest('.history-wrap')) showHistory = false;
  }

  function relativeTime(ts: number): string {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function goBack() {
    if (!canGoBack) return;
    goBackPreviewTab();
    inputUrl = $currentUrl;
    startLoadFeedback();
  }

  function goForward() {
    if (!canGoForward) return;
    goForwardPreviewTab();
    inputUrl = $currentUrl;
    startLoadFeedback();
  }

  function refresh() {
    const activeIframe = getActiveIframeElement();
    if (activeIframe) {
      startLoadFeedback(activeTab?.id);
      activeIframe.src = activeIframe.src;
    }
  }

  async function clearBrowsingData() {
    if (clearingData) return;
    clearingData = true;
    try {
      const ok = await clearPreviewData();
      // Reload so the cleared cookies/cache take effect immediately and the page
      // re-authenticates with a fresh session.
      if (ok) refresh();
    } finally {
      clearingData = false;
    }
  }

  function clearLoadFeedbackTimer() {
    if (loadFeedbackTimer) {
      clearTimeout(loadFeedbackTimer);
      loadFeedbackTimer = null;
    }
  }

  function startLoadFeedback(tabId = activeTab?.id) {
    if (!tabId) return;
    updateTabLoadState(tabId, { isLoading: true, iframeError: false, slowLoad: false });
    clearLoadFeedbackTimer();
    loadFeedbackTimer = setTimeout(() => {
      const state = ensureTabLoadState(tabId);
      if (state.isLoading) {
        updateTabLoadState(tabId, { slowLoad: true });
      }
    }, 1800);
  }

  function toggleInspectMode() {
    inspectMode = !inspectMode;
    selectedElementInfo = null;
    if (inspectMode) {
      ensureProxyRunning();
      injectInspectorIfNeeded();
    }
    postInspectorState();
  }

  // Inject the inspector script directly into the iframe when the proxy hasn't
  // done it (e.g. external URLs or proxy not yet ready).
  function injectInspectorIfNeeded() {
    const activeIframe = getActiveIframeElement();
    if (!activeIframe?.contentWindow) return;
    try {
      const doc = activeIframe.contentDocument || activeIframe.contentWindow.document;
      if (!doc || doc.querySelector('script[data-forge-inspector]')) return;
      const script = doc.createElement('script');
      script.setAttribute('data-forge-inspector', '1');
      script.textContent = getInspectorScript();
      (doc.head || doc.documentElement).appendChild(script);
    } catch {
      // Cross-origin — proxy injection is needed; silently ignore
    }
  }

  // Minimal inline inspector that mirrors what the Rust proxy injects,
  // used as a direct fallback when the proxy hasn't injected it yet.
  function getInspectorScript(): string {
    return `(function(){
  if (window.__forgeInspectorLoaded) return;
  window.__forgeInspectorLoaded = true;
  const state = { enabled: false, hovered: null, selected: null };
  let overlay, label;
  const buildSelector = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let sel = node.tagName.toLowerCase();
      if (node.id) { sel += '#' + node.id; parts.unshift(sel); break; }
      const cls = Array.from(node.classList || []).filter(c => c && !/^(ng-|v-|svelte-)/.test(c)).slice(0,2).join('.');
      if (cls) sel += '.' + cls;
      parts.unshift(sel);
      node = node.parentElement;
      if (parts.length >= 4) break;
    }
    return parts.join(' > ');
  };
  const ensureOverlay = () => {
    if (overlay) return;
    overlay = document.createElement('div');
    Object.assign(overlay.style, { position:'fixed', pointerEvents:'none', zIndex:'2147483646', border:'2px solid #7c6af7', background:'rgba(124,106,247,0.12)', borderRadius:'4px', boxSizing:'border-box', display:'none' });
    label = document.createElement('div');
    Object.assign(label.style, { position:'fixed', zIndex:'2147483647', padding:'6px 8px', borderRadius:'999px', background:'rgba(16,16,20,0.92)', color:'#fff', font:'12px system-ui,sans-serif', pointerEvents:'none', display:'none' });
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(label);
  };
  const hide = () => { if(overlay) overlay.style.display='none'; if(label) label.style.display='none'; };
  const show = (el) => {
    if (!overlay||!el) return;
    const r = el.getBoundingClientRect();
    if (r.width<2||r.height<2){hide();return;}
    overlay.style.display='block'; overlay.style.left=r.left+'px'; overlay.style.top=r.top+'px'; overlay.style.width=r.width+'px'; overlay.style.height=r.height+'px';
    label.style.display='block'; label.textContent=el.tagName.toLowerCase()+' '+buildSelector(el); label.style.left=Math.max(8,r.left)+'px'; label.style.top=Math.max(8,r.top-30)+'px';
  };
  const setEnabled = (v) => { state.enabled=v; document.documentElement.style.cursor=v?'crosshair':''; if(v)ensureOverlay(); else hide(); };
  document.addEventListener('mousemove', e => { if(!state.enabled)return; show(e.target instanceof Element?e.target:null); }, true);
  document.addEventListener('click', e => {
    if(!state.enabled)return;
    const el = e.target instanceof Element ? e.target : null;
    if(!el)return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);
    state.selected = {
      selector: buildSelector(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText||el.textContent||'').trim().slice(0,500),
      html: (el.outerHTML||'').slice(0,3000),
      classes: Array.from(el.classList||[]),
      styles: { display:computed.display, position:computed.position, color:computed.color, backgroundColor:computed.backgroundColor, width:computed.width, height:computed.height },
      page: { url: location.href, title: document.title },
      rect: { x:Math.round(r.x), y:Math.round(r.y), width:Math.round(r.width), height:Math.round(r.height) }
    };
    parent.postMessage({ type:'forge-inspector:selected', payload:state.selected }, '*');
  }, true);
  window.addEventListener('message', e => {
    if(e.source!==window.parent)return;
    if((e.data||{}).type!=='forge-inspector:set')return;
    setEnabled(Boolean(e.data.enabled));
  });
  setEnabled(false);
})();`;
  }

  function getActiveTabTargetOrigin(): string | null {
    if (!activeTab) return null;
    const url = activeTab.url;
    const localDev = parseLocalDevUrl(normalizeUrl(url));
    if (localDev) {
      // Local dev tab — only send if proxy port is known
      return getLocalDevProxyOrigin(localDev);
    }
    // External URL — inspector is never injected, skip entirely
    if (isAbsoluteUrl(normalizeUrl(url))) {
      return null;
    }
    // Relative path (served via proxy)
    if ($proxyPort) {
      return `http://127.0.0.1:${$proxyPort}`;
    }
    return window.location.origin;
  }

  function postInspectorState() {
    const activeIframe = getActiveIframeElement();
    if (!activeIframe?.contentWindow) return;
    const targetOrigin = getActiveTabTargetOrigin();
    if (!targetOrigin) return;
    // Include parentOrigin so the iframe script can use it as the postMessage target
    // when replying, avoiding the need for '*' in the reverse direction.
    activeIframe.contentWindow.postMessage(
      { type: 'forge-inspector:set', enabled: inspectMode, parentOrigin: window.location.origin },
      targetOrigin
    );
  }

  function buildIframeSrc(url: string) {
    const norm = normalizeUrl(url);
    if (norm === 'about:blank') {
      return norm;
    }
    const localDev = parseLocalDevUrl(norm);
    if (localDev) {
      return buildLocalProxyUrl(localDev.path, localDev);
    }
    // YouTube embeds are more reliable when loaded directly instead of through the local proxy.
    if (isYouTubeUrl(norm) && norm.includes('/embed/')) {
      return norm;
    }
    // External/absolute URLs: always proxy through background server (needed for iframe embedding)
    if (isAbsoluteUrl(norm)) {
      if ($proxyPort) {
        return buildExternalProxyUrl(norm);
      }
      // Background proxy server not yet ready — show blank
      return '';
    }
    // For local/relative URLs, route directly to the local dev server when dev mode is active.
    if ($proxyStarted) {
      return buildLocalProxyUrl(norm);
    }
    // Not in dev mode and no external URL — show placeholder
    return '';
  }

  let protocolBadge = $derived.by(() => {
    const norm = normalizeUrl($currentUrl);
    if (norm.startsWith('https://')) return 'HTTPS';
    if (norm.startsWith('http://')) return 'HTTP';
    return 'DEV';
  });

  function buildIframeSandbox(url: string) {
    const norm = normalizeUrl(url);
    // `allow-same-origin` is required for *all* preview content, not just local
    // dev. Everything (external sites included) is served through the loopback
    // proxy at http://127.0.0.1:{port}. Without `allow-same-origin` the iframe
    // document gets an opaque origin, so its navigation/subresource requests
    // carry `Origin: null` — which the proxy's CSRF/SSRF guard
    // (proxy_request_allowed) rejects with 403, leaving the page blank. Granting
    // it makes the document's origin the proxy origin (first-party to the guard)
    // while the parent app stays isolated by being a different origin
    // (tauri.localhost), so this does not expose the app to proxied pages.
    const base =
      'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin';
    if (isYouTubeUrl(norm)) {
      return `${base} allow-presentation`;
    }
    return base;
  }




  function handleIframeLoad(tabId: string) {
    updateTabLoadState(tabId, { isLoading: false, slowLoad: false, iframeError: false });
    clearLoadFeedbackTimer();
    if (activeTab?.id === tabId) {
      postInspectorState();
    }
    try {
      const iframeElement = iframeElements[tabId];
      if (iframeElement && iframeElement.contentWindow) {
        const href = iframeElement.contentWindow.location.href;
        if (!href) return;

        // Local dev server: direct same-origin URL, no '/proxy' prefix.
        // Read the pathname and push it to both store and address bar.
        if (!href.includes('/proxy')) {
          const path = iframeElement.contentWindow.location.pathname;
          const search = iframeElement.contentWindow.location.search;
          if (path && activeTab?.id === tabId) {
            const newUrl = path + search;
            // If the active tab's current URL is a full localhost URL whose
            // path already matches this load, the iframe just (re)loaded the
            // page we're already on — typically after Back/Forward to a
            // typed-in `http://localhost:PORT/...` history entry. Pushing here
            // would rewrite that entry to a relative path and truncate the
            // forward history, so only sync the address bar instead.
            const currentLocalDev = parseLocalDevUrl(normalizeUrl(activeTab.url));
            if (currentLocalDev) {
              const absoluteLocalUrl = `http://${currentLocalDev.host}:${currentLocalDev.port}${newUrl}`;
              if (activeTab.url === absoluteLocalUrl) {
                inputUrl = activeTab.url;
              } else {
                commitInternalNavigation(absoluteLocalUrl);
                inputUrl = absoluteLocalUrl;
              }
            } else {
              commitInternalNavigation(newUrl);
              inputUrl = newUrl;
            }
          }
          return;
        }

        // External URL proxied through the background server. The iframe already
        // navigated itself, so record it into history with commitInternalNavigation
        // (NOT navigatePreviewTab) — that updates url/history without re-driving
        // loadUrl, so we don't reload the page the user is already viewing, while
        // still making Back return to it instead of the last typed URL.
        const externalUrl = extractExternalUrlFromProxyUrl(href);
        if (externalUrl && activeTab?.id === tabId) {
          commitInternalNavigation(externalUrl);
          inputUrl = externalUrl;
        }
      }
    } catch (err) {
      // Cross-origin expected for direct external URLs without proxy
    }
  }
  function handleIframeError(tabId: string) {
    clearLoadFeedbackTimer();
    updateTabLoadState(tabId, { isLoading: false, slowLoad: false, iframeError: true });
  }

  function buildElementPrompt(info: SelectedElementInfo): string {
    const tag = info.tag.toLowerCase();
    const classStr = info.classes?.length ? `.${info.classes[0]}` : '';
    const textPreview = info.text
      ? ` "${info.text.slice(0, 30)}${info.text.length > 30 ? '…' : ''}"`
      : '';
    return `<${tag}${classStr}>${textPreview}`;
  }

  function pngBytesToDataUrl(pngBytes: number[]): string {
    const uint8 = new Uint8Array(pngBytes);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    return `data:image/png;base64,${btoa(binary)}`;
  }

  function revealPromptBar() {
    // The floating prompt bar overlays every aux view, so just focus it.
    // We must NOT switch to the terminal view here: that hides the preview
    // panel the user is actively inspecting (e.g. right after "Add Element
    // to Chat"), which looked like the preview closing unexpectedly.
    requestAnimationFrame(() => focusPromptBar());
  }

  function addImageToPrompt(dataUrl: string, name: string) {
    promptBarImage.set({ dataUrl, name });
  }

  // Captures a screenshot of the selected element's bounding box.
  // Returns a data URL string, or null if capture fails.
  async function captureElementScreenshot(info: SelectedElementInfo): Promise<string | null> {
    try {
      // Find the iframe that is showing the active tab
      const activeIframe = getActiveIframeElement();
      if (!activeIframe) return null;

      const iframeRect = activeIframe.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;

      // The element rect from the inspector is relative to the iframe's viewport.
      // Offset it by the iframe's position on screen to get absolute screen coords.
      const x = Math.round((iframeRect.left + info.rect.x) * scale) / scale;
      const y = Math.round((iframeRect.top + info.rect.y) * scale) / scale;
      const width = Math.max(4, Math.round(info.rect.width));
      const height = Math.max(4, Math.round(info.rect.height));

      // Clamp to the iframe's visible area so we never request out-of-bounds pixels
      const clampedX = Math.max(iframeRect.left, x);
      const clampedY = Math.max(iframeRect.top, y);
      const clampedW = Math.min(width, iframeRect.right - clampedX);
      const clampedH = Math.min(height, iframeRect.bottom - clampedY);
      if (clampedW <= 0 || clampedH <= 0) return null;

      const pngBytes = await invoke<number[]>('preview_capture_screenshot', {
        x: Math.round(clampedX),
        y: Math.round(clampedY),
        width: Math.round(clampedW),
        height: Math.round(clampedH),
        scale,
      });

      // Convert raw PNG bytes → base64 data URL
      return pngBytesToDataUrl(pngBytes);
    } catch {
      return null;
    }
  }

  async function addElementToPrompt(info: SelectedElementInfo) {
    const text = buildElementPrompt(info).trim();
    const dataUrl = await captureElementScreenshot(info);
    if (text) promptBarInput.set(text);
    if (dataUrl) {
      const tag = info.tag.toLowerCase();
      addImageToPrompt(dataUrl, `element-${tag}-${Date.now()}.png`);
      showToast('Element and screenshot added to prompt bar', 'success');
    } else if (text) {
      showToast('Element added, but screenshot capture failed', 'warning');
    }
    revealPromptBar();
  }

  function handleInspectorMessage(event: MessageEvent) {
    if (!event.data) return;

    // Identify which iframe sent the message
    const sourceTabId = Object.entries(iframeElements).find(([, iframe]) => iframe?.contentWindow === event.source)?.[0];

    // Scroll-position bridge: the iframe is cross-origin, so the page itself
    // reports its scroll offset (and asks to have it restored on load) via the
    // proxy origin, which we validate the same way as console/inspector traffic.
    if (event.data.type === 'forge-preview:scroll' || event.data.type === 'forge-preview:scroll-ready') {
      if (!sourceTabId) return;
      const sourceTab = ($previewTabs || []).find((t) => t.id === sourceTabId);
      if (!sourceTab) return;
      const sourceLocalDev = parseLocalDevUrl(normalizeUrl(sourceTab.url));
      const expectedOrigin = sourceLocalDev
        ? getLocalDevProxyOrigin(sourceLocalDev)
        : ($proxyPort ? `http://127.0.0.1:${$proxyPort}` : null);
      if (!expectedOrigin || event.origin !== expectedOrigin) return;

      if (event.data.type === 'forge-preview:scroll') {
        saveScrollPosition(sourceTab.url, {
          x: Number(event.data.x) || 0,
          y: Number(event.data.y) || 0,
        });
      } else {
        // Page is ready — restore its last known scroll position, if any.
        const saved = getScrollPosition(sourceTab.url);
        if (saved && (saved.x !== 0 || saved.y !== 0)) {
          iframeElements[sourceTabId]?.contentWindow?.postMessage(
            { type: 'forge-preview:scroll-restore', x: saved.x, y: saved.y },
            expectedOrigin
          );
        }
      }
      return;
    }

    // Console log events: only accept from our proxy origin
    if (event.data.type === 'forge-preview:console') {
      if (!sourceTabId) return;
      const sourceTab = ($previewTabs || []).find((t) => t.id === sourceTabId);
      const sourceLocalDev = sourceTab ? parseLocalDevUrl(normalizeUrl(sourceTab.url)) : null;
      const expectedOrigin = sourceLocalDev
        ? getLocalDevProxyOrigin(sourceLocalDev)
        : ($proxyPort ? `http://127.0.0.1:${$proxyPort}` : null);
      if (!expectedOrigin || event.origin !== expectedOrigin) return;
      const payload = event.data.payload || {};
      const level = ['log', 'info', 'warn', 'error', 'debug'].includes(payload.level) ? payload.level : 'log';
      if (activeTab?.id === sourceTabId) {
        consoleLogs = [
          ...consoleLogs.slice(-199),
          {
            id: ++consoleLogId,
            level,
            message: String(payload.message || ''),
            url: payload.url,
            timestamp: payload.timestamp || new Date().toISOString(),
          },
        ];
      }
      if ((level === 'error' || level === 'warn') && activeTab?.id === sourceTabId) {
        showConsole = true;
      }
      return;
    }

    // Inspector selection events: only accept from our proxy origin or a local dev URL.
    // External-URL iframes never have the inspector injected, so we reject those.
    if (event.data.type !== 'forge-inspector:selected') return;
    if (!sourceTabId) return;
    {
      const sourceTab = ($previewTabs || []).find((t) => t.id === sourceTabId);
      const sourceLocalDev = sourceTab ? parseLocalDevUrl(normalizeUrl(sourceTab.url)) : null;
      const expectedOrigin = sourceLocalDev
        ? getLocalDevProxyOrigin(sourceLocalDev)
        : ($proxyPort ? `http://127.0.0.1:${$proxyPort}` : null);
      if (!expectedOrigin || event.origin !== expectedOrigin) return;
    }
    const info = event.data.payload;
    selectedElementInfo = info;
    inspectMode = false;
    postInspectorState();
    if (info?.selector) {
      void addElementToPrompt(info);
    }
  }

  function handleInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      inputUrl = $currentUrl;
      (e.target as HTMLInputElement).blur();
    }
  }

  function clearConsoleLogs() {
    consoleLogs = [];
  }

  async function takeScreenshot() {
    if (screenshotting) return;
    const target = viewportMode !== 'responsive' ? deviceShellEl : previewContentEl;
    if (!target) return;
    screenshotting = true;
    try {
      const rect = target.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;

      const pngBytes = await invoke<number[]>('preview_capture_screenshot', {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scale,
      });

      const dataUrl = pngBytesToDataUrl(pngBytes);
      const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });

      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Screenshot copied to clipboard', 'success');
      } catch {
        const label = viewportMode === 'mobile' ? 'mobile' : viewportMode === 'tablet' ? 'tablet' : 'preview';
        const name = `soryq-${label}-${Date.now()}.png`;
        try {
          const link = document.createElement('a');
          link.download = name;
          link.href = URL.createObjectURL(blob);
          link.click();
          URL.revokeObjectURL(link.href);
          showToast('Screenshot saved as PNG', 'success');
        } catch {
          addImageToPrompt(dataUrl, name);
          revealPromptBar();
          showToast('Screenshot added to prompt bar', 'success');
        }
      }
    } catch (err) {
      showToast('Screenshot failed', 'error');
    } finally {
      screenshotting = false;
    }
  }

  function openNewTab() {
    createBlankPreviewBrowserTab();
    inputUrl = 'about:blank';
  }

  function activateTab(tabId: string) {
    selectPreviewBrowserTab(tabId);
    inputUrl = $currentUrl;
    selectedElementInfo = null;
  }

  function closeTab(event: MouseEvent, tabId: string) {
    event.stopPropagation();
    closePreviewBrowserTab(tabId);
    inputUrl = $currentUrl;
  }

  function handleCloseTabKeydown(event: KeyboardEvent, tabId: string) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    closePreviewBrowserTab(tabId);
    inputUrl = $currentUrl;
  }
</script>

<svelte:window onclick={handleWindowClickForHistory} />

<div class="preview-panel">
  <div class="preview-tabs">
    <div class="preview-tab-list" use:clampHorizontalScroll>
      {#each $previewTabs as tab (tab.id)}
        <button
          class="preview-tab"
          class:active={tab.id === $activePreviewTabId}
          onclick={() => activateTab(tab.id)}
          title={tab.url}
        >
          <span class="preview-tab-title">{tab.title}</span>
          <span
            class="preview-tab-close"
            role="button"
            tabindex="0"
            onclick={(event) => closeTab(event, tab.id)}
            onkeydown={(event) => handleCloseTabKeydown(event, tab.id)}
            aria-label="Close {tab.title}"
          >
            ×
          </span>
        </button>
      {/each}
    </div>

    <button class="preview-tab-add" onclick={openNewTab} title="New preview tab" aria-label="New preview tab">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>
  </div>

  <div class="browser-bar">
    <div class="nav-group main-nav">
      <button class="nav-btn" onclick={goBack} disabled={!canGoBack} title="Back">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <button class="nav-btn" onclick={goForward} disabled={!canGoForward} title="Forward">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
      <button class="nav-btn {getActiveTabLoadState().isLoading ? 'spinning' : ''}" onclick={refresh} title="Refresh">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8"/>
          <path d="M21 3v5h-5"/>
          <path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16"/>
          <path d="M8 16H3v5"/>
        </svg>
      </button>
    </div>

    <div class="nav-group utility-nav">
      <div class="history-wrap">
        <button
          class="nav-btn history-btn"
          class:active={showHistory}
          onclick={() => (showHistory = !showHistory)}
          title="Browsing history"
          aria-label="Browsing history"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7"/>
            <polyline points="3 3 3 9 9 9"/>
            <path d="M12 7v5l3 2"/>
          </svg>
        </button>
        {#if showHistory}
          <div class="history-dropdown">
            <div class="history-header">
              <span>History</span>
              {#if $browsingHistory.length}
                <button class="history-clear" onclick={clearBrowsingHistory}>Clear all</button>
              {/if}
            </div>
            <div class="history-list">
              {#if $browsingHistory.length === 0}
                <div class="history-empty">No history yet.</div>
              {:else}
                {#each $browsingHistory as entry (entry.url + entry.ts)}
                  <div class="history-row">
                    <button class="history-entry" onclick={() => openHistoryEntry(entry.url)} title={entry.url}>
                      <span class="history-title">{entry.title}</span>
                      <span class="history-url">{entry.url}</span>
                    </button>
                    <span class="history-time">{relativeTime(entry.ts)}</span>
                    <button class="history-remove" onclick={() => removeHistoryEntry(entry.url)} aria-label="Remove from history">×</button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <button
        class="nav-btn inspect-btn"
        class:active={inspectMode}
        onclick={toggleInspectMode}
        title={inspectMode ? 'Exit Add Element to Chat' : 'Add Element to Chat'}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3l7 18 2.5-7.5L20 13 3 3z"/>
        </svg>
      </button>
      <button
        class="nav-btn console-btn"
        class:active={showConsole}
        onclick={() => showConsole = !showConsole}
        title="Toggle preview console"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      </button>

      <!-- Screenshot -->
      <button
        class="nav-btn screenshot-btn"
        class:screenshotting
        onclick={takeScreenshot}
        disabled={screenshotting}
        title={viewportMode !== 'responsive' ? `Screenshot ${viewportMode} frame` : 'Screenshot preview'}
      >
        {#if screenshotting}
          <svg class="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
        {/if}
      </button>

      <!-- Clear cookies & cache -->
      <button
        class="nav-btn clear-data-btn"
        class:clearing={clearingData}
        onclick={clearBrowsingData}
        disabled={clearingData}
        title="Clear preview cookies & cache (keeps app settings)"
      >
        {#if clearingData}
          <svg class="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4"/>
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5Z"/>
            <circle cx="9.5" cy="11" r="0.6" fill="currentColor"/>
            <circle cx="14" cy="14.5" r="0.6" fill="currentColor"/>
            <circle cx="9.5" cy="16" r="0.6" fill="currentColor"/>
          </svg>
        {/if}
      </button>
    </div>

    <div class="nav-group viewport-nav">
      <!-- Viewport: Responsive (desktop) -->
      <button
        class="nav-btn viewport-btn"
        class:active={viewportMode === 'responsive'}
        onclick={() => viewportMode = 'responsive'}
        title="Responsive (full width)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="14" rx="2"/>
          <path d="M8 20h8M12 18v2"/>
        </svg>
      </button>

      <!-- Viewport: Tablet -->
      <button
        class="nav-btn viewport-btn"
        class:active={viewportMode === 'tablet'}
        onclick={() => viewportMode = 'tablet'}
        title="Tablet (768px)"
      >
        <svg width="13" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="2" width="16" height="20" rx="2"/>
          <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none"/>
        </svg>
      </button>

      <!-- Viewport: Mobile -->
      <button
        class="nav-btn viewport-btn"
        class:active={viewportMode === 'mobile'}
        onclick={() => viewportMode = 'mobile'}
        title="Mobile (375px)"
      >
        <svg width="10" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="2"/>
          <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none"/>
          <line x1="9" y1="6" x2="15" y2="6"/>
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

    <span
      class="preview-trust-pill"
      title="External pages load through Soryq's embedded proxy. Local dev preview uses the active project's configured port."
    >
      Sandboxed preview
    </span>

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
      <span class="label">Port:</span>
      <div class="port-combo">
        <input
          type="number"
          list="common-ports"
          class="port-input"
          bind:value={tempPort}
          onchange={handlePortChange}
          onkeydown={(e) => e.key === 'Enter' && handlePortChange()}
          min="1"
          max="65535"
          title="Dev server port (type custom or pick common)"
        />
        <datalist id="common-ports">
          {#each commonPorts as port (port)}
            <option value={port}>{port}</option>
          {/each}
        </datalist>
        <button
          class="nav-btn detect-btn"
          onclick={autoDetectPort}
          title="Auto-detect dev server port from project config"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
        </button>
      </div>

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
          <span class="proxy-btn-text">Connecting</span>
        {:else if $proxyStarted}
          <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
          <span class="proxy-btn-text">Dev: On</span>
        {:else}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
          </svg>
          <span class="proxy-btn-text">Dev: Off</span>
        {/if}
      </button>
    </div>
  </div>

  {#if getActiveTabLoadState().isLoading}
    <div class="loading-bar">
      <div class="loading-progress"></div>
    </div>
  {/if}

  {#if getActiveTabLoadState().slowLoad}
    <div class="preview-status-banner">
      <span>
        {$currentUrl.startsWith('http://localhost') || $currentUrl.startsWith('http://127.0.0.1') || $currentUrl.startsWith('http://0.0.0.0')
          ? `Waiting for your local dev server on port ${$targetPort} to finish responding.`
          : 'The preview is still loading through the embedded proxy.'}
      </span>
    </div>
  {/if}

  {#if getActiveTabLoadState().iframeError}
    <div class="preview-status-banner error">
      <span>Preview failed to load. Check that the local dev server is running and reachable on port {$targetPort}.</span>
    </div>
  {/if}

  {#if selectedElementInfo}
    <div class="inspect-banner">
      <div class="inspect-copy">
        <span class="inspect-label">Selected</span>
        <strong>{selectedElementInfo.selector}</strong>
        <span class="inspect-meta">{selectedElementInfo.tag} {selectedElementInfo.rect.width}x{selectedElementInfo.rect.height}</span>
      </div>
      <button class="inspect-add-btn" onclick={() => selectedElementInfo && addElementToPrompt(selectedElementInfo)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        Add to prompt
      </button>
      <button class="inspect-copy-btn" onclick={async () => {
        await navigator.clipboard.writeText(selectedElementInfo?.selector || '');
        showToast('Selector copied to clipboard', 'success');
      }}>Copy selector</button>
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

  <div class="preview-content" class:viewport-constrained={viewportMode !== 'responsive'} bind:this={previewContentEl}>
    {#if activeIframeSrc}
      {#if viewportMode !== 'responsive'}
        <div class="device-shell" class:is-mobile={viewportMode === 'mobile'} class:is-tablet={viewportMode === 'tablet'} bind:this={deviceShellEl}>
          <div class="device-notch"></div>
          <div class="device-screen">
            <div class="preview-frame-stack">
              {#each $previewTabs as tab (tab.id)}
                {@const tabSrc = buildIframeSrc(tab.loadUrl ?? tab.url)}
                {#if tabSrc}
                  <iframe
                    use:registerIframe={tab.id}
                    src={tabSrc}
                    title="Web Preview"
                    class="preview-iframe"
                    class:is-active={tab.id === $activePreviewTabId}
                    onload={() => handleIframeLoad(tab.id)}
                    onerror={() => handleIframeError(tab.id)}
                    allow="accelerometer; camera; clipboard-read; clipboard-write; encrypted-media; geolocation; gyroscope; microphone; payment; usb"
                  sandbox={buildIframeSandbox(tab.url)}
                    allowfullscreen
                  ></iframe>
                {/if}
              {/each}
            </div>
          </div>
          <div class="device-home"></div>
          <span class="device-label">
            {viewportMode === 'mobile' ? '375px · iPhone' : '768px · iPad'}
          </span>
        </div>
      {:else}
        <div class="preview-frame-stack">
          {#each $previewTabs as tab (tab.id)}
            {@const tabSrc = buildIframeSrc(tab.loadUrl ?? tab.url)}
            {#if tabSrc}
            <iframe
              use:registerIframe={tab.id}
                src={tabSrc}
                title="Web Preview"
                class="preview-iframe"
                class:is-active={tab.id === $activePreviewTabId}
                onload={() => handleIframeLoad(tab.id)}
                onerror={() => handleIframeError(tab.id)}
                allow="accelerometer; camera; clipboard-read; clipboard-write; encrypted-media; geolocation; gyroscope; microphone; payment; usb"
              sandbox={buildIframeSandbox(tab.url)}
                allowfullscreen
              ></iframe>
            {/if}
          {/each}
        </div>
      {/if}
    {:else}
      <div class="proxy-placeholder">
        <div class="placeholder-globe">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 014-10z"/>
          </svg>
        </div>
        <h3>Web Preview</h3>
        <p>Built for previewing your <strong>local dev server</strong> (port {$targetPort}). You can also open external pages, but many full websites block embedding and won't load here — this isn't a full web browser.</p>
        <div class="placeholder-actions">
          <button class="action-btn web-btn" onclick={() => { navigatePreviewTab('https://html.duckduckgo.com/html/'); inputUrl = 'https://html.duckduckgo.com/html/'; }}
            title="Open browser">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
            </svg>
            Browse Web
          </button>
          <button class="action-btn" onclick={toggleProxy}
            title="Preview local dev server">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
            </svg>
            Local Dev ({$targetPort})
          </button>
        </div>
        <p class="placeholder-note">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          Local &amp; development previews work best
        </p>
      </div>
    {/if}

    {#if showConsole}
      <div class="preview-console">
        <div class="console-header">
          <span>Console</span>
          <div class="console-actions">
            <span>{consoleLogs.length} logs</span>
            <button onclick={clearConsoleLogs}>Clear</button>
            <button onclick={() => showConsole = false} aria-label="Close console">Close</button>
          </div>
        </div>
        <div class="console-body">
          {#if consoleLogs.length === 0}
            <div class="console-empty">No preview console output yet.</div>
          {:else}
            {#each consoleLogs as log (log.id)}
              <div class="console-row {log.level}">
                <span class="console-level">{log.level}</span>
                <span class="console-message">{log.message}</span>
              </div>
            {/each}
          {/if}
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
    /* Transparent so the frosted glass aux panel shows through; the actual
       web preview iframe paints its own opaque page background. */
    background: transparent;
    overflow: hidden;
    container-type: inline-size;
  }

  .preview-tabs {
    height: 36px;
    /* Transparent chrome — the frosted aux panel behind shows through. */
    background: transparent;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 10px;
    flex-shrink: 0;
  }

  .preview-tab-list {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
    scrollbar-width: none;
  }

  .preview-tab-list::-webkit-scrollbar {
    display: none;
  }

  .preview-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 220px;
    height: 28px;
    padding: 0 8px 0 10px;
    border-radius: 8px;
    border: 1px solid transparent;
    scroll-snap-align: start;
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .preview-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .preview-tab.active {
    background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
    border-color: var(--border);
    color: var(--text-primary);
  }

  .preview-tab-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11.5px;
  }

  .preview-tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1;
    flex-shrink: 0;
  }

  .preview-tab-close:hover {
    background: rgba(248, 113, 113, 0.12);
    color: var(--error);
  }

  .preview-tab-add {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 7px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }

  .preview-tab-add:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
  }

  /* Browser bar */
  .browser-bar {
    height: 42px;
    /* Transparent toolbar chrome — frosted aux panel shows through. */
    background: transparent;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 8px;
    gap: 8px;
    flex-shrink: 0;
  }

  .nav-group {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    align-items: center;
  }

  .viewport-nav {
    border-left: 1px solid var(--border);
    padding-left: 4px;
    margin-left: 2px;
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

  .nav-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .nav-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .nav-btn.active {
    background: var(--accent-light);
    color: var(--accent);
  }

  .console-btn.active {
    background: rgba(56, 189, 248, 0.14);
    color: var(--info);
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  :global(.nav-btn.spinning svg) { animation: spin 0.7s linear infinite; }

  .address-bar {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
    border: 1px solid var(--border);
    border-radius: 9999px;
    height: 30px;
    padding: 0 4px 0 12px;
    gap: 6px;
    transition: border-color 0.15s;
    overflow: hidden;
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

  .preview-trust-pill {
    flex-shrink: 0;
    max-width: 138px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
    border-radius: 999px;
    padding: 4px 8px;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 600;
  }

  .proxy-settings {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    min-width: 0;
  }

  .label {
    font-size: 10.5px;
    color: var(--text-muted);
    font-weight: 500;
    white-space: nowrap;
  }

  .port-combo {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .port-input {
    width: 62px;
    height: 32px;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-primary);
    font-size: 11.5px;
    text-align: center;
    outline: none;
    font-family: inherit;
    transition: border-color 0.15s;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .port-input::-webkit-inner-spin-button,
  .port-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .port-input:focus { border-color: var(--accent); }

  .detect-btn {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
  }

  .proxy-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    background: var(--accent);
    color: var(--button-text, #fff);
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

  .preview-status-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    background: rgba(56, 189, 248, 0.08);
    border-bottom: 1px solid var(--border);
    color: var(--info);
    font-size: 11px;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .preview-status-banner.error {
    background: rgba(239, 68, 68, 0.08);
    color: var(--error);
  }

  /* Preview area */
  .preview-content {
    flex: 1;
    /* Transparent — the actual web iframe / device screen paint their own white
       page background. Keeping this transparent lets the frosted glass (and any
       background image) show through on the initial placeholder + around the
       device frame. */
    background: transparent;
    position: relative;
    overflow: hidden;
  }

  .inspect-banner {
    position: absolute;
    right: 14px;
    bottom: 14px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: rgba(10, 10, 12, 0.82);
    backdrop-filter: blur(10px);
    color: var(--text-primary);
    max-width: min(520px, calc(100% - 24px));
  }

  .inspect-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .inspect-label,
  .inspect-meta {
    color: var(--text-muted);
    font-size: 11px;
  }

  .inspect-copy strong {
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .inspect-copy-btn {
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 9999px;
    padding: 7px 10px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 11.5px;
  }

  .inspect-copy-btn:hover {
    background: var(--bg-hover);
  }

  .inspect-add-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
    border-radius: 9999px;
    padding: 7px 12px;
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
    cursor: pointer;
    font-size: 11.5px;
    font-weight: 600;
    transition: background 0.15s, border-color 0.15s;
  }

  .inspect-add-btn:hover {
    background: color-mix(in srgb, var(--accent) 28%, transparent);
    border-color: var(--accent);
  }

  .preview-frame-stack {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .preview-iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: #ffffff;
    display: block;
    opacity: 0;
    pointer-events: none;
    visibility: hidden;
  }

  .preview-iframe.is-active {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
  }

  .preview-console {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    z-index: 30;
    max-height: min(260px, 45%);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
    color: var(--text-primary);
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.36);
    overflow: hidden;
  }

  .console-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  .console-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 500;
    text-transform: none;
  }

  .console-actions button {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 10px;
    cursor: pointer;
  }

  .console-actions button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .console-body {
    min-height: 72px;
    overflow: auto;
    font-family: var(--editor-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
    font-size: 11px;
    line-height: 1.45;
  }

  .console-empty {
    padding: 18px 12px;
    color: var(--text-muted);
    text-align: center;
  }

  .console-row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .console-row.warn {
    background: rgba(251, 191, 36, 0.07);
  }

  .console-row.error {
    background: rgba(239, 68, 68, 0.08);
  }

  .console-row.info,
  .console-row.debug {
    color: var(--text-secondary);
  }

  .console-level {
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: 9px;
    font-weight: 800;
  }

  .console-row.warn .console-level {
    color: var(--warning);
  }

  .console-row.error .console-level {
    color: var(--error);
  }

  .console-message {
    min-width: 0;
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
    /* Transparent initial page — frosted aux panel + background image show
       through. (The .overlay variant below re-adds a frost so it can cover a
       loading iframe.) */
    background: transparent;
    color: var(--text-primary);
    gap: 12px;
  }

  .proxy-placeholder.overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    /* Covers a not-yet-ready iframe — needs a frosted backing to stay legible. */
    background: rgba(var(--bg-primary-rgb, 24, 24, 30), var(--frost-surface, 0.72));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
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

  .placeholder-note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 11.5px;
    opacity: 0.85;
  }

  .placeholder-note svg { flex-shrink: 0; opacity: 0.7; }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 36px;
    padding: 0 20px;
    border-radius: 8px;
    background: var(--accent);
    color: var(--button-text, #fff);
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

  /* ── Screenshot button ── */
  .screenshot-btn:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
  }

  .screenshot-btn.screenshotting {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* ── Viewport toggle ── */

  .viewport-btn.active {
    background: var(--accent-light);
    color: var(--accent);
  }

  /* ── Device shell (constrained viewport) ── */
  .preview-content.viewport-constrained {
    background: radial-gradient(ellipse at 50% 30%, #1e1e2e 0%, #0c0c12 100%);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow: auto;
    padding: 40px 32px 56px;
  }

  /* ── Shared device chassis ── */
  .device-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    background: #1c1c1e;
    margin: auto;
  }

  /* ── Mobile (iPhone-style) ── */
  .device-shell.is-mobile {
    border-radius: 52px;
    padding: 18px 10px 14px;
    box-shadow:
      inset 0 0 0 1px rgba(255,255,255,0.08),   /* inner highlight */
      0 0 0 1.5px #3c3c3e,                       /* silver rim */
      0 0 0 3px #1c1c1e,                         /* dark gap */
      0 0 0 4.5px #4a4a4e,                       /* outer rim */
      0 0 0 5.5px #1c1c1e,                       /* outer dark */
      0 32px 80px rgba(0,0,0,0.65),
      0 8px 24px rgba(0,0,0,0.4);
  }

  /* Left side buttons (volume up / down) */
  .device-shell.is-mobile::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 110px;
    width: 4px;
    height: 34px;
    background: #3c3c3e;
    border-radius: 2px 0 0 2px;
    box-shadow: 0 44px 0 #3c3c3e;
  }

  /* Right side button (power) */
  .device-shell.is-mobile::after {
    content: '';
    position: absolute;
    right: -6px;
    top: 140px;
    width: 4px;
    height: 68px;
    background: #3c3c3e;
    border-radius: 0 2px 2px 0;
  }

  /* ── Tablet (iPad-style) ── */
  .device-shell.is-tablet {
    border-radius: 26px;
    padding: 18px 14px 16px;
    box-shadow:
      inset 0 0 0 1px rgba(255,255,255,0.07),
      0 0 0 1.5px #3c3c3e,
      0 0 0 3px #1c1c1e,
      0 0 0 4.5px #4a4a4e,
      0 0 0 5.5px #1c1c1e,
      0 24px 64px rgba(0,0,0,0.55),
      0 6px 18px rgba(0,0,0,0.35);
  }

  /* Top edge camera (tablet) */
  .device-shell.is-tablet::before {
    content: '';
    position: absolute;
    top: 9px;
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #2a2a2e;
    border: 1.5px solid #3a3a3e;
  }

  /* Right edge power button (tablet) */
  .device-shell.is-tablet::after {
    content: '';
    position: absolute;
    top: 80px;
    right: -6px;
    width: 4px;
    height: 50px;
    background: #3c3c3e;
    border-radius: 0 2px 2px 0;
  }

  /* ── Dynamic Island pill (mobile only) ── */
  .device-notch {
    flex-shrink: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .device-shell.is-mobile .device-notch {
    width: 120px;
    height: 34px;
    background: #000;
    border-radius: 17px;
    margin-bottom: 10px;
    padding-right: 10px;
    gap: 5px;
  }

  /* Camera lens inside pill */
  .device-shell.is-mobile .device-notch::after {
    content: '';
    position: absolute;
    right: 12px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #0d0d18;
    border: 1.5px solid #1e1e2a;
    box-shadow: 0 0 0 2px rgba(60,60,80,0.5);
  }

  /* Tablet has no notch — hide it */
  .device-shell.is-tablet .device-notch {
    display: none;
  }

  /* ── Screen ── */
  .device-screen {
    border-radius: 8px;
    overflow: hidden;
    background: #fff;
  }

  .device-shell.is-mobile .device-screen {
    border-radius: 14px;
    width: 375px;
  }

  .device-shell.is-tablet .device-screen {
    border-radius: 10px;
    width: 768px;
  }

  .device-screen .preview-iframe {
    width: 100%;
    height: 750px;
    display: block;
    border: none;
  }

  .device-screen .preview-frame-stack {
    width: 100%;
    height: 750px;
  }

  .device-shell.is-tablet .device-screen .preview-iframe {
    height: 960px;
  }

  .device-shell.is-tablet .device-screen .preview-frame-stack {
    height: 960px;
  }

  /* ── Home indicator / home button ── */
  .device-home {
    flex-shrink: 0;
  }

  .device-shell.is-mobile .device-home {
    width: 134px;
    height: 5px;
    background: rgba(255, 255, 255, 0.28);
    border-radius: 3px;
    margin-top: 12px;
  }

  .device-shell.is-tablet .device-home {
    display: none;
  }

  /* ── Viewport label badge ── */
  .device-label {
    position: absolute;
    bottom: -28px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 10.5px;
    font-weight: 600;
    color: rgba(255,255,255,0.3);
    white-space: nowrap;
    letter-spacing: 0.5px;
  }

  /* Container queries for responsive toolbar */
  @container (max-width: 650px) {
    .browser-bar {
      height: auto;
      min-height: 74px;
      padding: 6px 8px;
      flex-wrap: wrap;
      gap: 6px 8px;
    }

    /* Row 1 elements */
    .main-nav {
      order: 1;
    }

    .address-bar {
      order: 2;
      flex: 1;
      min-width: 140px;
    }

    .open-external-btn {
      order: 3;
    }

    .preview-trust-pill {
      order: 4;
    }

    /* Row 2 elements */
    .utility-nav {
      order: 5;
    }

    .viewport-nav {
      order: 6;
    }

    .proxy-settings {
      order: 7;
      margin-left: auto;
    }
  }

  @container (max-width: 480px) {
    .preview-tabs {
      padding-inline: 8px;
      gap: 6px;
    }

    .preview-tab {
      max-width: 150px;
    }

    /* Hide viewport selectors on small screens to save space */
    .viewport-nav {
      display: none;
    }

    .label {
      display: none;
    }

    .preview-trust-pill {
      display: none;
    }
  }

  @container (max-width: 380px) {
    .preview-tab {
      max-width: 110px;
    }

    .protocol-badge {
      display: none;
    }

    .browser-bar {
      gap: 4px;
    }

    /* Hide utility nav (inspect/console/screenshot) at very narrow widths */
    .utility-nav {
      display: none;
    }

    /* Row 1: main-nav + proxy-settings */
    .main-nav {
      order: 1;
    }

    .proxy-settings {
      order: 2;
      margin-left: auto;
    }

    /* Row 2: Address bar alone */
    .address-bar {
      order: 3;
      flex: 1 1 100%;
      width: 100%;
      margin-top: 2px;
    }

    .open-external-btn {
      order: 4;
    }

    .proxy-btn-text {
      display: none;
    }

    .proxy-btn {
      padding: 0 8px;
    }
  }

  @container (max-width: 280px) {
    .port-input {
      width: 48px;
    }
    .detect-btn {
      display: none;
    }
  }

  /* ── Browsing history dropdown ── */
  .history-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .history-btn.active {
    background: var(--accent-light);
    color: var(--accent);
  }

  .history-dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 60;
    width: 340px;
    max-width: 80vw;
    max-height: 380px;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    padding: 0 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .history-clear {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 600;
    text-transform: none;
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 5px;
  }
  .history-clear:hover { background: var(--bg-hover); color: var(--error); }

  .history-list {
    overflow-y: auto;
    padding: 4px;
  }

  .history-empty {
    padding: 18px 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: 11.5px;
  }

  .history-row {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    padding-right: 4px;
  }
  .history-row:hover { background: var(--bg-hover); }

  .history-entry {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 7px 8px;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    color: inherit;
  }

  .history-title {
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-url {
    font-size: 10.5px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .history-time {
    flex-shrink: 0;
    font-size: 9.5px;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .history-remove {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
  }
  .history-row:hover .history-remove { opacity: 1; }
  .history-remove:hover { background: rgba(248, 113, 113, 0.14); color: var(--error); }
</style>
