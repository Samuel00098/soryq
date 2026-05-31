# Soryq — Agentic Orchestration & Monetization Plan

> **Status:** Draft v1 · **Date:** 2026-05-29 · **Owner:** Samuel Solesi
>
> Goal: evolve Soryq from a multi-pane terminal/IDE into a true **multi-agent orchestrator**
> (a planner agent that decomposes work, spawns and coordinates sub-agents across terminals,
> and synthesizes results) — while keeping the project open source and building a viable
> **open-core, paid-team-features** business around it.

---

## 1. Vision & Positioning

### 1.1 What we're building
A planner/orchestrator layer on top of Soryq's existing terminal mosaic. The user states a
high-level goal; a **planner agent** decomposes it into subtasks, **spawns one agent per
subtask** into isolated work environments, **monitors** their progress, and **synthesizes**
the outputs back into a coherent result — with the human reviewing and approving along the way.

### 1.2 The market (2026 landscape)
Multi-agent coding has split into three tiers:

| Tier | Description | Examples |
|------|-------------|----------|
| **1 — Interactive** | One session, agent + subagents, human watches | Claude Code subagents, Codex subagents |
| **2 — Parallel (local)** | Many agents in isolated **git worktrees**, dashboard + diff/merge control | Cursor 3 "Agents Window", Windsurf Wave 13, Conductor, Vibe Kanban, Claude Squad, Antigravity |
| **3 — Cloud** | Agents run in cloud VMs, no local terminal | Claude Code Web, Codex Web, Jules, Copilot Coding Agent |

Soryq today is a **"tiled IDE / single-window panes"** shape (the human is the orchestrator).
This plan moves Soryq into **Tier 2** (planner-driven parallel agents) while preserving the
tiled UX as the visible surface.

### 1.3 Our differentiator — keep this free, it wins adoption
**Soryq is agent-agnostic.** Nearly every competitor is locked to its own agent (Cursor→Cursor,
Windsurf→Cascade, Antigravity→Gemini). Soryq already detects and runs `codex`, `claude`,
`aider`, `opencode`, `copilot`, `antigravity`, etc. side-by-side in one mosaic. **No one owns
"the neutral cockpit where you run and orchestrate ANY agent CLI."** That is our wedge.

> **Strategic principle:** The agent-agnostic mosaic stays free and open to maximize adoption.
> We monetize the **orchestration, isolation, and team/governance** layer on top.

---

## 2. Current Architecture (what we already have)

The primitives for orchestration largely exist. Key seams identified in the codebase:

| Capability | Where | Notes |
|-----------|-------|-------|
| Spawn agent into pane | `src/lib/stores/terminal.ts:752` `spawnAgentPreset(command, cwd?)` | Detects agent type, finds/creates pane, grows mosaic |
| Read agent output | `src/lib/stores/terminal.ts:339` `getSessionOutputBuffer(id)` | Live output buffer per session |
| Command blocks (I/O + exit codes) | `src/lib/stores/terminal.ts:631–703` | `startCommandBlock` / `appendToCommandBlock` / `finalizeCommandBlock` |
| Agent detection | `src/lib/stores/terminal.ts:174–183, 294–303` | `AGENT_COMMAND_PATTERNS` |
| Dynamic pane allocation | `src/lib/components/terminal/TerminalPanel.svelte:18` | `registerMosaicGrow` callback |
| Layout / views | `src/lib/stores/layout.ts` | `activeView`: terminal/editor/preview/review/http/tasks |
| Command registry (UI actions) | `src/lib/stores/commandpalette.ts` | `registerCommand()` is extensible |
| Project/workspace context | `src/lib/stores/workspace.ts` | `activeProjectId`, `restoreProjectState` |
| **LLM client (already wired)** | `src/lib/services/openrouter-keychain.ts` | OpenRouter API key mgmt + voice refinement uses it |
| PTY backend | `src-tauri/src/commands/terminal.rs`, `src-tauri/src/pty/manager.rs` | `portable-pty`, per-session, rate-limited |

### 2.1 The one critical gap: **isolation**
All terminal sessions currently share the project root as `cwd`. Every serious Tier-2 tool uses
**git worktrees** so parallel agents don't clobber each other's files. Closing this gap is the
single biggest step from "panes that run agents" to "a real parallel orchestrator." It is also a
natural paid feature.

### 2.2 Tech stack (confirmed)
- **Frontend:** Svelte 5 (runes), Tauri 2 API, xterm.js 5, CodeMirror 6, Marked 18
- **Backend:** Tauri 2 (Rust), `portable-pty` 0.8, `tokio` 1, `dashmap` 5, `axum` 0.8, `keyring` 3

---

## 3. Orchestrator Architecture (target design)

Standard pattern: **Planner → Workers → Synthesis**, with the human in the loop.

```
┌─────────────────────────────────────────────────────────────┐
│  User goal: "Add OAuth login + tests + docs"                  │
└───────────────┬─────────────────────────────────────────────┘
                ▼
        ┌───────────────┐   LLM via existing OpenRouter client
        │   PLANNER      │   → structured plan:
        │   (decompose)  │     [{title, agentCmd, prompt, dependsOn[], cwd}]
        └───────┬───────┘
                ▼  for each ready subtask
        ┌───────────────────────────────────────────────┐
        │  spawnAgentPreset(cmd, worktreeCwd)            │  ← workers run in
        │  worker A   worker B   worker C  (mosaic panes)│    isolated worktrees
        └───────┬───────────────────────────────────────┘
                ▼  poll getSessionOutputBuffer + command blocks
        ┌───────────────┐
        │   MONITOR      │  detect: done / blocked / asking-question (exit codes, idle, markers)
        └───────┬───────┘
                ▼  outputs
        ┌───────────────┐
        │  SYNTHESIS     │  LLM merges results → summary, next wave, or merge plan
        └───────┬───────┘
                ▼
        Human review → approve merges (worktree → branch → main)
```

### 3.1 New module: `src/lib/stores/orchestrator.ts`
A thin TS orchestration layer (fast to iterate, reuses all existing primitives). Responsibilities:

1. **Plan** — call LLM with the user goal → return a structured plan (subtasks with assigned
   agent command, prompt, dependencies, target worktree). Reuse the structured-LLM-call pattern
   from `voice-refinement.ts`.
2. **Schedule** — topologically order subtasks by `dependsOn`; dispatch ready ones.
3. **Spawn** — loop `spawnAgentPreset(cmd, worktreeCwd)` per ready subtask; mosaic grows via
   `registerMosaicGrow`.
4. **Monitor** — poll `getSessionOutputBuffer(id)` + finalized command blocks; classify each
   worker as running / done / blocked / needs-input.
5. **Synthesize** — feed worker outputs back to the planner for the next wave or a final summary.
6. **Surface** — register actions via `commandpalette.ts:registerCommand()`; add a new
   `activeView: 'orchestrator'` planning/kanban panel in `layout.ts`.

### 3.2 Planner output schema (draft)
```ts
interface OrchestrationPlan {
  goal: string;
  subtasks: Subtask[];
}
interface Subtask {
  id: string;
  title: string;
  agentCmd: string;        // e.g. "claude", "codex", "aider"
  prompt: string;          // task-specific instructions fed to the agent
  dependsOn: string[];     // subtask ids that must finish first
  worktree?: string;       // branch/worktree name for isolation
  status: 'pending' | 'running' | 'blocked' | 'done' | 'failed';
}
```

### 3.3 Worktree isolation (Rust backend additions)
New commands in `src-tauri/src/commands/` (e.g. `worktree.rs`):
- `worktree_create(project_root, branch)` → creates a git worktree, returns its path
- spawn the worker's PTY with that worktree path as `cwd`
- `worktree_status(path)` → diff summary for review
- `worktree_merge(path, target)` / `worktree_remove(path)` → on approval/cleanup

This is the highest-leverage backend work and a clean paid-feature boundary.

### 3.4 Completion / progress detection
Heuristics, layered:
- Exit codes via existing command-block finalization
- Output idle timeout (no new bytes for N seconds)
- Sentinel markers the planner instructs agents to print (e.g. `__SORYQ_DONE__`)
- Prompt-detection (agent asking a question → route back to human or planner)

---

## 4. Implementation Roadmap (phased)

### Phase 0 — Foundations (1–2 weeks)
- [ ] Decide license change (see §5) **before** more external contributors arrive
- [ ] Spike: structured LLM plan call using existing OpenRouter client
- [ ] Define `OrchestrationPlan` / `Subtask` types in `src/lib/types/`

### Phase 1 — Minimal planner loop (2–3 weeks) — *free tier OK as a teaser*
- [ ] `orchestrator.ts` store: plan → spawn (no dependencies) → monitor → summarize
- [ ] Reuse `spawnAgentPreset` + `getSessionOutputBuffer` + command blocks
- [ ] Basic orchestrator panel (`activeView: 'orchestrator'`) showing subtasks + statuses
- [ ] Command-palette entries: "Plan & orchestrate", "Synthesize results"

### Phase 2 — Dependencies & isolation (3–4 weeks) — *PAID*
- [ ] Topological scheduling with `dependsOn`
- [ ] Rust `worktree_*` commands; spawn workers in isolated worktrees
- [ ] Diff/review UI per worktree; approve → merge flow
- [ ] Robust completion/blocked detection (markers + idle + exit codes)

### Phase 3 — Team & governance (4–6 weeks) — *PAID / ENTERPRISE*
- [ ] Shared workspaces & shared orchestration runs
- [ ] Run history / replay
- [ ] SSO, RBAC, audit logs, policy controls
- [ ] License gating module (separate from open core)

### Phase 4 — Optional cloud arm (later)
- [ ] Managed orchestration and/or managed inference billing (Tier 3 expansion)

---

## 5. Licensing & Monetization

### 5.1 Model: Open-core, paid team/pro features
Core is free + open (drives adoption); advanced/team features are paid. Proven by Grafana,
Plane, GitLab, Sentry.

### 5.2 License decision — **change from Apache 2.0**
Apache 2.0 is maximally permissive: anyone (incl. a competitor or cloud provider) can take
Soryq, add a paywall, and host/sell it against us with zero obligation to contribute back.

**Recommendation: relicense the open core to AGPL-3.0.**
- Stays genuine OSS (trust + adoption) but forces anyone hosting a *modified* version to
  open-source their changes → neutralizes freeriders.
- Precedent: Grafana, Plane CE, Mattermost, Bitwarden, Gitea; Redis re-adopted AGPL in 2025.

**Alternative: source-available (BSL / FSL / SSPL)** if we want to outright forbid competitors
from commercializing it. Not OSI-"open source," but transparent (MongoDB, Sentry, HashiCorp).
More protective, slightly more community friction.

> **Do the relicense now**, while the project is young and contributor count is low —
> relicensing later (needs every contributor's consent) is painful.

### 5.3 Free vs. Paid split
**Free / open core**
- The IDE, terminal mosaic, **agent-agnostic spawning** (our wedge — keep it free)
- Bring-your-own-key, single-machine use
- Manual multi-pane use + (optionally) a basic single-wave planner teaser

**Paid Pro / Team**
- The **orchestrator/planner** (decompose → spawn → synthesize, with dependencies)
- **Worktree isolation** + auto merge/conflict handling
- Team collaboration: shared workspaces, shared runs, run history/replay
- Governance: SSO, RBAC, audit logs, policy controls (enterprise tier — biggest revenue)
- Later: hosted/managed orchestration or managed inference billing

### 5.4 Open-core discipline
Do **not** ship paid features in the open repo and "trust" people not to use them. Gate paid
features behind a separate license/module. Copy Plane's model: commercial editions are built
*on top of* the community edition, not beside it.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Relicensing friction with existing contributors | Do it now while contributor count is low; get explicit consent |
| Parallel agents corrupting shared files | Worktree isolation (Phase 2) before promoting parallel orchestration |
| Planner produces bad decompositions | Human-in-the-loop approval before spawning; show plan first |
| Runaway agent cost (inference) | Budgets/limits per run; BYO-key in free tier shifts cost to user |
| Big players (Cursor/Antigravity) copy the cockpit | Lean on agent-agnostic neutrality + open community as moat |
| Detecting "agent done" is unreliable | Layered heuristics: exit codes + idle + sentinel markers |

---

## 7. Immediate Next Steps
1. **Decision:** confirm AGPL-3.0 (vs BSL) for the open core.
2. **Spike:** structured planner LLM call via existing OpenRouter client.
3. **Scaffold:** `src/lib/types/orchestration.ts` + `src/lib/stores/orchestrator.ts` (Phase 1).
4. **Backend design:** sketch `worktree_*` Rust commands (Phase 2 prep).

---

## Appendix A — Sources (2026 landscape research)
- Best Multi-Agent Coding Tools 2026 — Nimbalyst: https://nimbalyst.com/blog/best-multi-agent-coding-tools-2026/
- Cursor vs Windsurf vs Antigravity — Codecademy: https://www.codecademy.com/article/agentic-ide-comparison-cursor-vs-windsurf-vs-antigravity
- From Conductor to Orchestrator (2026) — htdocs.dev: https://htdocs.dev/posts/from-conductor-to-orchestrator-a-practical-guide-to-multi-agent-coding-in-2026/
- The Code Agent Orchestra — Addy Osmani: https://addyosmani.com/blog/code-agent-orchestra/
- ComposioHQ/agent-orchestrator — GitHub: https://github.com/ComposioHQ/agent-orchestrator
- 9 Open-Source Agent Orchestrators — Augment Code: https://www.augmentcode.com/tools/open-source-agent-orchestrators
- Open-core model — Wikipedia: https://en.wikipedia.org/wiki/Open-core_model
- Open Source vs Open Core — OneUptime: https://oneuptime.com/blog/post/2026-03-03-open-source-vs-open-core-whats-the-difference/view
- AGPL vs MIT for OSS SaaS — Monetizely: https://www.getmonetizely.com/articles/should-you-license-your-open-source-saas-under-agpl-or-mit-a-decision-guide-for-founders
- OSS Licensing MIT vs Apache vs AGPL 2026 — OSSAlt: https://ossalt.com/guides/oss-licensing-guide-mit-apache-agpl-2026
