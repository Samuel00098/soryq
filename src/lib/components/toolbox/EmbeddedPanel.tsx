import { useMemo, useState } from 'react';
import { get } from '$lib/stores/storeCompat';
import { activeProject } from '$lib/stores/workspace';
import { showToast } from '$lib/stores/notification';
import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';
import { ensureIdleOrCreateTerminal, sendPromptToSession, setActiveSession } from '$lib/stores/terminal';
import { showTerminal } from '$lib/stores/layout';
import { requestRoomControl } from '$lib/stores/layoutControl';
import { useStore } from '$lib/react/useStore';
import { useAction } from '$lib/react/useAction';
import './EmbeddedPanel.css';

type EmbeddedMode = 'arduino' | 'platformio' | 'pi';
type CommandAction = {
  label: string;
  command: string;
  tone?: 'primary' | 'warning';
};

export default function EmbeddedPanel() {
  const project = useStore(activeProject);
  const modeTabsRef = useAction<HTMLDivElement>(clampHorizontalScroll);

  const [mode, setMode] = useState<EmbeddedMode>('arduino');

  const [arduinoFqbn, setArduinoFqbn] = useState('arduino:avr:uno');
  const [arduinoPort, setArduinoPort] = useState('COM3');
  const [arduinoBaud, setArduinoBaud] = useState('115200');

  const [platformioBoard, setPlatformioBoard] = useState('uno');

  const [piUser, setPiUser] = useState('pi');
  const [piHost, setPiHost] = useState('raspberrypi.local');
  const [piPath, setPiPath] = useState('~/soryq-project');

  const modeTitle =
    mode === 'arduino' ? 'Arduino CLI' : mode === 'platformio' ? 'PlatformIO' : 'Raspberry Pi';

  const activeRoot = project?.root_path ?? null;

  const arduinoCommands = useMemo<CommandAction[]>(
    () => [
      { label: 'Detect boards', command: 'arduino-cli board list' },
      {
        label: 'Install AVR core',
        command: 'arduino-cli core update-index; arduino-cli core install arduino:avr',
      },
      {
        label: 'Compile',
        command: `arduino-cli compile --fqbn ${arduinoFqbn.trim() || 'arduino:avr:uno'} .`,
        tone: 'primary',
      },
      {
        label: 'Upload',
        command: `arduino-cli upload -p ${arduinoPort.trim() || 'COM3'} --fqbn ${arduinoFqbn.trim() || 'arduino:avr:uno'} .`,
        tone: 'primary',
      },
      {
        label: 'Serial monitor',
        command: `arduino-cli monitor -p ${arduinoPort.trim() || 'COM3'} -c baudrate=${arduinoBaud.trim() || '115200'}`,
        tone: 'warning',
      },
    ],
    [arduinoFqbn, arduinoPort, arduinoBaud],
  );

  const platformioCommands = useMemo<CommandAction[]>(
    () => [
      { label: 'Create project', command: `pio project init --board ${platformioBoard.trim() || 'uno'}` },
      { label: 'Build', command: 'pio run', tone: 'primary' },
      { label: 'Upload', command: 'pio run -t upload', tone: 'primary' },
      {
        label: 'Serial monitor',
        command: `pio device monitor -b ${arduinoBaud.trim() || '115200'}`,
        tone: 'warning',
      },
      { label: 'List devices', command: 'pio device list' },
    ],
    [platformioBoard, arduinoBaud],
  );

  const piTarget = `${piUser.trim() || 'pi'}@${piHost.trim() || 'raspberrypi.local'}`;
  const piCommands = useMemo<CommandAction[]>(
    () => [
      { label: 'SSH', command: `ssh ${piTarget}`, tone: 'primary' },
      { label: 'Copy project', command: `scp -r . ${piTarget}:${piPath.trim() || '~/soryq-project'}` },
      {
        label: 'Sync project',
        command: `rsync -av --exclude node_modules --exclude .git ./ ${piTarget}:${piPath.trim() || '~/soryq-project'}/`,
      },
      {
        label: 'Run remote shell',
        command: `ssh ${piTarget} "cd ${piPath.trim() || '~/soryq-project'} && bash"`,
      },
    ],
    [piTarget, piPath],
  );

  const visibleCommands =
    mode === 'arduino' ? arduinoCommands : mode === 'platformio' ? platformioCommands : piCommands;

  function getRunnableCommand(command: string) {
    return command.trim();
  }

  async function copyCommand(command: string) {
    const value = getRunnableCommand(command);
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      showToast('Command copied', 'info');
    } catch (err) {
      showToast(`Copy failed: ${err}`, 'error');
    }
  }

  async function runCommand(command: string) {
    const value = getRunnableCommand(command);
    if (!value) return;

    const proj = get(activeProject);
    if (!proj) {
      showToast('Open a project before running embedded commands', 'warning');
      return;
    }

    const sessionId = await ensureIdleOrCreateTerminal(proj.root_path, proj.id);
    if (sessionId === null) return;

    setActiveSession(sessionId);
    showTerminal();
    requestRoomControl('focus', 'terminal');
    sendPromptToSession(sessionId, value);
    showToast('Embedded command sent to terminal', 'success');
  }

  return (
    <div className="embedded-panel">
      <div className="embedded-toolbar">
        <div className="mode-tabs" aria-label="Embedded workflow" ref={modeTabsRef}>
          <button className={mode === 'arduino' ? 'active' : ''} onClick={() => setMode('arduino')}>
            Arduino
          </button>
          <button className={mode === 'platformio' ? 'active' : ''} onClick={() => setMode('platformio')}>
            PlatformIO
          </button>
          <button className={mode === 'pi' ? 'active' : ''} onClick={() => setMode('pi')}>
            Raspberry Pi
          </button>
        </div>
        <div className="project-chip" title={activeRoot ?? 'No project open'}>
          {activeRoot ? 'Project ready' : 'No project'}
        </div>
      </div>

      <section className="embedded-config">
        <div className="section-heading">
          <span>{modeTitle}</span>
          <span>{visibleCommands.length} actions</span>
        </div>

        {mode === 'arduino' ? (
          <div className="field-grid">
            <label>
              <span>Board FQBN</span>
              <input value={arduinoFqbn} onChange={(e) => setArduinoFqbn(e.target.value)} placeholder="arduino:avr:uno" />
            </label>
            <label>
              <span>Port</span>
              <input value={arduinoPort} onChange={(e) => setArduinoPort(e.target.value)} placeholder="COM3" />
            </label>
            <label>
              <span>Baud</span>
              <input value={arduinoBaud} onChange={(e) => setArduinoBaud(e.target.value)} placeholder="115200" inputMode="numeric" />
            </label>
          </div>
        ) : mode === 'platformio' ? (
          <div className="field-grid">
            <label>
              <span>Board ID</span>
              <input value={platformioBoard} onChange={(e) => setPlatformioBoard(e.target.value)} placeholder="uno" />
            </label>
            <label>
              <span>Baud</span>
              <input value={arduinoBaud} onChange={(e) => setArduinoBaud(e.target.value)} placeholder="115200" inputMode="numeric" />
            </label>
          </div>
        ) : (
          <div className="field-grid">
            <label>
              <span>User</span>
              <input value={piUser} onChange={(e) => setPiUser(e.target.value)} placeholder="pi" />
            </label>
            <label>
              <span>Host</span>
              <input value={piHost} onChange={(e) => setPiHost(e.target.value)} placeholder="raspberrypi.local" />
            </label>
            <label className="wide">
              <span>Remote path</span>
              <input value={piPath} onChange={(e) => setPiPath(e.target.value)} placeholder="~/soryq-project" />
            </label>
          </div>
        )}
      </section>

      <section className="command-list scrollable">
        {visibleCommands.map((item, i) => (
          <article
            key={`${item.label}-${i}`}
            className={`command-item${item.tone === 'primary' ? ' primary' : ''}${item.tone === 'warning' ? ' warning' : ''}`}
          >
            <div className="command-main">
              <div className="command-label">{item.label}</div>
              <code>{item.command}</code>
            </div>
            <div className="command-actions">
              <button
                className="icon-btn"
                title="Copy command"
                aria-label={`Copy ${item.label} command`}
                onClick={() => copyCommand(item.command)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </button>
              <button className="run-btn" title="Run in terminal" onClick={() => runCommand(item.command)}>
                Run
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
