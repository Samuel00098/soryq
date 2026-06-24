import { useState } from 'react';
import { activeProject } from '$lib/stores/workspace';
import { ensureIdleOrCreateTerminal, setActiveSession, writeToSession } from '$lib/stores/terminal';
import { showTerminal } from '$lib/stores/layout';
import { requestRoomControl } from '$lib/stores/layoutControl';
import { showToast } from '$lib/stores/notification';
import { useStore } from '$lib/react/useStore';
import './ContainersPanel.css';

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
    tone: 'primary',
  },
  {
    label: 'Compose Up',
    command: 'docker compose up --build',
    description: 'Build and run the project compose stack in the terminal.',
    tone: 'primary',
  },
  {
    label: 'Compose Down',
    command: 'docker compose down',
    description: 'Stop and remove the project compose services.',
    tone: 'danger',
  },
  {
    label: 'Containers',
    command: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    description: 'List running containers with their status and exposed ports.',
  },
  {
    label: 'Logs',
    command: 'docker compose logs --tail=120',
    description: 'Show the latest Compose logs for the active project.',
  },
];

export default function ContainersPanel() {
  const project = useStore(activeProject);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  async function runAction(action: ContainerAction) {
    if (!project) {
      showToast('Open a project before running Docker commands.', 'warning');
      return;
    }

    const projectRoot = project.root_path;
    const projectId = project.id;

    setBusyLabel(action.label);
    try {
      const sessionId = await ensureIdleOrCreateTerminal(projectRoot, projectId);
      if (sessionId == null) {
        showToast('Could not open a terminal for Docker.', 'error');
        return;
      }

      setActiveSession(sessionId);
      showTerminal();
      requestRoomControl('focus', 'terminal');
      writeToSession(sessionId, `${action.command}\r`);
      showToast(`${action.label} sent to terminal.`, 'success');
    } catch (err) {
      console.error('Docker panel action failed:', err);
      showToast('Docker action failed to start.', 'error');
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <section className="containers-panel">
      <header className="containers-header">
        <div>
          <h2>Containers</h2>
          <p>{project ? project.name : 'No active project'}</p>
        </div>
        <span className="status-pill">Docker CLI</span>
      </header>

      <div className="project-strip">
        <span className="label">Working directory</span>
        <span className="path" title={project?.root_path ?? ''}>
          {project?.root_path ?? 'Open a project folder first'}
        </span>
        <span className="project-note">
          Docker commands are sent to a terminal using this active project as the working directory.
        </span>
      </div>

      <div className="action-grid">
        {actions.map((action) => (
          <button
            key={action.label}
            className={`${action.tone === 'primary' ? 'primary' : ''}${action.tone === 'danger' ? 'danger' : ''}`}
            disabled={!project || busyLabel !== null}
            onClick={() => runAction(action)}
            title={action.command}
          >
            <span>{busyLabel === action.label ? 'Starting...' : action.label}</span>
            <small>{action.description}</small>
          </button>
        ))}
      </div>

      <section className="command-preview" aria-label="Docker command reference">
        <h3>Commands</h3>
        {actions.map((action) => (
          <div key={action.label} className="command-row">
            <span>{action.label}</span>
            <code>{action.command}</code>
          </div>
        ))}
      </section>
    </section>
  );
}
