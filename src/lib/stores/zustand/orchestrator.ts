import { create } from 'zustand';
import type { OrchestratorTask } from '$lib/services/orchestrator/task-lifecycle';
import { loadJson } from '$lib/utils/storage';

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  OrchestratorTask,
  OrchestratorTaskStatus,
} from '$lib/services/orchestrator/task-lifecycle';
export type { ActivityEvent, ActivityKind } from '$lib/services/orchestrator/activity-log';

export interface DispatchRef {
  taskId: string;
  agent: string;
  name?: string | null;
  /** 'spawn' opened a new agent; 'send' pushed to an existing one. */
  via: 'spawn' | 'send';
}

export interface CompletionSummary {
  /** 'done' | 'failed' | 'blocked' */
  status: 'done' | 'failed' | 'blocked';
  agentName: string;
  taskTitle: string;
  elapsedSec: number | null;
  reason?: string | null;
  /** AI-generated plain-English summary of what the agent did this turn. */
  summary?: string | null;
  /** True while the summary LLM call is in flight. */
  summaryPending?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  pending?: boolean;
  /** Agents this turn touched. Newer field; legacy single fields kept for old chats. */
  dispatched?: DispatchRef[];
  dispatchedTaskId?: string | null;
  dispatchedAgent?: string | null;
  /** Reconnaissance findings shown before dispatch. */
  reconSummary?: string | null;
  /** Structured agent completion summary card. */
  completion?: CompletionSummary | null;
}

// ─── State shape ────────────────────────────────────────────────────────────

const CHAT_STORAGE_KEY = 'soryq_orchestrator_chat';

function loadChat(): Record<string, ChatMessage[]> {
  return loadJson<Record<string, ChatMessage[]>>(CHAT_STORAGE_KEY, {});
}

interface OrchestratorState {
  orchestratorTasks: OrchestratorTask[];
  chatMessages: Record<string, ChatMessage[]>;
  agentCenterOpen: boolean;
  agentForcedAgent: string;
  agentVoiceModeActive: boolean;
  __set: <K extends keyof OrchestratorStateValueKeys>(key: K, value: OrchestratorStateValueKeys[K]) => void;
}

type OrchestratorStateValueKeys = Omit<OrchestratorState, '__set'>;

// ─── Store ──────────────────────────────────────────────────────────────────

export const useOrchestratorStore = create<OrchestratorState>((set) => ({
  orchestratorTasks: [],
  chatMessages: loadChat(),
  agentCenterOpen: false,
  agentForcedAgent: 'auto',
  agentVoiceModeActive: false,
  __set: (key, value) => set({ [key]: value }),
}));
