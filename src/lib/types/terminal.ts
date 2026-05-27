export interface TerminalSessionInfo {
  id: number;
  title: string;
  isRunning: boolean;
  agentPreset?: string | null;
  lastActivatedAt?: number;
}
