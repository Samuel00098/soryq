# Soryq Orchestrator Worktree + Review Slice

## Goal
Make Soryq’s agent orchestrator behave like the intended workflow for code-changing work: create an isolated task runtime, run one agent in one leased terminal, keep edits in a task-scoped worktree, and require explicit review before completion.

## Why this slice
The current implementation in `src/lib/stores/orchestrator.ts` is a phase-1 direct dispatcher:
- one user message can create one task
- one task leases one terminal
- the goal is auto-sent into the agent terminal
- terminal exit is treated as completion

That is useful, but it does not match the intended architecture in `docs/superpowers/specs/2026-06-04-soryq-agent-orchestrator-architecture.md`.

Missing behavior:
- no worktree-backed execution for code-changing work
- no explicit `in-review` state
- no distinction between `blocked` and `failed`
- no review gate between agent execution and task completion
- no separation between lifecycle, leasing, worktree management, and review policy

## BridgeMind comparison
BridgeMind’s public workflow is structurally closer to:
- task created
- agent starts work
- agent moves task to `in-review`
- human reviews and approves
- task becomes `complete`

BridgeMind’s public docs clearly expose task lifecycle and shared project/task context through BridgeMCP, but do not clearly document automatic git worktree creation per task.

Soryq should follow the stronger local-first variant:
- keep BridgeMind’s explicit review boundary
- add per-task worktree isolation as the default for code-changing work
- keep one-terminal-one-task leasing visible in the UI

## Recommended approach
Use a split-runtime design while keeping the current UI/store entrypoints.

Do not keep growing `src/lib/stores/orchestrator.ts` as the place that owns every orchestration concern.

Instead:
- keep the store as the UI-facing shell
- move orchestration behavior into focused service modules
- preserve the current panel and chat flow while changing the underlying lifecycle semantics

This is the smallest change that fixes the workflow model without prematurely moving the full orchestrator into Rust.

## Runtime shape
Keep these existing UI surfaces:
- `src/lib/components/orchestrator/OrchestratorPanel.svelte`
- `src/lib/stores/orchestrator.ts` as the public store surface
- current terminal integration in `src/lib/stores/terminal.ts`

Introduce internal orchestration modules under `src/lib/services/orchestrator/`:

### 1. `task-lifecycle.ts`
Owns:
- task types
- allowed state transitions
- timestamps and status mutation helpers
- retry / approval / cancellation transitions

This module decides what statuses mean.

### 2. `terminal-lease.ts`
Owns:
- spawning an agent preset
- assigning a terminal lease to a task
- releasing a lease
- reconciling terminal exit into lifecycle events

This module reports facts like “terminal exited” or “lease released”. It must not guess that terminal exit means success.

### 3. `worktree-manager.ts`
Owns:
- deciding the worktree path and branch name
- creating task worktrees for code-changing tasks
- storing base branch, base commit, branch name, and path metadata
- cleanup/archive/discard hooks

This module is responsible for task-scoped filesystem isolation.

### 4. `review-gate.ts`
Owns:
- deciding whether a finished task goes to `in-review`, `blocked`, or `failed`
- explicit approval decision state
- request-changes / approve / reject transitions

This module creates the human gate that the current implementation lacks.

## Task model
Replace the current task status model:
- `pending`
- `running`
- `done`
- `failed`

with an explicit workflow:
- `todo`
- `in-progress`
- `in-review`
- `complete`
- `blocked`
- `failed`
- `cancelled`

### Status semantics
- `todo`: created, ready to run, or returned for changes
- `in-progress`: leased to a running agent session
- `in-review`: agent execution finished and human review is required
- `complete`: approved and finished
- `blocked`: waiting on user input, credentials, approval, or unresolved ambiguity
- `failed`: unrecoverable launch/runtime/worktree/state error
- `cancelled`: intentionally stopped and not continuing

## Execution mode rules
Retain execution mode as an explicit field and expand behavior around it.

### Direct task
Use for:
- read-only investigation
- log inspection
- quick diagnosis
- tasks that do not need isolated edits

Completion rule:
- if the agent exits cleanly and there is no reviewable code-change path, the task may move directly to `complete`

### Worktree task
Default for:
- edits
- bug fixes
- refactors
- multi-file changes
- any request likely to modify the repo

Completion rule:
- terminal exit does not mean complete
- terminal exit becomes a lifecycle event
- task moves to `in-review` when the execution produced reviewable work

## Lifecycle behavior
### Create task
On task creation:
- infer `worktree` as the default execution mode for code-changing requests
- otherwise use `direct`
- initial status is `todo`

### Launch task
On launch:
1. create the worktree first when execution mode is `worktree`
2. spawn the chosen agent terminal
3. lease the terminal to the task
4. move the task to `in-progress`
5. deliver the full task prompt

### Agent finishes
When the terminal stops:
- direct read-only task → may become `complete`
- worktree/code-changing task → move to `in-review`
- unresolved human dependency → move to `blocked`
- unrecoverable launch/runtime/worktree problem → move to `failed`

### Review decision
In review:
- approve → `complete`
- request changes → back to `todo` while preserving task and worktree context
- reject/cancel → `cancelled`

## Concrete code changes
### `src/lib/stores/orchestrator.ts`
Keep responsibility for:
- persistence to `.soryq/orchestrator.json`
- per-project chat transcript
- wiring UI actions to orchestration services
- exposing the public store API used by the panel

Remove direct ownership of:
- lifecycle semantics
- worktree creation logic
- review classification rules
- terminal-exit-as-success assumptions

## New service modules
### `src/lib/services/orchestrator/task-lifecycle.ts`
Should export:
- task types
- transition helpers
- guards that reject invalid state transitions
- helpers for approve / request-changes / retry / cancel

### `src/lib/services/orchestrator/terminal-lease.ts`
Should export:
- lease task to terminal
- release terminal lease
- resend prompt
- terminal exit reconciliation hooks

It should use existing terminal store helpers rather than duplicating PTY logic.

### `src/lib/services/orchestrator/worktree-manager.ts`
Should export:
- derive task branch/worktree names
- create worktree metadata
- create/remove/archive/discard operations
- helpers for review display metadata

This will likely need Tauri command support if the current backend does not already expose safe git/worktree operations.

### `src/lib/services/orchestrator/review-gate.ts`
Should export:
- classify finished execution as `in-review`, `blocked`, or `failed`
- approval transition helpers
- request-changes helpers

## UI changes for this slice
Keep UI changes modest and focused.

### `OrchestratorPanel.svelte`
Add support for:
- displaying `todo`, `in-progress`, `in-review`, `blocked`, `failed`, `complete`, `cancelled`
- showing worktree-backed tasks distinctly
- showing assigned agent and terminal lease clearly
- showing worktree path / branch metadata when present
- review actions instead of only resend/release/delete for reviewable tasks

### Review-facing fields
For `in-review` tasks, show at minimum:
- assigned agent
- leased terminal session
- worktree path
- base branch
- task branch name
- changed-files count if available

## Persistence changes
Persist enough state so project switches and app restarts do not destroy review context.

Task persistence should include at least:
- execution mode
- status
- assigned session id
- worktree metadata when present
- review state metadata when present
- timestamps for created/started/completed/reviewed states

If a terminal lease is no longer live after reload:
- do not silently mark the task complete
- reconcile to `todo`, `blocked`, or `in-review` based on persisted facts

## Failure and safety rules
### `blocked` vs `failed`
Use `blocked` when:
- the agent asks for human input
- credentials or environment access are missing
- the task reaches a policy gate
- the task cannot continue without clarification

Use `failed` when:
- the agent could not be launched
- the worktree could not be created
- an invalid state transition is attempted
- an unrecoverable runtime error occurs

### Terminal ownership
Preserve the existing core invariant:
- one terminal can be owned by at most one task at a time

### Completion correctness
The system must stop treating terminal exit as synonymous with success.

That is the main behavioral bug in the current slice.

## Testing strategy
Add or update unit tests around orchestration behavior rather than UI appearance.

Required coverage:
- valid and invalid lifecycle transitions
- code-changing requests defaulting to `worktree`
- terminal exit moving worktree tasks to `in-review` instead of `complete`
- direct read-only tasks completing correctly
- blocked vs failed classification
- release/retry behavior preserving task integrity
- persistence reload preserving `in-review` and `blocked` tasks

## Non-goals for this slice
Do not include:
- swarm orchestration
- dependency graphs
- Rust-first orchestrator migration
- auto-merge or hidden merge behavior
- final approval automation without explicit human action

## Acceptance criteria
This slice is complete when:
1. code-changing orchestrator tasks default to worktree execution
2. a worktree-backed task creates and records isolated task metadata before agent execution
3. terminal exit no longer marks a worktree task complete
4. worktree-backed tasks move into `in-review`
5. review actions can explicitly approve, request changes, or cancel
6. blocked and failed states are distinct in both behavior and UI
7. persisted orchestration state survives reload without silently losing review context

## Follow-on work
Once this slice is stable, the next architecture step should be:
- artifact collection and richer review integration
- preview-driven verification hooks
- approval cards in the review surface
- parent/child task relationships and later swarm execution
