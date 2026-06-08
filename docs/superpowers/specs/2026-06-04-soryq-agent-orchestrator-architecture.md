# Soryq Agent Orchestrator Architecture

## Goal
Turn Soryq into a local control plane that can accept a goal, route it to one terminal agent or a swarm, monitor execution, isolate filesystem changes with git worktrees, and surface approvals only at explicit gates.

## Product shape
Soryq should support three execution modes:

1. **Direct terminal task** — one agent, one terminal, one task.
2. **Worktree-backed task** — one agent gets its own git worktree and runs isolated edits.
3. **Swarm task** — multiple agents coordinate under a parent task graph.

The default for code-changing work should be **single-agent + worktree**. That gives the user the “talk to one terminal in the middle of other terminals” experience while keeping changes isolated.

## Design principles
- **Terminal-native first**: agents live in PTY panes, not a chat sidebar.
- **Visible orchestration**: state, ownership, and handoffs must be readable at a glance.
- **Local-first control**: every action happens on the user’s machine unless explicitly configured otherwise.
- **Explicit gates**: approvals are workflow states, not hidden prompts.
- **Rollback-safe**: every meaningful edit path should be backed by git diff + snapshot history.
- **Low friction for single-agent work**: the smallest useful unit is one terminal agent with a bounded scope.

## Existing Soryq surfaces to reuse
- `src/lib/stores/terminal.ts`: per-project terminal sessions, panes, agent presets, prompt routing.
- `src/lib/stores/workspace.ts`: per-project persistence and project switching.
- `src/lib/stores/runs.ts`: preset agent commands and quick-run launchers.
- `src/lib/components/terminal/*`: terminal panes, prompt bar, agent output handling.
- `src/lib/components/review/ReviewPanel.svelte`: diff review surface.
- `src/lib/components/preview/PreviewPanel.svelte`: live preview verification loop.
- `src/lib/components/workspace/TasksPanel.svelte`: a natural home for task state.

## Architecture overview

### 1) Orchestrator Core
A Rust-backed orchestration service owns the task graph and execution lifecycle.

Responsibilities:
- accept a goal
- decompose it into tasks
- assign tasks to terminals or swarms
- create and manage leases
- pause, resume, retry, reassign, or abort work
- decide when to request approval
- record checkpoints and final outcomes

This layer should be the only place that knows the full lifecycle of a task.

### 2) Task Graph Manager
Represents work as a graph, not a flat queue.

Node types:
- goal
- task
- subtask
- verification step
- approval gate
- rollback point

Edges:
- dependency
- handoff
- blocks
- verifies
- revises

This allows one terminal to work alone while still letting the orchestrator add optional verification or follow-up tasks.

### 3) Agent Adapter Layer
Each CLI agent gets a small adapter with a stable contract.

Adapter fields:
- launch command
- prompt injection method
- output parsing rules
- completion detection
- attention detection
- capability flags
- supported worktree behavior

Capabilities should be explicit, for example:
- read-only
- can edit files
- can run tests
- can apply patches
- supports checkpoint handoff
- supports background mode

### 4) Terminal Session Manager
Builds on the current PTY model and adds orchestration metadata.

Each terminal session should carry:
- owner task id
- project id
- agent preset / adapter id
- lease expiry
- cwd / worktree path
- execution mode
- current status
- last event time
- pinned files / scope

A session may be:
- unassigned
- leased by one task
- shared for observation only
- user-controlled/manual

### 5) Worktree Manager
Responsible for per-task filesystem isolation.

When a task is file-changing, the orchestrator should:
- create a git worktree from the active repo
- assign the task to that worktree
- route the agent terminal into that worktree path
- record the branch / ref / commit base
- capture diffs against the base branch
- remove or archive the worktree after completion

Worktrees should be default for:
- edits
- refactors
- multi-step fixes
- parallel agent work

Worktrees may be skipped for:
- read-only research
- log inspection
- quick diagnosis
- tasks that only run commands without touching files

### 6) Artifact and Verification Layer
Every task should produce artifacts that prove what happened.

Artifacts:
- raw terminal output
- test logs
- git diff
- files touched
- preview URL or screenshot hash
- DOM inspection data
- checkpoint snapshot
- approval decision log

Verification should be a first-class step, not an afterthought. For frontend tasks, the preferred loop is:
preview inspect → edit → diff → test → verify → approve.

### 7) Persistence Layer
Persist orchestration state locally.

Store:
- goals
- task graph
- task state transitions
- session leases
- agent metadata
- approval records
- checkpoints
- rollback references
- per-project orchestration preferences

Use durable local storage for UI-facing state, and keep filesystem artifacts in the repo/worktree.

### 8) UI Layer
The UI should expose orchestration without hiding the terminals.

Primary surfaces:
- goal composer / command bar
- task board
- agent lane / terminal ownership view
- verification panel
- approval cards
- event timeline
- diff / preview / snapshot cross-links

The user should always be able to answer:
- what is running
- who owns it
- what it touched
- what it needs next
- what can be rolled back

## Core data model

### Task
- id
- projectId
- title
- goalId
- parentTaskId
- status
- priority
- executionMode (`direct`, `worktree`, `swarm`)
- assignedAgentId
- assignedSessionId
- worktreeId
- dependencies[]
- approvalsRequired[]
- checkpoints[]
- artifactIds[]
- createdAt / updatedAt / completedAt

### AgentSession
- id
- projectId
- terminalSessionId
- adapterId
- command
- cwd
- worktreePath
- leaseOwnerTaskId
- status
- lastHeartbeatAt
- attentionState
- capabilities[]

### Worktree
- id
- projectId
- baseBranch
- baseCommit
- path
- branchName
- ownerTaskId
- status
- createdAt
- archivedAt

### Event
- id
- taskId
- sessionId
- type
- timestamp
- payload

Event types:
- task_created
- task_assigned
- worktree_created
- terminal_started
- output_received
- attention_requested
- verification_passed
- verification_failed
- approval_requested
- approval_granted
- approval_denied
- task_completed
- task_failed
- task_rolled_back

## Task lifecycle

### Direct terminal task
1. User creates task.
2. Orchestrator assigns a single agent session.
3. Session runs in the chosen terminal.
4. Orchestrator watches output.
5. Task completes or enters a blocked state.
6. User approves or intervenes only if required.

### Worktree-backed task
1. User creates task that can modify files.
2. Orchestrator creates a worktree.
3. A terminal session is leased to that task.
4. Agent runs inside the worktree.
5. Verifier collects diff/test artifacts.
6. Orchestrator requests approval if the task crosses a gate.
7. Worktree is merged, archived, or discarded.

### Swarm task
1. Parent goal is decomposed into subtasks.
2. Orchestrator assigns independent tasks to multiple agents.
3. Each task gets its own session and optionally its own worktree.
4. Subtasks report progress and artifacts back to the parent.
5. Parent task moves to verification and merge.

## Lease and ownership rules
- A terminal can be owned by at most one task at a time.
- A task can hold one exclusive agent lease or many observational links.
- Leases expire unless renewed by heartbeat.
- The orchestrator may preempt a lease if the session stalls or the user retakes control.
- Manual user input always overrides automation.

## Approval policy
Approvals should be triggered by policy, not by guesswork.

Examples:
- destructive file deletes
- git reset / rebase / force-push
- large multi-file rewrite
- task attempting to leave its worktree
- cross-project changes
- handoff from verification to ship

Approvals should be batchable so the user is not interrupted for every small step.

## Safety and conflict handling
- Worktree isolation prevents accidental overlap.
- File locks prevent two agents from editing the same file concurrently unless the user explicitly allows it.
- Every task has a rollback reference.
- Stalled sessions should be marked blocked, not silently failed.
- If the agent output diverges from the task plan, the orchestrator should surface it as a mismatch instead of pretending success.

## Integration with current Soryq code

### Terminal store
Extend the current terminal session info with orchestration metadata:
- task id
- worktree id
- lease state
- verification state
- approval state

### Workspace store
Persist orchestration state per project so switching projects preserves active agents, tasks, and worktrees.

### Runs/presets
Treat agent CLI presets as launchable adapters, not just shortcuts.

### Tasks panel
Use it as the primary user-facing task graph view.

### Review panel
Use it as the verification and approval surface.

### Preview panel
Use it as the live UI verification step for web tasks.

## Uniqueness for Soryq
This is where Soryq should differ from BridgeSpace-like tools:
- **one terminal, one task** as the default interaction model
- **worktree-backed isolation** as the default for edits
- **preview-driven verification** for frontend work
- **git diff + snapshot rollback** as a visible safety layer
- **task graph visibility** instead of just a memory hub
- **local control first** instead of a hidden remote swarm

## Rollout plan

### Phase 1 — Single-task orchestration
- goal input
- task creation
- assign one agent to one terminal
- basic status tracking
- task completion events

### Phase 2 — Worktree isolation
- create per-task worktrees
- route terminals into worktree cwd
- capture diff and artifact metadata
- archive/discard worktrees safely

### Phase 3 — Verification loop
- collect tests and diffs
- integrate preview verification
- approval cards and decision states
- blocked / needs-attention handling

### Phase 4 — Parallel tasks
- multiple terminal leases
- dependency edges
- parent/child task tracking
- merge back from subtasks

### Phase 5 — Polished orchestration UX
- task timeline
- ownership visibility
- rollback button
- reusable task templates
- task history and replay

## Non-goals
- Replacing the terminal with a chat-first interface.
- Building a cloud agent service in v1.
- Keeping agent memory in a proprietary remote graph.
- Letting agents modify the main workspace without isolation by default.

## Summary
Soryq’s orchestrator should behave like a local command center: assign one agent to one task, isolate edits with worktrees, verify work through real project artifacts, and keep the user in control at every meaningful gate.
