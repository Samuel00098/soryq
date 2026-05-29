<script lang="ts">
  import { openProject } from '$lib/stores/workspace';
</script>

<div class="empty-workspace">
  <div class="illustration-container">
    <!-- Premium workspace illustration with glowing nodes and network connection lines -->
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" class="empty-illustration">
      <defs>
        <linearGradient id="folder-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="var(--accent)" />
          <stop offset="100%" stop-color="color-mix(in srgb, var(--accent) 30%, #8b5cf6)" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      
      <!-- Connective network paths -->
      <path d="M 60,65 L 35,45 M 60,65 L 85,45 M 60,65 L 60,95" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="3,3" class="dash-flow" opacity="0.6" />
      
      <!-- Orbit lines -->
      <circle cx="60" cy="65" r="32" stroke="var(--border)" stroke-width="1" stroke-dasharray="2,4" />

      <!-- Left Node (Terminal) -->
      <g class="node-left">
        <circle cx="35" cy="45" r="16" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5" />
        <rect x="29" y="39" width="12" height="12" rx="2" fill="var(--bg-tertiary)" />
        <polyline points="32 43 35 45 32 47" fill="none" stroke="var(--text-secondary)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
        <line x1="37" y1="47" x2="40" y2="47" stroke="var(--accent)" stroke-width="1.2" />
      </g>

      <!-- Right Node (Preview) -->
      <g class="node-right">
        <circle cx="85" cy="45" r="16" fill="var(--bg-secondary)" stroke="var(--border)" stroke-width="1.5" />
        <circle cx="85" cy="45" r="6" stroke="var(--text-secondary)" stroke-width="1.2" />
        <path d="M 85,39 L 85,51 M 79,45 L 91,45" stroke="var(--text-muted)" stroke-width="1" opacity="0.5" />
      </g>

      <!-- Center Node (Main Folder Workspace) -->
      <g class="node-center">
        <!-- Shadow/Glow -->
        <circle cx="60" cy="65" r="22" fill="var(--accent-light)" filter="url(#glow)" opacity="0.3" />
        <circle cx="60" cy="65" r="20" fill="var(--bg-primary)" stroke="var(--accent)" stroke-width="1.5" />
        
        <!-- Folder Icon -->
        <path d="M 52,57 L 57,57 L 59,60 L 68,60 L 68,73 L 52,73 Z" fill="url(#folder-gradient)" />
        <path d="M 50,60 L 70,60 L 68,73 L 52,73 Z" fill="var(--accent)" opacity="0.8" />
        
        <!-- Plus badge -->
        <circle cx="70" cy="71" r="5" fill="var(--success)" stroke="var(--bg-primary)" stroke-width="1.2" />
        <line x1="70" y1="69" x2="70" y2="73" stroke="#fff" stroke-width="1" />
        <line x1="68" y1="71" x2="72" y2="71" stroke="#fff" stroke-width="1" />
      </g>
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
    padding: 32px 16px;
    text-align: center;
    background: var(--sidebar-bg);
    color: var(--text-secondary);
    user-select: none;
    gap: 16px;
  }

  .illustration-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 140px;
    height: 140px;
    border-radius: var(--radius-lg);
    background: rgba(0, 0, 0, 0.15);
    border: 1px dashed var(--border);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s;
  }

  .empty-workspace:hover .illustration-container {
    transform: scale(1.04);
    border-color: var(--accent);
  }

  .empty-illustration {
    filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.3));
  }

  /* Node floating animations */
  .node-left {
    animation: float-left 6s ease-in-out infinite;
  }
  .node-right {
    animation: float-right 6s ease-in-out infinite 0.75s;
  }
  .node-center {
    animation: float-center 6s ease-in-out infinite 1.5s;
  }

  @keyframes float-left {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(-2px, -3px); }
  }
  @keyframes float-right {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(2px, -3px); }
  }
  @keyframes float-center {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(0, -4px); }
  }

  .dash-flow {
    stroke-dashoffset: 20;
    animation: dash 3s linear infinite;
  }

  @keyframes dash {
    to { stroke-dashoffset: 0; }
  }

  .empty-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.2px;
  }

  .empty-desc {
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 220px;
    margin: 0;
  }

  .add-folder-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    padding: 0 16px;
    border-radius: var(--radius-sm);
    font-size: 11.5px;
    font-weight: 600;
    background: var(--button-bg);
    color: var(--button-text);
    border: none;
    cursor: pointer;
    transition: background 0.15s, transform 0.1s;
    box-shadow: var(--shadow-md);
  }

  .add-folder-btn:hover {
    background: var(--button-hover-bg);
  }

  .add-folder-btn:active {
    transform: scale(0.97);
  }
</style>
