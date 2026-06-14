<script lang="ts">
  import { pendingUpdate, updateDownloading, updateProgress, installUpdate } from '$lib/stores/updater';
  import { showToast } from '$lib/stores/notification';
  import { openChangelogPage } from '$lib/services/changelog';

  let expanded = $state(false);

  async function viewChangelog() {
    try {
      await openChangelogPage();
    } catch (err) {
      console.error('Failed to open changelog:', err);
      showToast('Could not open the changelog', 'error');
    }
  }
</script>

{#if $pendingUpdate}
  <div class="update-banner">
    <div class="update-main">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
      </svg>
      <span class="update-msg">Soryq <strong>{$pendingUpdate.version}</strong> is available</span>
      <span class="update-trust">signed release</span>
      {#if $pendingUpdate.body}
        <button class="update-notes-btn" onclick={() => expanded = !expanded}>
          {expanded ? 'Hide' : 'What\'s new'}
        </button>
      {/if}
      <button class="update-notes-btn" onclick={viewChangelog} title="View the full changelog">
        View Changelog
      </button>
    </div>

    <div class="update-actions">
      {#if $updateDownloading}
        <div class="update-progress">
          <div class="update-progress-bar" style="width: {$updateProgress}%"></div>
        </div>
        <span class="update-pct">{$updateProgress}%</span>
      {:else}
        <button class="update-install-btn" onclick={installUpdate}>
          Install &amp; Restart
        </button>
      {/if}
    </div>
  </div>

  {#if expanded && $pendingUpdate.body}
    <div class="update-notes">
      {$pendingUpdate.body}
    </div>
  {/if}
{/if}

<style>
  .update-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 12px;
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    font-size: 12px;
    color: var(--fg);
    flex-shrink: 0;
  }

  .update-main {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    min-width: 0;
  }

  .update-msg {
    color: var(--fg-muted);
  }

  .update-msg strong {
    color: var(--accent);
  }

  .update-trust {
    padding: 2px 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
    border-radius: 999px;
    color: var(--accent);
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  .update-notes-btn {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    opacity: 0.8;
  }

  .update-notes-btn:hover { opacity: 1; }

  .update-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .update-install-btn {
    padding: 3px 10px;
    background: var(--accent);
    color: var(--button-text, #fff);
    border: none;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .update-install-btn:hover { opacity: 0.85; }

  .update-progress {
    width: 80px;
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    overflow: hidden;
  }

  .update-progress-bar {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.2s;
  }

  .update-pct {
    font-size: 11px;
    color: var(--fg-muted);
    min-width: 28px;
  }

  .update-notes {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--fg-muted);
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    white-space: pre-wrap;
    max-height: 120px;
    overflow-y: auto;
  }
</style>
