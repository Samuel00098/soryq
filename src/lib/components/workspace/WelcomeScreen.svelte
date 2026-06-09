<!-- WelcomeScreen.svelte -->
<script lang="ts">
  import {
    newWorkspacePromptOpen,
    openProject,
    openWorkspace,
    recentWorkspaces,
    clearAllApplicationState,
    renameWorkspace,
  } from '$lib/stores/workspace';
  import { derived } from 'svelte/store';
  import { search as paletteSearch } from '$lib/stores/commandpalette';
  import { activeTheme } from '$lib/stores/theme';
  import { openSettings } from '$lib/stores/layout';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';

  let isLight = $derived($activeTheme?.type === 'light');

  const filteredWorkspaces = derived(
    [recentWorkspaces, paletteSearch],
    ([$recentWorkspaces, $search]) => {
      const list = $recentWorkspaces || [];
      if (!$search) return list;
      const q = $search.toLowerCase();
      return list.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          (w.project_paths || []).some((p) => p.toLowerCase().includes(q))
      );
    }
  );

  function removeRecent(e: MouseEvent, id: string) {
    e.stopPropagation();
    recentWorkspaces.update((r) => r.filter((w) => w.id !== id));
  }

  let renamingId = $state<string | null>(null);
  let renamingName = $state('');

  function startRename(e: MouseEvent, id: string, name: string) {
    e.stopPropagation();
    renamingId = id;
    renamingName = name;
  }

  function saveRename(id: string) {
    const t = renamingName.trim();
    if (t) renameWorkspace(id, t);
    renamingId = null;
    renamingName = '';
  }

  function handleRenameKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') saveRename(id);
    else if (e.key === 'Escape') { renamingId = null; renamingName = ''; }
  }

  function formatTime(ts: string): string {
    try {
      const n = parseInt(ts, 10);
      if (isNaN(n)) return '';
      const diff = Date.now() - n;
      const m = Math.floor(diff / 60000);
      const h = Math.floor(diff / 3600000);
      const d = Math.floor(diff / 86400000);
      if (m < 1) return 'just now';
      if (m < 60) return `${m}m ago`;
      if (h < 24) return `${h}h ago`;
      if (d < 7) return `${d}d ago`;
      return new Date(n).toLocaleDateString();
    } catch { return ''; }
  }

  function shortPath(path: string) {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts.length <= 2 ? path.replace(/\\/g, '/') : '…/' + parts.slice(-2).join('/');
  }

  function projectHue(name: string) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return Math.abs(h) % 360;
  }

  let iconError = $state(false);
  let hasRecents = $derived($recentWorkspaces.length > 0);

  // Time & Date Display
  let timeString = $state('');
  let dateString = $state('');
  function updateTime() {
    const now = new Date();
    timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateString = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  }

  // --- Async Portal Feeds ---
  let hnStories = $state<any[]>([]);
  let loadingHn = $state(false);
  let ghRepos = $state<any[]>([]);
  let loadingGh = $state(false);
  let dailyNotes = $state<any[]>([]);
  let activeDailyNotes = $derived(dailyNotes.filter((note) => note.focus.length > 0 || note.done.length > 0));
  let loadingNotes = $state(false);

  async function fetchCorsFree(url: string, headers: Record<string, string> = {}): Promise<any> {
    try {
      const requestHeaders = {
        'User-Agent': 'Soryq-Developer-Workspace/1.0',
        ...headers
      };
      const payload = await invoke<any>('http_send_request', {
        method: 'GET',
        url: url,
        headers: requestHeaders,
        body: null
      });
      return JSON.parse(payload.body);
    } catch (err) {
      console.error(`CORS free fetch failed for ${url}:`, err);
      throw err;
    }
  }

  async function loadHnStories() {
    loadingHn = true;
    try {
      const ids = await fetchCorsFree('https://hacker-news.firebaseio.com/v0/topstories.json');
      const topIds = ids.slice(0, 6);
      const storyPromises = topIds.map((id: number) =>
        fetchCorsFree(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      );
      hnStories = await Promise.all(storyPromises);
    } catch (err) {
      console.error('Failed to load HN stories:', err);
    } finally {
      loadingHn = false;
    }
  }

  async function loadGhRepos() {
    loadingGh = true;
    try {
      const data = await fetchCorsFree('https://api.github.com/search/repositories?q=stars:>15000+language:rust+language:typescript+language:python&sort=stars&order=desc&per_page=5');
      ghRepos = data.items || [];
    } catch (err) {
      console.error('Failed to load GitHub trending:', err);
    } finally {
      loadingGh = false;
    }
  }

  async function loadDailyNotes() {
    loadingNotes = true;
    try {
      dailyNotes = await invoke<any[]>('workspace_get_recent_daily_notes');
    } catch (err) {
      console.error('Failed to load daily notes timeline:', err);
    } finally {
      loadingNotes = false;
    }
  }

  async function openUrl(url: string) {
    try {
      await invoke('preview_open_in_browser', { url });
    } catch (err) {
      console.error('Failed to open URL:', err);
    }
  }

  async function handleNoteClick(note: any) {
    const ws = $recentWorkspaces.find((w: any) =>
      w.project_paths.includes(note.project_path)
    );
    if (ws) {
      await openWorkspace(ws.id);
      setTimeout(async () => {
        const { openFile } = await import('$lib/stores/editor');
        await openFile(note.filepath);
      }, 500);
    } else {
      const { addFolderToWorkspace } = await import('$lib/stores/workspace');
      try {
        await addFolderToWorkspace(note.project_path);
        setTimeout(async () => {
          const { openFile } = await import('$lib/stores/editor');
          await openFile(note.filepath);
        }, 500);
      } catch (err) {
        console.error('Failed to add project path for note:', err);
      }
    }
  }

  onMount(() => {
    updateTime();
    const timer = setInterval(updateTime, 1000);
    void loadHnStories();
    void loadGhRepos();
    void loadDailyNotes();
    return () => clearInterval(timer);
  });
</script>

<div class="welcome" class:light={isLight}>
  <!-- Header -->
  <header class="header">
    <div class="logo-wrap">
      {#if !iconError}
        <img src="/icon.png?v=2" alt="Soryq" class="logo-img" onerror={() => iconError = true} />
      {:else}
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" class="logo-fallback">
          <rect width="36" height="36" rx="8" fill="#1e1b4b"/>
          <polyline points="6,22 10,18 6,14" fill="none" stroke="#8b5cf6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <rect x="12" y="16.5" width="11" height="2.5" rx="1.25" fill="rgba(255,255,255,0.55)"/>
          <rect x="12" y="21" width="8" height="2" rx="1" fill="rgba(255,255,255,0.2)"/>
        </svg>
      {/if}
    </div>
    <div class="header-text">
      <h1 class="app-name">Soryq Portal</h1>
      <p class="app-tagline">Welcome back. It is {dateString} — {timeString}</p>
    </div>
  </header>

  <!-- 3 Column Layout Grid -->
  <div class="content">
    
    <!-- Column 1: Workspace list & Actions -->
    <div class="col left-col">
      <!-- Primary actions -->
      <div class="action-group bento-card">
        <span class="section-label">Launchpad</span>
        <button class="action-btn primary" onclick={() => newWorkspacePromptOpen.set(true)}>
          <span class="action-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
          <span class="action-label">New Workspace</span>
          <kbd>Ctrl+N</kbd>
        </button>

        <button class="action-btn secondary" onclick={openProject}>
          <span class="action-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </span>
          <span class="action-label">Open Folder</span>
          <kbd>Ctrl+O</kbd>
        </button>

        <button class="action-btn secondary" onclick={openSettings}>
          <span class="action-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
            </svg>
          </span>
          <span class="action-label">Settings</span>
          <kbd>Ctrl+,</kbd>
        </button>
      </div>

      <!-- Recents -->
      <div class="recents bento-card">
        <div class="recents-header">
          <span class="section-label">Recent Workspaces</span>
          {#if hasRecents}
            <button class="text-btn danger" onclick={clearAllApplicationState}>Clear all</button>
          {/if}
        </div>

        {#if $filteredWorkspaces.length > 0}
          <div class="recent-list scrollable">
            {#each $filteredWorkspaces as w (w.id)}
              {@const hue = projectHue(w.name)}
              <!-- svelte-ignore a11y_interactive_supports_focus a11y_click_events_have_key_events -->
              <div class="recent-item" onclick={() => openWorkspace(w.id)} role="button">
                <div class="recent-avatar" style="--hue:{hue}; background: {isLight ? 'hsl(var(--hue) 50% 92%)' : 'hsl(var(--hue) 35% 20% / 0.45)'}; border-color: {isLight ? 'hsl(var(--hue) 50% 82%)' : 'hsl(var(--hue) 35% 30% / 0.4)'}; color: {isLight ? 'hsl(var(--hue) 60% 35%)' : 'hsl(var(--hue) 60% 70%)'};">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div class="recent-info">
                  {#if renamingId === w.id}
                    <!-- svelte-ignore a11y_autofocus a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                    <input
                      class="rename-input"
                      bind:value={renamingName}
                      onkeydown={(e) => handleRenameKey(e, w.id)}
                      onblur={() => saveRename(w.id)}
                      onclick={(e) => e.stopPropagation()}
                      autofocus
                    />
                  {:else}
                    <span class="recent-name">{w.name}</span>
                  {/if}
                  <span class="recent-path" title={w.project_paths.join(', ')}>
                    {w.project_paths.length === 0
                      ? 'Empty workspace'
                      : w.project_paths.map(shortPath).join(', ')}
                  </span>
                </div>
                <div class="recent-actions">
                  {#if w.last_opened}
                    <span class="recent-time">{formatTime(w.last_opened)}</span>
                  {/if}
                  <button
                    class="icon-btn"
                    onclick={(e) => startRename(e, w.id, w.name)}
                    title="Rename"
                    aria-label="Rename {w.name}"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.122 2.122 0 1 1 3 3L12 15l-4 1 1-4z"/>
                    </svg>
                  </button>
                  <button
                    class="icon-btn danger"
                    onclick={(e) => removeRecent(e, w.id)}
                    title="Remove"
                    aria-label="Remove {w.name}"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <p style="font-weight: 550; color: var(--text-primary); margin: 0 0 4px 0;">No Recent Workspaces</p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Column 2: Tech News Feed (Middle) -->
    <div class="col middle-col">
      <!-- Hacker News top stories -->
      <div class="feed-section bento-card">
        <div class="feed-header">
          <span class="section-label">Hacker News top stories</span>
          <button class="icon-btn" onclick={loadHnStories} disabled={loadingHn} title="Refresh News">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>

        <div class="feed-list scrollable">
          {#if loadingHn}
            <div class="shimmer-feed">
              <div class="shimmer-item"></div>
              <div class="shimmer-item"></div>
              <div class="shimmer-item"></div>
            </div>
          {:else}
            {#each hnStories.filter(Boolean) as story}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <div class="feed-item" onclick={() => story.url && openUrl(story.url)}>
                <div class="feed-main">
                  <span class="feed-title">{story.title}</span>
                  <div class="feed-meta">
                    <span class="feed-score">{story.score || 0} points</span>
                    <span class="dot">•</span>
                    <span class="feed-by">by {story.by}</span>
                  </div>
                </div>
                {#if story.kids}
                  <button class="comments-btn" onclick={(e) => { e.stopPropagation(); openUrl(`https://news.ycombinator.com/item?id=${story.id}`); }} title="View HN comments">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    {story.kids.length}
                  </button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <!-- GitHub Trending Repos -->
      <div class="feed-section bento-card">
        <div class="feed-header">
          <span class="section-label">Popular Github Repositories</span>
          <button class="icon-btn" onclick={loadGhRepos} disabled={loadingGh} title="Refresh Repos">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>

        <div class="feed-list scrollable">
          {#if loadingGh}
            <div class="shimmer-feed">
              <div class="shimmer-item"></div>
              <div class="shimmer-item"></div>
              <div class="shimmer-item"></div>
            </div>
          {:else}
            {#each ghRepos as repo}
              <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
              <div class="feed-item" onclick={() => openUrl(repo.html_url)}>
                <div class="feed-main">
                  <span class="feed-title repo-name">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    {repo.full_name}
                  </span>
                  <p class="repo-desc">{repo.description || 'No description provided.'}</p>
                  <div class="feed-meta">
                    {#if repo.language}
                      <span class="repo-lang badge">{repo.language}</span>
                    {/if}
                    <span class="repo-stars">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                      {Math.round(repo.stargazers_count / 100) / 10}k
                    </span>
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>

    <!-- Column 3: Timeline of Daily Notes & Shortcuts (Right) -->
    <div class="col right-col">
      <!-- Daily Notes timeline -->
      <div class="daily-notes-widget bento-card">
        <div class="widget-header">
          <span class="section-label">Daily Notes Summary</span>
          <button class="icon-btn" onclick={loadDailyNotes} disabled={loadingNotes} title="Refresh Notes">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        </div>

        <div class="notes-timeline scrollable">
          {#if loadingNotes}
            <div class="empty-notes-timeline">Loading notes timeline...</div>
          {:else if activeDailyNotes.length === 0}
            <div class="empty-notes-timeline">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span>No active daily notes found</span>
            </div>
          {:else}
            <div class="timeline-container">
              {#each activeDailyNotes as note}
                <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
                <div class="timeline-node" onclick={() => handleNoteClick(note)}>
                  <div class="node-bullet"></div>
                  <div class="node-content">
                    <span class="node-project">{note.project_name}</span>
                    <span class="node-date">{note.date}</span>
                    
                    {#if note.focus.length > 0}
                      <div class="node-section">
                        <span class="sec-title">Focus</span>
                        <ul>
                          {#each note.focus.slice(0, 3) as item}
                            <li>{item}</li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                    
                    {#if note.done.length > 0}
                      <div class="node-section">
                        <span class="sec-title">Done</span>
                        <ul>
                          {#each note.done.slice(0, 3) as item}
                            <li>{item}</li>
                          {/each}
                        </ul>
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- Shortcuts grid -->
      <div class="shortcuts-row bento-card">
        <span class="section-label">Quick shortcuts</span>
        <div class="shortcut-grid">
          {#each [
            ['Command palette', 'Ctrl+Shift+P'],
            ['Toggle sidebar', 'Ctrl+B'],
            ['Focus terminal', 'Ctrl+`'],
            ['Open preview', 'Ctrl+Alt+P'],
          ] as [label, keys]}
            <div class="shortcut-item">
              <span>{label}</span>
              <kbd>{keys}</kbd>
            </div>
          {/each}
        </div>
      </div>
    </div>

  </div>
</div>

<style>
  .welcome {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    height: 100%;
    background: transparent;
    background-image:
      radial-gradient(72% 48% at 50% -6%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 62%),
      radial-gradient(46% 40% at 100% 102%, color-mix(in srgb, var(--accent-hover, var(--accent)) 8%, transparent), transparent 58%);
    overflow: hidden;
    padding: clamp(14px, 2vw, 24px);
    gap: clamp(12px, 1.4vw, 16px);
    box-sizing: border-box;
  }

  /* ── Header ── */
  .header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    text-align: center;
    width: 100%;
    max-width: 1200px;
    flex-shrink: 0;
    animation: welcome-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  .logo-wrap {
    position: relative;
    width: 56px;
    height: 56px;
    border-radius: 14px;
    background: linear-gradient(155deg, color-mix(in srgb, var(--accent) 16%, var(--bg-secondary)), color-mix(in srgb, var(--bg-secondary) 88%, transparent));
    border: 1px solid color-mix(in srgb, var(--accent) 24%, var(--border));
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow:
      var(--shadow-md),
      inset 0 1px 0 var(--glass-rim-strong, rgba(255, 255, 255, 0.13)),
      0 0 20px color-mix(in srgb, var(--accent) 15%, transparent);
  }

  .logo-img {
    width: 44px;
    height: 44px;
    border-radius: 8px;
  }

  .logo-fallback { opacity: 0.8; }

  .header-text { display: flex; flex-direction: column; gap: 2px; align-items: center; }

  .app-name {
    font-size: clamp(20px, 2.4vw, 26px);
    font-weight: 700;
    color: var(--text-primary);
    background: linear-gradient(180deg, var(--text-primary) 35%, color-mix(in srgb, var(--text-primary) 62%, var(--accent)));
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: -0.6px;
    line-height: 1;
  }

  .app-tagline {
    font-size: 11.5px;
    color: var(--text-muted);
    margin-top: 3px;
  }

  /* ── Content grid ── */
  .content {
    display: grid;
    grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(260px, 300px);
    gap: clamp(12px, 1.4vw, 16px);
    flex: 1;
    min-height: 0;
    width: 100%;
    max-width: 1200px;
  }

  /* Columns general styling */
  .col {
    display: flex;
    flex-direction: column;
    gap: 16px;
    height: 100%;
    min-height: 0;
  }

  .left-col {
    animation: welcome-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.06s both;
  }

  .middle-col {
    animation: welcome-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.12s both;
  }

  .right-col {
    animation: welcome-rise 0.55s cubic-bezier(0.16, 1, 0.3, 1) 0.18s both;
  }

  /* Bento Cards */
  .bento-card {
    background: color-mix(in srgb, var(--bg-secondary) 55%, transparent);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 14px;
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    box-shadow:
      inset 0 1px 0 var(--glass-rim, rgba(255, 255, 255, 0.07)),
      var(--shadow-sm);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .section-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 10px;
    display: inline-block;
  }

  /* ── Action buttons ── */
  .action-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    width: 100%;
    border: 1px solid var(--border);
  }

  .action-btn.primary {
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, white), var(--accent));
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
    color: var(--button-text, #fff);
    box-shadow:
      0 6px 16px -6px color-mix(in srgb, var(--accent) 50%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .action-btn.primary:hover {
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent-hover, var(--accent)) 90%, white), var(--accent-hover, var(--accent)));
    border-color: color-mix(in srgb, var(--accent) 80%, transparent);
    transform: translateY(-1px);
  }

  .action-btn.secondary {
    background: color-mix(in srgb, var(--bg-secondary) 40%, transparent);
    color: var(--text-primary);
  }

  .action-btn.secondary:hover {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    transform: translateY(-1px);
  }

  .action-btn kbd {
    font-size: 9px;
    font-family: inherit;
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-muted);
    margin-left: auto;
  }

  /* ── Recents ── */
  .recents {
    flex: 1;
    min-height: 0;
  }

  .recents-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .recents-header .section-label {
    margin-bottom: 0;
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    flex: 1;
    padding-right: 2px;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
  }

  .recent-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg-secondary) 30%, transparent);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .recent-item:hover {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
    transform: translateY(-0.5px);
  }

  .recent-avatar {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: 1px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .recent-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .recent-name {
    font-size: 11.5px;
    font-weight: 550;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-path {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .recent-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
  }

  .recent-item:hover .recent-actions { opacity: 1; }

  .recent-time {
    font-size: 9px;
    color: var(--text-muted);
    margin-right: 2px;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: var(--text-muted);
    border: none;
    background: transparent;
    cursor: pointer;
    transition: all 0.12s;
  }

  .icon-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .icon-btn.danger:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    color: var(--error);
  }

  .rename-input {
    background: var(--bg-primary);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    font-size: 11.5px;
    font-weight: 550;
    padding: 0 4px;
    border-radius: 4px;
    outline: none;
    width: 100%;
    height: 18px;
    box-sizing: border-box;
  }

  /* ── Feeds (Middle Column) ── */
  .feed-section {
    flex: 1;
    min-height: 0;
  }

  .feed-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 6px;
    margin-bottom: 8px;
    flex-shrink: 0;
  }

  .feed-header .section-label {
    margin-bottom: 0;
  }

  .feed-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-right: 2px;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
  }

  .feed-item {
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle);
    background: color-mix(in srgb, var(--bg-primary) 40%, transparent);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: all 0.15s ease;
  }

  .feed-item:hover {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    transform: translateX(2px);
  }

  .feed-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .feed-title {
    font-size: 12px;
    font-weight: 550;
    color: var(--text-primary);
    line-height: 1.3;
  }

  .feed-title.repo-name {
    color: var(--accent);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .repo-desc {
    font-size: 10.5px;
    color: var(--text-muted);
    margin: 2px 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .feed-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9.5px;
    color: var(--text-muted);
  }

  .badge {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    padding: 1px 4px;
    border-radius: 4px;
    font-weight: 600;
  }

  .repo-stars {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .repo-stars svg {
    color: var(--warning);
  }

  .comments-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 10px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .comments-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Shimmer Loading states */
  .shimmer-feed {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .shimmer-item {
    height: 40px;
    background: linear-gradient(90deg, var(--bg-hover) 25%, var(--border) 50%, var(--bg-hover) 75%);
    background-size: 200% 100%;
    animation: shimmer-pulse-welcome 1.6s infinite linear;
    border-radius: 6px;
  }

  @keyframes shimmer-pulse-welcome {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }

  /* ── Timeline (Right Column) ── */
  .daily-notes-widget {
    flex: 1;
    min-height: 0;
  }

  .widget-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--border-subtle);
    padding-bottom: 6px;
    margin-bottom: 10px;
    flex-shrink: 0;
  }

  .widget-header .section-label {
    margin-bottom: 0;
  }

  .notes-timeline {
    flex: 1;
    overflow-y: auto;
    padding-right: 2px;
    overscroll-behavior: none;
    scrollbar-gutter: stable;
  }

  .empty-notes-timeline {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
    padding: 24px 0;
    text-align: center;
  }

  .timeline-container {
    display: flex;
    flex-direction: column;
    padding-left: 10px;
    border-left: 1.5px solid var(--border);
    margin-left: 6px;
    gap: 12px;
  }

  .timeline-node {
    position: relative;
    cursor: pointer;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: color-mix(in srgb, var(--bg-primary) 30%, transparent);
    transition: all 0.15s ease;
  }

  .timeline-node:hover {
    background: var(--bg-hover);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
  }

  .node-bullet {
    position: absolute;
    left: -15.5px;
    top: 12px;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--border);
    border: 2px solid var(--bg-secondary);
    transition: background 0.15s;
  }

  .timeline-node:hover .node-bullet {
    background: var(--accent);
  }

  .node-content {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .node-project {
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
  }

  .node-date {
    font-size: 9.5px;
    color: var(--text-muted);
  }

  .node-section {
    margin-top: 4px;
  }

  .sec-title {
    font-size: 9px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    display: block;
    margin-bottom: 2px;
  }

  .node-content ul {
    margin: 0;
    padding-left: 12px;
    list-style-type: disc;
  }

  .node-content li {
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.3;
  }

  .node-empty {
    font-size: 10px;
    font-style: italic;
    color: var(--text-muted);
    margin-top: 2px;
  }

  /* Shortcuts */
  .shortcuts-row {
    flex-shrink: 0;
  }

  .shortcut-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .shortcut-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--bg-secondary) 25%, transparent);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    font-size: 11px;
    color: var(--text-secondary);
  }

  .shortcut-item kbd {
    font-size: 9px;
    padding: 1px 4px;
    border: 1px solid var(--border);
    background: var(--bg-primary);
    border-radius: 4px;
    color: var(--text-muted);
  }

  .scrollable::-webkit-scrollbar {
    width: 5px;
    height: 5px;
  }

  .scrollable::-webkit-scrollbar-track {
    background: transparent;
  }

  .scrollable::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.15));
    border-radius: 2.5px;
  }

  .scrollable::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .text-btn {
    font-size: 10px;
    color: var(--text-muted);
    padding: 1px 4px;
    border-radius: 3px;
    cursor: pointer;
    background: transparent;
    border: none;
  }

  .text-btn.danger:hover {
    background: color-mix(in srgb, var(--error) 12%, transparent);
    color: var(--error);
  }

  .empty-state {
    padding: 16px;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }

  @keyframes welcome-rise {
    0% { opacity: 0; transform: translateY(10px); }
    100% { opacity: 1; transform: translateY(0); }
  }

  /* Narrow the side rails before collapsing the grid. */
  @media (max-width: 1180px) {
    .content {
      grid-template-columns: minmax(210px, 240px) minmax(0, 1fr) minmax(220px, 260px);
    }
  }

  /* Two-column stacked layout: cards get fluid, viewport-relative heights
     and the whole page scrolls instead of clipping. */
  @media (max-width: 1024px) {
    .welcome {
      overflow-y: auto;
    }
    .content {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      height: auto;
    }
    .col {
      height: auto;
    }
    .right-col {
      grid-column: span 2;
    }
    .recent-list,
    .feed-list,
    .notes-timeline {
      max-height: clamp(220px, 40vh, 360px);
    }
    /* Daily-notes + shortcuts sit side by side once the rail spans full width. */
    .right-col {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }

  /* Single column for tablets / narrow windows. */
  @media (max-width: 680px) {
    .content {
      grid-template-columns: minmax(0, 1fr);
    }
    .right-col {
      grid-column: span 1;
      grid-template-columns: minmax(0, 1fr);
    }
    .recent-list,
    .feed-list,
    .notes-timeline {
      max-height: clamp(200px, 48vh, 340px);
    }
  }

  /* Compact phones / very small windows. */
  @media (max-width: 440px) {
    .header {
      flex-direction: row;
      gap: 10px;
      text-align: left;
      justify-content: flex-start;
    }
    .header-text {
      align-items: flex-start;
    }
    .logo-wrap {
      width: 44px;
      height: 44px;
    }
    .action-btn kbd,
    .shortcut-item kbd {
      display: none;
    }
  }
</style>
