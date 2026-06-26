import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { get } from '$lib/stores/storeCompat';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  activeSessionId,
  manualPromptTargetId,
  sessions,
  commandHistory,
  addHistoryEntry,
  setSessionExecuting,
  setSessionTaskSummary,
  summarizeTerminalTask,
  startCommandBlock,
  promptBarInput,
  promptBarImage,
  promptBarFocusRequest,
  promptBarVoiceModeRequest,
  activateSessionInPane,
  sendPromptToSession,
  getSessionLabel,
  getSessionPromptTargetLabel,
  isAgentSession,
  spawnAgentPreset,
  setSessionWorktree,
} from '$lib/stores/terminal';
import { getPresetRuns } from '$lib/stores/runs';
import { customAgents, removedPresetAgents } from '$lib/stores/customAgents';
import { pickAssistantName } from '$lib/services/orchestrator/agent-names';
import { createTaskWorktree, removeTaskWorktree } from '$lib/services/orchestrator/worktree-manager';
import { applyOrchestratorAgentName } from '$lib/services/orchestrator/terminal-lease';
import { showToast } from '$lib/stores/notification';
import { createVoiceInputSession, mergeVoiceTranscript } from '$lib/services/voice-input';
import { refineVoicePrompt } from '$lib/services/voice-refinement';
import { isTauriRuntime } from '$lib/utils/tauri';
import { activeProject } from '$lib/stores/workspace';
import {
  orchestratorTasks,
  sendChatMessage,
  chatMessages,
  agentCenterOpen,
  agentForcedAgent,
  agentVoiceModeActive,
  type ChatMessage,
} from '$lib/stores/orchestrator';
import { describeTtsError, getVoiceReplyConfigError, speak, stopSpeaking, warmupLocalTts } from '$lib/services/tts';
import { openSettings } from '$lib/stores/layout';
import { requestRoomControl } from '$lib/stores/layoutControl';
import { addRunEntry } from '$lib/stores/runHistory';
import { isImagePath, getImageMimeType } from '$lib/stores/editor';
import { useStore } from '$lib/react/useStore';
import '$lib/components/orchestrator/VoiceConversationOverlay.css';
import './FloatingPromptBar.css';

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
  const c = (NUM_BARS - 1) / 2;
  const d = Math.abs(i - c) / c;
  const max = (0.22 + (1 - d * d) * 0.78).toFixed(2);
  return {
    ['--dur']: `${dur}ms`,
    ['--dly']: `${dly}ms`,
    ['--max']: max,
  } as CSSProperties;
}

// Per-project state cache
const barProjectCache = new Map<string, { inputValue: string; manualTargetId: number | null }>();

// `diskPath` is set when the image already exists on disk (attached via the
// file picker) so submitPrompt can reference it directly instead of re-saving
// a fresh copy — the agent then reads the exact file the user picked.
type PastedImage = { objectUrl: string; dataUrl: string; name: string; diskPath?: string };

// Map a clipboard image MIME type to a clean file extension. Splitting on "/"
// alone mangles compound subtypes (e.g. "image/svg+xml" -> "svgxml"), which
// would write a file with a bogus extension the agent can't open.
function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/apng': return 'apng';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/bmp': return 'bmp';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon': return 'ico';
    case 'image/svg+xml': return 'svg';
    case 'image/avif': return 'avif';
    case 'image/tiff': return 'tif';
    default: {
      const sub = (mime.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase();
      return sub || 'png';
    }
  }
}

// Decode a data: URL into raw bytes locally. We deliberately avoid
// `fetch(dataUrl)` here: Chromium routes fetches of data: URLs through the
// `connect-src` CSP directive, which doesn't allow `data:` — so fetch throws
// and the pasted image is silently dropped before it ever reaches the agent.
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return new Uint8Array();
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const raw = meta.includes(';base64') ? atob(body) : decodeURIComponent(body);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/#+\s+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function speechTextForAssistantMessage(message: ChatMessage): string {
  if (message.completion) {
    const c = message.completion;
    const status =
      c.status === 'done' ? 'finished' :
      c.status === 'failed' ? 'failed' :
      'needs your input';
    const pieces = [
      `${c.agentName} ${status}: ${c.taskTitle}.`,
      c.reason ? `Reason: ${c.reason}.` : '',
      c.summary ? c.summary : c.summaryPending ? 'I am still summarizing the terminal output.' : '',
    ];
    return pieces.filter(Boolean).join(' ');
  }
  return message.text;
}

function speechKeyForAssistantMessage(message: ChatMessage): string {
  const spoken = stripMarkdown(speechTextForAssistantMessage(message).split('\n\n🔍')[0]);
  return `${message.id}:${spoken}`;
}

function useSyncedState<T>(initialValue: T) {
  const [value, setValueState] = useState(initialValue);
  const valueRef = useRef(value);
  const setValue = useCallback((next: T | ((current: T) => T)) => {
    const resolved = typeof next === 'function'
      ? (next as (current: T) => T)(valueRef.current)
      : next;
    valueRef.current = resolved;
    setValueState(resolved);
  }, []);
  return [value, setValue, valueRef] as const;
}

export default function FloatingPromptBar() {
  const $activeSessionId = useStore(activeSessionId);
  const $manualPromptTargetId = useStore(manualPromptTargetId);
  const $sessions = useStore(sessions);
  const $commandHistory = useStore(commandHistory);
  const $customAgents = useStore(customAgents);
  const $removedPresetAgents = useStore(removedPresetAgents);
  const $activeProject = useStore(activeProject);
  const $orchestratorTasks = useStore(orchestratorTasks);
  const $chatMessages = useStore(chatMessages);
  const $agentCenterOpen = useStore(agentCenterOpen);
  const $promptBarInput = useStore(promptBarInput);
  const $promptBarImage = useStore(promptBarImage);
  const $promptBarFocusRequest = useStore(promptBarFocusRequest);
  const $promptBarVoiceModeRequest = useStore(promptBarVoiceModeRequest);

  const lastBarProjectIdRef = useRef<string | null>(null);

  const [inputValue, setInputValue, inputValueRef] = useSyncedState('');
  const inputElRef = useRef<HTMLTextAreaElement | null>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftBeforeHistoryRef = useRef('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isListening, setIsListening, isListeningRef] = useSyncedState(false);
  const [isRefining, setIsRefining, isRefiningRef] = useSyncedState(false);
  const [voiceLocked, setVoiceLocked] = useSyncedState(false);
  const [voiceHeld, setVoiceHeld] = useSyncedState(false);
  const [voiceStopping, setVoiceStopping, voiceStoppingRef] = useSyncedState(false);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnCounts, setSpawnCounts] = useState<Map<string, number>>(new Map());
  const totalSpawnCount = useMemo(
    () => Array.from(spawnCounts.values()).reduce((a, b) => a + b, 0),
    [spawnCounts]
  );
  const shellElRef = useRef<HTMLDivElement | null>(null);
  const barElRef = useRef<HTMLDivElement | null>(null);
  const [draggedExplorerPath, setDraggedExplorerPath] = useState<string | null>(null);
  const [lastExplorerDragPoint, setLastExplorerDragPoint] = useState<{ x: number; y: number } | null>(null);
  const [, setIsHovered] = useState(false);
  const [, setIsFocused] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isGlobalFileDrag, setIsGlobalFileDrag] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const voiceDraftBaseRef = useRef('');
  const [voiceDraftText, setVoiceDraftText, voiceDraftTextRef] = useSyncedState('');
  const [isAgentMode, setIsAgentMode] = useState(true);
  const prevoiceCenterRef = useRef(false);
  const voiceHeldRef = useRef(false);
  const [agentSending, setAgentSending, agentSendingRef] = useSyncedState(false);
  const [voiceModeActive, setVoiceModeActive, voiceModeActiveRef] = useSyncedState(false);
  const [isTtsSpeaking, setIsTtsSpeaking, isTtsSpeakingRef] = useSyncedState(false);
  const lastSpokenMessageKeyRef = useRef<string | null>(null);
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);

  const hasPromptText = inputValue.trim().length > 0;
  const isActive = true;

  const waitingTaskCount = useMemo(
    () => $orchestratorTasks.filter(
      (t) => t.projectId === ($activeProject?.id ?? '') && t.status === 'blocked'
    ).length,
    [$orchestratorTasks, $activeProject]
  );

  const projectChatMessages = useMemo(
    () => $chatMessages[$activeProject?.id ?? ''] ?? [],
    [$chatMessages, $activeProject]
  );

  const isVoiceActive = isAgentMode && voiceModeActive;

  const lastAssistantRaw = useMemo(() => {
    const msg = [...projectChatMessages].reverse().find((m) => m.role === 'assistant' && !m.pending);
    return msg ? speechTextForAssistantMessage(msg) : '';
  }, [projectChatMessages]);

  const lastAssistantDisplay = useMemo(() => {
    if (lastAssistantRaw.length === 0) return '';
    return lastAssistantRaw
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/#+\s+/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 160);
  }, [lastAssistantRaw]);

  // Reading customAgents + removedPresetAgents keeps this reactive:
  // adding/removing/hiding agents in Settings re-derives the spawn list.
  const spawnPresets = useMemo(() => {
    void $customAgents;
    void $removedPresetAgents;
    if (!$activeProject) return [];
    return getPresetRuns($activeProject.id).filter((r) => r.isAgent);
  }, [$customAgents, $removedPresetAgents, $activeProject]);

  const activeTerminal = useMemo(
    () => $sessions.find((session) => session.id === $activeSessionId) ?? null,
    [$sessions, $activeSessionId]
  );
  const preferredAgentTerminal = useMemo(
    () => (
      isAgentSession(activeTerminal)
        ? activeTerminal
        : ($sessions
            .filter((session) => session.isRunning && isAgentSession(session))
            .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))[0] ?? null)
    ),
    [activeTerminal, $sessions]
  );
  // Prefer a running agent as the target so a terminal-mode prompt reaches an
  // agent for a response (routing it through the auto-submitting paste path)
  // instead of running as a command in whatever shell pane happens to be focused.
  // `preferredAgentTerminal` already returns the focused pane when it's itself an
  // agent, so this still respects "the agent I'm looking at"; it only overrides a
  // non-agent active pane, and falls back to that shell when no agent is running.
  const autoTarget = preferredAgentTerminal ?? activeTerminal;
  const manualTarget = useMemo(
    () => ($manualPromptTargetId !== null
      ? ($sessions.find((s) => s.id === $manualPromptTargetId && s.isRunning) ?? null)
      : null),
    [$manualPromptTargetId, $sessions]
  );
  const promptTarget = manualTarget ?? autoTarget;
  // "Pinned" only when the user deliberately targets a terminal other than the
  // active one (via the picker). Focusing a pane keeps target === active = auto.
  const isPinned = $manualPromptTargetId !== null && $manualPromptTargetId !== $activeSessionId;
  const runningSessions = useMemo(() => $sessions.filter((s) => s.isRunning), [$sessions]);
  const historyItems = useMemo(() => ($commandHistory || []).slice(0, 12), [$commandHistory]);
  const canSend = isAgentMode
    ? Boolean($activeProject) && !agentSending
    : Boolean(promptTarget?.isRunning);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputElRef.current?.focus());
  }, []);

  const adjustInputHeight = useCallback(() => {
    const inputEl = inputElRef.current;
    if (!inputEl) return;
    if (!inputEl.value) {
      inputEl.style.height = '24px';
      return;
    }
    inputEl.style.height = '0px';
    const nextHeight = Math.min(inputEl.scrollHeight, 100);
    inputEl.style.height = `${Math.max(nextHeight, 24)}px`;
  }, []);

  const resetHistoryCursor = useCallback(() => {
    setHistoryIndex(-1);
    draftBeforeHistoryRef.current = '';
  }, []);

  // Per-project state: save/restore inputValue and pinned target when project changes
  useEffect(() => {
    const projectId = $activeProject?.id ?? null;
    if (projectId === lastBarProjectIdRef.current) return;

    if (lastBarProjectIdRef.current !== null) {
      barProjectCache.set(lastBarProjectIdRef.current, { inputValue, manualTargetId: get(manualPromptTargetId) });
    }

    if (projectId !== null) {
      const cached = barProjectCache.get(projectId);
      setInputValue(cached?.inputValue ?? '');
      const sessionAlive = cached?.manualTargetId != null &&
        get(sessions).some((s) => s.id === cached.manualTargetId && s.isRunning);
      manualPromptTargetId.set(sessionAlive ? (cached?.manualTargetId ?? null) : null);
    } else {
      setInputValue('');
      manualPromptTargetId.set(null);
    }

    lastBarProjectIdRef.current = projectId;
    setHistoryIndex(-1);
    draftBeforeHistoryRef.current = '';
    setHistoryOpen(false);
    setTargetPickerOpen(false);
    setSpawnOpen(false);
    setSpawnCounts(new Map());
    requestAnimationFrame(adjustInputHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [$activeProject]);

  // Clear manual pin if the session dies
  useEffect(() => {
    if ($manualPromptTargetId !== null && !$sessions.find((s) => s.id === $manualPromptTargetId && s.isRunning)) {
      manualPromptTargetId.set(null);
    }
  }, [$manualPromptTargetId, $sessions]);

  const selectTarget = useCallback((id: number) => {
    manualPromptTargetId.set(id);
    setTargetPickerOpen(false);
    focusInput();
  }, [focusInput]);

  const toggleTargetPicker = useCallback(() => {
    setTargetPickerOpen((v) => !v);
    setHistoryOpen(false);
    setSpawnOpen(false);
  }, []);

  const resolvePromptTarget = useCallback(() => {
    const allSessions = get(sessions);
    const pinnedId = get(manualPromptTargetId);
    if (pinnedId !== null) {
      const manual = allSessions.find((s) => s.id === pinnedId && s.isRunning);
      if (manual) return manual;
    }
    const currentActiveSessionId = get(activeSessionId);
    const currentActiveTerminal = allSessions.find((session) => session.id === currentActiveSessionId) ?? null;
    // The focused pane wins only when it's itself an agent (the one you're looking
    // at). Otherwise prefer the most recently used running agent over a non-agent
    // active pane, so the prompt actually reaches an agent for a response (and
    // takes the auto-submitting paste path) instead of running as a shell command.
    // Falls back to the focused shell only when no agent is running.
    if (currentActiveTerminal && isAgentSession(currentActiveTerminal)) return currentActiveTerminal;
    const runningAgent = allSessions
      .filter((session) => session.isRunning && isAgentSession(session))
      .sort((a, b) => (b.lastActivatedAt ?? 0) - (a.lastActivatedAt ?? 0))[0] ?? null;
    return runningAgent ?? currentActiveTerminal;
  }, []);

  const openPromptBar = useCallback(() => {
    setIsExpanded(true);
    setIsFocused(true);
    focusInput();
  }, [focusInput]);

  const canStayOpen = useCallback(() => {
    return hasPromptText || historyOpen || targetPickerOpen || spawnOpen || isListening || isRefining || isDragOver || (!draggedExplorerPath && isGlobalFileDrag) || voiceModeActive;
  }, [hasPromptText, historyOpen, targetPickerOpen, spawnOpen, isListening, isRefining, isDragOver, draggedExplorerPath, isGlobalFileDrag, voiceModeActive]);

  const enterAgentMode = useCallback(() => {
    if (isAgentMode) {
      focusInput();
      return;
    }
    setIsAgentMode(true);
    if (projectChatMessages.length > 0 || waitingTaskCount > 0) {
      agentCenterOpen.set(true);
    }
    setHistoryOpen(false);
    setTargetPickerOpen(false);
    setSpawnOpen(false);
    focusInput();
  }, [isAgentMode, projectChatMessages, waitingTaskCount, focusInput]);

  const handleShellFocusOut = useCallback((event: React.FocusEvent) => {
    setIsFocused(false);
    const next = event.relatedTarget as Node | null;
    if (shellElRef.current && next && shellElRef.current.contains(next)) return;
    if (!canStayOpen()) setIsExpanded(false);
  }, [canStayOpen]);

  const sendPromptToTarget = useCallback((sessionId: number, text: string, agentPreset?: string | null) => {
    sendPromptToSession(sessionId, text, agentPreset);
  }, []);

  const incrementSpawn = useCallback((command: string) => {
    setSpawnCounts((prev) => {
      const next = new Map(prev);
      next.set(command, (next.get(command) ?? 0) + 1);
      return next;
    });
  }, []);

  const decrementSpawn = useCallback((command: string) => {
    setSpawnCounts((prev) => {
      const next = new Map(prev);
      const count = next.get(command) ?? 0;
      if (count <= 1) {
        next.delete(command);
      } else {
        next.set(command, count - 1);
      }
      return next;
    });
  }, []);

  // Spawn the selected agents into terminal panes. Each spawned agent gets a
  // friendly assistant name (same pool as orchestrator agents, so it's easy to
  // address) and receives the standing operating brief automatically — the
  // agent-charter auto-brief fires once the CLI is ready, and it reads the
  // name set here so the charter opens with "you are <name>".
  const handleSpawnConfirm = useCallback(async () => {
    const entries = Array.from(spawnCounts.entries()).filter(([, count]) => count > 0);
    if (!entries.length) return;
    setSpawnOpen(false);
    setSpawnCounts(new Map());
    const cwd = $activeProject?.root_path;
    const projectId = $activeProject?.id;
    const takenNames = get(sessions)
      .filter((s) => s.isRunning && s.agentName)
      .map((s) => s.agentName as string);
    let lastId: number | null = null;
    let total = 0;
    const spawnedNames: string[] = [];
    for (const [cmd, count] of entries) {
      for (let i = 0; i < count; i++) {
        // Pick the name up front so the agent's isolated worktree branch carries
        // it (e.g. soryq/iris-…). Each agent gets its own worktree so several can
        // edit the same project at once; non-git projects fall back to the root.
        const name = pickAssistantName(takenNames);
        let worktree = projectId
          ? await createTaskWorktree({
              projectId,
              taskId: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              label: name,
            })
          : null;
        let id = await spawnAgentPreset(cmd, worktree?.path ?? cwd);
        // If the isolated worktree couldn't start a shell, don't fail the spawn —
        // drop the worktree and retry in the project root so the agent still opens
        // (it just shares the working tree, like before isolation).
        if (id === null && worktree) {
          if (projectId) void removeTaskWorktree(projectId, worktree, false);
          worktree = null;
          id = await spawnAgentPreset(cmd, cwd);
        }
        if (id !== null) {
          takenNames.push(name);
          applyOrchestratorAgentName(id, name);
          if (worktree) setSessionWorktree(id, worktree);
          spawnedNames.push(name);
          lastId = id;
          total++;
        } else if (worktree && projectId) {
          // Spawn failed entirely — don't leave an orphaned worktree behind.
          void removeTaskWorktree(projectId, worktree, false);
        }
      }
    }
    if (!total) {
      showToast(
        projectId ? "Couldn't start the agent — see the console for details" : 'Open a project first to spawn an agent',
        'warning'
      );
      return;
    }
    // In terminal mode, point the prompt bar at the freshly spawned agent. Agent
    // mode keeps its own routing, so don't pin a manual target from there.
    if (lastId !== null && !isAgentMode) manualPromptTargetId.set(lastId);
    showToast(
      total === 1 ? `Spawned ${spawnedNames[0]}` : `Spawned ${total} agents: ${spawnedNames.join(', ')}`,
      'info',
      undefined,
      true
    );
    focusInput();
  }, [spawnCounts, $activeProject, isAgentMode, focusInput]);

  const saveImageToDisk = useCallback(async (img: PastedImage, projectPath: string): Promise<string | null> => {
    try {
      // Normalise to forward slashes so the path the agent CLI receives is clean
      // and unambiguous — mixed back/forward slashes can trip up TUI path parsing.
      const root = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
      const savePath = `${root}/.soryq/attachments/${img.name}`;
      const data = Array.from(dataUrlToBytes(img.dataUrl));
      await invoke('fs_write_binary', { path: savePath, data });
      return savePath;
    } catch (error) {
      console.error('Failed to save pasted image to disk:', error);
      return null;
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setPastedImages((prev) => {
      const img = prev[index];
      if (img) URL.revokeObjectURL(img.objectUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith('image/'));
    if (!imageItems.length) return;
    e.preventDefault();
    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (!blob) continue;
      // Unique name (timestamp + random) so two images pasted at once never
      // collide; keep the real extension so the agent reads the right format.
      const ext = extensionForMime(item.type);
      const name = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const objectUrl = URL.createObjectURL(blob);
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      setPastedImages((prev) => [...prev, { objectUrl, dataUrl, name }]);
    }
  }, []);

  // Write any attached/pasted images to disk and return their on-disk paths,
  // so both the agent-chat path and the terminal path can fold attachments into
  // the message text identically. `ok` is false only when saving was needed but
  // no project is open to hold .soryq/attachments — the caller should abort then.
  const materializeAttachments = useCallback(async (): Promise<{ paths: string[]; ok: boolean }> => {
    if (pastedImages.length === 0) return { paths: [], ok: true };
    const toSave = [...pastedImages];
    // Only images without an on-disk path need to be written, which requires a
    // project to hold the .soryq/attachments folder. Picked-from-disk images
    // already have a path and can be sent even with no project open.
    const needsSave = toSave.some((img) => !img.diskPath);
    const projectPath = get(activeProject)?.root_path;
    if (needsSave && !projectPath) {
      showToast('Open a project before attaching images', 'warning');
      return { paths: [], ok: false };
    }
    setPastedImages([]);
    const paths = await Promise.all(
      toSave.map((img) =>
        img.diskPath
          ? Promise.resolve(img.diskPath.replace(/\\/g, '/'))
          : saveImageToDisk(img, projectPath as string)
      )
    );
    const validPaths = paths.filter(Boolean) as string[];
    const failedCount = toSave.length - validPaths.length;
    if (failedCount > 0) {
      showToast(
        failedCount === toSave.length
          ? `Couldn't attach ${toSave.length === 1 ? 'the image' : 'the images'}`
          : `Couldn't attach ${failedCount} of ${toSave.length} images`,
        'error'
      );
    }
    toSave.forEach((img) => URL.revokeObjectURL(img.objectUrl));
    return { paths: validPaths, ok: true };
  }, [pastedImages, saveImageToDisk]);

  // Quote only paths with spaces — matches attachPathsToInput and is friendlier
  // to agent TUIs than always-single-quoting (which leaves literal quotes the
  // CLI then can't open).
  const appendAttachmentPaths = useCallback((text: string, paths: string[]): string => {
    if (!paths.length) return text;
    const quoted = paths.map((p) => (p.includes(' ') ? `"${p}"` : p)).join(' ');
    return text ? `${text} ${quoted}` : quoted;
  }, []);

  // Single source of truth for "should the mic come back on now?" in the
  // conversational voice loop. Every terminal point of a turn (dispatch done,
  // speech done, a transcript that errored out) funnels through here instead of
  // repeating the guard, so the loop can never get wedged with the mic off while
  // nothing else is running. The internal guards in voiceInput.start() make a
  // redundant call from two racing finalizers a harmless no-op.
  const resumeVoiceLoopRef = useRef<() => void>(() => {});

  const submitAgentMessageRef = useRef<(textOverride?: string) => Promise<void>>(async () => {});

  useEffect(() => {
    resumeVoiceLoopRef.current = () => {
      if (
        voiceModeActiveRef.current &&
        isAgentModeRef.current &&
        !voiceStoppingRef.current &&
        !isTtsSpeakingRef.current &&
        !isListeningRef.current &&
        !isRefiningRef.current &&
        !agentSendingRef.current
      ) {
        void voiceInput.start();
      }
    };
  });

  const speakResponse = useCallback(async (text: string) => {
    // Drop the transient "🔍 Analyzing codebase…" status the orchestrator appends
    // to the reply while reconnaissance runs — we only want to speak the reply.
    const clean = stripMarkdown(text.split('\n\n🔍')[0]);
    if (!clean || clean.length < 3) {
      setIsTtsSpeaking(false);
      resumeVoiceLoopRef.current();
      return;
    }
    try {
      await speak(clean);
    } catch (error) {
      if (voiceModeActive) showToast(describeTtsError(error), 'error');
    } finally {
      setIsTtsSpeaking(false);
      resumeVoiceLoopRef.current();
    }
  }, [voiceModeActive]);

  const stopAgentVoice = useCallback(() => {
    setVoiceModeActive(false);
    agentVoiceModeActive.set(false);
    setIsTtsSpeaking(false);
    lastSpokenMessageKeyRef.current = null;
    stopSpeaking();
    // Restore the command center to exactly its pre-voice state (open or closed)
    // so leaving voice mode is predictable rather than leaving it stuck open.
    agentCenterOpen.set(prevoiceCenterRef.current);
    setVoiceLocked(false);
    setVoiceHeld(false);
    setVoiceStopping(true);
    voiceInput.stop();
    focusInput();
  }, [focusInput]);

  const toggleAgentVoiceMode = useCallback(() => {
    if (voiceModeActive) { stopAgentVoice(); return; }
    const replyVoiceError = getVoiceReplyConfigError();
    if (replyVoiceError) {
      showToast(replyVoiceError, 'warning');
      openSettings();
      return;
    }
    prevoiceCenterRef.current = get(agentCenterOpen);
    agentCenterOpen.set(false);
    // Seed with the current last assistant message so entering voice mode opens
    // straight into listening instead of re-speaking the reply already on screen.
    const lastMsg = projectChatMessages.at(-1);
    lastSpokenMessageKeyRef.current = lastMsg && lastMsg.role === 'assistant' && !lastMsg.pending ? speechKeyForAssistantMessage(lastMsg) : null;
    setVoiceModeActive(true);
    agentVoiceModeActive.set(true);
    // Warm the local speech engine now so the first reply isn't stalled on a
    // cold WASM/ONNX start (no-op for cloud providers).
    warmupLocalTts();
    void voiceInput.start();
  }, [voiceModeActive, stopAgentVoice, projectChatMessages]);

  const launchAgentVoiceMode = useCallback(() => {
    openPromptBar();
    enterAgentMode();
    if (!voiceModeActive) {
      toggleAgentVoiceMode();
    }
  }, [openPromptBar, enterAgentMode, voiceModeActive, toggleAgentVoiceMode]);

  const toggleAgentMode = useCallback(() => {
    if (isAgentMode) {
      if (voiceModeActive) stopAgentVoice();
      agentCenterOpen.set(false);
      setIsAgentMode(false);
      focusInput();
      return;
    }
    enterAgentMode();
  }, [isAgentMode, voiceModeActive, stopAgentVoice, focusInput, enterAgentMode]);

  const submitAgentMessage = useCallback(async (textOverride?: string) => {
    if (!$activeProject || agentSendingRef.current) return;
    const { paths, ok } = await materializeAttachments();
    if (!ok) return;
    const promptText = (textOverride ?? inputValueRef.current).trim();
    const finalText = appendAttachmentPaths(promptText, paths);
    if (!finalText) return;
    setInputValue('');
    // In voice mode the orb overlay owns the screen, so don't pop the command
    // center open behind it — stopAgentVoice restores its prior state on exit.
    if (!voiceModeActive) {
      agentCenterOpen.set(true);
      requestRoomControl('focus', 'orchestrator');
    }
    setAgentSending(true);
    try {
      await sendChatMessage($activeProject.id, $activeProject.root_path, finalText, {
        forcedAgent: get(agentForcedAgent),
        voiceConversation: voiceModeActiveRef.current,
      });
    } finally {
      setAgentSending(false);
      // Resume listening once dispatch finishes if the spoken reply already ended
      // (TTS may run and complete during the background recon/spawn above). If TTS
      // is still playing, speakResponse's finally handles the restart instead.
      resumeVoiceLoopRef.current();
    }
    resetHistoryCursor();
      requestAnimationFrame(adjustInputHeight);
      focusInput();
  }, [$activeProject, materializeAttachments, appendAttachmentPaths, inputValueRef, voiceModeActive, resetHistoryCursor, adjustInputHeight, focusInput]);

  useEffect(() => {
    submitAgentMessageRef.current = submitAgentMessage;
  }, [submitAgentMessage]);

  // Auto-speak new assistant messages in agent voice mode.
  // Deliberately NOT gated on `agentSending`: the conversational reply is ready
  // the moment routing finishes (well before recon + spawn + dispatch complete),
  // so speaking it immediately removes seconds of dead air. Background dispatch
  // keeps running while TTS plays; the mic resumes when dispatch finishes
  // (see submitAgentMessage's finally) or when TTS ends (see speakResponse).
  useEffect(() => {
    if (!voiceModeActive || !isAgentMode || isTtsSpeaking) return;
    const lastMsg = projectChatMessages.at(-1);
    if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.pending) return;
    // Agent-completion recaps are announced (as a short status line) by the
    // orchestrator's completion path so they work even when this overlay is
    // closed; skip them here so a completion is never spoken twice.
    if (lastMsg.completion) return;
    const speechKey = speechKeyForAssistantMessage(lastMsg);
    if (speechKey === lastSpokenMessageKeyRef.current) return;
    lastSpokenMessageKeyRef.current = speechKey;
    setIsTtsSpeaking(true);
    void speakResponse(speechTextForAssistantMessage(lastMsg));
  }, [voiceModeActive, isAgentMode, isTtsSpeaking, projectChatMessages, speakResponse]);

  // Auto-open agent center when waiting tasks arrive (if in agent mode and not in voice mode)
  useEffect(() => {
    if (!isAgentMode || voiceModeActive) return;
    if (waitingTaskCount > 0) agentCenterOpen.set(true);
  }, [isAgentMode, voiceModeActive, waitingTaskCount]);

  const submitPrompt = useCallback(async () => {
    if (isAgentMode) { await submitAgentMessage(); return; }
    if (!inputValue.trim() && pastedImages.length === 0) return;

    const { paths, ok } = await materializeAttachments();
    if (!ok) return;
    const finalText = appendAttachmentPaths(inputValue.trim(), paths);
    if (!finalText) return;

    const target = resolvePromptTarget();
    if (!target) {
      showToast('No active terminal available', 'warning');
      return;
    }

    activateSessionInPane(target.id);
    if (!target.agentPreset) {
      requestRoomControl('focus', 'terminal');
    }
    const taskSummary = summarizeTerminalTask(finalText);
    sendPromptToTarget(target.id, finalText, target.agentPreset);
    setSessionExecuting(target.id, true);
    setSessionTaskSummary(target.id, taskSummary || null);
    startCommandBlock(target.id, finalText);
    addRunEntry({
      command: finalText,
      sessionId: target.id,
      sessionRole: target.role ?? null,
      sessionLabel: getSessionLabel(target, $sessions),
      agentPreset: target.agentPreset ?? null,
      projectId: $activeProject?.id ?? '',
      startedAt: Date.now(),
    });
    addHistoryEntry(finalText);

    setInputValue('');
    setIsExpanded(false);
    setHistoryOpen(false);
    resetHistoryCursor();
    requestAnimationFrame(adjustInputHeight);
    focusInput();
    showToast(
      `Sent to ${getSessionPromptTargetLabel(target, $sessions)}`,
      'info',
      undefined,
      true
    );
  }, [isAgentMode, submitAgentMessage, inputValue, pastedImages, materializeAttachments, appendAttachmentPaths, resolvePromptTarget, sendPromptToTarget, $sessions, $activeProject, resetHistoryCursor, adjustInputHeight, focusInput]);

  const selectHistoryItem = useCallback((text: string) => {
    setInputValue(text);
    setHistoryOpen(false);
    resetHistoryCursor();
    focusInput();
  }, [resetHistoryCursor, focusInput]);

  const stepHistory = useCallback((direction: 1 | -1) => {
    const items = get(commandHistory);
    if (!items.length) return;

    setHistoryIndex((prevIndex) => {
      if (prevIndex === -1) {
        draftBeforeHistoryRef.current = inputValue;
      }
      const nextIndex = Math.max(-1, Math.min(items.length - 1, prevIndex + direction));
      setInputValue(nextIndex === -1 ? draftBeforeHistoryRef.current : items[nextIndex]);
      return nextIndex;
    });
  }, [inputValue]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
      return;
    }

    if (event.key === 'ArrowUp') {
      const cursorPos = inputElRef.current?.selectionStart ?? 0;
      const onFirstLine = !inputValue.substring(0, cursorPos).includes('\n');
      if (onFirstLine) {
        event.preventDefault();
        stepHistory(1);
        return;
      }
    }

    if (event.key === 'ArrowDown') {
      const cursorPos = inputElRef.current?.selectionStart ?? inputValue.length;
      const onLastLine = !inputValue.substring(cursorPos).includes('\n');
      if (onLastLine) {
        event.preventDefault();
        stepHistory(-1);
        return;
      }
    }

    if (event.key === 'Escape') {
      setHistoryOpen(false);
      resetHistoryCursor();
    }
  }, [submitPrompt, inputValue, stepHistory, resetHistoryCursor]);

  const handleInput = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInputValue(value);
    setHistoryOpen(false);
    adjustInputHeight();
    setHistoryIndex((prev) => (prev !== -1 ? -1 : prev));
    if (value.trim()) setIsExpanded(true);
  }, [adjustInputHeight]);

  const voiceInputRef = useRef(
    createVoiceInputSession({
      onStart: () => {
        setIsListening(true);
        setIsRefining(false);
        voiceDraftBaseRef.current = inputValueRef.current;
        setVoiceDraftText('');
        showToast('Listening for terminal prompt...', 'info');
      },
      onResult: (transcript) => {
        setVoiceDraftText(transcript);
      },
      onProcessingStart: () => {
        setIsListening(false);
        setIsRefining(true);
      },
      onEnd: () => {
        setVoiceStopping((currentStopping) => {
          setVoiceLocked((currentLocked) => {
            setVoiceHeld((currentHeld) => {
              const shouldRestart = !currentStopping && (currentLocked || currentHeld);
              const shouldResumeAgentVoice = isAgentModeRef.current && voiceModeActiveRef.current;
              const transcript = voiceDraftTextRef.current.trim();
              setIsListening(false);

              if (!transcript) {
                setIsRefining(false);
                setVoiceStopping(false);
                voiceDraftBaseRef.current = '';
                setVoiceDraftText('');
                queueMicrotask(() => {
                  if (shouldRestart) {
                    if (currentLocked || currentHeld) {
                      void voiceInputRef.current.start();
                    }
                    return;
                  }
                  resumeVoiceLoopRef.current();
                });
                return currentHeld;
              }

              setIsRefining(true);

              void (async () => {
                try {
                  const result = await refineVoicePrompt(transcript, { aiRefinement: !(isAgentModeRef.current && voiceModeActiveRef.current) });
                  if (result.text) {
                    const merged = mergeVoiceTranscript(voiceDraftBaseRef.current, result.text);
                    setInputValue(merged);
                    requestAnimationFrame(adjustInputHeight);
                    if (isAgentModeRef.current && voiceModeActiveRef.current) {
                      await submitAgentMessageRef.current(merged);
                    } else {
                      focusInput();
                      if (result.aiRefined) {
                        showToast('Prompt refined by AI', 'success', undefined, true);
                      }
                    }
                  }
                  // An empty refinement (nothing usable was said) just falls through to
                  // the finally below, which restarts the loop — no special-casing here.
                } catch (error) {
                  console.error('Failed to refine voice prompt:', error);
                  // Surface the failure in voice mode so a silent dead mic isn't the only
                  // signal; the finally still re-arms listening so the loop survives it.
                  if (shouldResumeAgentVoice) showToast('Could not process that — listening again.', 'warning', 3000);
                } finally {
                  setIsRefining(false);
                  setVoiceStopping(false);
                  voiceDraftBaseRef.current = '';
                  setVoiceDraftText('');
                  if (shouldRestart) {
                    queueMicrotask(() => {
                      if (currentLocked || currentHeld) {
                        void voiceInputRef.current.start();
                      }
                    });
                  } else {
                    // Conversational voice loop: re-arm the mic for the next turn. Guarded
                    // (won't fire mid-speech or mid-send), so racing finalizers are safe.
                    queueMicrotask(() => resumeVoiceLoopRef.current());
                  }
                }
              })();
              return currentHeld;
            });
            return currentLocked;
          });
          return currentStopping;
        });
      },
      onError: (message) => {
        setIsListening(false);
        setIsRefining(false);
        setVoiceLocked(false);
        setVoiceHeld(false);
        setVoiceStopping(false);
        voiceDraftBaseRef.current = '';
        setVoiceDraftText('');
        showToast(message, 'error');
      },
    })
  );
  const voiceInput = voiceInputRef.current;

  // Mirror frequently-read state into refs so the voiceInput callbacks (created
  // once via useRef above) always see current values without being recreated.
  const isAgentModeRef = useRef(isAgentMode);
  useEffect(() => { isAgentModeRef.current = isAgentMode; }, [isAgentMode]);

  const toggleVoiceInput = useCallback(async () => {
    if (isRefining) return;
    if (isListening && voiceLocked) {
      setVoiceLocked(false);
      setVoiceStopping(true);
      voiceInput.stop();
      voiceDraftBaseRef.current = '';
      return;
    }
    setVoiceLocked(true);
    await voiceInput.start();
  }, [isRefining, isListening, voiceLocked, voiceInput]);

  // Read an on-disk image into a preview chip. Returns true when the chip was
  // added; false (e.g. file outside the project) lets the caller fall back to a
  // plain path so the image is still sent, just without a thumbnail.
  const addDiskImageChip = useCallback(async (path: string): Promise<boolean> => {
    try {
      const bytes = await invoke<number[]>('fs_read_binary', { path });
      const mimeType = getImageMimeType(path);
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const name = path.split(/[\\/]/).pop() || 'image';
      setPastedImages((prev) => [...prev, { objectUrl, dataUrl: '', name, diskPath: path }]);
      return true;
    } catch (error) {
      console.error('Failed to preview attached image:', error);
      return false;
    }
  }, []);

  const attachPathsToInput = useCallback((paths: string[]) => {
    if (!paths.length) return;

    const formatted = paths
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => (path.includes(' ') ? `"${path}"` : path))
      .join(' ');

    if (!formatted) return;

    setInputValue((prev) => (prev ? `${prev} ${formatted}` : formatted));
    setHistoryOpen(false);
    setTargetPickerOpen(false);
    resetHistoryCursor();
    requestAnimationFrame(() => {
      adjustInputHeight();
      const el = inputElRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  }, [resetHistoryCursor, adjustInputHeight]);

  const attachFiles = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: true,
        directory: false,
        title: 'Attach files to prompt',
      });

      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;

      const items = (Array.isArray(selected) ? selected : [selected]).map(String);
      // Images become preview chips (sent as the exact file path, so the agent
      // reads the right image); everything else is inserted as a plain path.
      const textPaths: string[] = [];
      for (const path of items) {
        if (isImagePath(path)) {
          const previewed = await addDiskImageChip(path);
          if (!previewed) textPaths.push(path);
        } else {
          textPaths.push(path);
        }
      }

      if (textPaths.length > 0) {
        // Routed through the shared helper so quoting matches paste/drag-drop
        // (double-quote only when the path has spaces) — the previous always
        // single-quote behaviour left literal quotes the agent CLI couldn't open.
        attachPathsToInput(textPaths);
      } else {
        setHistoryOpen(false);
        resetHistoryCursor();
        requestAnimationFrame(() => inputElRef.current?.focus());
      }
    } catch (error) {
      console.error('Failed to attach files to prompt:', error);
      showToast('Failed to attach files', 'error');
    }
  }, [addDiskImageChip, attachPathsToInput, resetHistoryCursor]);

  const isPointInsideBar = useCallback((clientX: number, clientY: number) => {
    const barEl = barElRef.current;
    if (!barEl || typeof document === 'undefined') return false;
    const hovered = document.elementsFromPoint(clientX, clientY) as HTMLElement[];
    return hovered.some((el) => el === barEl || el.closest('.floating-prompt-bar') === barEl);
  }, []);

  const updateExplorerDragPoint = useCallback((clientX: number, clientY: number) => {
    if (clientX < 0 || clientY < 0) return false;
    setLastExplorerDragPoint({ x: clientX, y: clientY });
    const overBar = isPointInsideBar(clientX, clientY);
    setIsDragOver(overBar);
    return overBar;
  }, [isPointInsideBar]);

  const handleInternalDragOver = useCallback((event: React.DragEvent) => {
    if (!draggedExplorerPath) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    updateExplorerDragPoint(event.clientX, event.clientY);
  }, [draggedExplorerPath, updateExplorerDragPoint]);

  const handleInternalDragEnter = useCallback((event: React.DragEvent) => {
    if (!draggedExplorerPath) return;
    event.preventDefault();
    updateExplorerDragPoint(event.clientX, event.clientY);
  }, [draggedExplorerPath, updateExplorerDragPoint]);

  const handleInternalDragLeave = useCallback((event: React.DragEvent) => {
    if (!draggedExplorerPath) return;
    event.preventDefault();
  }, [draggedExplorerPath]);

  const handleInternalDrop = useCallback((event: React.DragEvent) => {
    const droppedPath =
      draggedExplorerPath ||
      event.dataTransfer?.getData('application/x-soryq-path')?.trim() ||
      event.dataTransfer?.getData('text/plain')?.trim() ||
      null;

    if (!droppedPath) return;

    event.preventDefault();
    event.stopPropagation();
    updateExplorerDragPoint(event.clientX, event.clientY);
    setIsDragOver(false);
    attachPathsToInput([droppedPath]);
    setDraggedExplorerPath(null);
    setLastExplorerDragPoint(null);
  }, [draggedExplorerPath, updateExplorerDragPoint, attachPathsToInput]);

  const lastFocusRequestRef = useRef(0);
  useEffect(() => {
    const req = $promptBarFocusRequest;
    if (req !== lastFocusRequestRef.current) {
      lastFocusRequestRef.current = req;
      if (req > 0) openPromptBar();
    }
  }, [$promptBarFocusRequest, openPromptBar]);

  const lastVoiceModeRequestRef = useRef(0);
  useEffect(() => {
    const req = $promptBarVoiceModeRequest;
    if (req !== lastVoiceModeRequestRef.current) {
      lastVoiceModeRequestRef.current = req;
      if (req > 0) launchAgentVoiceMode();
    }
  }, [$promptBarVoiceModeRequest, launchAgentVoiceMode]);

  useEffect(() => {
    const text = $promptBarInput;
    if (text) {
      // Append the injected text to any existing input rather than overwriting it
      setInputValue((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      promptBarInput.set(null);
      setHistoryOpen(false);
      resetHistoryCursor();
      requestAnimationFrame(() => {
        adjustInputHeight();
        const el = inputElRef.current;
        el?.focus();
        if (el) el.setSelectionRange(el.value.length, el.value.length);
      });
    }
  }, [$promptBarInput, resetHistoryCursor, adjustInputHeight]);

  // Watch for element screenshots injected from the Preview panel inspector
  useEffect(() => {
    const img = $promptBarImage;
    if (!img) return;
    promptBarImage.set(null);
    // Convert the dataUrl into an objectUrl so it renders in the chip. Decode
    // locally rather than fetch(dataUrl) — the CSP connect-src blocks data: URLs.
    try {
      const mime = img.dataUrl.slice(5, img.dataUrl.indexOf(';')) || 'image/png';
      const blob = new Blob([dataUrlToBytes(img.dataUrl)], { type: mime });
      const objectUrl = URL.createObjectURL(blob);
      setPastedImages((prev) => [...prev, { objectUrl, dataUrl: img.dataUrl, name: img.name }]);
      requestAnimationFrame(() => {
        inputElRef.current?.focus();
      });
    } catch {/* silently ignore */}
  }, [$promptBarImage]);

  // Run once on mount — NOT on every session/active-session change. These mirror
  // Svelte `$effect`s that read the prompt target via `resolvePromptTarget()`,
  // which uses the non-reactive `get(store)`; Svelte therefore tracked no
  // dependencies and ran them exactly once. Listing $sessions/$activeSessionId/
  // $manualPromptTargetId as React deps (the original port) made the second
  // effect re-focus the prompt bar input on every active-session change, which
  // fights the terminal pane's own focus handler — a focus war that repaints the
  // whole view every frame (the flicker; it pauses only while DevTools holds
  // focus). See focusTerminalPane → focusPane → activateSessionInPane.
  useEffect(() => {
    if (!resolvePromptTarget()?.id) {
      setHistoryOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sessionId = resolvePromptTarget()?.id;
    if (!sessionId) return;
    setHistoryOpen(false);
    resetHistoryCursor();
    requestAnimationFrame(() => {
      adjustInputHeight();
      inputElRef.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    requestAnimationFrame(adjustInputHeight);
  }, [inputValue, adjustInputHeight]);

  const handleDocumentPointerDown = useCallback((event: MouseEvent) => {
    if (!historyOpen && !targetPickerOpen && !spawnOpen && !isExpanded) return;
    const target = event.target as Node | null;
    if (shellElRef.current && target && !shellElRef.current.contains(target)) {
      if (!canStayOpen()) setIsExpanded(false);
      setHistoryOpen(false);
      setTargetPickerOpen(false);
      setSpawnOpen(false);
      setSpawnCounts(new Map());
    }
  }, [historyOpen, targetPickerOpen, spawnOpen, isExpanded, canStayOpen]);

  const handleGlobalVoiceShortcut = useCallback((event: KeyboardEvent) => {
    // 1. If voice mode is active, Escape or Alt exits voice mode
    if (voiceModeActive && isAgentMode) {
      if (event.key === 'Escape' || (event.key === 'Alt' && event.location === KeyboardEvent.DOM_KEY_LOCATION_LEFT)) {
        event.preventDefault();
        stopAgentVoice();
      }
      return;
    }

    // 2. If voice input is listening (non-agent mode), Alt stops it
    if (isListening && !isAgentMode) {
      if (event.key === 'Alt' && event.location === KeyboardEvent.DOM_KEY_LOCATION_LEFT) {
        event.preventDefault();
        void toggleVoiceInput();
        return;
      }
    }

    if (event.key !== 'Alt' || event.location !== KeyboardEvent.DOM_KEY_LOCATION_LEFT || event.repeat || isRefining) return;

    // For starting, require focus to be within the prompt bar
    const activeElement = document.activeElement;
    if (!shellElRef.current || !activeElement || !shellElRef.current.contains(activeElement)) return;

    event.preventDefault();

    if (isAgentMode) {
      toggleAgentVoiceMode();
    } else {
      void toggleVoiceInput();
    }
  }, [voiceModeActive, isAgentMode, isListening, isRefining, stopAgentVoice, toggleAgentVoiceMode, toggleVoiceInput]);

  const handleExplorerDragStart = useCallback((event: Event) => {
    const custom = event as CustomEvent<{ path?: string }>;
    setDraggedExplorerPath(custom.detail?.path?.trim() || null);
    setLastExplorerDragPoint(null);
    setIsDragOver(false);
    setIsGlobalFileDrag(false);
  }, []);

  const handleExplorerDragMoveRef = useRef<(event: Event) => void>(() => {});
  const handleExplorerDragEndRef = useRef<(event: Event) => void>(() => {});

  useEffect(() => {
    handleExplorerDragMoveRef.current = (event: Event) => {
      const custom = event as CustomEvent<{ clientX?: number; clientY?: number }>;
      if (!draggedExplorerPath) return;
      updateExplorerDragPoint(custom.detail?.clientX ?? -1, custom.detail?.clientY ?? -1);
    };
    handleExplorerDragEndRef.current = (event: Event) => {
      const custom = event as CustomEvent<{ path?: string; clientX?: number; clientY?: number }>;
      const endedPath = custom.detail?.path?.trim() || draggedExplorerPath;
      const droppedOverBar =
        typeof custom.detail?.clientX === 'number' && typeof custom.detail?.clientY === 'number'
          ? updateExplorerDragPoint(custom.detail.clientX, custom.detail.clientY)
          : lastExplorerDragPoint
            ? isPointInsideBar(lastExplorerDragPoint.x, lastExplorerDragPoint.y)
            : isDragOver;

      if (endedPath && droppedOverBar) {
        setDraggedExplorerPath(endedPath);
        attachPathsToInput([endedPath]);
      }
      setDraggedExplorerPath(null);
      setLastExplorerDragPoint(null);
      setIsDragOver(false);
    };
  }, [draggedExplorerPath, updateExplorerDragPoint, lastExplorerDragPoint, isPointInsideBar, isDragOver, attachPathsToInput]);

  const handleDocumentDragOver = useCallback((event: DragEvent) => {
    if (!draggedExplorerPath) return;
    const overBar = updateExplorerDragPoint(event.clientX, event.clientY);
    if (overBar) {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }
  }, [draggedExplorerPath, updateExplorerDragPoint]);

  const handleDocumentDrop = useCallback((event: DragEvent) => {
    const droppedPath =
      draggedExplorerPath ||
      event.dataTransfer?.getData('application/x-soryq-path')?.trim() ||
      event.dataTransfer?.getData('text/plain')?.trim() ||
      null;

    if (!droppedPath) return;
    const overBar = updateExplorerDragPoint(event.clientX, event.clientY);
    if (overBar) {
      event.preventDefault();
      event.stopPropagation();
      attachPathsToInput([droppedPath]);
    }
    setDraggedExplorerPath(null);
    setLastExplorerDragPoint(null);
    setIsDragOver(false);
  }, [draggedExplorerPath, updateExplorerDragPoint, attachPathsToInput]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const dragStartHandler = handleExplorerDragStart as EventListener;
    const dragMoveHandler = ((event: Event) => handleExplorerDragMoveRef.current(event)) as EventListener;
    const dragEndHandler = ((event: Event) => handleExplorerDragEndRef.current(event)) as EventListener;

    document.addEventListener('mousedown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleGlobalVoiceShortcut);
    document.addEventListener('dragover', handleDocumentDragOver);
    document.addEventListener('drop', handleDocumentDrop);
    window.addEventListener('soryq-explorer-drag-start', dragStartHandler);
    window.addEventListener('soryq-explorer-drag-move', dragMoveHandler);
    window.addEventListener('soryq-explorer-drag-end', dragEndHandler);

    // Tauri v2 intercepts OS file drops before HTML5 events reach the webview.
    // Use getCurrentWindow().onDragDropEvent() — the correct Tauri v2 API.
    let unlistenDragDrop: (() => void) | undefined;

    if (isTauriRuntime()) {
      getCurrentWindow().onDragDropEvent((event) => {
        if (draggedExplorerPath) {
          return;
        }

        const type = event.payload.type;

        if (type === 'enter') {
          setIsGlobalFileDrag(true);
          return;
        }

        if (type === 'leave') {
          setIsGlobalFileDrag(false);
          setIsDragOver(false);
          return;
        }

        if (type === 'over') {
          const barEl = barElRef.current;
          if (!barEl) return;
          const pos = (event.payload as any).position as { x: number; y: number };
          const rect = barEl.getBoundingClientRect();
          setIsDragOver(pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom);
          return;
        }

        if (type === 'drop') {
          setIsGlobalFileDrag(false);
          const payload = event.payload as any;
          const paths: string[] = payload.paths ?? [];

          const barEl = barElRef.current;
          if (!barEl || !paths.length) { setIsDragOver(false); return; }

          const pos = payload.position as { x: number; y: number };
          const rect = barEl.getBoundingClientRect();
          const isOverBar = pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom;

          setIsDragOver(false);
          if (!isOverBar) return;

          attachPathsToInput(paths);
        }
      }).then((u) => { unlistenDragDrop = u; });
    }

    return () => {
      document.removeEventListener('mousedown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleGlobalVoiceShortcut);
      document.removeEventListener('dragover', handleDocumentDragOver);
      document.removeEventListener('drop', handleDocumentDrop);
      window.removeEventListener('soryq-explorer-drag-start', dragStartHandler);
      window.removeEventListener('soryq-explorer-drag-move', dragMoveHandler);
      window.removeEventListener('soryq-explorer-drag-end', dragEndHandler);
      unlistenDragDrop?.();
    };
  }, [
    handleDocumentPointerDown,
    handleGlobalVoiceShortcut,
    handleDocumentDragOver,
    handleDocumentDrop,
    handleExplorerDragStart,
    draggedExplorerPath,
    attachPathsToInput,
  ]);

  const showDropOverlay = draggedExplorerPath ? isDragOver : (isGlobalFileDrag || isDragOver);

  return (
    <div
      className={`floating-prompt-shell ${isActive ? 'active' : 'collapsed'}`}
      ref={shellElRef}
    >
      {isActive && (
        <>
          {historyOpen && historyItems.length > 0 && (
            <div
              className="history-panel"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
            >
              <div className="history-header">
                <span className="history-label">Recent prompts</span>
                <span className="history-hint">Click to re-use</span>
              </div>
              <div className="history-list">
                {historyItems.map((item, i) => (
                  <button key={i} className="history-item" onClick={() => selectHistoryItem(item)} title={item}>
                    <span className="history-index">{i + 1}</span>
                    <span className="history-text">{item}</span>
                    <svg className="history-insert-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 10 4 15 9 20" />
                      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            className={`floating-prompt-bar${!canSend ? ' disabled' : ''}${isDragOver ? ' drag-over' : ''}${isGlobalFileDrag && !isDragOver ? ' global-drag' : ''}${isAgentMode ? ' agent-mode' : ''}${isVoiceActive ? ' voice-active' : ''}`}
            id="floating-prompt-bar"
            ref={barElRef}
            onDragEnter={handleInternalDragEnter}
            onDragOver={handleInternalDragOver}
            onDragLeave={handleInternalDragLeave}
            onDrop={handleInternalDrop}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={() => setIsFocused(true)}
            onBlur={handleShellFocusOut}
          >
            {showDropOverlay && (
              <div className="drop-overlay">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" x2="12" y1="3" y2="15" />
                </svg>
                Drop file to add as context
              </div>
            )}

            {isVoiceActive && (
              <div className="voice-mode-inner">
                {/* Stop Button */}
                <button
                  className="voice-close-btn"
                  onClick={stopAgentVoice}
                  aria-label="End voice mode"
                  title="End voice mode"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>

                {/* Orb */}
                <div className={`orb-wrap ${
                  isListening
                    ? 'listening'
                    : isTtsSpeaking
                      ? 'speaking'
                      : isRefining || agentSending
                        ? 'thinking'
                        : 'idle'
                }`}>
                  <div className="orb">
                    {isListening ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    ) : isTtsSpeaking ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      </svg>
                    ) : isRefining || agentSending ? (
                      <svg className="spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
                        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Status + live transcript / last response preview */}
                <div className="text-col">
                  <p className={`status ${
                    isListening
                      ? 'listening'
                      : isTtsSpeaking
                        ? 'speaking'
                        : isRefining || agentSending
                          ? 'thinking'
                          : 'idle'
                  }`}>{
                    isListening
                      ? STATUS.listening
                      : isTtsSpeaking
                        ? STATUS.speaking
                        : isRefining || agentSending
                          ? STATUS.thinking
                          : STATUS.idle
                  }</p>
                  {(isListening ? voiceDraftText : isTtsSpeaking ? lastAssistantDisplay : '') && (
                    <p className="live-text">{isListening ? voiceDraftText : isTtsSpeaking ? lastAssistantDisplay : ''}</p>
                  )}
                </div>
              </div>
            )}
            <button
              className={`agent-toggle${isAgentMode ? ' active' : ''}`}
              onClick={toggleAgentMode}
              title={isAgentMode ? 'Exit agent mode' : 'Enter agent mode'}
              aria-label={isAgentMode ? 'Exit agent mode' : 'Enter agent mode'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <path d="M12 7v4" />
                <circle cx="12" cy="5" r="2" />
                <path d="M8 16h.01M16 16h.01" />
                <path d="M5 11V9a7 7 0 0 1 14 0v2" />
              </svg>
              {waitingTaskCount > 0 && !isAgentMode && (
                <span className="agent-toggle-badge">{waitingTaskCount}</span>
              )}
            </button>

            <button
              className={`spawn-toggle${spawnOpen ? ' active' : ''}`}
              onClick={() => {
                setSpawnOpen((v) => {
                  const next = !v;
                  if (!next) setSpawnCounts(new Map());
                  return next;
                });
                setHistoryOpen(false);
                setTargetPickerOpen(false);
              }}
              title="Spawn agents"
              aria-label="Spawn agents"
              disabled={!$activeProject}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {totalSpawnCount > 0 && (
                <span className="spawn-toggle-badge">{totalSpawnCount}</span>
              )}
            </button>

            <button
              className="attach-toggle"
              onClick={attachFiles}
              title="Attach files"
              aria-label="Attach files"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <button
              className={`voice-toggle${isListening ? ' listening' : ''}${isRefining ? ' refining' : ''}${isAgentMode ? ' agent-voice' : ''}`}
              onClick={toggleVoiceInput}
              title={isRefining ? 'Refining with AI…' : isListening ? 'Stop listening' : (isAgentMode ? 'Speak to agent' : 'Start voice input')}
              aria-label={isRefining ? 'Refining with AI…' : isListening ? 'Stop listening' : (isAgentMode ? 'Speak to agent' : 'Start voice input')}
            >
              {isRefining ? (
                <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                  <polyline points="21 3 21 8 16 8" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              )}
            </button>

            <div className="prompt-copy">
              {spawnOpen && spawnPresets.length > 0 && (
                <div className="spawn-picker">
                  <div className="spawn-header">Spawn Agents</div>
                  {spawnPresets.map((preset) => {
                    const count = spawnCounts.get(preset.command) ?? 0;
                    return (
                      <div key={preset.id} className={`spawn-row${count > 0 ? ' selected' : ''}`}>
                        <div className="spawn-counter">
                          <button
                            className="counter-btn"
                            onClick={() => decrementSpawn(preset.command)}
                            disabled={count === 0}
                            title="Spawn fewer"
                            aria-label={`Spawn fewer ${preset.name}`}
                          >−</button>
                          <span className="counter-value">{count}</span>
                          <button
                            className="counter-btn"
                            onClick={() => incrementSpawn(preset.command)}
                            title="Spawn more"
                            aria-label={`Spawn more ${preset.name}`}
                          >+</button>
                        </div>
                        <button
                          className="spawn-item"
                          onClick={() => incrementSpawn(preset.command)}
                          title="Add one"
                        >
                          <span className="spawn-name">{preset.name}</span>
                          <span className="spawn-cmd">{preset.command}</span>
                        </button>
                      </div>
                    );
                  })}
                  <div className="spawn-footer">
                    <button
                      className="spawn-confirm"
                      onClick={handleSpawnConfirm}
                      disabled={totalSpawnCount === 0}
                    >
                      Spawn{totalSpawnCount > 0 ? ` ${totalSpawnCount}` : ''}
                    </button>
                  </div>
                </div>
              )}
              <div className="prompt-meta">
                {isAgentMode ? (
                  <>
                    <button
                      className="prompt-target agent-chat-open-btn"
                      onClick={() => agentCenterOpen.set(!$agentCenterOpen)}
                      title="Toggle agent panel"
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
                      </svg>
                      Agent mode
                      {waitingTaskCount > 0 && (
                        <span className="agent-meta-badge">{waitingTaskCount} waiting</span>
                      )}
                    </button>
                    <div className="agent-voice-controls">
                      <button
                        className={`agent-voice-mode-btn${voiceModeActive ? ' active' : ''}${isTtsSpeaking ? ' speaking' : ''}`}
                        onClick={toggleAgentVoiceMode}
                        title={voiceModeActive ? (isTtsSpeaking ? 'Speaking…' : 'Voice mode on — click to stop') : 'Enable voice conversation mode'}
                        aria-label={voiceModeActive ? 'Stop voice mode' : 'Enable voice mode'}
                      >
                        {isTtsSpeaking ? (
                          <svg className="pulse" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                          </svg>
                        )}
                      </button>
                      <span className="prompt-hint">
                        {isListening
                          ? 'Listening...'
                          : isRefining
                            ? 'Refining...'
                            : agentSending
                              ? 'Sending...'
                              : isTtsSpeaking
                                ? 'Speaking...'
                                : voiceModeActive && isAgentMode
                                  ? 'Voice mode on - speak naturally'
                                  : 'Enter to send - Hold Alt to speak'}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      className={`prompt-target prompt-target-btn${isPinned ? ' pinned' : ''}`}
                      onClick={toggleTargetPicker}
                      title="Click to choose target terminal"
                    >
                      {promptTarget ? getSessionPromptTargetLabel(promptTarget, $sessions) : 'No active terminal'}
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="chevron-icon">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    <span className="prompt-hint">Enter to send, Up/Down for history, mic to dictate</span>
                  </>
                )}
              </div>

              {targetPickerOpen && runningSessions.length > 0 && (
                <div className="target-picker">
                  {runningSessions.map((s) => (
                    <button
                      key={s.id}
                      className={`target-item${promptTarget?.id === s.id ? ' active' : ''}`}
                      onClick={() => selectTarget(s.id)}
                    >
                      {s.role && (
                        <span
                          className="target-dot"
                          style={{
                            background: s.role === 'Server' ? '#4ade80' : s.role === 'Tests' ? '#60a5fa' : s.role === 'Build' ? '#fb923c' : s.role === 'Agent' ? '#a78bfa' : s.role === 'Git' ? '#fbbf24' : '#9ca3af',
                          }}
                        />
                      )}
                      <span className="target-label">{getSessionPromptTargetLabel(s, $sessions)}</span>
                      {s.id === promptTarget?.id && !isPinned && (
                        <span className="target-auto-badge">auto</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {pastedImages.length > 0 && (
                <div className="image-chips">
                  {pastedImages.map((img, i) => (
                    <div className="image-chip" key={img.objectUrl}>
                      <img src={img.objectUrl} alt="Pasted image" className="chip-thumb" />
                      <span className="chip-label">{img.name || 'image'}</span>
                      <button className="chip-remove" onClick={() => removeImage(i)} title="Remove image" aria-label="Remove image">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={inputElRef}
                value={inputValue}
                className="prompt-input"
                placeholder={
                  isAgentMode
                    ? ($activeProject ? 'Ask your agent…' : 'Open a project to use agent mode')
                    : (canSend ? 'Prompt the active terminal...' : 'Open or focus a terminal to send prompts')
                }
                rows={1}
                disabled={!canSend}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onMouseDown={() => { setTargetPickerOpen(false); setHistoryOpen(false); }}
              />
            </div>

            <button
              className="send-btn"
              onClick={submitPrompt}
              disabled={!canSend || (!inputValue.trim() && pastedImages.length === 0)}
              title={isAgentMode ? 'Send to agent' : (preferredAgentTerminal ? 'Send prompt to AI agent terminal' : 'Send prompt to active terminal')}
            >
              Send
            </button>
          </div>
        </>
      )}
      {!isActive && (
        <button
          type="button"
          className="prompt-bubble"
          onClick={openPromptBar}
          title="Open prompt bar"
          aria-label="Open prompt bar"
          aria-controls="floating-prompt-bar"
          aria-expanded={isActive}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m8 8 4 4-4 4" />
            <path d="M13 16h3.5" />
          </svg>
          {waitingTaskCount > 0 && (
            <span className="bubble-waiting-badge">{waitingTaskCount}</span>
          )}
        </button>
      )}
    </div>
  );
}
