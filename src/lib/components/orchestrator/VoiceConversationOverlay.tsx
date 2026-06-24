import type { CSSProperties } from 'react';
import './VoiceConversationOverlay.css';

interface Props {
  isListening?: boolean;
  isTtsSpeaking?: boolean;
  isRefining?: boolean;
  sending?: boolean;
  voiceDraftText?: string;
  lastAssistantDisplay?: string;
  onStop: () => void;
  /** Render as a small docked panel (above the floating bar) instead of a
      full-screen takeover, so the workspace stays visible while talking. */
  compact?: boolean;
}

const NUM_BARS = 22;

const STATUS: Record<string, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  speaking: 'Speaking…',
  thinking: 'Thinking…',
};

function barStyle(i: number): CSSProperties {
  const dur = 280 + ((i * 137) % 420);
  const dly = (i * 83) % 360;
  // Bell-curve envelope: centre bars tallest, edges shortest.
  const c = (NUM_BARS - 1) / 2;
  const d = Math.abs(i - c) / c;
  const max = (0.22 + (1 - d * d) * 0.78).toFixed(2);
  return {
    ['--dur']: `${dur}ms`,
    ['--dly']: `${dly}ms`,
    ['--max']: max,
  } as CSSProperties;
}

export default function VoiceConversationOverlay({
  isListening = false,
  isTtsSpeaking = false,
  isRefining = false,
  sending = false,
  voiceDraftText = '',
  lastAssistantDisplay = '',
  onStop,
  compact = false,
}: Props) {
  const state = isListening
    ? 'listening'
    : isTtsSpeaking
      ? 'speaking'
      : isRefining || sending
        ? 'thinking'
        : 'idle';

  const displayText = isListening ? voiceDraftText : isTtsSpeaking ? lastAssistantDisplay : '';

  return (
    <div className={`overlay${compact ? ' compact' : ''}`} role="dialog" aria-label="Voice conversation">
      <button className="close-btn" onClick={onStop} aria-label="End voice mode" title="End voice mode">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Orb */}
      <div className={`orb-wrap ${state}`}>
        {isListening && (
          <>
            <div className="ring ring-a"></div>
            <div className="ring ring-b"></div>
          </>
        )}
        <div className="orb">
          {isListening ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          ) : isTtsSpeaking ? (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          ) : isRefining || sending ? (
            <svg className="spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : (
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
              <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
            </svg>
          )}
        </div>
      </div>

      {/* Equalizer */}
      <div className={`eq ${state}`}>
        {Array.from({ length: NUM_BARS }).map((_, i) => (
          <div key={i} className="bar" style={barStyle(i)}></div>
        ))}
      </div>

      {/* Status + live transcript / last response preview */}
      <div className="text-col">
        <p className={`status ${state}`}>{STATUS[state]}</p>
        {displayText && <p className="live-text">{displayText}</p>}
      </div>

      {!compact && (
        <button className="end-btn" onClick={onStop}>
          End voice mode
        </button>
      )}
    </div>
  );
}
