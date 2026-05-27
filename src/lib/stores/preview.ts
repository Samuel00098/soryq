import { writable, get } from 'svelte/store';
import { showToast } from './notification';

export const targetPort = writable<number>(5173);
export const proxyPort = writable<number | null>(null);
export const proxyStarted = writable<boolean>(false);
export const isConnecting = writable<boolean>(false);
export const preferredLocalHost = writable<string>('localhost');

export type PreviewTab = {
  id: string;
  title: string;
  url: string;
  history: string[];
  historyIndex: number;
};

const currentUrlStore = writable<string>('/');

function createTabId() {
  return `preview-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function derivePreviewTabTitle(url: string) {
  const trimmed = url.trim();
  if (!trimmed || trimmed === '/' || trimmed === 'about:blank') {
    return 'New Tab';
  }

  const localPreview = parseLocalPreviewUrl(trimmed);
  if (localPreview) {
    const normalizedPath = localPreview.path === '/' ? '' : localPreview.path;
    return `Local:${localPreview.port}${normalizedPath}`;
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${host}${path}`;
  } catch {
    return trimmed.length > 32 ? `${trimmed.slice(0, 29)}...` : trimmed;
  }
}

function createPreviewTab(url = '/'): PreviewTab {
  return {
    id: createTabId(),
    title: derivePreviewTabTitle(url),
    url,
    history: [url],
    historyIndex: 0,
  };
}

export const previewTabs = writable<PreviewTab[]>([createPreviewTab('/')]);
export const activePreviewTabId = writable<string>(get(previewTabs)[0].id);

function getActiveTabId() {
  return get(activePreviewTabId);
}

function setCurrentUrlStore(url: string) {
  currentUrlStore.set(url);
}

function replaceActiveTab(mutator: (tab: PreviewTab) => PreviewTab) {
  const activeId = getActiveTabId();
  previewTabs.update((tabs) => tabs.map((tab) => (tab.id === activeId ? mutator(tab) : tab)));
}

function syncCurrentUrlFromActiveTab() {
  const activeId = getActiveTabId();
  const activeTab = get(previewTabs).find((tab) => tab.id === activeId);
  setCurrentUrlStore(activeTab?.url || '/');
}

export const currentUrl = {
  subscribe: currentUrlStore.subscribe,
  set(url: string) {
    setCurrentUrlStore(url);
    replaceActiveTab((tab) => ({
      ...tab,
      url,
      title: derivePreviewTabTitle(url),
    }));
  },
  update(updater: (value: string) => string) {
    currentUrl.set(updater(get(currentUrlStore)));
  }
};

export function navigatePreviewTab(url: string) {
  setCurrentUrlStore(url);
  replaceActiveTab((tab) => {
    if (tab.history[tab.historyIndex] === url) {
      return {
        ...tab,
        url,
        title: derivePreviewTabTitle(url),
      };
    }
    const history = tab.history.slice(0, tab.historyIndex + 1);
    history.push(url);
    return {
      ...tab,
      url,
      title: derivePreviewTabTitle(url),
      history,
      historyIndex: history.length - 1,
    };
  });
}

export function goBackPreviewTab() {
  let nextUrl: string | null = null;
  replaceActiveTab((tab) => {
    if (tab.historyIndex <= 0) return tab;
    const nextHistoryIndex = tab.historyIndex - 1;
    nextUrl = tab.history[nextHistoryIndex];
    return {
      ...tab,
      url: nextUrl,
      title: derivePreviewTabTitle(nextUrl),
      historyIndex: nextHistoryIndex,
    };
  });
  if (nextUrl) {
    setCurrentUrlStore(nextUrl);
  }
}

export function goForwardPreviewTab() {
  let nextUrl: string | null = null;
  replaceActiveTab((tab) => {
    if (tab.historyIndex >= tab.history.length - 1) return tab;
    const nextHistoryIndex = tab.historyIndex + 1;
    nextUrl = tab.history[nextHistoryIndex];
    return {
      ...tab,
      url: nextUrl,
      title: derivePreviewTabTitle(nextUrl),
      historyIndex: nextHistoryIndex,
    };
  });
  if (nextUrl) {
    setCurrentUrlStore(nextUrl);
  }
}

export function createPreviewBrowserTab(url = '/') {
  const nextTab = createPreviewTab(url);
  previewTabs.update((tabs) => [...tabs, nextTab]);
  activePreviewTabId.set(nextTab.id);
  setCurrentUrlStore(url);
  return nextTab.id;
}

export function selectPreviewBrowserTab(tabId: string) {
  const tab = get(previewTabs).find((item) => item.id === tabId);
  if (!tab) return;
  activePreviewTabId.set(tabId);
  setCurrentUrlStore(tab.url);
}

export function closePreviewBrowserTab(tabId: string) {
  const tabs = get(previewTabs);
  if (tabs.length <= 1) {
    previewTabs.set([createPreviewTab('/')]);
    const onlyTab = get(previewTabs)[0];
    activePreviewTabId.set(onlyTab.id);
    setCurrentUrlStore(onlyTab.url);
    return;
  }

  const closingIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (closingIndex === -1) return;
  const remaining = tabs.filter((tab) => tab.id !== tabId);
  previewTabs.set(remaining);

  if (getActiveTabId() === tabId) {
    const fallbackIndex = Math.max(0, closingIndex - 1);
    const fallbackTab = remaining[fallbackIndex] || remaining[0];
    activePreviewTabId.set(fallbackTab.id);
    setCurrentUrlStore(fallbackTab.url);
  }
}

export function restorePreviewTabsState(tabs: PreviewTab[] | null | undefined, activeTabId?: string | null) {
  if (!tabs?.length) {
    const defaultTab = createPreviewTab('/');
    previewTabs.set([defaultTab]);
    activePreviewTabId.set(defaultTab.id);
    setCurrentUrlStore(defaultTab.url);
    return;
  }

  previewTabs.set(
    tabs.map((tab) => ({
      ...tab,
      title: derivePreviewTabTitle(tab.url),
      history: tab.history?.length ? tab.history : [tab.url],
      historyIndex: Math.min(
        Math.max(tab.historyIndex ?? 0, 0),
        (tab.history?.length ? tab.history.length : 1) - 1
      ),
    }))
  );

  const resolvedActiveId = tabs.some((tab) => tab.id === activeTabId) ? activeTabId! : tabs[0].id;
  activePreviewTabId.set(resolvedActiveId);
  syncCurrentUrlFromActiveTab();
}

export function resetPreviewTabsState() {
  const defaultTab = createPreviewTab('/');
  previewTabs.set([defaultTab]);
  activePreviewTabId.set(defaultTab.id);
  setCurrentUrlStore(defaultTab.url);
}

export function parseLocalPreviewUrl(url: string): { host: string; port: number; path: string } | null {
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

export async function ensureProxyRunning(): Promise<number | null> {
  const currentPort = get(proxyPort);
  if (currentPort) return currentPort;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const port = await invoke<number>('preview_start_proxy');
    proxyPort.set(port);
    return port;
  } catch (err) {
    console.error('Failed to ensure proxy is running:', err);
    return null;
  }
}

export async function loadProxyState() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const activeProxyPort = await invoke<number | null>('preview_get_proxy_port');
    const activeTargetPort = await invoke<number>('preview_get_target_port');
    
    targetPort.set(activeTargetPort);
    if (activeProxyPort) {
      proxyPort.set(activeProxyPort);
    } else {
      proxyPort.set(null);
    }
  } catch (err) {
    console.error('Failed to load proxy state:', err);
  }
}

export async function startProxy() {
  if (get(proxyStarted)) return;
  if (get(isConnecting)) return;
  isConnecting.set(true);
  try {
    const port = await ensureProxyRunning();
    if (port) {
      proxyStarted.set(true);
      showToast(`Dev server connection started`, 'success');
    }
  } catch (err: any) {
    console.error('Failed to start dev connection:', err);
    showToast(`Failed to start dev connection: ${err?.message || err}`, 'error');
  } finally {
    isConnecting.set(false);
  }
}

export async function stopProxy() {
  // We do not stop the background proxy server, so that external websites still work.
  // We just mark the dev server connection as stopped/inactive.
  proxyStarted.set(false);
  showToast('Dev server connection stopped', 'info');
}

export async function setTargetPort(port: number, options?: { silent?: boolean }) {
  if (get(targetPort) === port) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('preview_set_target_port', { port });
    targetPort.set(port);
    if (!options?.silent) {
      showToast(`Target dev port updated to ${port}`, 'info');
    }
  } catch (err: any) {
    console.error('Failed to set target port:', err);
    showToast(`Failed to update target port: ${err?.message || err}`, 'error');
  }
}

export async function setPreferredLocalHost(host: string | null) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('preview_set_preferred_local_host', { host });
    preferredLocalHost.set(host || 'localhost');
  } catch (err) {
    console.error('Failed to set preferred local host:', err);
  }
}

export async function clearProxyTarget() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('preview_clear_proxy_target');
  } catch (err) {
    console.error('Failed to clear proxy target:', err);
  }
}
