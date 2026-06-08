// Shared signals for reasoning about a CLI agent's state from its terminal
// output. Used by the orchestrator's turn watcher and by TerminalPane's
// attention toast so the two stay in sync.

/** ASCII BEL — CLI agents commonly ring it when a turn finishes or they want input. */
export const BELL = '\x07';

/**
 * Phrases that indicate an agent has paused waiting for a human decision
 * (confirmation prompts, "waiting for your response", etc.).
 */
export const AGENT_ATTENTION_PATTERN =
  /\[y\/n\]|\[Y\/n\]|\[n\/Y\]|\(y\/n\)|\(Y\/n\)|\(yes\/no\)|\[yes\/no\]|do you want to|would you like to|shall i\b|please (confirm|review|choose|select)|press enter to continue|awaiting (your )?input|waiting for (your )?response|needs? your (input|attention|review)/i;

/** Count BEL characters in a chunk of terminal output. */
export function countBell(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 7) count += 1;
  }
  return count;
}

/** True when the output shows the agent waiting on the user. */
export function containsAttentionRequest(text: string): boolean {
  return AGENT_ATTENTION_PATTERN.test(text);
}

/** A short, human-facing reason for a blocked task derived from agent output. */
export function attentionReason(text: string): string {
  const match = text.match(AGENT_ATTENTION_PATTERN);
  if (match) {
    // Surface a little surrounding context so the blocked card is actionable.
    const idx = match.index ?? 0;
    const snippet = text.slice(Math.max(0, idx - 40), idx + match[0].length + 40).replace(/\s+/g, ' ').trim();
    if (snippet) return snippet.length > 140 ? `${snippet.slice(0, 137)}…` : snippet;
  }
  return 'Agent is waiting for your input.';
}
