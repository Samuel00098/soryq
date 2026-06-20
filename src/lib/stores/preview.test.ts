import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Tauri-dependent notification module before importing preview
vi.mock('./notification', () => ({
  showToast: vi.fn(),
}));

// Re-import after mock is set up — stores are singletons we must reset per test
// Store references are module-level, so we use dynamic import + manual reset
import {
  BLANK_PREVIEW_URL,
  createBlankPreviewBrowserTab,
  navigatePreviewTab,
  commitInternalNavigation,
  goBackPreviewTab,
  goForwardPreviewTab,
  previewTabs,
  activePreviewTabId,
  currentUrl,
  parseLocalPreviewUrl,
  type PreviewTab,
} from './preview';
import { get } from '$lib/stores/storeCompat';

/**
 * Create a fresh singleton state for each test.
 * We reset the previewTabs and activePreviewTabId stores to a single initial tab.
 * Also resets the currentUrl private writable through the public setter.
 */
function resetStores() {
  const freshTab: PreviewTab = {
    id: 'test-tab-1',
    title: 'New Tab',
    url: '/',
    history: ['/'],
    historyIndex: 0,
  };
  previewTabs.set([freshTab]);
  activePreviewTabId.set(freshTab.id);
  currentUrl.set('/');
}

function getActiveTab(): PreviewTab {
  const tabs = get(previewTabs);
  const activeId = get(activePreviewTabId);
  return tabs.find((t) => t.id === activeId)!;
}

describe('preview navigation', () => {
  beforeEach(() => {
    resetStores();
  });

  describe('initial state', () => {
    it('starts at root with no back or forward history', () => {
      const tab = getActiveTab();
      expect(tab.url).toBe('/');
      expect(tab.history).toEqual(['/']);
      expect(tab.historyIndex).toBe(0);
      expect(tab.historyIndex).toBe(0);
      expect(tab.historyIndex <= 0).toBe(true);
      expect(tab.historyIndex >= tab.history.length - 1).toBe(true);
    });
  });

  describe('navigatePreviewTab', () => {
    it('adds a new URL to the history', () => {
      navigatePreviewTab('/new-page');
      const tab = getActiveTab();
      expect(tab.url).toBe('/new-page');
      expect(tab.history).toEqual(['/', '/new-page']);
      expect(tab.historyIndex).toBe(1);
    });

    it('updates currentUrl to the new URL', () => {
      let url = '';
      const unsub = currentUrl.subscribe((v) => (url = v));
      navigatePreviewTab('/about');
      expect(url).toBe('/about');
      unsub();
    });

    it('navigating to the same URL does not duplicate history', () => {
      navigatePreviewTab('/same');
      navigatePreviewTab('/same');
      const tab = getActiveTab();
      expect(tab.history).toEqual(['/', '/same']);
      expect(tab.historyIndex).toBe(1);
    });

    it('truncates forward history when navigating after going back', () => {
      navigatePreviewTab('/page1');
      navigatePreviewTab('/page2');
      navigatePreviewTab('/page3');

      // Go back twice → at /page1
      goBackPreviewTab();
      goBackPreviewTab();

      // Navigate to a new branch
      navigatePreviewTab('/branch');

      const tab = getActiveTab();
      expect(tab.url).toBe('/branch');
      expect(tab.history).toEqual(['/', '/page1', '/branch']);
      expect(tab.historyIndex).toBe(2);

      // Forward should not be available
      expect(tab.historyIndex >= tab.history.length - 1).toBe(true);
    });
  });

  describe('commitInternalNavigation (in-iframe navigations)', () => {
    it('records history like a normal navigation', () => {
      commitInternalNavigation('/page-a');
      const tab = getActiveTab();
      expect(tab.url).toBe('/page-a');
      expect(tab.history).toEqual(['/', '/page-a']);
      expect(tab.historyIndex).toBe(1);
    });

    it('does NOT change loadUrl, so the iframe is not reloaded', () => {
      navigatePreviewTab('https://html.duckduckgo.com/html/?q=cats'); // explicit load
      expect(getActiveTab().loadUrl).toBe('https://html.duckduckgo.com/html/?q=cats');

      // User searches again from DuckDuckGo's own box — the iframe navigates
      // itself and we only record it.
      commitInternalNavigation('https://html.duckduckgo.com/html/?q=dogs');
      const tab = getActiveTab();
      expect(tab.url).toBe('https://html.duckduckgo.com/html/?q=dogs');
      // loadUrl stays on the previously-loaded page (no reload).
      expect(tab.loadUrl).toBe('https://html.duckduckgo.com/html/?q=cats');
    });

    it('Back returns to the in-iframe page, not the "/" main menu', () => {
      // 1. From the "/" placeholder the user opens a search (explicit load).
      navigatePreviewTab('https://html.duckduckgo.com/html/?q=cats');
      // 2. Searches again from the page's own box (iframe-driven).
      commitInternalNavigation('https://html.duckduckgo.com/html/?q=dogs');

      // 3. Back → the first search, NOT "/".
      goBackPreviewTab();
      const tab = getActiveTab();
      expect(tab.url).toBe('https://html.duckduckgo.com/html/?q=cats');
      // Back re-drives loadUrl so the iframe actually loads the page.
      expect(tab.loadUrl).toBe('https://html.duckduckgo.com/html/?q=cats');
      expect(tab.historyIndex).toBe(1);
    });
  });

  describe('goBackPreviewTab', () => {
    it('goes back one step in history', () => {
      navigatePreviewTab('/page1');
      navigatePreviewTab('/page2');

      goBackPreviewTab();
      const tab = getActiveTab();
      expect(tab.url).toBe('/page1');
      expect(tab.historyIndex).toBe(1);
    });

    it('can go forward again after going back', () => {
      navigatePreviewTab('/page1');
      navigatePreviewTab('/page2');

      goBackPreviewTab();
      goForwardPreviewTab();
      const tab = getActiveTab();
      expect(tab.url).toBe('/page2');
      expect(tab.historyIndex).toBe(2);
    });

    it('is a no-op when already at the beginning of history', () => {
      // Already at index 0
      goBackPreviewTab();
      const tab = getActiveTab();
      expect(tab.url).toBe('/');
      expect(tab.historyIndex).toBe(0);
    });

    it('stays at root when going back from a single-entry history', () => {
      navigatePreviewTab('/other');
      goBackPreviewTab();

      let tab = getActiveTab();
      expect(tab.url).toBe('/');
      expect(tab.historyIndex).toBe(0);

      // Already at the start — go back again should be a no-op
      goBackPreviewTab();
      tab = getActiveTab();
      expect(tab.url).toBe('/');
      expect(tab.historyIndex).toBe(0);
    });
  });

  describe('goForwardPreviewTab', () => {
    it('goes forward one step in history', () => {
      navigatePreviewTab('/page1');
      goBackPreviewTab();

      goForwardPreviewTab();
      const tab = getActiveTab();
      expect(tab.url).toBe('/page1');
      expect(tab.historyIndex).toBe(1);
    });

    it('is a no-op when already at the end of history', () => {
      navigatePreviewTab('/page1');
      // At end — no forward available
      goForwardPreviewTab();
      const tab = getActiveTab();
      expect(tab.url).toBe('/page1');
      expect(tab.historyIndex).toBe(1);
    });
  });

  describe('back-and-forth integration', () => {
    it('traverses a multi-step history correctly', () => {
      navigatePreviewTab('/a');
      navigatePreviewTab('/b');
      navigatePreviewTab('/c');
      // History: ['/', '/a', '/b', '/c'], index=3, url='/c'

      // Back three steps: /c → /b → /a → /
      goBackPreviewTab();
      expect(getActiveTab().url).toBe('/b');
      goBackPreviewTab();
      expect(getActiveTab().url).toBe('/a');
      goBackPreviewTab();
      expect(getActiveTab().url).toBe('/');

      // Already at start — no-op
      goBackPreviewTab();
      expect(getActiveTab().url).toBe('/');

      // Forward: / → /a → /b → /c
      goForwardPreviewTab();
      expect(getActiveTab().url).toBe('/a');
      goForwardPreviewTab();
      expect(getActiveTab().url).toBe('/b');
      goForwardPreviewTab();
      expect(getActiveTab().url).toBe('/c');

      // Already at end — no-op
      goForwardPreviewTab();
      expect(getActiveTab().url).toBe('/c');
    });
  });

  describe('localhost full-URL history (Back/Forward regression)', () => {
    // Reproduces PreviewPanel.handleIframeLoad's local-dev branch. When the
    // iframe reports a path that already matches the active tab's current
    // (full localhost) URL, the component must NOT push a relative entry —
    // doing so would rewrite the entry and truncate the forward history.
    // `parseLocalPreviewUrl` here is the store twin of the component's
    // `parseLocalDevUrl`, and normalizeUrl() is the identity on full http URLs.
    function simulateLocalDevIframeLoad(loadedPath: string) {
      const tab = getActiveTab();
      const currentLocalDev = parseLocalPreviewUrl(tab.url);
      if (currentLocalDev && currentLocalDev.path === loadedPath) {
        return; // guard: page already current, skip push
      }
      // The component records iframe-driven navigations without reloading.
      commitInternalNavigation(loadedPath);
    }

    it('preserves forward history when going back to a typed-in localhost URL', () => {
      // 1. User types a full localhost URL; iframe load reports path "/"
      navigatePreviewTab('http://localhost:5173/');
      simulateLocalDevIframeLoad('/'); // guard skips → no rewrite

      // 2. User clicks a link → relative path is pushed
      simulateLocalDevIframeLoad('/about');

      let tab = getActiveTab();
      expect(tab.history).toEqual(['/', 'http://localhost:5173/', '/about']);
      expect(tab.historyIndex).toBe(2);

      // 3. Press Back → returns to the full-URL entry; iframe reloads "/"
      goBackPreviewTab();
      simulateLocalDevIframeLoad('/'); // guard skips → forward history intact

      tab = getActiveTab();
      expect(tab.url).toBe('http://localhost:5173/');
      expect(tab.history).toEqual(['/', 'http://localhost:5173/', '/about']);
      expect(tab.historyIndex).toBe(1);
      // Forward is still available
      expect(tab.historyIndex < tab.history.length - 1).toBe(true);

      // 4. Forward works
      goForwardPreviewTab();
      expect(getActiveTab().url).toBe('/about');
    });

    it('still pushes when the iframe genuinely navigates to a new path', () => {
      navigatePreviewTab('http://localhost:5173/');
      simulateLocalDevIframeLoad('/'); // matches → skip
      simulateLocalDevIframeLoad('/dashboard'); // new path → push

      const tab = getActiveTab();
      expect(tab.history).toEqual(['/', 'http://localhost:5173/', '/dashboard']);
      expect(tab.historyIndex).toBe(2);
    });
  });

  describe('multiple tabs', () => {
    it('creates blank browser tabs without inheriting the active tab URL', () => {
      navigatePreviewTab('https://example.com/docs');

      const blankTabId = createBlankPreviewBrowserTab();
      const tabs = get(previewTabs);
      const firstTab = tabs.find((t) => t.id === 'test-tab-1')!;
      const blankTab = tabs.find((t) => t.id === blankTabId)!;

      expect(get(activePreviewTabId)).toBe(blankTabId);
      expect(getActiveTab()).toBe(blankTab);
      expect(get(currentUrl)).toBe(BLANK_PREVIEW_URL);
      expect(firstTab.url).toBe('https://example.com/docs');
      expect(firstTab.history).toEqual(['/', 'https://example.com/docs']);
      expect(blankTab.url).toBe(BLANK_PREVIEW_URL);
      expect(blankTab.history).toEqual([BLANK_PREVIEW_URL]);
    });

    it('keeps a blank tab history isolated after navigation', () => {
      navigatePreviewTab('/from-tab1');
      const blankTabId = createBlankPreviewBrowserTab();

      navigatePreviewTab('/from-blank-tab');

      const tabs = get(previewTabs);
      const firstTab = tabs.find((t) => t.id === 'test-tab-1')!;
      const blankTab = tabs.find((t) => t.id === blankTabId)!;

      expect(firstTab.history).toEqual(['/', '/from-tab1']);
      expect(firstTab.historyIndex).toBe(1);
      expect(blankTab.history).toEqual([BLANK_PREVIEW_URL, '/from-blank-tab']);
      expect(blankTab.historyIndex).toBe(1);
    });

    it('navigation only affects the active tab', () => {
      // Create a second tab
      const tab2: PreviewTab = {
        id: 'test-tab-2',
        title: 'New Tab',
        url: '/',
        history: ['/'],
        historyIndex: 0,
      };
      previewTabs.update((tabs) => [...tabs, tab2]);

      // Navigate on tab1 (active)
      navigatePreviewTab('/from-tab1');

      // Switch to tab2
      activePreviewTabId.set(tab2.id);

      // Navigate on tab2
      navigatePreviewTab('/from-tab2');

      // Verify tab1 is untouched
      const tabs = get(previewTabs);
      const t1 = tabs.find((t) => t.id === 'test-tab-1')!;
      expect(t1.history).toEqual(['/', '/from-tab1']);
      expect(t1.historyIndex).toBe(1);

      // Verify tab2 is correct
      const t2 = tabs.find((t) => t.id === 'test-tab-2')!;
      expect(t2.history).toEqual(['/', '/from-tab2']);
      expect(t2.historyIndex).toBe(1);
    });
  });
});
