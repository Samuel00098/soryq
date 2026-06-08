# Soryq Orchestrator Worktree + Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Soryq’s orchestrator from terminal-exit-means-done dispatching to worktree-backed code-changing tasks with explicit `in-review`, `blocked`, and approval-driven completion.

**Architecture:** Keep `src/lib/stores/orchestrator.ts` as the UI-facing shell, but move lifecycle, terminal lease, worktree, and review semantics into focused service modules. Add safe Tauri git worktree commands, persist worktree/review metadata in task records, and treat terminal exit as an event that the lifecycle classifies instead of unconditional success.

**Tech Stack:** Svelte 5 stores/components, TypeScript, Vitest, Tauri 2, Rust, git CLI via backend commands.

---

## File map

### Existing files to modify
- `src/lib/stores/orchestrator.ts`
  - Keep persistence, chat transcript, and UI-facing actions.
  - Stop owning raw lifecycle semantics and terminal-exit completion guesses.
- `src/lib/components/orchestrator/OrchestratorPanel.svelte`
  - Render richer task states and review actions.
- `src-tauri/src/commands/workspace.rs`
  - Add safe git worktree commands and supporting structs.
- `src-tauri/src/lib.rs`
  - Register new worktree commands.

### New TypeScript files to create
- `src/lib/services/orchestrator/task-lifecycle.ts`
  - Task types, execution mode inference, valid transitions, approve/request-changes/cancel helpers.
- `src/lib/services/orchestrator/review-gate.ts`
  - Translate execution outcomes into `complete`, `in-review`, `blocked`, or `failed`.
- `src/lib/services/orchestrator/worktree-manager.ts`
  - Tauri command wrappers and worktree metadata helpers.
- `src/lib/services/orchestrator/terminal-lease.ts`
  - Spawn, lease, release, resend, and terminal-exit helpers built on the terminal store.

### New tests to create
- `src/lib/services/orchestrator/task-lifecycle.test.ts`
- `src/lib/services/orchestrator/review-gate.test.ts`
- `src/lib/services/orchestrator/worktree-manager.test.ts`
- `src/lib/stores/orchestrator.test.ts`

### Rust tests to add inline
- Add unit tests near the new worktree helpers in `src-tauri/src/commands/workspace.rs` for branch/worktree name validation and command preconditions.

---

### Task 1: Introduce the orchestration domain model and lifecycle rules

**Files:**
- Create: `src/lib/services/orchestrator/task-lifecycle.ts`
- Test: `src/lib/services/orchestrator/task-lifecycle.test.ts`
- Modify: `src/lib/stores/orchestrator.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  createTaskRecord,
  inferExecutionMode,
  transitionTask,
  approveTask,
  requestTaskChanges,
  cancelTask,
  type OrchestratorTask,
} from '$lib/services/orchestrator/task-lifecycle';

describe('inferExecutionMode', () => {
  it('defaults code-changing goals to worktree', () => {
    expect(inferExecutionMode('Fix the failing auth tests')).toBe('worktree');
    expect(inferExecutionMode('Refactor the orchestrator store')).toBe('worktree');
  });

  it('keeps read-only investigation direct', () => {
    expect(inferExecutionMode('Explain how the auth flow works')).toBe('direct');
    expect(inferExecutionMode('Inspect the logs and summarize the failure')).toBe('direct');
  });
});

describe('task lifecycle transitions', () => {
  const seed = createTaskRecord('project-1', 'Fix orchestrator review flow', 'worktree', 'claude');

  it('allows todo -> in-progress -> in-review -> complete', () => {
    const started = transitionTask(seed, 'in-progress');
    const review = transitionTask(started, 'in-review');
    const done = approveTask(review);
    expect(done.status).toBe('complete');
    expect(done.completedAt).toBeTypeOf('number');
  });

  it('rejects invalid complete -> in-progress transitions', () => {
    const done = approveTask(transitionTask(transitionTask(seed, 'in-progress'), 'in-review'));
    expect(() => transitionTask(done, 'in-progress')).toThrow(/invalid orchestrator transition/i);
  });

  it('returns request-changes tasks to todo while preserving worktree metadata', () => {
    const review = transitionTask(
      {
        ...transitionTask(seed, 'in-progress'),
        worktree: {
          id: 'wt-1',
          path: '/tmp/wt-1',
          branchName: 'soryq/ot_1',
          baseBranch: 'main',
          baseCommit: 'abc1234',
        },
      },
      'in-review'
    );
    const todoAgain = requestTaskChanges(review, 'Need better error states');
    expect(todoAgain.status).toBe('todo');
    expect(todoAgain.worktree?.path).toBe('/tmp/wt-1');
    expect(todoAgain.review?.decision).toBe('changes-requested');
  });

  it('marks cancellation explicitly', () => {
    const cancelled = cancelTask(seed, 'User rejected the task');
    expect(cancelled.status).toBe('cancelled');
  });
});
```

- [ ] **Step 2: Run the lifecycle test to verify it fails**

Run: `npm test -- src/lib/services/orchestrator/task-lifecycle.test.ts`
Expected: FAIL with module-not-found or missing export errors for `task-lifecycle.ts`.

- [ ] **Step 3: Implement the lifecycle module**

```ts
export type OrchestratorTaskStatus =
  | 'todo'
  | 'in-progress'
  | 'in-review'
  | 'complete'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type ExecutionMode = 'direct' | 'worktree';

export interface OrchestratorWorktree {
  id: string;
  path: string;
  branchName: string;
  baseBranch: string;
  baseCommit: string;
  createdAt: number;
  changedFilesCount?: number | null;
}

export interface OrchestratorReviewState {
  requestedAt: number | null;
  decision: 'pending' | 'approved' | 'changes-requested' | 'cancelled' | null;
  note?: string | null;
}

export interface OrchestratorTask {
  id: string;
  projectId: string;
  goal: string;
  title: string;
  status: OrchestratorTaskStatus;
  executionMode: ExecutionMode;
  agentPreset?: string | null;
  assignedSessionId?: number | null;
  worktree?: OrchestratorWorktree | null;
  review?: OrchestratorReviewState | null;
  blockedReason?: string | null;
  failureReason?: string | null;
  createdAt: number;
  startedAt?: number | null;
  completedAt?: number | null;
}

const CODE_CHANGE_RE = /\b(add|build|change|create|delete|fix|implement|modify|refactor|remove|rename|update|write)\b/i;
const READ_ONLY_RE = /\b(explain|inspect|investigate|look at|summarize|trace|understand)\b/i;

export function inferExecutionMode(goal: string): ExecutionMode {
  const text = goal.trim();
  if (READ_ONLY_RE.test(text) && !CODE_CHANGE_RE.test(text)) return 'direct';
  return CODE_CHANGE_RE.test(text) ? 'worktree' : 'direct';
}

export function createTaskRecord(
  projectId: string,
  goal: string,
  executionMode: ExecutionMode,
  agentPreset?: string | null
): OrchestratorTask {
  const trimmed = goal.trim();
  return {
    id: `ot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    projectId,
    goal: trimmed,
    title: trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed,
    status: 'todo',
    executionMode,
    agentPreset: agentPreset ?? null,
    assignedSessionId: null,
    worktree: null,
    review: null,
    blockedReason: null,
    failureReason: null,
    createdAt: Date.now(),
    startedAt: null,
    completedAt: null,
  };
}

const ALLOWED: Record<OrchestratorTaskStatus, OrchestratorTaskStatus[]> = {
  todo: ['in-progress', 'cancelled', 'failed'],
  'in-progress': ['in-review', 'blocked', 'failed', 'cancelled'],
  'in-review': ['complete', 'todo', 'cancelled', 'failed'],
  complete: [],
  blocked: ['todo', 'in-progress', 'cancelled', 'failed'],
  failed: [],
  cancelled: [],
};
```

Add the transition helpers in the same file:

```ts
export function transitionTask(task: OrchestratorTask, next: OrchestratorTaskStatus): OrchestratorTask {
  if (!ALLOWED[task.status].includes(next)) {
    throw new Error(`Invalid orchestrator transition: ${task.status} -> ${next}`);
  }
  const now = Date.now();
  return {
    ...task,
    status: next,
    startedAt: next === 'in-progress' ? task.startedAt ?? now : task.startedAt ?? null,
    completedAt: next === 'complete' ? now : task.completedAt ?? null,
    review:
      next === 'in-review'
        ? { requestedAt: now, decision: 'pending', note: null }
        : task.review ?? null,
  };
}

export function approveTask(task: OrchestratorTask): OrchestratorTask {
  const reviewed = task.status === 'in-review' ? task : transitionTask(task, 'in-review');
  return {
    ...transitionTask(reviewed, 'complete'),
    review: { ...(reviewed.review ?? { requestedAt: Date.now(), decision: 'pending', note: null }), decision: 'approved' },
  };
}

export function requestTaskChanges(task: OrchestratorTask, note: string): OrchestratorTask {
  const review = task.status === 'in-review' ? task : transitionTask(task, 'in-review');
  return {
    ...transitionTask(review, 'todo'),
    assignedSessionId: null,
    review: { ...(review.review ?? { requestedAt: Date.now(), decision: 'pending', note: null }), decision: 'changes-requested', note },
  };
}

export function cancelTask(task: OrchestratorTask, note?: string): OrchestratorTask {
  const now = Date.now();
  return {
    ...task,
    status: 'cancelled',
    review: task.review ? { ...task.review, decision: 'cancelled', note: note ?? task.review.note ?? null } : task.review ?? null,
    completedAt: task.completedAt ?? now,
  };
}
```

- [ ] **Step 4: Re-export the new types from the store instead of maintaining duplicate task definitions**

Replace the top of `src/lib/stores/orchestrator.ts` with imports like:

```ts
import {
  createTaskRecord,
  inferExecutionMode,
  type ExecutionMode,
  type OrchestratorTask,
} from '$lib/services/orchestrator/task-lifecycle';
```

Then delete the in-file `OrchestratorTaskStatus`, `ExecutionMode`, and `OrchestratorTask` definitions so there is one source of truth.

- [ ] **Step 5: Run the lifecycle tests to verify they pass**

Run: `npm test -- src/lib/services/orchestrator/task-lifecycle.test.ts`
Expected: PASS with 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/orchestrator/task-lifecycle.ts src/lib/services/orchestrator/task-lifecycle.test.ts src/lib/stores/orchestrator.ts
git commit -m "refactor: add orchestrator lifecycle model"
```

---

### Task 2: Add safe git worktree creation/removal primitives

**Files:**
- Create: `src/lib/services/orchestrator/worktree-manager.ts`
- Test: `src/lib/services/orchestrator/worktree-manager.test.ts`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write failing worktree manager tests**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { createTaskWorktree, removeTaskWorktree } from '$lib/services/orchestrator/worktree-manager';

describe('worktree-manager', () => {
  beforeEach(() => invoke.mockReset());

  it('creates a deterministic task worktree and returns metadata', async () => {
    invoke.mockResolvedValue({
      id: 'ot_123',
      path: '/repo/.soryq/worktrees/ot_123',
      branch_name: 'soryq/ot_123-fix-review-flow',
      base_branch: 'main',
      base_commit: 'abc1234',
      created_at: 1710000000000,
    });

    const result = await createTaskWorktree({
      projectId: 'project-1',
      taskId: 'ot_123',
      title: 'Fix review flow',
    });

    expect(invoke).toHaveBeenCalledWith('workspace_git_worktree_create', {
      projectId: 'project-1',
      taskId: 'ot_123',
      title: 'Fix review flow',
    });
    expect(result.branchName).toContain('ot_123');
  });

  it('removes a task worktree by id/path', async () => {
    invoke.mockResolvedValue('removed');
    await removeTaskWorktree({ projectId: 'project-1', taskId: 'ot_123', path: '/repo/.soryq/worktrees/ot_123' });
    expect(invoke).toHaveBeenCalledWith('workspace_git_worktree_remove', {
      projectId: 'project-1',
      taskId: 'ot_123',
      path: '/repo/.soryq/worktrees/ot_123',
      force: false,
    });
  });
});
```

- [ ] **Step 2: Run the worktree manager test to verify it fails**

Run: `npm test -- src/lib/services/orchestrator/worktree-manager.test.ts`
Expected: FAIL with missing module/exports.

- [ ] **Step 3: Add backend worktree commands in Rust**

Add structs and commands to `src-tauri/src/commands/workspace.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
pub struct GitWorktreeInfo {
    pub id: String,
    pub path: String,
    pub branch_name: String,
    pub base_branch: String,
    pub base_commit: String,
    pub created_at: i64,
}

#[tauri::command]
pub fn workspace_git_worktree_create(
    project_id: String,
    task_id: String,
    title: String,
    state: State<AppState>,
) -> Result<GitWorktreeInfo, String> {
    let root_path = get_project_path(&project_id, &state)?;
    if !root_path.join(".git").exists() {
        return Err("Not a git repository".to_string());
    }

    let base_branch = git_capture(&root_path, &["branch", "--show-current"])
        .ok_or_else(|| "Failed to determine current branch".to_string())?;
    let base_commit = git_capture(&root_path, &["rev-parse", "HEAD"])
        .ok_or_else(|| "Failed to determine HEAD commit".to_string())?;
    let branch_name = sanitize_worktree_branch_name(&task_id, &title);
    let worktree_root = root_path.join(".soryq").join("worktrees");
    std::fs::create_dir_all(&worktree_root).map_err(|e| format!("Failed to create worktree dir: {}", e))?;
    let worktree_path = worktree_root.join(&task_id);

    let output = Command::new("git")
        .args(["worktree", "add", "-b", &branch_name, worktree_path.to_string_lossy().as_ref(), &base_branch])
        .current_dir(&root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to create worktree: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to read system time: {}", e))?
        .as_millis() as i64;

    Ok(GitWorktreeInfo {
        id: task_id,
        path: clean_path_buf(worktree_path).to_string_lossy().to_string(),
        branch_name,
        base_branch,
        base_commit,
        created_at,
    })
}

#[tauri::command]
pub fn workspace_git_worktree_remove(
    project_id: String,
    task_id: String,
    path: String,
    force: bool,
    state: State<AppState>,
) -> Result<String, String> {
    let root_path = get_project_path(&project_id, &state)?;
    let worktree_path = clean_path_buf(PathBuf::from(path));
    if !worktree_path.starts_with(root_path.join(".soryq").join("worktrees")) {
        return Err("Access denied: invalid worktree path".to_string());
    }

    let mut args = vec!["worktree", "remove"];
    if force { args.push("--force"); }
    args.push(worktree_path.to_string_lossy().as_ref());

    let output = Command::new("git")
        .args(&args)
        .current_dir(&root_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(format!("Removed worktree for {}", task_id))
}
```

Also add helpers near the git utilities in the same file:

```rust
fn sanitize_worktree_branch_name(task_id: &str, title: &str) -> String {
    let slug: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let compact = slug.split('-').filter(|s| !s.is_empty()).take(6).collect::<Vec<_>>().join("-");
    format!("soryq/{task_id}-{compact}")
}
```

- [ ] **Step 4: Register the new Tauri commands**

Add both commands to `src-tauri/src/lib.rs` inside `tauri::generate_handler!`:

```rust
commands::workspace::workspace_git_worktree_create,
commands::workspace::workspace_git_worktree_remove,
```

- [ ] **Step 5: Implement the TypeScript wrapper**

Create `src/lib/services/orchestrator/worktree-manager.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import type { OrchestratorWorktree } from './task-lifecycle';

interface CreateTaskWorktreeArgs {
  projectId: string;
  taskId: string;
  title: string;
}

interface RemoveTaskWorktreeArgs {
  projectId: string;
  taskId: string;
  path: string;
  force?: boolean;
}

interface RawWorktreeInfo {
  id: string;
  path: string;
  branch_name: string;
  base_branch: string;
  base_commit: string;
  created_at: number;
}

export async function createTaskWorktree(args: CreateTaskWorktreeArgs): Promise<OrchestratorWorktree> {
  const raw = await invoke<RawWorktreeInfo>('workspace_git_worktree_create', args);
  return {
    id: raw.id,
    path: raw.path,
    branchName: raw.branch_name,
    baseBranch: raw.base_branch,
    baseCommit: raw.base_commit,
    createdAt: raw.created_at,
    changedFilesCount: null,
  };
}

export async function removeTaskWorktree(args: RemoveTaskWorktreeArgs): Promise<string> {
  return invoke<string>('workspace_git_worktree_remove', {
    projectId: args.projectId,
    taskId: args.taskId,
    path: args.path,
    force: args.force ?? false,
  });
}
```

- [ ] **Step 6: Run the targeted tests**

Run: `npm test -- src/lib/services/orchestrator/worktree-manager.test.ts`
Expected: PASS with 2 passing tests.

Run: `cargo test worktree --manifest-path src-tauri/Cargo.toml`
Expected: PASS for the new Rust worktree helper/validation tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/orchestrator/worktree-manager.ts src/lib/services/orchestrator/worktree-manager.test.ts src-tauri/src/commands/workspace.rs src-tauri/src/lib.rs
git commit -m "feat: add orchestrator worktree primitives"
```

---

### Task 3: Move terminal spawning/leasing into a dedicated orchestration adapter

**Files:**
- Create: `src/lib/services/orchestrator/terminal-lease.ts`
- Modify: `src/lib/stores/orchestrator.ts`
- Test: `src/lib/stores/orchestrator.test.ts`

- [ ] **Step 1: Write failing store tests for launch behavior**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const spawnAgentPreset = vi.fn();
const setSessionOwnerTask = vi.fn();
const setSessionTaskSummary = vi.fn();
const setActiveSession = vi.fn();
const sendAgentPromptDirect = vi.fn();
const getSessionOutputBuffer = vi.fn(() => 'booted output................................');
const showToast = vi.fn();
const createTaskWorktree = vi.fn();

vi.mock('$lib/stores/terminal', () => ({
  sessions: { subscribe: vi.fn(() => () => {}) },
  spawnAgentPreset,
  setSessionOwnerTask,
  setSessionTaskSummary,
  setActiveSession,
  sendAgentPromptDirect,
  getSessionOutputBuffer,
  getAgentDisplayName: (id: string) => id,
  manualPromptTargetId: { set: vi.fn() },
  promptBarInput: { set: vi.fn() },
  focusPromptBar: vi.fn(),
  summarizeTerminalTask: (text: string) => text,
  getTerminalProjectState: () => ({ sessions: [] }),
}));

vi.mock('$lib/services/orchestrator/worktree-manager', () => ({ createTaskWorktree }));

import {
  orchestratorTasks,
  createOrchestratorTask,
  launchOrchestratorTask,
} from '$lib/stores/orchestrator';

describe('launchOrchestratorTask', () => {
  beforeEach(() => {
    orchestratorTasks.set([]);
    spawnAgentPreset.mockReset();
    createTaskWorktree.mockReset();
    sendAgentPromptDirect.mockReset();
  });

  it('creates the worktree before launching a worktree task', async () => {
    const task = createOrchestratorTask('project-1', 'Fix orchestrator lifecycle');
    createTaskWorktree.mockResolvedValue({
      id: task.id,
      path: '/repo/.soryq/worktrees/' + task.id,
      branchName: 'soryq/' + task.id,
      baseBranch: 'main',
      baseCommit: 'abc1234',
      createdAt: Date.now(),
    });
    spawnAgentPreset.mockResolvedValue(42);

    await launchOrchestratorTask(task.id, 'claude', '/repo', true);

    expect(createTaskWorktree.mock.invocationCallOrder[0]).toBeLessThan(spawnAgentPreset.mock.invocationCallOrder[0]);
    expect(spawnAgentPreset).toHaveBeenCalledWith('claude', '/repo/.soryq/worktrees/' + task.id);
    expect(get(orchestratorTasks)[0].status).toBe('in-progress');
  });
});
```

- [ ] **Step 2: Run the store test to verify it fails**

Run: `npm test -- src/lib/stores/orchestrator.test.ts`
Expected: FAIL because the store still launches directly from the root path and has no worktree metadata.

- [ ] **Step 3: Implement `terminal-lease.ts`**

Create `src/lib/services/orchestrator/terminal-lease.ts`:

```ts
import {
  spawnAgentPreset,
  setSessionOwnerTask,
  setSessionTaskSummary,
  setActiveSession,
  sendAgentPromptDirect,
  getSessionOutputBuffer,
} from '$lib/stores/terminal';

export async function waitForAgentReady(sessionId: number, settleMs = 1600, maxWaitMs = 9000): Promise<void> {
  const start = Date.now();
  const startLen = getSessionOutputBuffer(sessionId).length;
  await new Promise<void>((resolve) => {
    const tick = () => {
      const printed = getSessionOutputBuffer(sessionId).length > startLen + 16;
      if (printed || Date.now() - start >= maxWaitMs) resolve();
      else setTimeout(tick, 150);
    };
    tick();
  });
  await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
}

export async function leaseTerminalToTask(opts: {
  agentCommand: string;
  cwd: string;
  taskId: string;
  taskTitle: string;
}): Promise<number | null> {
  const sessionId = await spawnAgentPreset(opts.agentCommand, opts.cwd);
  if (sessionId == null) return null;
  setSessionOwnerTask(sessionId, opts.taskId);
  setSessionTaskSummary(sessionId, opts.taskTitle);
  setActiveSession(sessionId);
  return sessionId;
}

export function resendGoal(sessionId: number, goal: string): void {
  sendAgentPromptDirect(sessionId, goal);
}
```

- [ ] **Step 4: Refactor the store launch path to use lifecycle + worktree + lease modules**

In `src/lib/stores/orchestrator.ts`, update task creation and launch logic to look like this:

```ts
export function createOrchestratorTask(
  projectId: string,
  goal: string,
  executionMode?: ExecutionMode,
  agentPreset?: string | null
): OrchestratorTask {
  const trimmed = goal.trim();
  const mode = executionMode ?? inferExecutionMode(trimmed);
  const task = createTaskRecord(projectId, trimmed, mode, agentPreset ?? null);
  orchestratorTasks.update((all) => [...all, task]);
  void flush(projectId);
  return task;
}

export async function launchOrchestratorTask(
  id: string,
  agentCommand: string,
  cwd: string,
  autoRun = true
): Promise<void> {
  const task = get(orchestratorTasks).find((entry) => entry.id === id);
  if (!task) return;

  let launchCwd = cwd;
  let worktree = task.worktree ?? null;

  if (task.executionMode === 'worktree' && !worktree) {
    worktree = await createTaskWorktree({
      projectId: task.projectId,
      taskId: task.id,
      title: task.title,
    });
    patchTask(task.id, (current) => ({ ...current, worktree }));
    launchCwd = worktree.path;
  } else if (worktree) {
    launchCwd = worktree.path;
  }

  const sessionId = await leaseTerminalToTask({
    agentCommand,
    cwd: launchCwd,
    taskId: task.id,
    taskTitle: task.title,
  });
  if (sessionId == null) {
    patchTask(task.id, (current) => ({ ...current, status: 'failed', failureReason: 'No free terminal pane available' }));
    return;
  }

  patchTask(task.id, (current) => transitionTask({ ...current, agentPreset: agentCommand, assignedSessionId: sessionId }, 'in-progress'));

  if (autoRun && task.goal) {
    await waitForAgentReady(sessionId);
    resendGoal(sessionId, task.goal);
  }
}
```

- [ ] **Step 5: Run the store test to verify it passes**

Run: `npm test -- src/lib/stores/orchestrator.test.ts`
Expected: PASS for the worktree-before-launch assertion.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/orchestrator/terminal-lease.ts src/lib/stores/orchestrator.ts src/lib/stores/orchestrator.test.ts
git commit -m "refactor: isolate orchestrator terminal leasing"
```

---

### Task 4: Add review-gate semantics and persistence-safe exit reconciliation

**Files:**
- Create: `src/lib/services/orchestrator/review-gate.ts`
- Test: `src/lib/services/orchestrator/review-gate.test.ts`
- Modify: `src/lib/stores/orchestrator.ts`
- Test: `src/lib/stores/orchestrator.test.ts`

- [ ] **Step 1: Write failing review-gate tests**

```ts
import { describe, expect, it } from 'vitest';
import { classifyTaskAfterExecution } from '$lib/services/orchestrator/review-gate';
import { createTaskRecord, transitionTask } from '$lib/services/orchestrator/task-lifecycle';

describe('classifyTaskAfterExecution', () => {
  it('sends worktree tasks to in-review instead of complete', () => {
    const task = transitionTask(createTaskRecord('project-1', 'Fix auth bug', 'worktree', 'claude'), 'in-progress');
    expect(classifyTaskAfterExecution(task, { exitCode: 0 }).status).toBe('in-review');
  });

  it('completes direct read-only tasks on clean exit', () => {
    const task = transitionTask(createTaskRecord('project-1', 'Explain the auth flow', 'direct', 'claude'), 'in-progress');
    expect(classifyTaskAfterExecution(task, { exitCode: 0 }).status).toBe('complete');
  });

  it('marks blocked when human input is required', () => {
    const task = transitionTask(createTaskRecord('project-1', 'Fix auth bug', 'worktree', 'claude'), 'in-progress');
    const next = classifyTaskAfterExecution(task, { exitCode: 0, needsHumanInput: true, note: 'Need API key' });
    expect(next.status).toBe('blocked');
    expect(next.blockedReason).toContain('API key');
  });
});
```

- [ ] **Step 2: Run the review-gate test to verify it fails**

Run: `npm test -- src/lib/services/orchestrator/review-gate.test.ts`
Expected: FAIL with missing module/exports.

- [ ] **Step 3: Implement the review gate**

Create `src/lib/services/orchestrator/review-gate.ts`:

```ts
import { approveTask, transitionTask, type OrchestratorTask } from './task-lifecycle';

interface ExecutionOutcome {
  exitCode: number | null;
  needsHumanInput?: boolean;
  note?: string;
}

export function classifyTaskAfterExecution(task: OrchestratorTask, outcome: ExecutionOutcome): OrchestratorTask {
  if (outcome.exitCode !== 0) {
    return {
      ...task,
      status: 'failed',
      failureReason: outcome.note ?? `Agent exited with code ${outcome.exitCode ?? 'unknown'}`,
      assignedSessionId: null,
    };
  }

  if (outcome.needsHumanInput) {
    return {
      ...task,
      status: 'blocked',
      blockedReason: outcome.note ?? 'Human input required',
      assignedSessionId: null,
    };
  }

  if (task.executionMode === 'worktree') {
    return {
      ...transitionTask(task, 'in-review'),
      assignedSessionId: null,
    };
  }

  return {
    ...approveTask({ ...task, status: 'in-review' }),
    assignedSessionId: null,
  };
}
```

- [ ] **Step 4: Replace terminal-exit-means-done logic in the store**

In `src/lib/stores/orchestrator.ts`, replace the session subscription block with review-gated reconciliation:

```ts
if (typeof window !== 'undefined') {
  sessions.subscribe(($sessions) => {
    const active = get(orchestratorTasks).filter(
      (task) => task.status === 'in-progress' && task.assignedSessionId != null
    );

    for (const task of active) {
      const session = $sessions.find((entry) => entry.id === task.assignedSessionId);
      if (!session) continue;
      if (!session.isRunning) {
        patchTask(task.id, (current) =>
          classifyTaskAfterExecution(current, {
            exitCode: 0,
            needsHumanInput: false,
          })
        );
        setSessionOwnerTask(session.id, null);
        setSessionTaskSummary(session.id, null);
      }
    }
  });
}
```

Also update `loadProjectOrchestratorTasks` so it does **not** rewrite persisted `in-review` or `blocked` tasks back to `todo`. Only reconcile orphaned `in-progress` tasks.

- [ ] **Step 5: Add store tests for reload and exit reconciliation**

Extend `src/lib/stores/orchestrator.test.ts` with tests like:

```ts
it('keeps persisted in-review tasks intact on reload', async () => {
  fsReadFile.mockResolvedValue(JSON.stringify([
    {
      id: 'ot_1',
      projectId: 'project-1',
      goal: 'Fix the review flow',
      title: 'Fix the review flow',
      status: 'in-review',
      executionMode: 'worktree',
      worktree: {
        id: 'ot_1',
        path: '/repo/.soryq/worktrees/ot_1',
        branchName: 'soryq/ot_1',
        baseBranch: 'main',
        baseCommit: 'abc1234',
        createdAt: Date.now(),
      },
      review: { requestedAt: Date.now(), decision: 'pending', note: null },
      createdAt: Date.now(),
    },
  ]));

  await loadProjectOrchestratorTasks({ id: 'project-1', root_path: '/repo' });

  expect(get(orchestratorTasks)[0].status).toBe('in-review');
});
```

- [ ] **Step 6: Run the targeted tests**

Run: `npm test -- src/lib/services/orchestrator/review-gate.test.ts src/lib/stores/orchestrator.test.ts`
Expected: PASS with review-gate and persistence assertions succeeding.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/orchestrator/review-gate.ts src/lib/services/orchestrator/review-gate.test.ts src/lib/stores/orchestrator.ts src/lib/stores/orchestrator.test.ts
git commit -m "feat: add orchestrator review gate"
```

---

### Task 5: Add review actions and richer task state to the orchestrator panel

**Files:**
- Modify: `src/lib/components/orchestrator/OrchestratorPanel.svelte`
- Modify: `src/lib/stores/orchestrator.ts`
- Test: `src/lib/stores/orchestrator.test.ts`

- [ ] **Step 1: Add failing store tests for review actions**

Extend `src/lib/stores/orchestrator.test.ts`:

```ts
it('approves an in-review task explicitly', () => {
  const task = createOrchestratorTask('project-1', 'Fix the review flow');
  orchestratorTasks.set([
    {
      ...task,
      status: 'in-review',
      executionMode: 'worktree',
      review: { requestedAt: Date.now(), decision: 'pending', note: null },
    },
  ]);

  approveOrchestratorTask(task.id);

  expect(get(orchestratorTasks)[0].status).toBe('complete');
  expect(get(orchestratorTasks)[0].review?.decision).toBe('approved');
});

it('requests changes without discarding the worktree context', () => {
  const task = createOrchestratorTask('project-1', 'Fix the review flow');
  orchestratorTasks.set([
    {
      ...task,
      status: 'in-review',
      executionMode: 'worktree',
      worktree: {
        id: task.id,
        path: '/repo/.soryq/worktrees/' + task.id,
        branchName: 'soryq/' + task.id,
        baseBranch: 'main',
        baseCommit: 'abc1234',
        createdAt: Date.now(),
      },
      review: { requestedAt: Date.now(), decision: 'pending', note: null },
    },
  ]);

  requestOrchestratorTaskChanges(task.id, 'Handle blocked state in the panel');

  expect(get(orchestratorTasks)[0].status).toBe('todo');
  expect(get(orchestratorTasks)[0].worktree?.path).toContain(task.id);
});
```

- [ ] **Step 2: Run the store tests to verify they fail**

Run: `npm test -- src/lib/stores/orchestrator.test.ts`
Expected: FAIL with missing `approveOrchestratorTask` / `requestOrchestratorTaskChanges` exports.

- [ ] **Step 3: Add explicit review actions in the store**

Add these exports to `src/lib/stores/orchestrator.ts`:

```ts
export function approveOrchestratorTask(id: string) {
  patchTask(id, (task) => approveTask(task));
}

export function requestOrchestratorTaskChanges(id: string, note: string) {
  patchTask(id, (task) => requestTaskChanges(task, note));
}

export function cancelOrchestratorTask(id: string, note?: string) {
  patchTask(id, (task) => cancelTask(task, note));
}
```

- [ ] **Step 4: Update `OrchestratorPanel.svelte` to render the new states and actions**

Make these targeted changes:

```svelte
<script lang="ts">
  import {
    approveOrchestratorTask,
    cancelOrchestratorTask,
    requestOrchestratorTaskChanges,
    // existing imports...
  } from '$lib/stores/orchestrator';

  let reviewNoteByTask = $state<Record<string, string>>({});
  let reviewTasks = $derived($tasksStore.filter((t) => t.status === 'in-review'));
  let blockedTasks = $derived($tasksStore.filter((t) => t.status === 'blocked'));
</script>
```

Render review cards below the running strip:

```svelte
{#if reviewTasks.length > 0}
  <div class="review-strip">
    {#each reviewTasks as task (task.id)}
      <div class="review-card">
        <div class="review-head">
          <span class="review-status">In review</span>
          <span class="review-agent">{agentLabel(task.agentPreset)}</span>
        </div>
        <div class="review-title">{task.title}</div>
        <div class="review-meta">
          <span>{task.worktree?.branchName}</span>
          <span>{task.worktree?.baseBranch}</span>
          <span>{task.worktree?.path}</span>
        </div>
        <textarea
          class="review-note"
          bind:value={reviewNoteByTask[task.id]}
          placeholder="Optional review note…"
        />
        <div class="review-actions">
          <button onclick={() => approveOrchestratorTask(task.id)}>Approve</button>
          <button onclick={() => requestOrchestratorTaskChanges(task.id, reviewNoteByTask[task.id] ?? '')}>Request changes</button>
          <button onclick={() => cancelOrchestratorTask(task.id, reviewNoteByTask[task.id] ?? '')}>Cancel</button>
        </div>
      </div>
    {/each}
  </div>
{/if}
```

Render blocked tasks separately with their `blockedReason` so they do not look failed.

- [ ] **Step 5: Run the updated tests**

Run: `npm test -- src/lib/stores/orchestrator.test.ts`
Expected: PASS with approval/request-changes coverage added.

Run: `npm test`
Expected: PASS for the full Vitest suite.

- [ ] **Step 6: Manual smoke-check the app**

Run: `npm run dev`
Expected: Vite starts successfully and the app loads.

Then verify manually in the UI:
1. Open a project and the Orchestrator panel.
2. Send `Explain how the auth flow works`.
   - Expected: direct task launches and may complete without `in-review`.
3. Send `Fix the failing auth tests`.
   - Expected: task records `worktree` metadata and launches inside a worktree path.
4. Let the task finish.
   - Expected: task becomes `in-review`, not `complete`.
5. Click **Approve**.
   - Expected: task becomes `complete`.
6. Repeat with **Request changes**.
   - Expected: task returns to `todo` and preserves the existing worktree metadata.

- [ ] **Step 7: Commit**

```bash
git add src/lib/components/orchestrator/OrchestratorPanel.svelte src/lib/stores/orchestrator.ts src/lib/stores/orchestrator.test.ts
git commit -m "feat: add orchestrator review actions"
```

---

## Final verification checklist

- [ ] Run: `npm test`
  - Expected: PASS
- [ ] Run: `cargo test --manifest-path src-tauri/Cargo.toml`
  - Expected: PASS
- [ ] Run: `npm run dev`
  - Expected: App launches and the orchestrator panel shows direct vs worktree flows correctly
- [ ] Confirm a code-changing task creates a worktree before terminal launch
- [ ] Confirm terminal exit moves worktree tasks to `in-review`
- [ ] Confirm approval changes `in-review` → `complete`
- [ ] Confirm request changes changes `in-review` → `todo` without dropping worktree metadata
- [ ] Confirm reload preserves `in-review` and `blocked` tasks

## Spec coverage check
- Worktree default for code-changing tasks: Task 1 + Task 3
- Safe worktree creation and metadata persistence: Task 2 + Task 3
- Terminal exit no longer implying success: Task 4
- Explicit `in-review`, `blocked`, `failed`, `complete`, `cancelled`: Task 1 + Task 4 + Task 5
- Review actions in UI: Task 5
- Persistence-safe reload behavior: Task 4

## Notes for the implementing agent
- Keep `src/lib/stores/orchestrator.ts` as the public API surface for the panel; do not move chat or persistence into the panel.
- Do not add swarm logic in this plan.
- Do not auto-merge or delete worktrees on approval in this slice.
- Use the existing terminal store helpers instead of reimplementing PTY behavior.
- Treat `blocked` as operationally distinct from `failed`; do not collapse them into one UI state.
