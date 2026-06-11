<script lang="ts">
  import { fade } from 'svelte/transition';

  interface Props {
    isListening: boolean;
    isTtsSpeaking: boolean;
    isRefining: boolean;
    sending: boolean;
    voiceDraftText: string;
    lastAssistantDisplay: string;
    onStop: () => void;
    /** Render as a small docked panel (above the floating bar) instead of a
        full-screen takeover, so the workspace stays visible while talking. */
    compact?: boolean;
  }

  let {
    isListening = false,
    isTtsSpeaking = false,
    isRefining = false,
    sending = false,
    voiceDraftText = '',
    lastAssistantDisplay = '',
    onStop,
    compact = false,
  }: Props = $props();

  const NUM_BARS = 22;

  function barStyle(i: number): string {
    const dur = 280 + ((i * 137) % 420);
    const dly = (i * 83) % 360;
    // Bell-curve envelope: centre bars tallest, edges shortest
    const c = (NUM_BARS - 1) / 2;
    const d = Math.abs(i - c) / c;
    const max = (0.22 + (1 - d * d) * 0.78).toFixed(2);
    return `--dur:${dur}ms;--dly:${dly}ms;--max:${max}`;
  }

  let state = $derived(
    isListening ? 'listening' :
    isTtsSpeaking ? 'speaking' :
    (isRefining || sending) ? 'thinking' :
    'idle'
  );

  const STATUS: Record<string, string> = {
    idle: 'Ready',
    listening: 'Listening…',
    speaking: 'Speaking…',
    thinking: 'Thinking…',
  };

  let displayText = $derived(
    isListening ? voiceDraftText :
    isTtsSpeaking ? lastAssistantDisplay :
    ''
  );
</script>

<div
  class="overlay"
  class:compact
  role="dialog"
  aria-label="Voice conversation"
  transition:fade={{ duration: compact ? 140 : 200 }}
>
  <button class="close-btn" onclick={onStop} aria-label="End voice mode" title="End voice mode">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  </button>

  <!-- Orb -->
  <div class="orb-wrap {state}">
    {#if isListening}
      <div class="ring ring-a"></div>
      <div class="ring ring-b"></div>
    {/if}
    <div class="orb">
      {#if isListening}
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
          <line x1="12" x2="12" y1="19" y2="22"/>
        </svg>
      {:else if isTtsSpeaking}
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      {:else if isRefining || sending}
        <svg class="spin" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
      {:else}
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
          <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
        </svg>
      {/if}
    </div>
  </div>

  <!-- Equalizer -->
  <div class="eq {state}">
    {#each { length: NUM_BARS } as _, i}
      <div class="bar" style={barStyle(i)}></div>
    {/each}
  </div>

  <!-- Status + live transcript / last response preview -->
  <div class="text-col">
    <p class="status {state}">{STATUS[state]}</p>
    {#if displayText}
      <p class="live-text">{displayText}</p>
    {/if}
  </div>

  {#if !compact}
    <button class="end-btn" onclick={onStop}>End voice mode</button>
  {/if}
</div>

<style>
  .overlay {
    position: fixed;
    /* Sit below the custom title bar so the window controls (min/max/close) stay
       reachable while voice mode owns the rest of the screen. */
    top: var(--titlebar-height, 38px);
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 300;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 22px;
    padding: 28px 24px 28px;
    /* Translucent glass takeover: the workspace stays faintly visible behind a
       heavy blur so voice mode reads as a focused overlay on top of your work
       rather than a context-switch to a different screen. */
    background: color-mix(in srgb, var(--bg-primary) 86%, transparent);
    backdrop-filter: blur(var(--glass-blur-strong, 40px)) saturate(var(--glass-saturate, 140%));
    -webkit-backdrop-filter: blur(var(--glass-blur-strong, 40px)) saturate(var(--glass-saturate, 140%));
  }

  /* ── Close button ── */
  .close-btn {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .close-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  /* ── Orb ── */
  .orb-wrap {
    position: relative;
    width: 130px;
    height: 130px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .orb {
    position: relative;
    z-index: 2;
    width: 92px;
    height: 92px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.4s, box-shadow 0.4s, color 0.4s;
  }

  .idle .orb {
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-secondary, #0e0e14) 84%);
    box-shadow:
      0 0 22px color-mix(in srgb, var(--accent) 20%, transparent),
      0 0 55px color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
    animation: pulse-idle 3.5s ease-in-out infinite;
  }

  .listening .orb {
    background: color-mix(in srgb, #ef4444 32%, var(--bg-secondary, #0e0e14) 68%);
    box-shadow: 0 0 28px rgba(239,68,68,.5), 0 0 65px rgba(239,68,68,.18);
    color: #fca5a5;
    animation: pulse-listen .9s ease-in-out infinite;
  }

  .speaking .orb {
    background: color-mix(in srgb, var(--accent) 42%, var(--bg-secondary, #0e0e14) 58%);
    box-shadow:
      0 0 30px color-mix(in srgb, var(--accent) 48%, transparent),
      0 0 70px color-mix(in srgb, var(--accent) 18%, transparent);
    color: white;
    animation: pulse-speak 1.6s ease-in-out infinite;
  }

  .thinking .orb {
    background: color-mix(in srgb, var(--text-muted) 12%, var(--bg-secondary, #0e0e14) 88%);
    box-shadow: 0 0 14px rgba(107,114,128,.1);
    color: var(--text-secondary);
    opacity: 0.6;
  }

  /* Ripple rings — listening only */
  .ring {
    position: absolute;
    border-radius: 50%;
    border: 1.5px solid rgba(239,68,68,.5);
    width: 92px;
    height: 92px;
    animation: ring-ripple 2s ease-out infinite;
    pointer-events: none;
  }
  .ring-b { animation-delay: .9s; }

  @keyframes ring-ripple {
    0%   { width: 92px;  height: 92px;  opacity: .6; }
    100% { width: 165px; height: 165px; opacity: 0;  }
  }
  @keyframes pulse-idle   { 0%,100%{transform:scale(1);opacity:.85} 50%{transform:scale(1.04);opacity:1}  }
  @keyframes pulse-listen { 0%,100%{transform:scale(1)}              50%{transform:scale(1.09)}             }
  @keyframes pulse-speak  { 0%,100%{transform:scale(1)}              50%{transform:scale(1.055)}            }

  /* ── Equalizer ── */
  .eq {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 56px;
  }

  .bar {
    width: 3px;
    height: 56px;
    border-radius: 2px 2px 1px 1px;
    transform-origin: 50% 100%;
    transform: scaleY(0.05);
    will-change: transform, opacity;
  }

  .idle .bar {
    background: var(--text-muted);
    opacity: 0.3;
    animation: eq-idle var(--dur) ease-in-out var(--dly) infinite alternate;
  }
  .listening .bar {
    background: #f87171;
    opacity: 1;
    animation: eq-live var(--dur) ease-in-out var(--dly) infinite alternate;
  }
  .speaking .bar {
    background: var(--accent);
    opacity: .85;
    animation: eq-mid var(--dur) ease-in-out var(--dly) infinite alternate;
  }
  .thinking .bar {
    background: var(--text-secondary);
    opacity: 0.25;
    animation: eq-think var(--dur) ease-in-out var(--dly) infinite alternate;
  }

  @keyframes eq-idle  { from{transform:scaleY(.04)} to{transform:scaleY(calc(var(--max)*.25))} }
  @keyframes eq-live  { from{transform:scaleY(.04)} to{transform:scaleY(var(--max))}            }
  @keyframes eq-mid   { from{transform:scaleY(.1)}  to{transform:scaleY(calc(var(--max)*.8))}  }
  @keyframes eq-think { from{transform:scaleY(.04)} to{transform:scaleY(calc(var(--max)*.35))} }

  /* ── Text ── */
  .text-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .status {
    font-size: 13px;
    font-weight: 500;
    margin: 0;
    letter-spacing: 0.03em;
    transition: color 0.3s;
  }
  .status.idle      { color: var(--text-muted); }
  .status.listening { color: #f87171; }
  .status.speaking  { color: var(--accent); }
  .status.thinking  { color: var(--text-secondary); }

  .live-text {
    font-size: 11.5px;
    color: var(--text-secondary);
    text-align: center;
    max-width: 240px;
    line-height: 1.55;
    margin: -8px 0 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-style: italic;
  }

  /* ── End button ── */
  .end-btn {
    margin-top: 4px;
    padding: 7px 20px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .end-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

  .spin { animation: spin 1.1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Compact docked panel ──
     A slim glass strip that sits directly above the floating prompt bar so the
     workspace behind stays visible while the voice loop runs. Lays the orb,
     equalizer and status out in a single row instead of the centred column. */
  .overlay.compact {
    position: relative;
    top: auto;
    left: auto;
    right: auto;
    bottom: auto;
    z-index: auto;
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
    gap: 12px;
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--border));
    border-radius: 18px;
    background: color-mix(in srgb, var(--bg-secondary) 86%, transparent);
    backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    -webkit-backdrop-filter: blur(var(--glass-blur, 22px)) saturate(var(--glass-saturate, 135%));
    box-shadow: var(--glass-shadow, 0 24px 60px -20px rgba(0, 0, 0, 0.65)), inset 0 1px 0 var(--glass-rim-strong, rgba(255, 255, 255, 0.13));
    pointer-events: auto;
  }

  .overlay.compact .orb-wrap {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }
  .overlay.compact .orb {
    width: 36px;
    height: 36px;
  }
  .overlay.compact .orb :global(svg) {
    width: 18px;
    height: 18px;
  }
  /* Ripple rings would overflow the slim strip — drop them in compact mode. */
  .overlay.compact .ring { display: none; }

  .overlay.compact .eq {
    height: 26px;
    gap: 2px;
    flex-shrink: 0;
  }
  .overlay.compact .bar { height: 26px; }

  .overlay.compact .text-col {
    align-items: flex-start;
    flex: 1;
    text-align: left;
    gap: 2px;
  }
  .overlay.compact .status { font-size: 11px; }
  .overlay.compact .live-text {
    margin: 0;
    max-width: none;
    width: 100%;
    text-align: left;
    font-size: 11px;
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }

  /* Pull the corner close button into the row at the far right. */
  .overlay.compact .close-btn {
    position: static;
    flex-shrink: 0;
    margin-left: auto;
    width: 24px;
    height: 24px;
  }
</style>
