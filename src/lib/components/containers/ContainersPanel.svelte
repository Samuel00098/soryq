<script lang="ts">
  import { activeProject } from '$lib/stores/workspace';
  import { createTerminalSession, setActiveSession, writeToSession } from '$lib/stores/terminal';
  import { showTerminal } from '$lib/stores/layout';
  import { showToast } from '$lib/stores/notification';

  type ContainerAction = {
    label: string;
    command: string;
    description: string;
    tone?: 'primary' | 'danger';
  };

  const actions: ContainerAction[] = [
    {
      label: 'Check Docker',
      command: 'docker --version; docker compose version',
      description: 'Confirm Docker and Compose are available on this machine.',
      tone: 'primary'
    },
    {
      label: 'Compose Up',
      command: 'docker compose up --build',
      description: 'Build and run the project compose stack in the terminal.',
      tone: 'primary'
    },
    {
      label: 'Compose Down',
      command: 'docker compose down',
      description: 'Stop and remove the project compose services.',
      tone: 'danger'
    },
    {
      label: 'Containers',
      command: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
      description: 'List running containers with their status and exposed ports.'
    },
    {
      label: 'Logs',
      command: 'docker compose logs --tail=120',
      description: 'Show the latest Compose logs for the active project.'
    }
  ];

  let busyLabel = $state<string | null>(null);

  async function runAction(action: ContainerAction) {
    const project = $activeProject;
    if (!project) {
      showToast('Open a project before running Docker commands.', 'warning');
      return;
    }

    busyLabel = action.label;
    try {
      const sessionId = await createTerminalSession(project.root_path, undefined, project.id);
      if (sessionId == null) {
        showToast('Could not open a terminal for Docker.', 'error');
        return;
      }

      setActiveSession(sessionId);
      showTerminal();
      writeToSession(sessionId, `${action.command}\r`);
      showToast(`${action.label} sent to terminal.`, 'success');
    } catch (err) {
      console.error('Docker panel action failed:', err);
      showToast('Docker action failed to start.', 'error');
    } finally {
      busyLabel = null;
    }
  }
</script>

<section class="containers-panel">
  <header class="containers-header">
    <div>
      <h2>Containers</h2>
      <p>{#if $activeProject}{$activeProject.name}{:else}No active project{/if}</p>
    </div>
    <span class="status-pill">Docker CLI</span>
  </header>

  <div class="project-strip">
    <span class="label">Working directory</span>
    <span class="path" title={$activeProject?.root_path ?? ''}>
      {$activeProject?.root_path ?? 'Open a project folder first'}
    </span>
  </div>

  <div class="action-grid">
    {#each actions as action}
      <button
        class:primary={action.tone === 'primary'}
        class:danger={action.tone === 'danger'}
        disabled={!$activeProject || busyLabel !== null}
        onclick={() => runAction(action)}
        title={action.command}
      >
        <span>{busyLabel === action.label ? 'Starting...' : action.label}</span>
        <small>{action.description}</small>
      </button>
    {/each}
  </div>

  <section class="command-preview" aria-label="Docker command reference">
    <h3>Commands</h3>
    {#each actions as action}
      <div class="command-row">
        <span>{action.label}</span>
        <code>{action.command}</code>
      </div>
    {/each}
  </section>
</section>

<style>
  .containers-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    background: var(--bg-primary);
    color: var(--text-primary);
    overflow: auto;
  }

  .containers-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 12px;
  }

  .containers-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
    letter-spacing: 0;
  }

  .containers-header p {
    margin: 4px 0 0;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .status-pill {
    flex: 0 0 auto;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 4px 8px;
    color: var(--text-secondary);
    font-size: 11px;
    background: var(--bg-secondary);
  }

  .project-strip {
    display: grid;
    gap: 5px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    background: var(--bg-secondary);
  }

  .label {
    color: var(--text-secondary);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
    gap: 10px;
  }

  .action-grid button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-height: 86px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 11px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }

  .action-grid button:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--bg-tertiary);
  }

  .action-grid button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }

  .action-grid button.primary {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  }

  .action-grid button.danger {
    border-color: color-mix(in srgb, #ef4444 50%, var(--border));
  }

  .action-grid span {
    font-size: 13px;
    font-weight: 650;
  }

  .action-grid small {
    color: var(--text-secondary);
    font-size: 11px;
    line-height: 1.35;
  }

  .command-preview {
    display: grid;
    gap: 8px;
    margin-top: auto;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }

  .command-preview h3 {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 650;
  }

  .command-row {
    display: grid;
    gap: 4px;
  }

  .command-row span {
    color: var(--text-secondary);
    font-size: 11px;
  }

  .command-row code {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
  }
</style>
