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

export interface RouteContext {
  projectName?: string;
  recentUserMessages?: string[];
  taskMemory?: string[];
  runningAgents?: RunningAgentRef[];
  reviewingAgents?: RunningAgentRef[];
  llmConfig?: RouteLlmConfig;
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
  const memory = (ctx?.taskMemory ?? []).slice(-5);
  if (memory.length) {
    parts.push('Recent task activity:');
    for (const line of memory) parts.push(`- ${compactText(line, 240)}`);
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

// Status-check patterns — intercepted before the LLM so we respond instantly.
const STATUS_CHECK_RE = /^(status|what[‘’]?s running|list agents|show agents|which agents|what agents are running|show me the agents|what are (?:my |the )?agents doing)\b/i;

// Output-query patterns — user wants to see what an agent said/wrote/outputted.
// Intercept before routing so we never send a new message to the agent.
const OUTPUT_QUERY_RE =
  /^(what did|what has|what[‘’]?s|show me what|get|fetch|read|check|see what)\b.{0,60}\b(said?|respond(?:ed)?|wrot[eo]|output(?:ted)?|result(?:s)?|response|reply|answer|return(?:ed)?|produc(?:ed)?|finish(?:ed)?|complet(?:ed)?|done)\b/i;

function pickDefaultAgent(agents: AgentChoice[]): AgentChoice | null {
  return agents.find((a) => a.command === 'claude') ?? agents[0] ?? null;
}

/** Find a running agent the message names, so heuristic close can target it. */
function matchRunningName(message: string, running: RunningAgentRef[]): string | null {
  const lower = message.toLowerCase();
  for (const r of running) {
    if (r.name && lower.includes(r.name.toLowerCase())) return r.name;
  }
  return null;
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

  const agent = pickDefaultAgent(agents);
  if (!agent) {
    return { reply: 'No agents are configured for this project yet.', actions: [], viaLLM: false };
  }

  // Don't spawn an agent for a question — the heuristic isn't smart enough to
  // answer it, so fall back to a helpful prompt asking for an actionable goal.
  const isQuestion = QUESTION_START_RE.test(text) || QUESTION_MARK_RE.test(text);
  const actionable = !isQuestion && (ACTION_RE.test(message) || message.trim().length > 24);
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
  reviewing: RunningAgentRef[]
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
    '- To shut an agent down that the user is finished with, use close (never spawn a new agent to "close" one).',
    '- If the user asks what an agent said, responded, wrote, outputted, or what its result/response/answer was — report it from the terminal output shown above. Use an EMPTY actions array. Never send a new message to the agent for this.',
    '- If the user is only chatting, greeting, or you need clarification, use an empty actions array and answer in reply.',
    '- Prefer "claude" for general coding unless another agent is clearly better.',
    '- Keep reply to one or two sentences.',
  ].join('\n');
}


function snapAgent(raw: unknown, agents: AgentChoice[]): string | null {
  const agent = typeof raw === 'string' ? raw.trim() : '';
  if (!agent) return pickDefaultAgent(agents)?.command ?? null;
  // Snap to a known agent; if the model invented one, fall back to the default.
  return agents.find((a) => a.command === agent)?.command ?? pickDefaultAgent(agents)?.command ?? null;
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
    const running = ctx?.runningAgents ?? [];
    if (running.length === 0) {
      return { reply: 'No agents are currently running.', actions: [], viaLLM: false };
    }
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
    const reply = `${running.length} agent${running.length === 1 ? '' : 's'} running:\n${lines.join('\n')}`;
    return { reply, actions: [], viaLLM: false };
  }

  // Fast-path: output query — user wants to read what an agent said/wrote.
  // Never send a new message; just surface the terminal output directly.
  if (OUTPUT_QUERY_RE.test(trimmed)) {
    const running = ctx?.runningAgents ?? [];
    if (running.length === 0) {
      return { reply: 'No agents are currently running — nothing to read yet.', actions: [], viaLLM: false };
    }
    const parts = running
      .filter((r) => r.recentOutput?.trim())
      .map((r) => {
        const nameStr = r.name ? `**${compactText(r.name, 32)}**` : '(unnamed)';
        const output = r.recentOutput!.trim().split('\n').slice(-20).join('\n');
        return `${nameStr}:\n\`\`\`\n${output}\n\`\`\``;
      });
    if (parts.length === 0) {
      const names = running.map((r) => r.name ? `**${r.name}**` : '(unnamed)').join(', ');
      return { reply: `${names} ${running.length === 1 ? 'hasn\'t' : 'haven\'t'} produced any output yet.`, actions: [], viaLLM: false };
    }
    return { reply: parts.join('\n\n'), actions: [], viaLLM: false };
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
    const systemPrompt = buildSystemPrompt(agents, ctx?.runningAgents ?? [], ctx?.reviewingAgents ?? []);
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
