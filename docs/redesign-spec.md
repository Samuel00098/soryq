# Soryq Redesign — Design Spec (Phase 1, design-first)

**Direction chosen:** **"The Flow"** — a living stream of work as the default frame; the editor/terminal/preview are *summoned* (expand) and *kept* (pin), not permanent furniture. Warm, calm, editorial aesthetic. BYO-key/no-meter/offline forward.
**Status:** design only — no live-app changes. Build happens after the Svelte→React migration settles.
**See it (in order — each answers the previous one's question):**
1. [`redesign-mockup-flow.html`](./redesign-mockup-flow.html) ⭐ **the chosen concept** — clickable: expand cards → full editor/terminal/preview, pin cards to keep them.
2. [`redesign-mockup-canvas.html`](./redesign-mockup-canvas.html) — the warm/calm aesthetic the Flow uses (agents as named characters).
3. [`redesign-mockup-editor.html`](./redesign-mockup-editor.html) — how the editor + docked/spare terminals behave.
4. Earlier explorations (rejected): [`redesign-mockup.html`](./redesign-mockup.html) (glass, "too much"), [`redesign-mockup-calm.html`](./redesign-mockup-calm.html) (flat, too anonymous).

### The Flow — core model
- **Default frame = the stream.** You talk/type to the orchestrator (compose bar, bottom); agents' work arrives as **interactive cards** (diff, terminal run, preview, query result, review).
- **Cards are live + actionable** — approve/tweak a diff, inspect a preview, re-run a command.
- **Expand** any card → the full, real editor/terminal/preview as a focused sheet (the "IDE on demand"). `Esc` returns to the flow.
- **Pin** any card → it docks in the ambient **Pinned** column and stays beside you (this is how you "keep a terminal/preview around" without fixed panels).
- **Threads** (left) = parallel streams of work, one per feature/agent — navigation by *intent*, not folders.
- **Personality** = the orchestrator + named agent characters (Ada/Wren/Sol) speaking in plain language; the soul that makes it enjoyable to return to.
- Tools that aren't "live work" (Database, Serial/Arduino, Settings) still open as focused rooms, reachable via `⌘K` / voice / a quiet launcher.

This spec exists so the look is decided *before* we build, and so the build maps cleanly onto
[the market wedge](./market-research-2026.md): voice orchestration + your keys + personality —
the three things BridgeSpace and the rest don't have.

---

## 1. Three design principles (your three asks, made concrete)

| Your ask | How the design delivers it |
|---|---|
| **1. Catchy & beautiful** | Deep-slate glass with a soft neon bloom behind it; the orchestrator + dev-pet is the glowing centerpiece, not a buried panel. Motion is subtle (pet bob, mic pulse, live waveform) — alive, not noisy. |
| **2. Easy to use** | One obvious focal point (the orchestrator) you *talk* to. A 6-icon left rail with hover labels. Layout presets (Focus / Split / Canvas / Preview) instead of manual window juggling. |
| **3. Very understandable** | Every agent has a **role + colored LED + progress bar**. The status bar always says what's true (native, your key, offline voice, no meter). Nothing is unlabeled. |

**The non-negotiable:** the **orchestrator is the hero of the screen.** Every competitor hides AI in a sidebar. Soryq makes *talking to direct your fleet* the first thing you see — that's the whole pitch, rendered.

---

## 2. The visual system (extends your real tokens)

Built on `src/styles/global.css` — we don't throw away the existing glass, we intensify it.

- **Base:** `--bg-0:#07080b` → `--bg-2:#12141b` (deep slate, unchanged).
- **Glass:** `rgba(255,255,255,.04–.065)` surfaces, `22px` blur, `140%` saturate, white rim `.10–.18`, deep shadow. (Your current values.)
- **New: ambient neon bloom** — a blurred radial-gradient field (teal/sky/pink/green) *behind* the glass. This is the single biggest "futuristic" lever and it's pure CSS, near-zero cost.
- **Accent = state, not decoration.** Reuse the dev-pet's palette as a semantic system:
  - `--teal #22d3c7` → orchestrator / builder / primary action
  - `--sky #60a5fa` → reviewer / info
  - `--amber #f5b045` → scout / attention
  - `--green #34d399` → terminal / success / "live"
  - `--pink #f472b6` → keywords / accent pop
- **Glow rule:** accents always carry a matching `box-shadow` glow — that's what reads as "neon."
- **Type:** Inter for UI, JetBrains Mono for code/terminal. Uppercase micro-labels with letter-spacing for the "console" feel.

---

## 3. Information architecture (the layout)

```
┌─ Title bar ──────────── brand · [Focus|Split|Canvas|Preview] ─┐
├──────┬───────────────────────────────────────┬──────────────┤
│ rail │  ◆ ORCHESTRATOR  (pet · voice · mic)   │  context     │
│ ◆▤⌕  │     ↳ live waveform + transcript       │  • session   │
│ ⎇▦⬡  │                                        │  • task board│
│      │  ⬡ Agent fleet (role · LED · progress) │  • preview   │
│ ◐⚙   │  ▢ editor          ▢ terminal          │              │
├──────┴───────────────────────────────────────┴──────────────┤
│ status: native · 0.41s · 64MB · 🔑 your key · 🎙 offline · ◆ │
└──────────────────────────────────────────────────────────────┘
```

- **Left rail (64px):** Orchestrator, Files, Search, Source control, Database, Agents · then Theme, Settings. Icons with hover tooltips — discoverable but out of the way.
- **Center:** orchestrator card (hero) → fleet strip → editor/terminal. This column *is* the workspace.
- **Right (300px):** ambient context — session (provider/model/voice/spend), task board, live preview. Collapsible.
- **Layout presets** replace fiddly window management: **Focus** (one room), **Split** (two), **Canvas** (freeform board), **Preview** (app + terminal). These map to the `layout` action the orchestrator already supports.

---

## 4. Signature moments (the "catchy" details worth building well)

1. **The orchestrator greeting + live waveform** — the app feels like it's *listening*. First-run hero.
2. **Dev-pet as state, not gimmick** — its expression/glow reflects what the fleet is doing (idle, thinking, blocked, shipped). This is the retention hook; treat it as a first-class component.
3. **Agent cards that breathe** — LED + progress + role; hover lifts. Makes a fleet legible at a glance.
4. **The honesty status bar** — "your key · offline voice · no meter" is always visible. Quiet, constant reassurance that *this one is yours* — the anti-credit-meter message, never naggy.

---

## 5. Build phases (after design sign-off)

- **Phase 1 — DONE:** this spec + the mockup. Decide direction.
- **Phase 2 — Shell:** rebuild `AppShell` + title bar + rail + layout presets in React against the new tokens. Add the ambient-bloom layer and glass surface utilities to `global.css`.
- **Phase 3 — Orchestrator hero:** promote the orchestrator/voice/pet to the centerpiece component; wire the waveform to the existing VAD/voice pipeline.
- **Phase 4 — Panels:** port editor, terminal grid, git, db, preview, task board into the new layout (styles already scoped per the panel-CSS rule).
- **Phase 5 — Polish & motion:** pet states, transitions (consider the View Transitions API), empty/first-run states.

**Roadmap parking lot (not this redesign):** marketing-site refresh to match; **Telegram integration** (remote-control / notify / chat-to-build) — flagged as a *later* feature, deliberately out of scope here.

---

*This is a starting point, not a verdict. Open the mockup, react to it, and we adjust the direction before a single app file changes.*
