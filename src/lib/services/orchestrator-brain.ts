import { invoke } from '@tauri-apps/api/core';
import { get } from 'svelte/store';
import {
  aiProvider,
  currentAiModel,
  type AiProviderId,
  getProviderDef,
  isLocalProvider,
  getProviderBaseUrl,
} from '$lib/stores/settings';
import { getProviderApiKeyLocal } from '$lib/services/ai-keychain';

export interface AgentChoice {
  command: string;
  name: string;
}

/**
 * One thing the orchestrator decided to do this turn. A single message can yield
 * several of these — e.g. "open two claude agents" → two `spawn` actions.
 */
export type OrchestratorAction =
  /** Launch a new agent. Omit `prompt` to open it idle/ready; `name` labels it. */
  | { kind: 'spawn'; agent: string; prompt?: string | null; name?: string | null }
  /** Push a new prompt to an already-running agent, addressed by its name. */
  | { kind: 'send'; target: string; prompt: string }
  /** Give a running agent a name (or rename it). */
  | { kind: 'name'; target: string; name: string }
  /** Stop a running agent and close its terminal. `target` is its name, or "all". */
  | { kind: 'close'; target: string };

export interface RouteResult {
  /** Short conversational message shown back to the user. */
  reply: string;
  /** The actions the orchestrator wants to take this turn (may be empty for chat). */
  actions: OrchestratorAction[];
  /** True when an LLM produced this routing (vs the heuristic fallback). */
  viaLLM: boolean;
}

/** A currently-running agent the orchestrator can address by name. */
export interface RunningAgentRef {
  name?: string | null;
  agent: string;
  title: string;
  /** Tail of the agent's terminal output, ANSI-stripped. Null when nothing captured yet. */
  recentOutput?: string | null;
}

export interface AgentOutputRef extends RunningAgentRef {
  status: 'in-progress' | 'complete' | 'blocked' | 'failed' | 'cancelled';
  updatedAt?: number | null;
  reason?: string | null;
}

export interface RouteContext {
  projectName?: string;
  recentUserMessages?: string[];
  taskMemory?: string[];
  taskPanel?: string[];
  runningAgents?: RunningAgentRef[];
  reviewingAgents?: RunningAgentRef[];
  taskOutputs?: AgentOutputRef[];
  llmConfig?: RouteLlmConfig;
  /**
   * Spoken voice-conversation mode. The user is primarily *talking* with the
   * orchestrator, not commanding a fleet, so routing defaults to plain
   * conversation and only acts (spawn/send/close) on an explicit request.
   */
  conversational?: boolean;
}

export interface RouteLlmConfig {
  provider: AiProviderId;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}


function compactText(raw: string, maxChars: number): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

function buildUserText(message: string, ctx?: RouteContext): string {
  const parts: string[] = [];
  if (ctx?.projectName) parts.push(`Project: ${compactText(ctx.projectName, 80)}`);
  const running = ctx?.runningAgents ?? [];
  if (running.length) {
    parts.push('Currently running agents:');
    for (const r of running) {
      parts.push(`- ${r.name ? `"${compactText(r.name, 48)}"` : '(unnamed)'} [${compactText(r.agent, 48)}] — ${compactText(r.title, 120)}`);
      if (r.recentOutput?.trim()) {
        const lines = r.recentOutput.trim().split('\n').slice(-8).map((l) => `  | ${l}`).join('\n');
        parts.push(`  Terminal output (recent tail):\n${lines}`);
      }
    }
  }
  const reviewing = ctx?.reviewingAgents ?? [];
  if (reviewing.length) {
    parts.push('Tasks awaiting review that can be resumed automatically:');
    for (const r of reviewing) {
      parts.push(`- ${r.name ? `"${compactText(r.name, 48)}"` : '(unnamed)'} [${compactText(r.agent, 48)}] — ${compactText(r.title, 120)}`);
    }
  }
  const taskOutputs = (ctx?.taskOutputs ?? []).slice(0, 6);
  if (taskOutputs.length) {
    parts.push('Recent agent/task status and terminal output:');
    for (const r of taskOutputs) {
      parts.push(`- ${r.name ? `"${compactText(r.name, 48)}"` : '(unnamed)'} [${compactText(r.agent, 48)}, ${r.status}] - ${compactText(r.title, 120)}`);
      if (r.reason) parts.push(`  Reason: ${compactText(r.reason, 180)}`);
      if (r.recentOutput?.trim()) {
        const lines = r.recentOutput.trim().split('\n').slice(-10).map((l) => `  | ${l}`).join('\n');
        parts.push(`  Terminal output (recent tail):\n${lines}`);
      }
    }
  }
  const memory = (ctx?.taskMemory ?? []).slice(-8);
  if (memory.length) {
    parts.push('Project memory and recent task activity:');
    for (const line of memory) parts.push(`- ${compactText(line, 240)}`);
  }
  const taskPanel = (ctx?.taskPanel ?? []).slice(0, 6);
  if (taskPanel.length) {
    parts.push('Task panel board:');
    for (const line of taskPanel) parts.push(`- ${compactText(line, 240)}`);
  }
  const recentUserMessages = (ctx?.recentUserMessages ?? []).slice(-6);
  if (recentUserMessages.length) {
    parts.push('Recent user messages:');
    for (const text of recentUserMessages) parts.push(`- ${compactText(text, 240)}`);
  }
  parts.push(`New user message: ${compactText(message, 240)}`);
  return parts.join('\n');
}


const ACTION_RE =
  /\b(add|build|create|fix|refactor|implement|write|update|change|modify|remove|delete|test|run|make|generate|debug|optimi[sz]e|install|set ?up|migrate|rename|move|wire|integrate|deploy|scaffold|convert|port|upgrade)\b/i;

// Anchored at the start so it only fires on an actual "close that agent" command,
// not a task that merely mentions one of these words ("fix the bug that stops X").
const CLOSE_CMD_RE = /^(?:please\s+|can you\s+)?(close|stop|shut\s?down|shut|kill|end|dismiss|terminate|release|quit)\b/i;
const CLOSE_ALL_RE = /\b(all|everything|every ?one|every agent|them all|the agents)\b/i;

// Question patterns — prevent the heuristic from spawning agents when the user is
// just chatting, asking for an explanation, or asking for status.
const QUESTION_START_RE = /^(what|why|how|when|where|who|which|is|are|does|do|can|could|would|should|explain|describe|tell me|show me|help me understand|help me|give me|walk me through)\b/i;
const QUESTION_MARK_RE = /\?\s*$/;

// Explicit "open an agent" intent. In spoken conversation mode we only spawn
// when the user clearly asks to launch an agent or to have one do coding work —
// everything else is treated as plain conversation, never a dispatch.
const EXPLICIT_SPAWN_RE =
  /\b(open|spawn|launch|start|fire up|boot up|kick off|create|use|have|get|tell|ask|put)\b[^.?!]*\b(agent|claude|codex|aider|opencode|antigravity|agy|cursor|pi|oh ?my ?pi|omp|assistant|bot)\b/i;

// Status-check patterns — intercepted before the LLM so we respond instantly.
const STATUS_CHECK_RE = /^(status|what[‘’]?s (?:the )?status|what[‘’]?s running|list agents|show agents|which agents|what agents are running|show me the agents|what are (?:my |the )?agents doing|how (?:is|are) (?:the |my |that |those )?agents? doing|is (?:it|that|the agent) (?:done|finished|complete)|has (?:it|that|the agent) finished|are (?:they|the agents) (?:done|finished|complete))\b/i;

// Output-query patterns — user wants to see what an agent said/wrote/outputted.
// Intercept before routing so we never send a new message to the agent.
const OUTPUT_QUERY_RE =
  /^(what did|what has|what[‘’]?s|show me what|get|fetch|read|check|see what|summari[sz]e|tell me what)\b.{0,80}\b(said?|respond(?:ed)?|wrot[eo]|output(?:ted)?|terminal|result(?:s)?|response|reply|answer|return(?:ed)?|produc(?:ed)?|finish(?:ed)?|complet(?:ed)?|done)\b/i;

const TASK_ADVICE_RE =
  /\b(what should|what[‘’]?s next|what next|next task|should we|prioriti[sz]e|recommend|suggest)\b/i;

function pickDefaultAgent(agents: AgentChoice[]): AgentChoice | null {
  return agents.find((a) => a.command === 'claude') ?? agents[0] ?? null;
}

// Spoken synonyms for command ids that aren't an obvious word. The command id
// itself and the preset name are matched generically (below); these cover the
// gap where the id is opaque ("agy" → "antigravity") or differs from how people
// say it. The Cursor command is the bare word "agent", which is too generic to
// match on its own, so it's reached only via "cursor".
const AGENT_ALIASES: Record<string, string[]> = {
  codex: ['codex'],
  claude: ['claude'],
  agy: ['agy', 'antigravity'],
  opencode: ['opencode', 'open code'],
  pi: ['pi'],
  omp: ['omp', 'oh my pi', 'oh-my-pi', 'ohmypi'],
  agent: ['cursor'],
  aider: ['aider'],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The words/phrases that name a given agent: its command id (unless generic),
 * its preset name, and any spoken aliases. */
function agentMatchTerms(agent: AgentChoice): string[] {
  const terms = new Set<string>();
  const cmd = agent.command.trim().toLowerCase();
  // The bare "agent" command (Cursor) is too generic to match as a word.
  if (cmd && cmd !== 'agent' && !cmd.includes(' ')) terms.add(cmd);
  const name = agent.name.trim().toLowerCase();
  if (name) terms.add(name);
  for (const alias of AGENT_ALIASES[cmd] ?? []) terms.add(alias);
  return [...terms].filter(Boolean);
}

/**
 * Resolve the agent a message names to its command id — matching the command,
 * the preset name, or a spoken alias, case-insensitively and on word
 * boundaries. Returns the MOST specific (longest) match so "Codex CLI" beats a
 * stray "codex"; null when no agent is named.
 */
export function resolveAgentCommand(text: string, agents: AgentChoice[]): string | null {
  const haystack = ` ${text.toLowerCase()} `;
  let best: { command: string; len: number } | null = null;
  for (const agent of agents) {
    for (const term of agentMatchTerms(agent)) {
      const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(term)}(?:[^a-z0-9]|$)`, 'i');
      if (re.test(haystack) && (!best || term.length > best.len)) {
        best = { command: agent.command, len: term.length };
      }
    }
  }
  return best?.command ?? null;
}

/** Find a running agent the message names, so heuristic close can target it. */
function matchRunningName(message: string, running: RunningAgentRef[]): string | null {
  const lower = message.toLowerCase();
  for (const r of running) {
    if (r.name && lower.includes(r.name.toLowerCase())) return r.name;
  }
  return null;
}

function statusPhrase(status: AgentOutputRef['status']): string {
  switch (status) {
    case 'in-progress': return 'still in progress';
    case 'complete': return 'done';
    case 'blocked': return 'waiting for input';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return status;
  }
}

function outputRefs(ctx?: RouteContext): AgentOutputRef[] {
  const refs = ctx?.taskOutputs ?? [];
  if (refs.length) return refs;
  return (ctx?.runningAgents ?? []).map((r) => ({ ...r, status: 'in-progress' as const }));
}

function displayAgentName(ref: RunningAgentRef): string {
  return ref.name ? compactText(ref.name, 32) : compactText(ref.agent, 32) || 'Agent';
}

function latestOutputLine(ref: RunningAgentRef, maxChars = 160): string {
  const line = ref.recentOutput
    ?.trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return line ? compactText(line, maxChars) : '';
}

function formatStatusReply(refs: AgentOutputRef[]): string {
  if (!refs.length) return 'No agents are currently running, and I do not have recent task output to summarize yet.';
  const lines = refs.slice(0, 6).map((r) => {
    const latest = latestOutputLine(r);
    const reason = r.reason ? ` (${compactText(r.reason, 90)})` : '';
    const tail = latest ? ` Latest output: ${latest}` : '';
    return `- ${displayAgentName(r)} is ${statusPhrase(r.status)}${reason}: ${compactText(r.title, 90)}.${tail}`;
  });
  if (refs.length === 1) return lines[0].replace(/^- /, '');
  return `${refs.length} recent agent tasks:\n${lines.join('\n')}`;
}

function formatOutputReply(refs: AgentOutputRef[], conversational = false): string {
  const withOutput = refs.filter((r) => r.recentOutput?.trim());
  if (!withOutput.length) {
    if (!refs.length) return 'No agents are currently running, and I do not have captured terminal output yet.';
    return formatStatusReply(refs);
  }

  const parts = withOutput.slice(0, 3).map((r) => {
    const output = r.recentOutput!.trim().split('\n').slice(-20).join('\n');
    const compact = compactText(output, conversational ? 520 : 900);
    const intro = `${displayAgentName(r)} is ${statusPhrase(r.status)} on "${compactText(r.title, 80)}".`;
    if (conversational) return `${intro} The latest terminal output says: ${compact}`;
    return `${intro}\n\nLatest terminal output:\n\`\`\`\n${output}\n\`\`\``;
  });
  return parts.join('\n\n');
}

function formatTaskPanelAdvice(taskPanel: string[]): string {
  const doing = taskPanel.find((line) => /^In progress\b/i.test(line));
  const todo = taskPanel.find((line) => /^To do\b/i.test(line));
  if (doing && todo) {
    return `I would focus on ${compactText(doing, 150)} first, then pick from ${compactText(todo, 150)}. Work already in progress usually has the best payoff unless it is blocked.`;
  }
  if (doing) return `I would finish or unblock ${compactText(doing, 170)} before starting new work.`;
  if (todo) return `I would start with ${compactText(todo, 170)}. Nothing is currently marked in progress.`;
  return 'The task panel is empty right now, so there is no queued work to prioritize.';
}

/** Routing without an LLM: pick a sensible agent and decide chat vs dispatch. */
function heuristicRoute(message: string, agents: AgentChoice[], ctx?: RouteContext): RouteResult {
  const text = message.trim();

  // "close it" / "stop that agent" — only when there's actually something running
  // to close, so a bare "stop" can't no-op confusingly.
  const running = ctx?.runningAgents ?? [];
  if (running.length && CLOSE_CMD_RE.test(text)) {
    if (CLOSE_ALL_RE.test(text)) {
      return { reply: 'Closing all running agents.', actions: [{ kind: 'close', target: 'all' }], viaLLM: false };
    }
    const target = matchRunningName(text, running) ?? 'last';
    return { reply: 'Closing that agent.', actions: [{ kind: 'close', target }], viaLLM: false };
  }

  const defaultAgent = pickDefaultAgent(agents);
  if (!defaultAgent) {
    return { reply: 'No agents are configured for this project yet.', actions: [], viaLLM: false };
  }
  // If the user named a specific agent ("open codex", "use Codex CLI"), bring
  // THAT one out — not the default. Falls back to the default when none named.
  const namedCommand = resolveAgentCommand(text, agents);
  const agent = (namedCommand ? agents.find((a) => a.command === namedCommand) : null) ?? defaultAgent;

  // In spoken conversation mode, talking is the default — only dispatch when the
  // user explicitly asks to open an agent. Otherwise just keep the conversation
  // going rather than silently spawning a terminal behind the voice overlay.
  // When there are running agents, surface their terminal output so the reply
  // is useful (e.g. "how's the agent doing" → recent output) instead of canned.
  if (ctx?.conversational && !EXPLICIT_SPAWN_RE.test(text)) {
    const refs = outputRefs(ctx);
    if (refs.length) {
      return {
        reply: formatStatusReply(refs),
        actions: [],
        viaLLM: false,
      };
    }
    if (running.length) {
      const lines = running.map((r) => {
        const nameStr = r.name ? `**${compactText(r.name, 32)}**` : '(unnamed)';
        const agentStr = compactText(r.agent, 32);
        const titleStr = compactText(r.title, 80);
        let line = `• ${nameStr} [${agentStr}] — ${titleStr}`;
        if (r.recentOutput?.trim()) {
          const lastLine = r.recentOutput.trim().split('\n').filter((l) => l.trim()).pop() ?? '';
          if (lastLine) line += `\n  › ${compactText(lastLine, 120)}`;
        }
        return line;
      });
      return {
        reply: `${running.length} agent${running.length === 1 ? '' : 's'} running:\n${lines.join('\n')}`,
        actions: [],
        viaLLM: false,
      };
    }
    return {
      reply: "Got it. Say the word \u2014 like \u201copen an agent and \u2026\u201d \u2014 whenever you want me to put one on it.",
      actions: [],
      viaLLM: false,
    };
  }

  const isQuestion = QUESTION_START_RE.test(text) || QUESTION_MARK_RE.test(text);
  const isExplicitSpawn = EXPLICIT_SPAWN_RE.test(text);
  const hasRealTask = ACTION_RE.test(message);

  // Pure "open/spawn/launch X agent" request with no real task → spawn idle.
  if (isExplicitSpawn && !hasRealTask) {
    return {
      reply: `Opening ${agent.name}. Its terminal will be ready for you.`,
      actions: [{ kind: 'spawn', agent: agent.command, prompt: null }],
      viaLLM: false,
    };
  }

  // Don't spawn an agent for a question — the heuristic isn't smart enough to
  // answer it, so fall back to a helpful prompt asking for an actionable goal.
  const actionable = !isQuestion && (hasRealTask || message.trim().length > 24);
  if (actionable) {
    return {
      reply: `On it — handing this to ${agent.name} to work on. You can watch it in its terminal.`,
      actions: [{ kind: 'spawn', agent: agent.command, prompt: message.trim() }],
      viaLLM: false,
    };
  }
  return {
    reply: isQuestion
      ? "I can help with that — but I need an AI provider configured to give a good answer. Set one up in Settings, or describe a coding task and I'll put an agent on it."
      : "Tell me what you'd like built, fixed, or changed and I'll put an agent on it.",
    actions: [],
    viaLLM: false,
  };
}

function buildSystemPrompt(
  agents: AgentChoice[],
  running: RunningAgentRef[],
  reviewing: RunningAgentRef[],
  conversational = false
): string {
  const list = agents.map((a) => `- ${a.command} — ${a.name}`).join('\n');
  const runningList = running.length
    ? running
        .map((r) => `- ${r.name ? `"${compactText(r.name, 48)}"` : '(unnamed)'} [${compactText(r.agent, 48)}] — working on: ${compactText(r.title, 120)}`)
        .join('\n')
    : '(none running)';
  const reviewingList = reviewing.length
    ? reviewing
        .map((r) => `- ${r.name ? `"${compactText(r.name, 48)}"` : '(unnamed)'} [${compactText(r.agent, 48)}] — awaiting review: ${compactText(r.title, 120)}`)
        .join('\n')
    : '(none awaiting review)';
  return [
    "You are Soryq's agent orchestrator. The user talks to you in natural language and you control a fleet of local terminal coding agents. You decide what to do this turn and craft precise, self-contained prompts for the agents.",
    '',
    'Available agent types (use the exact command id on the left when spawning):',
    list,
    '',
    'Currently running agents you can address by name:',
    runningList,
    'Recent terminal output for each running agent is shown in the user message.',
    '',
    'Tasks awaiting review that can be resumed automatically without approval:',
    reviewingList,
    '',
    'Respond with ONLY a single JSON object — no prose, no markdown, no code fences:',
    '{"reply": "<short friendly message to the user>", "actions": [ <zero or more action objects> ]}',
    '',
    'Each action is ONE of:',
    '- {"kind": "spawn", "agent": "<command id>", "prompt": "<full standalone prompt>" | null, "name": null}',
    '    Launch a NEW agent. Omit/null "prompt" to just open it idle and ready. Leave "name" null — the app auto-assigns a friendly human name (e.g. "Iris"). Only set "name" to echo a specific name the USER explicitly chose; never invent generic labels like "claude-1" or "agent 2".',
    '- {"kind": "send", "target": "<running agent name>", "prompt": "<full standalone prompt>"}',
    '    Give a new task to an agent that is ALREADY running. Use this instead of spawning when the user refers to an existing agent.',
    '- {"kind": "name", "target": "<running agent name or unnamed reference>", "name": "<new name>"}',
    '    Give a running agent a name (or rename it).',
    '- {"kind": "close", "target": "<running agent name, or \\"all\\">"}',
    '    Stop a running agent and close its terminal. Use when the user wants to close, stop, end, dismiss, release, or shut down an agent they are done with. "close everything"/"stop them all" → one close with target "all".',
    '',
    'Rules:',
    '- The actions array may contain MULTIPLE actions. "open two claude agents" → two spawn actions.',
    '- Each spawn/send prompt must be fully self-contained — the agent has NO access to this conversation.',
    '- If the user refers to a running agent (by name, "the first one", "that agent"), prefer send/name over spawning a duplicate.',
    '- If a task is awaiting review and the user wants more work, use send to resume it automatically instead of waiting for approval.',
    '- Use the task panel board in the user message as project truth. Prefer work that unblocks "In progress" items, then "To do" items. If the user asks for advice, suggest what should be done next and what can wait; use an empty actions array unless they explicitly ask you to act.',
    '- To shut an agent down that the user is finished with, use close (never spawn a new agent to "close" one).',
    '- If the user asks what an agent said, responded, wrote, outputted, or what its result/response/answer was — report it from the terminal output shown above. Use an EMPTY actions array. Never send a new message to the agent for this.',
    '- If the user asks whether something is done, still running, blocked, failed, or what the terminal says, answer from the recent agent/task status and terminal output. Use an EMPTY actions array unless they explicitly ask you to continue or change something.',
    '- If the user is only chatting, greeting, or you need clarification, use an empty actions array and answer in reply.',
    '- Prefer "claude" for general coding unless another agent is clearly better.',
    '- Keep reply to one or two sentences.',
    '- CRITICAL: "open/spawn/launch X agent" without a real task (e.g. "open Claude", "spawn Codex", "launch an agent") means spawn with null prompt. Do NOT use the user\'s message as the agent\'s prompt — the user just wants the agent opened and ready, not given a meaningless task.',
    '- Only include a real task prompt when the user describes actual work to do ("fix this bug", "build a login page", "refactor the router").',
    ...(conversational
      ? [
          '',
          'VOICE CONVERSATION MODE — IMPORTANT:',
          'You are in a spoken, back-and-forth conversation. The user is talking WITH you, not dictating commands. Conversation is the default; acting is the exception.',
          '- Default to an EMPTY actions array. Answer, discuss, acknowledge, and ask follow-up questions in "reply".',
          '- ONLY spawn/send/close an agent when the user EXPLICITLY and unambiguously asks you to — e.g. "open an agent and add X", "spawn claude to fix Y", "have an agent do Z". A direct imperative to act on the codebase counts; anything softer does not.',
          '- A question, an observation, thinking out loud, brainstorming, or describing a problem is NOT a request to spawn. When in any doubt, DO NOT act — just talk and, if useful, offer to put an agent on it.',
          '- Never spawn an agent merely because the message mentions code or a task. Wait for the explicit go-ahead.',
          '- Terminal output for running agents is shown above. Reference it in your replies: say what the agents just outputted, mention their last action, or summarize progress. Do NOT recite the raw output verbatim — paraphrase naturally.',
        ]
      : []),
  ].join('\n');
}


function snapAgent(raw: unknown, agents: AgentChoice[]): string | null {
  const agent = typeof raw === 'string' ? raw.trim() : '';
  if (!agent) return pickDefaultAgent(agents)?.command ?? null;
  // Exact command id is the happy path.
  const exact = agents.find((a) => a.command.toLowerCase() === agent.toLowerCase());
  if (exact) return exact.command;
  // The model may have returned a display name ("Codex CLI") or alias instead of
  // the command id — resolve it before falling back to the default.
  return resolveAgentCommand(agent, agents) ?? pickDefaultAgent(agents)?.command ?? null;
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function parseAction(raw: unknown, agents: AgentChoice[]): OrchestratorAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const kind = str(obj.kind);
  if (kind === 'spawn') {
    const agent = snapAgent(obj.agent, agents);
    if (!agent) return null;
    const prompt = str(obj.prompt);
    const name = str(obj.name);
    return { kind: 'spawn', agent, prompt: prompt || null, name: name || null };
  }
  if (kind === 'send') {
    const target = str(obj.target);
    const prompt = str(obj.prompt);
    if (!target || !prompt) return null;
    return { kind: 'send', target, prompt };
  }
  if (kind === 'name') {
    const target = str(obj.target);
    const name = str(obj.name);
    if (!target || !name) return null;
    return { kind: 'name', target, name };
  }
  if (kind === 'close') {
    const target = str(obj.target);
    if (!target) return null;
    return { kind: 'close', target };
  }
  return null;
}

function parseRouteJson(raw: string, agents: AgentChoice[]): RouteResult | null {
  const trimmed = raw.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1').trim();
  // Be lenient: grab the first {...} block if the model added stray text.
  const match = unfenced.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const reply = str(obj.reply);

  const actions: OrchestratorAction[] = [];
  if (Array.isArray(obj.actions)) {
    for (const entry of obj.actions) {
      const action = parseAction(entry, agents);
      if (action) actions.push(action);
    }
  } else if (obj.dispatch && typeof obj.dispatch === 'object') {
    // Back-compat: an older single-dispatch shape → one spawn action.
    const d = obj.dispatch as Record<string, unknown>;
    const agent = snapAgent(d.agent, agents);
    const prompt = str(d.prompt);
    if (agent && prompt) actions.push({ kind: 'spawn', agent, prompt, name: null });
  }

  if (!reply && actions.length === 0) return null;
  return { reply: reply || 'Working on it.', actions, viaLLM: true };
}

/**
 * Route a natural-language request to the agent fleet. Uses the configured AI
 * provider when available (smarter routing + a real reply); otherwise falls back
 * to a keyword heuristic so the orchestrator still works with no API key.
 */
export async function routeOrchestratorRequest(
  message: string,
  agents: AgentChoice[],
  ctx?: RouteContext
): Promise<RouteResult> {
  const trimmed = message.trim();

  // Fast-path: status check — respond instantly from live state, no LLM needed.
  if (STATUS_CHECK_RE.test(trimmed)) {
    return { reply: formatStatusReply(outputRefs(ctx)), actions: [], viaLLM: false };
  }

  // Fast-path: output query — user wants to read what an agent said/wrote.
  // Never send a new message; just surface the terminal output directly.
  if (OUTPUT_QUERY_RE.test(trimmed)) {
    return { reply: formatOutputReply(outputRefs(ctx), !!ctx?.conversational), actions: [], viaLLM: false };
  }

  if (TASK_ADVICE_RE.test(trimmed) && (ctx?.taskPanel?.length ?? 0) > 0) {
    return { reply: formatTaskPanelAdvice(ctx?.taskPanel ?? []), actions: [], viaLLM: false };
  }

  const provider = ctx?.llmConfig?.provider ?? get(aiProvider);
  const local = isLocalProvider(provider);
  const apiKey = ctx?.llmConfig?.apiKey ?? getProviderApiKeyLocal(provider) ?? '';
  const baseUrl = ctx?.llmConfig?.baseUrl ?? (local ? getProviderBaseUrl(provider) : '');
  const configured = local ? !!baseUrl : !!apiKey;

  if (configured) {
    const def = getProviderDef(provider);
    const primaryModel = ctx?.llmConfig?.model ?? get(currentAiModel);
    const modelsToTry = [primaryModel, ...def.models.map((m) => m.id).filter((id) => id !== primaryModel)];
    const systemPrompt = buildSystemPrompt(agents, ctx?.runningAgents ?? [], ctx?.reviewingAgents ?? [], ctx?.conversational);
    const userText = buildUserText(message, ctx);

    for (const model of modelsToTry) {
      try {
        const raw = await invoke<string>('ai_complete', {
          systemPrompt,
          userText,
          provider,
          model,
          apiKey,
          baseUrl: baseUrl || undefined,
        });
        const result = parseRouteJson(raw, agents);
        if (result) return result;
      } catch (error) {
        const msg = String(error ?? '');
        // No key / command missing (older binary) → stop trying the LLM.
        if (msg.includes('API key is not set') || msg.includes('not found') || msg.includes('not allowed')) {
          break;
        }
        console.warn(`Orchestrator routing failed with ${provider}/${model}:`, error);
      }
    }
  }

  return heuristicRoute(message, agents, ctx);
}
