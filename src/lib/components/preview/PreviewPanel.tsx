import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '$lib/react/useStore';
import { useAction } from '$lib/react/useAction';
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
  closePreviewBrowserTab,
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

import './PreviewPanel.css';

type ViewportMode = 'responsive' | 'tablet' | 'mobile';

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

type TabLoadState = { isLoading: boolean; slowLoad: boolean; iframeError: boolean };

const DEFAULT_TAB_LOAD_STATE: TabLoadState = {
  isLoading: false,
  slowLoad: false,
  iframeError: false,
};

const commonPorts = [
  3000, 3001, 4173, 4200, 5000, 5173, 6006, 7000, 8000, 8080, 8081, 8888, 9000, 9229, 1234,
];

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
  const isLocal = /^(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:|\/|$)/i.test(
    firstSegment,
  );
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

function parseLocalDevUrl(url: string): { host: string; port: number; path: string } | null {
  try {
    const parsed = new URL(url);
    const isLocalHost =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '0.0.0.0';

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

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(url);
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

function buildElementPrompt(info: SelectedElementInfo): string {
  const tag = info.tag.toLowerCase();
  const classStr = info.classes?.length ? `.${info.classes[0]}` : '';
  const textPreview = info.text ? ` "${info.text.slice(0, 30)}${info.text.length > 30 ? '…' : ''}"` : '';
  return `<${tag}${classStr}>${textPreview}`;
}

function pngBytesToDataUrl(pngBytes: number[]): string {
  const uint8 = new Uint8Array(pngBytes);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
  return `data:image/png;base64,${btoa(binary)}`;
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

export default function PreviewPanel() {
  const tabs = useStore(previewTabs);
  const activeTabId = useStore(activePreviewTabId);
  const currentUrlValue = useStore(currentUrl);
  const port = useStore(targetPort);
  const proxyPortValue = useStore(proxyPort);
  const proxyStartedValue = useStore(proxyStarted);
  const preferredLocalHostValue = useStore(preferredLocalHost);
  const localDevProxyPortsValue = useStore(localDevProxyPorts);
  const isConnectingValue = useStore(isConnecting);
  const browsingHistoryValue = useStore(browsingHistory);
  const project = useStore(activeProject);

  const iframeElementsRef = useRef<Record<string, HTMLIFrameElement | undefined>>({});
  const previewContentRef = useRef<HTMLDivElement>(null);
  const deviceShellRef = useRef<HTMLDivElement>(null);
  const [screenshotting, setScreenshotting] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [tempPort, setTempPort] = useState(port);
  const [inputUrl, setInputUrl] = useState(currentUrlValue);
  const [inspectMode, setInspectMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [viewportMode, setViewportMode] = useState<ViewportMode>('responsive');
  const [selectedElementInfo, setSelectedElementInfo] = useState<SelectedElementInfo | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<PreviewConsoleLog[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [tabLoadState, setTabLoadState] = useState<Record<string, TabLoadState>>({});

  const consoleLogIdRef = useRef(0);
  const loadFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tabListRef = useAction<HTMLDivElement>(clampHorizontalScroll);

  const activeTab = useMemo(() => (tabs || []).find((tab) => tab.id === activeTabId) ?? null, [tabs, activeTabId]);
  const canGoBack = (activeTab?.historyIndex ?? 0) > 0;
  const canGoForward = activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false;

  // Keep latest mutable snapshots available to stable callbacks without
  // re-creating those callbacks on every render (mirrors the Svelte version's
  // direct closure access to component-scope `let` bindings).
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const inspectModeRef = useRef(inspectMode);
  inspectModeRef.current = inspectMode;
  const proxyPortRef = useRef(proxyPortValue);
  proxyPortRef.current = proxyPortValue;
  const portRef = useRef(port);
  portRef.current = port;

  const ensureTabLoadState = useCallback(
    (tabId: string) => tabLoadState[tabId] ?? DEFAULT_TAB_LOAD_STATE,
    [tabLoadState],
  );

  const updateTabLoadState = useCallback((tabId: string, patch: Partial<TabLoadState>) => {
    setTabLoadState((prev) => ({
      ...prev,
      [tabId]: {
        ...(prev[tabId] ?? DEFAULT_TAB_LOAD_STATE),
        ...patch,
      },
    }));
  }, []);

  const getActiveTabLoadState = useCallback((): TabLoadState => {
    const tab = activeTabRef.current;
    return tab ? tabLoadState[tab.id] ?? DEFAULT_TAB_LOAD_STATE : DEFAULT_TAB_LOAD_STATE;
  }, [tabLoadState]);

  const setIframeElement = useCallback((tabId: string, element: HTMLIFrameElement | null) => {
    iframeElementsRef.current = {
      ...iframeElementsRef.current,
      [tabId]: element ?? undefined,
    };
  }, []);

  const getActiveIframeElement = useCallback(() => {
    const tab = activeTabRef.current;
    return tab ? iframeElementsRef.current[tab.id] : undefined;
  }, []);

  const buildLocalProxyUrl = useCallback(
    (path: string, localDev?: { host: string; port: number }) => {
      const proxyPortForPath = localDev
        ? localDevProxyPortsValue[localDevProxyKey(localDev.host, localDev.port)]
        : proxyPortValue;
      if (!proxyPortForPath) return '';
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      return `http://127.0.0.1:${proxyPortForPath}${normalizedPath}`;
    },
    [localDevProxyPortsValue, proxyPortValue],
  );

  const buildExternalProxyUrl = useCallback(
    (url: string) => {
      try {
        const parsed = new URL(url);
        const scheme = parsed.protocol.replace(':', '');
        const authority = parsed.host;
        const path = parsed.pathname || '/';
        const search = parsed.search || '';
        return `http://127.0.0.1:${proxyPortValue}/proxy/${scheme}/${authority}${path}${search}`;
      } catch {
        return `http://127.0.0.1:${proxyPortValue}/proxy?url=${encodeURIComponent(url)}`;
      }
    },
    [proxyPortValue],
  );

  const getLocalDevProxyOrigin = useCallback(
    (localDev: { host: string; port: number }) => {
      const proxyPortForOrigin = localDevProxyPortsValue[localDevProxyKey(localDev.host, localDev.port)];
      return proxyPortForOrigin ? `http://127.0.0.1:${proxyPortForOrigin}` : null;
    },
    [localDevProxyPortsValue],
  );

  const buildIframeSrc = useCallback(
    (url: string) => {
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
        if (proxyPortValue) {
          return buildExternalProxyUrl(norm);
        }
        // Background proxy server not yet ready — show blank
        return '';
      }
      // For local/relative URLs, route directly to the local dev server when dev mode is active.
      if (proxyStartedValue) {
        return buildLocalProxyUrl(norm);
      }
      // Not in dev mode and no external URL — show placeholder
      return '';
    },
    [buildLocalProxyUrl, buildExternalProxyUrl, proxyPortValue, proxyStartedValue],
  );

  const activeIframeSrc = activeTab ? buildIframeSrc(activeTab.loadUrl ?? activeTab.url) : '';

  const showYoutubeHomepageWarning =
    !proxyStartedValue &&
    (currentUrlValue.includes('youtube.com') || currentUrlValue.includes('youtu.be')) &&
    !currentUrlValue.includes('/embed/');

  const protocolBadge = useMemo(() => {
    const norm = normalizeUrl(currentUrlValue);
    if (norm.startsWith('https://')) return 'HTTPS';
    if (norm.startsWith('http://')) return 'HTTP';
    return 'DEV';
  }, [currentUrlValue]);

  const clearLoadFeedbackTimer = useCallback(() => {
    if (loadFeedbackTimerRef.current) {
      clearTimeout(loadFeedbackTimerRef.current);
      loadFeedbackTimerRef.current = null;
    }
  }, []);

  const startLoadFeedback = useCallback(
    (tabId: string | undefined = activeTabRef.current?.id) => {
      if (!tabId) return;
      updateTabLoadState(tabId, { isLoading: true, iframeError: false, slowLoad: false });
      clearLoadFeedbackTimer();
      loadFeedbackTimerRef.current = setTimeout(() => {
        setTabLoadState((prev) => {
          const state = prev[tabId] ?? DEFAULT_TAB_LOAD_STATE;
          if (!state.isLoading) return prev;
          return { ...prev, [tabId]: { ...state, slowLoad: true } };
        });
      }, 1800);
    },
    [updateTabLoadState, clearLoadFeedbackTimer],
  );

  const handlePortChange = useCallback(() => {
    if (tempPort >= 1 && tempPort <= 65535) {
      setTargetPort(tempPort);
    }
  }, [tempPort]);

  const openInBrowser = useCallback(async () => {
    // Get the real URL (not the proxied version)
    const url = currentUrlValue;
    const norm = normalizeUrl(url);
    if (!norm || norm === 'about:blank' || norm === '/') return;
    try {
      await invoke('preview_open_in_browser', { url: norm });
    } catch (err) {
      showToast(`Could not open browser: ${err}`, 'error');
    }
  }, [currentUrlValue]);

  const toggleProxy = useCallback(async () => {
    if (proxyStartedValue) {
      // Stop dev mode — go back to a blank local path so the web panel stays clean
      stopProxy();
      if (!isAbsoluteUrl(currentUrlValue) || parseLocalDevUrl(normalizeUrl(currentUrlValue))) {
        navigatePreviewTab('/');
      }
    } else {
      // Start dev mode — navigate to the root of the local dev server
      await clearProxyTarget();
      await startProxy();
      const host = preferredLocalHostValue || 'localhost';
      await ensureLocalDevProxy(portRef.current, host);
      navigatePreviewTab(`http://${host}:${portRef.current}/`);
    }
  }, [proxyStartedValue, currentUrlValue, preferredLocalHostValue]);

  const autoDetectPort = useCallback(async () => {
    const projectPath = project?.root_path;
    if (!projectPath) {
      showToast('No active project — open a project folder first', 'info');
      return;
    }
    try {
      const detected = await invoke<number>('workspace_detect_port', { path: projectPath });
      await setTargetPort(detected);
    } catch {
      showToast('Could not detect dev server port', 'error');
    }
  }, [project]);

  const navigateTo = useCallback(
    async (rawUrl: string) => {
      const normalized = normalizeUrl(rawUrl);
      const localDev = parseLocalDevUrl(normalized);
      if (localDev) {
        await clearProxyTarget();
        await setPreferredLocalHost(localDev.host);
        await ensureLocalDevProxy(localDev.port, localDev.host);
        if (portRef.current !== localDev.port) {
          await setTargetPort(localDev.port);
        }
      } else {
        await setPreferredLocalHost(null);
        // Ensure the background proxy is running BEFORE updating the store and
        // triggering the iframe src binding, so buildIframeSrc sees the port set.
        await ensureProxyRunning();
      }
      navigatePreviewTab(normalized);
      setInputUrl(normalized);
      startLoadFeedback();
    },
    [startLoadFeedback],
  );

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void navigateTo(inputUrl);
    },
    [navigateTo, inputUrl],
  );

  const openHistoryEntry = useCallback(
    (url: string) => {
      setShowHistory(false);
      void navigateTo(url);
    },
    [navigateTo],
  );

  const goBack = useCallback(() => {
    if (!canGoBack) return;
    goBackPreviewTab();
    setInputUrl(currentUrl as unknown as string);
    startLoadFeedback();
  }, [canGoBack, startLoadFeedback]);

  const goForward = useCallback(() => {
    if (!canGoForward) return;
    goForwardPreviewTab();
    startLoadFeedback();
  }, [canGoForward, startLoadFeedback]);

  const refresh = useCallback(() => {
    const activeIframe = getActiveIframeElement();
    if (activeIframe) {
      startLoadFeedback(activeTabRef.current?.id);
      activeIframe.src = activeIframe.src;
    }
  }, [getActiveIframeElement, startLoadFeedback]);

  const clearBrowsingData = useCallback(async () => {
    if (clearingData) return;
    setClearingData(true);
    try {
      const ok = await clearPreviewData();
      // Reload so the cleared cookies/cache take effect immediately and the page
      // re-authenticates with a fresh session.
      if (ok) refresh();
    } finally {
      setClearingData(false);
    }
  }, [clearingData, refresh]);

  const postInspectorState = useCallback(() => {
    const activeIframe = getActiveIframeElement();
    if (!activeIframe?.contentWindow) return;
    const tab = activeTabRef.current;
    if (!tab) return;
    const url = tab.url;
    const localDev = parseLocalDevUrl(normalizeUrl(url));
    let targetOrigin: string | null;
    if (localDev) {
      // Local dev tab — only send if proxy port is known
      targetOrigin = getLocalDevProxyOrigin(localDev);
    } else if (isAbsoluteUrl(normalizeUrl(url))) {
      // External URL — inspector is never injected, skip entirely
      targetOrigin = null;
    } else if (proxyPortRef.current) {
      // Relative path (served via proxy)
      targetOrigin = `http://127.0.0.1:${proxyPortRef.current}`;
    } else {
      targetOrigin = window.location.origin;
    }
    if (!targetOrigin) return;
    // Include parentOrigin so the iframe script can use it as the postMessage target
    // when replying, avoiding the need for '*' in the reverse direction.
    activeIframe.contentWindow.postMessage(
      { type: 'forge-inspector:set', enabled: inspectModeRef.current, parentOrigin: window.location.origin },
      targetOrigin,
    );
  }, [getActiveIframeElement, getLocalDevProxyOrigin]);

  // Inject the inspector script directly into the iframe when the proxy hasn't
  // done it (e.g. external URLs or proxy not yet ready).
  const injectInspectorIfNeeded = useCallback(() => {
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
  }, [getActiveIframeElement]);

  const toggleInspectMode = useCallback(() => {
    setInspectMode((prev) => {
      const next = !prev;
      inspectModeRef.current = next;
      setSelectedElementInfo(null);
      if (next) {
        ensureProxyRunning();
        injectInspectorIfNeeded();
      }
      postInspectorState();
      return next;
    });
  }, [injectInspectorIfNeeded, postInspectorState]);

  const revealPromptBar = useCallback(() => {
    // The floating prompt bar overlays every aux view, so just focus it.
    // We must NOT switch to the terminal view here: that hides the preview
    // panel the user is actively inspecting (e.g. right after "Add Element
    // to Chat"), which looked like the preview closing unexpectedly.
    requestAnimationFrame(() => focusPromptBar());
  }, []);

  const addImageToPrompt = useCallback((dataUrl: string, name: string) => {
    promptBarImage.set({ dataUrl, name });
  }, []);

  // Captures a screenshot of the selected element's bounding box.
  // Returns a data URL string, or null if capture fails.
  const captureElementScreenshot = useCallback(
    async (info: SelectedElementInfo): Promise<string | null> => {
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
    },
    [getActiveIframeElement],
  );

  const addElementToPrompt = useCallback(
    async (info: SelectedElementInfo) => {
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
    },
    [captureElementScreenshot, addImageToPrompt, revealPromptBar],
  );

  const handleIframeLoad = useCallback(
    (tabId: string) => {
      updateTabLoadState(tabId, { isLoading: false, slowLoad: false, iframeError: false });
      clearLoadFeedbackTimer();

      // Try to restore video/audio playback position if available
      try {
        const tab = (tabsRef.current || []).find((t) => t.id === tabId);
        const iframeElement = iframeElementsRef.current[tabId];
        if (tab && tab.mediaPlaybackState && iframeElement && iframeElement.contentWindow) {
          const doc = iframeElement.contentDocument || iframeElement.contentWindow.document;
          if (doc) {
            const video = doc.querySelector('video');
            const audio = doc.querySelector('audio');
            const media = video || audio;
            if (media) {
              const restoreState = () => {
                if (media && tab.mediaPlaybackState) {
                  media.currentTime = tab.mediaPlaybackState.currentTime;
                  if (!tab.mediaPlaybackState.paused) {
                    media.play().catch(() => {});
                  }
                }
              };
              if (media.readyState >= 1) {
                restoreState();
              } else {
                media.addEventListener('loadedmetadata', restoreState, { once: true });
              }
            }
          }
        }
      } catch (err) {
        console.warn('Failed to restore media playback state:', err);
      }

      if (activeTabRef.current?.id === tabId) {
        postInspectorState();
      }
      try {
        const iframeElement = iframeElementsRef.current[tabId];
        if (iframeElement && iframeElement.contentWindow) {
          const href = iframeElement.contentWindow.location.href;
          if (!href) return;

          const activeTabNow = activeTabRef.current;

          // Local dev server: direct same-origin URL, no '/proxy' prefix.
          // Read the pathname and push it to both store and address bar.
          if (!href.includes('/proxy')) {
            const path = iframeElement.contentWindow.location.pathname;
            const search = iframeElement.contentWindow.location.search;
            if (path && activeTabNow?.id === tabId) {
              const newUrl = path + search;
              // If the active tab's current URL is a full localhost URL whose
              // path already matches this load, the iframe just (re)loaded the
              // page we're already on — typically after Back/Forward to a
              // typed-in `http://localhost:PORT/...` history entry. Pushing here
              // would rewrite that entry to a relative path and truncate the
              // forward history, so only sync the address bar instead.
              const currentLocalDev = parseLocalDevUrl(normalizeUrl(activeTabNow.url));
              if (currentLocalDev) {
                const absoluteLocalUrl = `http://${currentLocalDev.host}:${currentLocalDev.port}${newUrl}`;
                if (activeTabNow.url === absoluteLocalUrl) {
                  setInputUrl(activeTabNow.url);
                } else {
                  commitInternalNavigation(absoluteLocalUrl);
                  setInputUrl(absoluteLocalUrl);
                }
              } else {
                commitInternalNavigation(newUrl);
                setInputUrl(newUrl);
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
          if (externalUrl && activeTabNow?.id === tabId) {
            commitInternalNavigation(externalUrl);
            setInputUrl(externalUrl);
          }
        }
      } catch {
        // Cross-origin expected for direct external URLs without proxy
      }
    },
    [updateTabLoadState, clearLoadFeedbackTimer, postInspectorState],
  );

  const handleIframeError = useCallback(
    (tabId: string) => {
      clearLoadFeedbackTimer();
      updateTabLoadState(tabId, { isLoading: false, slowLoad: false, iframeError: true });
    },
    [clearLoadFeedbackTimer, updateTabLoadState],
  );

  const handleInspectorMessage = useCallback(
    (event: MessageEvent) => {
      if (!event.data) return;

      // Identify which iframe sent the message
      const sourceTabId = Object.entries(iframeElementsRef.current).find(
        ([, iframe]) => iframe?.contentWindow === event.source,
      )?.[0];

      // Scroll-position bridge: the iframe is cross-origin, so the page itself
      // reports its scroll offset (and asks to have it restored on load) via the
      // proxy origin, which we validate the same way as console/inspector traffic.
      if (event.data.type === 'forge-preview:scroll' || event.data.type === 'forge-preview:scroll-ready') {
        if (!sourceTabId) return;
        const sourceTab = (tabsRef.current || []).find((t) => t.id === sourceTabId);
        if (!sourceTab) return;
        const sourceLocalDev = parseLocalDevUrl(normalizeUrl(sourceTab.url));
        const expectedOrigin = sourceLocalDev
          ? getLocalDevProxyOrigin(sourceLocalDev)
          : proxyPortRef.current
            ? `http://127.0.0.1:${proxyPortRef.current}`
            : null;
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
            iframeElementsRef.current[sourceTabId]?.contentWindow?.postMessage(
              { type: 'forge-preview:scroll-restore', x: saved.x, y: saved.y },
              expectedOrigin,
            );
          }
        }
        return;
      }

      // Console log events: only accept from our proxy origin
      if (event.data.type === 'forge-preview:console') {
        if (!sourceTabId) return;
        const sourceTab = (tabsRef.current || []).find((t) => t.id === sourceTabId);
        const sourceLocalDev = sourceTab ? parseLocalDevUrl(normalizeUrl(sourceTab.url)) : null;
        const expectedOrigin = sourceLocalDev
          ? getLocalDevProxyOrigin(sourceLocalDev)
          : proxyPortRef.current
            ? `http://127.0.0.1:${proxyPortRef.current}`
            : null;
        if (!expectedOrigin || event.origin !== expectedOrigin) return;
        const payload = event.data.payload || {};
        const level = ['log', 'info', 'warn', 'error', 'debug'].includes(payload.level) ? payload.level : 'log';
        if (activeTabRef.current?.id === sourceTabId) {
          consoleLogIdRef.current += 1;
          const nextLog: PreviewConsoleLog = {
            id: consoleLogIdRef.current,
            level,
            message: String(payload.message || ''),
            url: payload.url,
            timestamp: payload.timestamp || new Date().toISOString(),
          };
          setConsoleLogs((prev) => [...prev.slice(-199), nextLog]);
        }
        if ((level === 'error' || level === 'warn') && activeTabRef.current?.id === sourceTabId) {
          setShowConsole(true);
        }
        return;
      }

      // Inspector selection events: only accept from our proxy origin or a local dev URL.
      // External-URL iframes never have the inspector injected, so we reject those.
      if (event.data.type !== 'forge-inspector:selected') return;
      if (!sourceTabId) return;
      {
        const sourceTab = (tabsRef.current || []).find((t) => t.id === sourceTabId);
        const sourceLocalDev = sourceTab ? parseLocalDevUrl(normalizeUrl(sourceTab.url)) : null;
        const expectedOrigin = sourceLocalDev
          ? getLocalDevProxyOrigin(sourceLocalDev)
          : proxyPortRef.current
            ? `http://127.0.0.1:${proxyPortRef.current}`
            : null;
        if (!expectedOrigin || event.origin !== expectedOrigin) return;
      }
      const info = event.data.payload;
      setSelectedElementInfo(info);
      setInspectMode(false);
      inspectModeRef.current = false;
      postInspectorState();
      if (info?.selector) {
        void addElementToPrompt(info);
      }
    },
    [getLocalDevProxyOrigin, postInspectorState, addElementToPrompt],
  );

  const handleInputKeydown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        setInputUrl(currentUrlValue);
        (e.target as HTMLInputElement).blur();
      }
    },
    [currentUrlValue],
  );

  const clearConsoleLogs = useCallback(() => {
    setConsoleLogs([]);
  }, []);

  const takeScreenshot = useCallback(async () => {
    if (screenshotting) return;
    const target = viewportMode !== 'responsive' ? deviceShellRef.current : previewContentRef.current;
    if (!target) return;
    setScreenshotting(true);
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
    } catch {
      showToast('Screenshot failed', 'error');
    } finally {
      setScreenshotting(false);
    }
  }, [screenshotting, viewportMode, addImageToPrompt, revealPromptBar]);

  const openNewTab = useCallback(() => {
    createBlankPreviewBrowserTab();
    setInputUrl('about:blank');
  }, []);

  const activateTab = useCallback((tabId: string) => {
    selectPreviewBrowserTab(tabId);
    setSelectedElementInfo(null);
  }, []);

  const closeTab = useCallback((event: React.MouseEvent, tabId: string) => {
    event.stopPropagation();
    closePreviewBrowserTab(tabId);
  }, []);

  const handleCloseTabKeydown = useCallback((event: React.KeyboardEvent, tabId: string) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    closePreviewBrowserTab(tabId);
  }, []);

  // Sync the address bar whenever the active tab/current URL changes from a
  // store-driven action (activateTab/closeTab call store setters that update
  // currentUrl, which this mirrors back into the local inputUrl field).
  useEffect(() => {
    setInputUrl(currentUrlValue);
  }, [currentUrlValue]);

  // onMount
  useEffect(() => {
    let unsubscribePort: () => void;
    let unsubscribeUrl: () => void;

    (async () => {
      await loadProxyState();
      setTempPort(portRef.current);
      // Always silently ensure the background proxy server is running.
      // This is needed for both external web browsing AND local dev proxying.
      // We do NOT auto-start proxyStarted (dev mode) — user can toggle that manually.
      await ensureProxyRunning();

      unsubscribePort = targetPort.subscribe((val) => {
        setTempPort(val);
      });

      unsubscribeUrl = currentUrl.subscribe((val) => {
        setInputUrl(val);
      });
    })();

    window.addEventListener('message', handleInspectorMessage);

    return () => {
      unsubscribePort?.();
      unsubscribeUrl?.();
      window.removeEventListener('message', handleInspectorMessage);
      clearLoadFeedbackTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window click handler for dismissing history popup
  useEffect(() => {
    const handleWindowClickForHistory = (e: MouseEvent) => {
      if (!showHistory) return;
      const target = e.target as HTMLElement;
      if (!target.closest('.history-wrap')) setShowHistory(false);
    };
    window.addEventListener('click', handleWindowClickForHistory);
    return () => window.removeEventListener('click', handleWindowClickForHistory);
  }, [showHistory]);

  // When the user navigates to an external absolute URL, ensure the background
  // proxy server is running (for iframe embedding) but do NOT change proxyStarted.
  // proxyStarted only controls local dev server forwarding.
  useEffect(() => {
    if (isAbsoluteUrl(currentUrlValue) && !proxyPortValue) {
      ensureProxyRunning();
    }
  }, [currentUrlValue, proxyPortValue]);

  useEffect(() => {
    const localDev = parseLocalDevUrl(currentUrlValue);
    if (!localDev) {
      setPreferredLocalHost(null);
      return;
    }
    setPreferredLocalHost(localDev.host);
    ensureLocalDevProxy(localDev.port, localDev.host);
    if (portRef.current !== localDev.port) {
      setTargetPort(localDev.port);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrlValue]);

  useEffect(() => {
    for (const tab of tabs || []) {
      const localDev = parseLocalDevUrl(normalizeUrl(tab.url));
      if (localDev) {
        ensureLocalDevProxy(localDev.port, localDev.host);
      }
    }
  }, [tabs]);

  // Log every real navigation into the persistent browsing history so the
  // history dropdown can recall any prior page (beyond a single tab's linear
  // back/forward stack). recordHistoryVisit ignores about:blank / "/" and
  // collapses immediately repeated URLs.
  useEffect(() => {
    const title = activeTab?.title ?? '';
    recordHistoryVisit(currentUrlValue, title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrlValue]);

  // Periodically check all tabs' iframes for video/audio media elements,
  // and record their currentTime and playback/paused states in the store.
  useEffect(() => {
    const interval = setInterval(() => {
      let updatedAny = false;
      const currentTabs = tabsRef.current || [];
      
      const nextTabs = currentTabs.map((tab) => {
        const iframe = iframeElementsRef.current[tab.id];
        if (!iframe) return tab;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc) {
            const video = doc.querySelector('video');
            const audio = doc.querySelector('audio');
            const media = video || audio;
            if (media && !isNaN(media.currentTime)) {
              const nextState = {
                currentTime: media.currentTime,
                paused: media.paused,
              };
              
              const oldState = tab.mediaPlaybackState;
              if (
                !oldState ||
                Math.abs(oldState.currentTime - nextState.currentTime) > 0.5 ||
                oldState.paused !== nextState.paused
              ) {
                updatedAny = true;
                return { ...tab, mediaPlaybackState: nextState };
              }
            }
          }
        } catch {
          // Cross-origin exception (expected for direct external URLs)
        }
        return tab;
      });

      if (updatedAny) {
        previewTabs.set(nextTabs);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="preview-panel">
      <div className="preview-tabs">
        <div className="preview-tab-list" ref={tabListRef}>
          {(tabs || []).map((tab) => (
            <button
              key={tab.id}
              className={`preview-tab${tab.id === activeTabId ? ' active' : ''}`}
              onClick={() => activateTab(tab.id)}
              title={tab.url}
            >
              <span className="preview-tab-title">{tab.title}</span>
              <span
                className="preview-tab-close"
                role="button"
                tabIndex={0}
                onClick={(event) => closeTab(event, tab.id)}
                onKeyDown={(event) => handleCloseTabKeydown(event, tab.id)}
                aria-label={`Close ${tab.title}`}
              >
                ×
              </span>
            </button>
          ))}
        </div>

        <button className="preview-tab-add" onClick={openNewTab} title="New preview tab" aria-label="New preview tab">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
      </div>

      <div className="browser-bar">
        <div className="nav-group main-nav">
          <button className="nav-btn" onClick={goBack} disabled={!canGoBack} title="Back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button className="nav-btn" onClick={goForward} disabled={!canGoForward} title="Forward">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button className={`nav-btn ${getActiveTabLoadState().isLoading ? 'spinning' : ''}`} onClick={refresh} title="Refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
        </div>

        <div className="nav-group utility-nav">
          <div className="history-wrap">
            <button
              className={`nav-btn history-btn${showHistory ? ' active' : ''}`}
              onClick={() => setShowHistory((prev) => !prev)}
              title="Browsing history"
              aria-label="Browsing history"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 3-6.7" />
                <polyline points="3 3 3 9 9 9" />
                <path d="M12 7v5l3 2" />
              </svg>
            </button>
            {showHistory && (
              <div className="history-dropdown">
                <div className="history-header">
                  <span>History</span>
                  {browsingHistoryValue.length > 0 && (
                    <button className="history-clear" onClick={clearBrowsingHistory}>
                      Clear all
                    </button>
                  )}
                </div>
                <div className="history-list">
                  {browsingHistoryValue.length === 0 ? (
                    <div className="history-empty">No history yet.</div>
                  ) : (
                    browsingHistoryValue.map((entry) => (
                      <div className="history-row" key={entry.url + entry.ts}>
                        <button className="history-entry" onClick={() => openHistoryEntry(entry.url)} title={entry.url}>
                          <span className="history-title">{entry.title}</span>
                          <span className="history-url">{entry.url}</span>
                        </button>
                        <span className="history-time">{relativeTime(entry.ts)}</span>
                        <button
                          className="history-remove"
                          onClick={() => removeHistoryEntry(entry.url)}
                          aria-label="Remove from history"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            className={`nav-btn inspect-btn${inspectMode ? ' active' : ''}`}
            onClick={toggleInspectMode}
            title={inspectMode ? 'Exit Add Element to Chat' : 'Add Element to Chat'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l7 18 2.5-7.5L20 13 3 3z" />
            </svg>
          </button>
          <button
            className={`nav-btn console-btn${showConsole ? ' active' : ''}`}
            onClick={() => setShowConsole((prev) => !prev)}
            title="Toggle preview console"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" />
              <line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </button>

          {/* Screenshot */}
          <button
            className={`nav-btn screenshot-btn${screenshotting ? ' screenshotting' : ''}`}
            onClick={takeScreenshot}
            disabled={screenshotting}
            title={viewportMode !== 'responsive' ? `Screenshot ${viewportMode} frame` : 'Screenshot preview'}
          >
            {screenshotting ? (
              <svg className="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>

          {/* Clear cookies & cache */}
          <button
            className={`nav-btn clear-data-btn${clearingData ? ' clearing' : ''}`}
            onClick={clearBrowsingData}
            disabled={clearingData}
            title="Clear preview cookies & cache (keeps app settings)"
          >
            {clearingData ? (
              <svg className="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5Z" />
                <circle cx="9.5" cy="11" r="0.6" fill="currentColor" />
                <circle cx="14" cy="14.5" r="0.6" fill="currentColor" />
                <circle cx="9.5" cy="16" r="0.6" fill="currentColor" />
              </svg>
            )}
          </button>
        </div>

        <div className="nav-group viewport-nav">
          {/* Viewport: Responsive (desktop) */}
          <button
            className={`nav-btn viewport-btn${viewportMode === 'responsive' ? ' active' : ''}`}
            onClick={() => setViewportMode('responsive')}
            title="Responsive (full width)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="14" rx="2" />
              <path d="M8 20h8M12 18v2" />
            </svg>
          </button>

          {/* Viewport: Tablet */}
          <button
            className={`nav-btn viewport-btn${viewportMode === 'tablet' ? ' active' : ''}`}
            onClick={() => setViewportMode('tablet')}
            title="Tablet (768px)"
          >
            <svg width="13" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
            </svg>
          </button>

          {/* Viewport: Mobile */}
          <button
            className={`nav-btn viewport-btn${viewportMode === 'mobile' ? ' active' : ''}`}
            onClick={() => setViewportMode('mobile')}
            title="Mobile (375px)"
          >
            <svg width="10" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
              <line x1="9" y1="6" x2="15" y2="6" />
            </svg>
          </button>
        </div>

        <form className="address-bar" onSubmit={handleNavigate}>
          <span className={`protocol-badge ${protocolBadge.toLowerCase()}`}>{protocolBadge}</span>
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Enter URL or search…"
            className="address-input"
            onKeyDown={handleInputKeydown}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="go-btn" title="Navigate">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        </form>

        <span
          className="preview-trust-pill"
          title="External pages load through Soryq's embedded proxy. Local dev preview uses the active project's configured port."
        >
          Sandboxed preview
        </span>

        {/* Open in system browser button */}
        {isAbsoluteUrl(currentUrlValue) && (
          <button className="nav-btn open-external-btn" onClick={openInBrowser} title="Open in system browser" aria-label="Open in system browser">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}

        <div className="proxy-settings">
          <span className="label">Port:</span>
          <div className="port-combo">
            <input
              type="number"
              list="common-ports"
              className="port-input"
              value={tempPort}
              onChange={(e) => setTempPort(Number(e.target.value))}
              onBlur={handlePortChange}
              onKeyDown={(e) => e.key === 'Enter' && handlePortChange()}
              min={1}
              max={65535}
              title="Dev server port (type custom or pick common)"
            />
            <datalist id="common-ports">
              {commonPorts.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </datalist>
            <button className="nav-btn detect-btn" onClick={autoDetectPort} title="Auto-detect dev server port from project config">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </button>
          </div>

          <button
            className={`proxy-btn${proxyStartedValue ? ' running' : ''}`}
            onClick={toggleProxy}
            disabled={isConnectingValue}
            title={proxyStartedValue ? 'Stop local dev preview' : 'Start local dev preview on this port'}
          >
            {isConnectingValue ? (
              <>
                <svg className="spin-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
                </svg>
                <span className="proxy-btn-text">Connecting</span>
              </>
            ) : proxyStartedValue ? (
              <>
                <svg width="8" height="8" viewBox="0 0 8 8">
                  <circle cx="4" cy="4" r="4" fill="currentColor" />
                </svg>
                <span className="proxy-btn-text">Dev: On</span>
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                </svg>
                <span className="proxy-btn-text">Dev: Off</span>
              </>
            )}
          </button>
        </div>
      </div>

      {getActiveTabLoadState().isLoading && (
        <div className="loading-bar">
          <div className="loading-progress"></div>
        </div>
      )}

      {getActiveTabLoadState().slowLoad && (
        <div className="preview-status-banner">
          <span>
            {currentUrlValue.startsWith('http://localhost') ||
            currentUrlValue.startsWith('http://127.0.0.1') ||
            currentUrlValue.startsWith('http://0.0.0.0')
              ? `Waiting for your local dev server on port ${port} to finish responding.`
              : 'The preview is still loading through the embedded proxy.'}
          </span>
        </div>
      )}

      {getActiveTabLoadState().iframeError && (
        <div className="preview-status-banner error">
          <span>Preview failed to load. Check that the local dev server is running and reachable on port {port}.</span>
        </div>
      )}

      {selectedElementInfo && (
        <div className="inspect-banner">
          <div className="inspect-copy">
            <span className="inspect-label">Selected</span>
            <strong>{selectedElementInfo.selector}</strong>
            <span className="inspect-meta">
              {selectedElementInfo.tag} {selectedElementInfo.rect.width}x{selectedElementInfo.rect.height}
            </span>
          </div>
          <button className="inspect-add-btn" onClick={() => selectedElementInfo && addElementToPrompt(selectedElementInfo)}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Add to prompt
          </button>
          <button
            className="inspect-copy-btn"
            onClick={async () => {
              await navigator.clipboard.writeText(selectedElementInfo?.selector || '');
              showToast('Selector copied to clipboard', 'success');
            }}
          >
            Copy selector
          </button>
        </div>
      )}

      {showYoutubeHomepageWarning && (
        <div className="youtube-warning-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="warning-icon">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>
            YouTube's homepage/search cannot be embedded. Please enter a specific video URL (e.g., <code>youtube.com/watch?v=...</code>) to
            preview it here.
          </span>
          <button className="banner-open-btn" onClick={openInBrowser} title="Open in system browser">
            Open in browser
          </button>
        </div>
      )}

      {!showYoutubeHomepageWarning &&
        isAbsoluteUrl(currentUrlValue) &&
        (currentUrlValue.includes('google.com') || currentUrlValue.includes('google.co')) && (
          <div className="google-warning-banner">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="warning-icon">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>
              Google may show a CAPTCHA in the built-in browser. Use the <strong>↗ button</strong> in the toolbar to open in your system
              browser for the best experience.
            </span>
            <button className="banner-open-btn" onClick={openInBrowser} title="Open Google in system browser">
              Open in browser
            </button>
          </div>
        )}

      <div
        className={`preview-content${viewportMode !== 'responsive' ? ' viewport-constrained' : ''}`}
        ref={previewContentRef}
      >
        {activeIframeSrc ? (
          viewportMode !== 'responsive' ? (
            <div
              className={`device-shell${viewportMode === 'mobile' ? ' is-mobile' : ''}${viewportMode === 'tablet' ? ' is-tablet' : ''}`}
              ref={deviceShellRef}
            >
              <div className="device-notch"></div>
              <div className="device-screen">
                <div className="preview-frame-stack">
                  {(tabs || []).map((tab) => {
                    const tabSrc = buildIframeSrc(tab.loadUrl ?? tab.url);
                    if (!tabSrc) return null;
                    return (
                      <iframe
                        key={tab.id}
                        ref={(node) => setIframeElement(tab.id, node)}
                        src={tabSrc}
                        title="Web Preview"
                        className={`preview-iframe${tab.id === activeTabId ? ' is-active' : ''}`}
                        onLoad={() => handleIframeLoad(tab.id)}
                        onError={() => handleIframeError(tab.id)}
                        allow="accelerometer; camera; clipboard-read; clipboard-write; encrypted-media; geolocation; gyroscope; microphone; payment; usb"
                        sandbox={buildIframeSandbox(tab.url)}
                        allowFullScreen
                      ></iframe>
                    );
                  })}
                </div>
              </div>
              <div className="device-home"></div>
              <span className="device-label">{viewportMode === 'mobile' ? '375px · iPhone' : '768px · iPad'}</span>
            </div>
          ) : (
            <div className="preview-frame-stack">
              {(tabs || []).map((tab) => {
                const tabSrc = buildIframeSrc(tab.loadUrl ?? tab.url);
                if (!tabSrc) return null;
                return (
                  <iframe
                    key={tab.id}
                    ref={(node) => setIframeElement(tab.id, node)}
                    src={tabSrc}
                    title="Web Preview"
                    className={`preview-iframe${tab.id === activeTabId ? ' is-active' : ''}`}
                    onLoad={() => handleIframeLoad(tab.id)}
                    onError={() => handleIframeError(tab.id)}
                    allow="accelerometer; camera; clipboard-read; clipboard-write; encrypted-media; geolocation; gyroscope; microphone; payment; usb"
                    sandbox={buildIframeSandbox(tab.url)}
                    allowFullScreen
                  ></iframe>
                );
              })}
            </div>
          )
        ) : (
          <div className="proxy-placeholder">
            <div className="placeholder-globe">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity={0.3}>
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 014-10z" />
              </svg>
            </div>
            <h3>Web Preview</h3>
            <p>
              Built for previewing your <strong>local dev server</strong> (port {port}). You can also open external pages, but many full
              websites block embedding and won't load here — this isn't a full web browser.
            </p>
            <div className="placeholder-actions">
              <button
                className="action-btn web-btn"
                onClick={() => {
                  navigatePreviewTab('https://html.duckduckgo.com/html/');
                  setInputUrl('https://html.duckduckgo.com/html/');
                }}
                title="Open browser"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                </svg>
                Browse Web
              </button>
              <button className="action-btn" onClick={toggleProxy} title="Preview local dev server">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
                </svg>
                Local Dev ({port})
              </button>
            </div>
            <p className="placeholder-note">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              Local &amp; development previews work best
            </p>
          </div>
        )}

        {showConsole && (
          <div className="preview-console">
            <div className="console-header">
              <span>Console</span>
              <div className="console-actions">
                <span>{consoleLogs.length} logs</span>
                <button onClick={clearConsoleLogs}>Clear</button>
                <button onClick={() => setShowConsole(false)} aria-label="Close console">
                  Close
                </button>
              </div>
            </div>
            <div className="console-body">
              {consoleLogs.length === 0 ? (
                <div className="console-empty">No preview console output yet.</div>
              ) : (
                consoleLogs.map((log) => (
                  <div className={`console-row ${log.level}`} key={log.id}>
                    <span className="console-level">{log.level}</span>
                    <span className="console-message">{log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
  const base = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin';
  if (isYouTubeUrl(norm)) {
    return `${base} allow-presentation`;
  }
  return base;
}
