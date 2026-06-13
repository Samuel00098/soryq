<script lang="ts">
  import { get } from 'svelte/store';
  import { activeProject } from '$lib/stores/workspace';
  import { showToast } from '$lib/stores/notification';
  import { clampHorizontalScroll } from '$lib/actions/clampHorizontalScroll';
  import {
    createTerminalSession,
    sendPromptToSession,
    setActiveSession,
  } from '$lib/stores/terminal';

  type EmbeddedMode = 'arduino' | 'platformio' | 'pi';
  type CommandAction = {
    label: string;
    command: string;
    tone?: 'primary' | 'warning';
  };

  let mode = $state<EmbeddedMode>('arduino');

  let arduinoFqbn = $state('arduino:avr:uno');
  let arduinoPort = $state('COM3');
  let arduinoBaud = $state('115200');

  let platformioBoard = $state('uno');

  let piUser = $state('pi');
  let piHost = $state('raspberrypi.local');
  let piPath = $state('~/soryq-project');

  const modeTitle = $derived.by(() => {
    if (mode === 'arduino') return 'Arduino CLI';
    if (mode === 'platformio') return 'PlatformIO';
    return 'Raspberry Pi';
  });

  const activeRoot = $derived($activeProject?.root_path ?? null);

  const arduinoCommands = $derived.by<CommandAction[]>(() => [
    { label: 'Detect boards', command: 'arduino-cli board list' },
    {
      label: 'Install AVR core',
      command: 'arduino-cli core update-index; arduino-cli core install arduino:avr'
    },
    {
      label: 'Compile',
      command: `arduino-cli compile --fqbn ${arduinoFqbn.trim() || 'arduino:avr:uno'} .`,
      tone: 'primary'
    },
    {
      label: 'Upload',
      command: `arduino-cli upload -p ${arduinoPort.trim() || 'COM3'} --fqbn ${arduinoFqbn.trim() || 'arduino:avr:uno'} .`,
      tone: 'primary'
    },
    {
      label: 'Serial monitor',
      command: `arduino-cli monitor -p ${arduinoPort.trim() || 'COM3'} -c baudrate=${arduinoBaud.trim() || '115200'}`,
      tone: 'warning'
    }
  ]);

  const platformioCommands = $derived.by<CommandAction[]>(() => [
    {
      label: 'Create project',
      command: `pio project init --board ${platformioBoard.trim() || 'uno'}`
    },
    { label: 'Build', command: 'pio run', tone: 'primary' },
    { label: 'Upload', command: 'pio run -t upload', tone: 'primary' },
    {
      label: 'Serial monitor',
      command: `pio device monitor -b ${arduinoBaud.trim() || '115200'}`,
      tone: 'warning'
    },
    { label: 'List devices', command: 'pio device list' }
  ]);

  const piTarget = $derived(`${piUser.trim() || 'pi'}@${piHost.trim() || 'raspberrypi.local'}`);
  const piCommands = $derived.by<CommandAction[]>(() => [
    { label: 'SSH', command: `ssh ${piTarget}`, tone: 'primary' },
    {
      label: 'Copy project',
      command: `scp -r . ${piTarget}:${piPath.trim() || '~/soryq-project'}`
    },
    {
      label: 'Sync project',
      command: `rsync -av --exclude node_modules --exclude .git ./ ${piTarget}:${piPath.trim() || '~/soryq-project'}/`
    },
    { label: 'Run remote shell', command: `ssh ${piTarget} "cd ${piPath.trim() || '~/soryq-project'} && bash"` }
  ]);

  const visibleCommands = $derived.by(() => {
    if (mode === 'arduino') return arduinoCommands;
    if (mode === 'platformio') return platformioCommands;
    return piCommands;
  });

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

  async function createEmbeddedCommandSession(): Promise<number | null> {
    const project = get(activeProject);
    if (!project) {
      showToast('Open a project before running embedded commands', 'warning');
      return null;
    }

    return createTerminalSession(project.root_path, undefined, project.id);
  }

  async function runCommand(command: string) {
    const value = getRunnableCommand(command);
    if (!value) return;

    const sessionId = await createEmbeddedCommandSession();
    if (sessionId === null) return;

    setActiveSession(sessionId);
    sendPromptToSession(sessionId, value);
    showToast('Embedded command sent to a new terminal', 'success');
  }
</script>

<div class="embedded-panel">
  <div class="embedded-toolbar">
    <div class="mode-tabs" aria-label="Embedded workflow" use:clampHorizontalScroll>
      <button class:active={mode === 'arduino'} onclick={() => mode = 'arduino'}>Arduino</button>
      <button class:active={mode === 'platformio'} onclick={() => mode = 'platformio'}>PlatformIO</button>
      <button class:active={mode === 'pi'} onclick={() => mode = 'pi'}>Raspberry Pi</button>
    </div>
    <div class="project-chip" title={activeRoot ?? 'No project open'}>
      {activeRoot ? 'Project ready' : 'No project'}
    </div>
  </div>

  <section class="embedded-config">
    <div class="section-heading">
      <span>{modeTitle}</span>
      <span>{visibleCommands.length} actions</span>
    </div>

    {#if mode === 'arduino'}
      <div class="field-grid">
        <label>
          <span>Board FQBN</span>
          <input bind:value={arduinoFqbn} placeholder="arduino:avr:uno" />
        </label>
        <label>
          <span>Port</span>
          <input bind:value={arduinoPort} placeholder="COM3" />
        </label>
        <label>
          <span>Baud</span>
          <input bind:value={arduinoBaud} placeholder="115200" inputmode="numeric" />
        </label>
      </div>
    {:else if mode === 'platformio'}
      <div class="field-grid">
        <label>
          <span>Board ID</span>
          <input bind:value={platformioBoard} placeholder="uno" />
        </label>
        <label>
          <span>Baud</span>
          <input bind:value={arduinoBaud} placeholder="115200" inputmode="numeric" />
        </label>
      </div>
    {:else}
      <div class="field-grid">
        <label>
          <span>User</span>
          <input bind:value={piUser} placeholder="pi" />
        </label>
        <label>
          <span>Host</span>
          <input bind:value={piHost} placeholder="raspberrypi.local" />
        </label>
        <label class="wide">
          <span>Remote path</span>
          <input bind:value={piPath} placeholder="~/soryq-project" />
        </label>
      </div>
    {/if}
  </section>

  <section class="command-list scrollable">
    {#each visibleCommands as item}
      <article class:primary={item.tone === 'primary'} class:warning={item.tone === 'warning'} class="command-item">
        <div class="command-main">
          <div class="command-label">{item.label}</div>
          <code>{item.command}</code>
        </div>
        <div class="command-actions">
          <button class="icon-btn" title="Copy command" aria-label={`Copy ${item.label} command`} onclick={() => copyCommand(item.command)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
            </svg>
          </button>
          <button class="run-btn" title="Run in terminal" onclick={() => runCommand(item.command)}>Run</button>
        </div>
      </article>
    {/each}
  </section>
</div>

<style>
  .embedded-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    height: 100%;
  }

  .embedded-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }

  .mode-tabs {
    display: inline-flex;
    gap: 4px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x proximity;
  }

  .mode-tabs button {
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    scroll-snap-align: start;
    font-size: 11.5px;
    font-weight: 650;
    padding: 6px 9px;
    white-space: nowrap;
  }

  .mode-tabs button:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .mode-tabs button.active {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 13%, transparent);
  }

  .project-chip {
    border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
    border-radius: 999px;
    color: var(--text-secondary);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    font-size: 10.5px;
    font-weight: 700;
    line-height: 1;
    padding: 7px 9px;
    white-space: nowrap;
  }

  .embedded-config {
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-secondary) 16%, transparent);
    padding: 12px;
  }

  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--text-muted);
    font-size: 10.5px;
    font-weight: 750;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .section-heading span:first-child {
    color: var(--text-primary);
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .field-grid label {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .field-grid label.wide {
    grid-column: span 2;
  }

  .field-grid span {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }

  .field-grid input {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: color-mix(in srgb, var(--bg-primary) 84%, transparent);
    color: var(--text-primary);
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    outline: none;
    padding: 7px 8px;
  }

  .field-grid input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .command-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .command-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--bg-primary) 70%, transparent);
    padding: 10px;
  }

  .command-item.primary {
    border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary));
  }

  .command-item.warning {
    border-color: color-mix(in srgb, var(--warning) 32%, var(--border));
    background: color-mix(in srgb, var(--warning) 7%, var(--bg-primary));
  }

  .command-main {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .command-label {
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 700;
  }

  code {
    color: var(--text-secondary);
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .command-actions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .icon-btn,
  .run-btn {
    height: 30px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .icon-btn {
    width: 32px;
    padding: 0;
  }

  .run-btn {
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 750;
    padding: 0 10px;
  }

  .icon-btn:hover,
  .run-btn:hover {
    border-color: var(--accent);
    background: var(--bg-hover);
  }

  @container (max-width: 520px) {
    .embedded-config {
      padding: 10px;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }

    .field-grid label.wide {
      grid-column: auto;
    }

    .command-item {
      grid-template-columns: 1fr;
      align-items: stretch;
    }

    .command-actions {
      justify-content: flex-end;
    }
  }
</style>
