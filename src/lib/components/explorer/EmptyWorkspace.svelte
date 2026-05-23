<script lang="ts">
  import { openProject } from '$lib/stores/workspace';
</script>

<div class="empty-workspace">
  <div class="empty-icon-container">
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      <line x1="12" y1="11" x2="12" y2="17"/>
      <line x1="9" y1="14" x2="15" y2="14"/>
    </svg>
  </div>
  
  <h3 class="empty-title">Empty Workspace</h3>
  <p class="empty-desc">
    Add one or more project folders to start coding, tracking git changes, and previewing your work.
  </p>

  <button class="add-folder-btn" onclick={openProject}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    <span>Add Folder</span>
  </button>
</div>

<style>
  .empty-workspace {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px 16px;
    text-align: center;
    background: var(--sidebar-bg);
    color: var(--text-secondary);
    user-select: none;
    gap: 16px;
  }

  .empty-icon-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: 16px;
    background: var(--bg-hover);
    border: 1px solid var(--border);
    margin-bottom: 4px;
    transition: transform 0.2s;
  }

  .empty-workspace:hover .empty-icon-container {
    transform: scale(1.05);
  }

  .empty-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .empty-desc {
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 200px;
    margin: 0;
  }

  .add-folder-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 600;
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  }

  .add-folder-btn:hover {
    background: var(--button-hover-bg);
  }

  .add-folder-btn:active {
    transform: scale(0.98);
  }
</style>
