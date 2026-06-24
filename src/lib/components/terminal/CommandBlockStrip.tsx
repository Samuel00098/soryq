import { commandBlocks, toggleCommandBlockCollapse } from '$lib/stores/terminal';
import { useStore } from '$lib/react/useStore';
import './CommandBlockStrip.css';

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// eslint-disable-next-line no-control-regex
const ANSI_CSI = /\x1b\[[0-9;]*[mGKHFABCDJrsu]/g;
// eslint-disable-next-line no-control-regex
const ANSI_OSC = /\x1b\][^\x07]*\x07/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, '').replace(ANSI_OSC, '');
}

export default function CommandBlockStrip({ sessionId }: { sessionId: number }) {
  const allBlocks = useStore(commandBlocks);
  const blocks = (allBlocks.get(sessionId) ?? []).slice(-10);

  if (blocks.length === 0) return null;

  return (
    <div className="block-strip">
      {blocks.map((block) => (
        <div key={block.id} className={`cmd-block${block.endTime === undefined ? ' running' : ''}`}>
          <div className="cmd-header">
            <span className="cmd-status">
              {block.endTime === undefined ? (
                <span className="dot dot-running"></span>
              ) : (block.exitCode ?? 0) === 0 ? (
                <span className="dot dot-ok"></span>
              ) : (
                <span className="dot dot-err"></span>
              )}
            </span>
            <span className="cmd-text">{block.command}</span>
            <span className="cmd-duration">{formatDuration(block.startTime, block.endTime)}</span>
            <span
              className="cmd-toggle"
              onClick={() => toggleCommandBlockCollapse(sessionId, block.id)}
              title={block.collapsed ? 'Expand output' : 'Collapse output'}
            >
              {block.collapsed ? '▸' : '▾'}
            </span>
          </div>
          {!block.collapsed && block.output && (
            <pre className="cmd-output">{stripAnsi(block.output)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
