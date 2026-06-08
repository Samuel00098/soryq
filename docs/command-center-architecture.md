# Soryq Command Center — Architecture & Design

## The Core Idea

A command center where you speak, the orchestrator **reconnoiters the codebase** to understand context, then dispatches precise prompts to coding agents (Claude Code) that execute flawlessly on the first try.

---

## 1. High-Level Flow

```
YOU ──→ "Fix the payment module crash"
           │
           ▼
   ┌───────────────────────────────────┐
   │      ORCHESTRATOR (Rust)          │
   │                                   │
   │   1. INTAKE                        │
   │      Parse natural language        │
   │      Identify target files/scope   │
   │                                   │
   │   2. RECONNAISSANCE                │
   │      Read target files             │
   │      Check git history             │
   │      Read error logs / traces      │
   │      Look at related modules       │
   │                                   │
   │   3. PROMPT CRAFTING               │
   │      Synthesize context into       │
   │      a precise, detailed prompt    │
   │                                   │
   │   4. APPROVAL GATE ──→ You review  │
   │                                   │
   │   5. DISPATCH                      │
   │      Spawn PTY session(s)          │
   │      Feed prompt to Claude Code    │
   │      Monitor output                │
   │                                   │
   │   6. REPORT                        │
   │      Summarize what changed        │
   └───────────────────────────────────┘
```

---

## 2. Rust Architecture

### 2.1 New Module: `src-tauri/src/orchestrator/`

```
src-tauri/src/orchestrator/
├── mod.rs           # Pub exports, register with Tauri
├── manager.rs       # OrchestratorManager — session registry & lifecycle
├── planner.rs       # Prompt parsing, task decomposition
├── recon.rs         # Codebase reconnaissance (read files, git log, etc.)
├── dispatch.rs      # Launch Claude Code in PTY, feed prompt, monitor
└── report.rs        # Parse agent output, summarize results
```

### 2.2 Core Structs

```rust
// manager.rs

/// Represents one dispatched agent session
pub struct AgentSession {
    pub id: u32,                    // Matches PTY session ID
    pub name: String,               // "Claude Code - Payment Fix"
    pub task: String,               // The original task description
    pub prompt: String,             // The enriched prompt sent to the agent
    pub status: AgentStatus,
    pub pty_id: u32,                // References the PTY session
    pub started_at: std::time::Instant,
    pub completed_at: Option<std::time::Instant>,
}

pub enum AgentStatus {
    Pending,       // Awaiting approval
    Running,       // PTY session active, agent working
    Completed(i32), // Exit code
    Failed(String), // Error description
}

/// A complete orchestration run (one user command → potentially multiple agents)
pub struct OrchestrationRun {
    pub id: Uuid,
    pub original_command: String,
    pub plan: String,               // How the orchestrator interpreted the command
    pub agents: Vec<AgentSession>,
    pub created_at: std::time::Instant,
    pub status: RunStatus,
}

pub enum RunStatus {
    AwaitingApproval,
    Running,
    Completed,
    Cancelled,
}
```

### 2.3 The OrchestratorManager

```rust
// manager.rs

pub struct OrchestratorManager {
    runs: RwLock<HashMap<Uuid, OrchestrationRun>>,
    active_run: RwLock<Option<Uuid>>,     // The current "in focus" run
    provider_config: RwLock<ProviderConfig>,
}

impl OrchestratorManager {
    /// Step 1: User says "fix the payment module crash"
    /// Step 2: Orchestrator does reconnaissance
    pub async fn plan_command(
        &self,
        command: String,
        workspace_path: String,
        state: &AppState,
    ) -> Result<OrchestrationRun, String> {
        // 1. Parse the command to identify targets
        // 2. Do reconnaissance (read files, git log, etc.)
        // 3. Craft enriched prompts per agent needed
        // 4. Store as a run in AwaitingApproval status
        // 5. Return the plan to the frontend
    }

    /// Step 3: User approves → dispatch agents
    pub fn approve_run(&self, run_id: Uuid, state: &AppState) -> Result<(), String> {
        // For each agent in the run:
        //   1. terminal_create() → spawn PTY running `claude`
        //   2. terminal_write() → feed the enriched prompt
        //   3. Store PTY ID → Agent ID mapping
        //   4. Set status to Running
    }

    /// Monitor output, detect completion
    pub fn handle_pty_output(&self, pty_id: u32, data: &[u8]) {
        // Match PTY ID to AgentSession
        // Stream data to frontend
        // Detect completion markers
    }

    /// Report results
    pub fn generate_report(&self, run_id: Uuid) -> Result<String, String> {
        // Collect all agent outputs
        // Summarize changes (git diff, files modified)
        // Return human-readable report
    }
}
```

---

## 3. The Reconnaissance Step (This Is The Secret Sauce)

This is what makes your orchestrator different. Before touching any agent, it gathers context:

```rust
// recon.rs

pub struct ReconContext {
    pub target_files: Vec<String>,
    pub file_contents: HashMap<String, String>,
    pub git_log: Vec<GitCommit>,
    pub git_diff: String,
    pub errors: Vec<String>,
    pub project_structure: Vec<String>,
    pub dependencies: HashMap<String, String>,
}

pub async fn reconnoiter(
    command: &str,
    workspace: &str,
    state: &AppState,
) -> Result<ReconContext, String> {
    // 1. Ask LLM: "Given this command, what files are likely relevant?"
    //    → Returns: ["src/payment.ts", "src/types.ts"]

    // 2. Read those files via fs_read_file / fs_read_dir
    // 3. Check git log for recent changes to those files
    // 4. Check git diff for uncommitted changes
    // 5. Look at the project's directory structure
    // 6. Return the full context
}
```

### Example reconnaissance in action:

**User says:** *"Fix the payment module crash"*

**Orchestrator queries the LLM:**
```
System: You are a reconnaissance planner. Given a user's command and a
project structure, list the files and information you need to understand
the problem before dispatching a coding agent.

Project files:
  src/payment.ts
  src/payment.test.ts
  src/types.ts
  src/api/transaction.ts
  ...

User command: "Fix the payment module crash"

Return a JSON list of reconnaissance actions needed.
```

**LLM responds:**
```json
[
  { "action": "read_file", "path": "src/payment.ts" },
  { "action": "read_file", "path": "src/types.ts" },
  { "action": "git_log", "file": "src/payment.ts", "count": 10 },
  { "action": "git_diff" },
  { "action": "list_directory", "path": "src/api" }
]
```

**Orchestrator executes these against Soryq's existing commands, then crafts:**

```
🧠 Reconnaissance Complete:

Target: src/payment.ts (line 142: processPayment())
Context:
  - Function expects `transaction.status` to be `StatusEnum`
  - API migration on commit a3f2b1c changed return type to `{ status: string }`
  - No type guard exists — null pointer when status doesn't match
  - 3 call sites affected

Prompt for Claude Code:
  "Fix the type mismatch in src/payment.ts caused by commit a3f2b1c.
   The API now returns { status: string } but processPayment()
   expects StatusEnum. Add a type guard, update the three call sites,
   and add a test for the new guard. The full code context is below..."
```

---

## 4. PTY / Claude Code Integration

Building on Soryq's existing `terminal_create` and `terminal_write`:

### Launching Claude Code non-interactively

```rust
// dispatch.rs

pub fn dispatch_agent(
    task: &AgentTask,
    workspace: &str,
    state: &AppState,
) -> Result<u32, String> {
    let enriched_prompt = task.prompt.clone();

    // Claude Code can accept a prompt via:
    //   claude "prompt text here"
    // or via stdin:
    //   echo "prompt" | claude
    //
    // We use the argument form so output is directly visible.

    let shell_cmd = format!(
        "claude \"{}\"",
        enriched_prompt.replace('"', "\\\"")
    );

    // Spawn a PTY session running this command
    // (Soryq's existing terminal_create infrastructure)
    let on_data = Channel::new(move |data| {
        // Forward output to the frontend
        // Also check for completion markers
    });
    let on_exit = Channel::new(move |exit_code| {
        // Mark agent as completed/failed
    });

    let pty_id = commands::terminal::terminal_create(
        80, 24,                                 // cols, rows
        Some(workspace.to_string()),             // cwd
        Some("claude".to_string()),              // shell_program
        on_data, on_exit,
        state,
    )?;

    // The shell_cmd is passed as args through terminal_write
    // Or we can construct the PTY to directly run claude + prompt
    commands::terminal::terminal_write(pty_id, &format!("{}\n", shell_cmd), state)?;

    Ok(pty_id)
}
```

**Alternative approach** (cleaner): Run `claude` as the shell program with the prompt as an argument. We already have `shell_program` support in `terminal_create`, so we might just need to extend it to support passing a command string to execute instead of a login shell.

---

## 5. Approval Gates

The user said these are fine. Here's how they thread through:

```
User: "Fix payment module crash, then commit"
       │
       ▼
Orchestrator plans the run:
  ┌─────────────────────────────────────────┐
  │ 🧠 PLAN                                  │
  │                                          │
  │ Task: Fix payment module type mismatch   │
  │ Agent: Claude Code                       │
  │ Reconnaissance done: ✓                   │
  │   → Read src/payment.ts (234 lines)      │
  │   → Read src/types.ts (89 lines)         │
  │   → Git log: commit a3f2b1c broke type   │
  │   → Identified 3 call sites to update    │
  │                                          │
  │ Prompt: 847 chars (see full prompt)      │
  │                                          │
  │ After: Will commit with message:         │
  │   "fix: add type guard for transaction   │
  │    status in processPayment"             │
  │                                          │
  │ [Approve & Launch] [Modify Prompt] [Cancel]│
  └─────────────────────────────────────────┘
       │
       ▼ (Approved)
       
Claude Code runs in its PTY, you see output stream live.
When it finishes:
  ┌─────────────────────────────────────────┐
  │ ✅ Agent Complete (exit code: 0)         │
  │                                          │
  │ Changes:                                 │
  │   src/payment.ts  +18 / -7              │
  │   src/types.ts     +4 / -0              │
  │   src/payment.test.ts  +32 / -0         │
  │                                          │
  │ Committed: a1b2c3d                        │
  │   "fix: add type guard for transaction   │
  │    status in processPayment"             │
  │                                          │
  │ [Approve Commit] [Review Diff] [Amend]   │
  └─────────────────────────────────────────┘
```

The approval gates operate at two levels:
1. **Dispatch approval** — approve the plan + prompts before agents launch
2. **Action approval** — approve commits/destructive actions (optional, configurable)

---

## 6. Svelte Frontend: Command Center Panel

A dedicated panel in Soryq's UI. Rough sketch:

```
┌──────────────────────────────────────────────────────────┐
│  ☰ Command Center                           [X] [—] [□]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │ ● ● ●  Agent Sessions                              ││
│  │                                                      ││
│  │  ┌─────────────────────────────────────────┐        ││
│  │  │ 🟢 Claude Code — Payment Fix            │        ││
│  │  │  Fix type mismatch in processPayment()  │        ││
│  │  │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │        ││
│  │  │  ✅ src/payment.ts  fixed               │        ││
│  │  │  ✅ src/types.ts    updated             │        ││
│  │  │  ⏳ src/payment.test.ts  writing...     │        ││
│  │  └─────────────────────────────────────────┘        ││
│  │                                                      ││
│  │  ┌─────────────────────────────────────────┐        ││
│  │  │ ⏸️ Claude Code — README Update          │        ││
│  │  │  Awaiting approval...                   │        ││
│  │  └─────────────────────────────────────────┘        ││
│  │                                                      ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │ 💬  Fix the payment module crash and update the     ││
│  │     docs while you're at it                         ││
│  │                                                     ││
│  │  [Send]  [🧠 Plan First]           ⚡ 0 active      ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

The key UI states:
- **Input bar** — type natural language commands
- **Agent session cards** — one per running/completed agent
- **Live stream** — each card shows its agent's output in real-time
- **Approval dialogs** — inline cards that pause and ask for confirmation
- **Status summary** — what changed, exit codes, git diff stats

---

## 7. Files to Create / Modify

### New files in `src-tauri/src/`:

| File | Purpose |
|------|---------|
| `orchestrator/mod.rs` | Module declaration, pub exports |
| `orchestrator/manager.rs` | `OrchestratorManager` — run lifecycle, session registry |
| `orchestrator/planner.rs` | Command parsing & task decomposition via `ai_complete` |
| `orchestrator/recon.rs` | Codebase reconnaissance using existing FS/git commands |
| `orchestrator/dispatch.rs` | Spawn Claude Code in PTY, feed prompt, wire up channels |
| `orchestrator/report.rs` | Parse agent output, summarize results |
| `commands/orchestrator.rs` | Tauri commands: `orchestrator_plan`, `orchestrator_approve`, `orchestrator_status` |

### New files in `src/lib/` (Svelte):

| File | Purpose |
|------|---------|
| `components/command-center/CommandCenter.svelte` | Main command center panel |
| `components/command-center/CommandInput.svelte` | Input bar |
| `components/command-center/AgentCard.svelte` | Per-agent status card |
| `components/command-center/PlanReview.svelte` | Plan approval dialog |
| `components/command-center/ReportView.svelte` | Completion summary |

### Modified files:

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Register `orchestrator` module + new Tauri commands |
| `src-tauri/src/state.rs` | Add `OrchestratorManager` to `AppState` |
| `src-tauri/src/commands/mod.rs` | Add `orchestrator` module |
| `src/lib/stores/` | New store for orchestrator state |

---

## 8. Implementation Priority

### Phase A — Core Loop (1-2 weeks)
1. Create `orchestrator/` module with `OrchestratorManager`
2. Implement `planner.rs` — parse command → structured tasks via `ai_complete`
3. Implement `recon.rs` — read files, git log, diff via existing commands
4. Implement `dispatch.rs` — spawn `claude "prompt"` in PTY, wire channels
5. Wire approval gate (dispatch-level)
6. Simple Svelte panel with input + agent cards

### Phase B — Fidelity (1 week)
7. Streaming agent output per card
8. Multi-agent orchestration (parallel dispatch)
9. Completion detection and report generation
10. Action-level approval gates (commit confirm)

### Phase C — Polish (1 week)
11. Conversation history (saved orchestration runs)
12. Keyboard shortcuts for common commands
13. Prompt templates / saved plans
14. Error recovery (retry failed agents with modified prompts)

---

## 9. How It's Different From Other Orchestrators

| Other orchestrators | Soryq Command Center |
|---|---|
| "Agent A, do task. Agent B, do task." | "Let me understand the problem first, then craft a precise prompt." |
| Dispatch without context | Reconnaissance-first: reads files, checks git, gathers context |
| Generic routing | Deep integration with the workspace (Soryq's own FS, git, terminal) |
| Agents figure out context themselves (wasting tokens) | Agents receive fully-contextualized prompts (first-try success) |
| No visibility into agent work | Live stream per agent, approval gates, structured reports |
| Web-based or CLI-only | Native Tauri app with Svelte UI + terminal grid |

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Claude Code prompt injection | The orchestrator pre-validates and sanitizes prompts; user reviews at approval gate |
| Agent runs forever | Timeout per agent (default 5 min, configurable); cancel button in UI |
| Multiple agents conflict (editing same file) | Orchestrator tracks target files; warns on conflict; sequences if needed |
| LLM reconnaissance is slow | Cache file reads; parallelize reconnaissance queries |
| Prompt too long for Claude | Orchestrator summarizes when context is large; prioritizes most relevant files |
| Claude Code not installed | Orchestrator checks `which claude` before dispatching; clear error message |
