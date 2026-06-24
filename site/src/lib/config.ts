// ── Single source of truth for site content/links ─────────────────────────
// Edit these as the project evolves — every component reads from here.

// Production domain, resolved at build time from Vercel's system env var —
// whatever custom domain is bound to the project (any name/TLD), else the
// .vercel.app domain. Not tied to a specific domain. Falls back to the current
// live URL for local builds. See `url` below + src/lib/site-url.ts.
export const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://site-flame-phi.vercel.app';

export const site = {
  name: 'Soryq',
  tagline: 'A lightweight, terminal-first developer workspace for keyboard-centric professionals.',
  description:
    'Soryq unifies a real PTY terminal grid, a CodeMirror editor, a live web-preview proxy with DOM inspector, and Git — in one fast, native, keyboard-driven window. No Electron. Sub-second startup.',
  version: '0.4.4',
  // Canonical site URL, resolved at build time from whatever production domain
  // is bound to the Vercel project (see productionUrl above). og:url / canonical
  // / social-card links auto-switch to that domain on the first deploy after
  // it's bound — no code change, and not tied to any specific domain.
  url: productionUrl,

  // Where launch/waitlist emails should go. CHANGE THIS to your real address.
  contactEmail: 'hello@soryq.app',
};

// ── Downloads ──────────────────────────────────────────────────────────────
// Downloads are CLOSED for now: every card renders a "Coming soon" state
// instead of a live installer link.
//   • TO RE-OPEN: set `downloadsAvailable = true` — the hrefs below already point
//     at the real public installers (soryq-releases), so nothing else needs to
//     change to go live.
//   • TO MOVE to site-hosted files later: drop installers into site/public/downloads/
//     and swap each `href` to the commented `/downloads/...` path below.
export const downloadsAvailable = false;

const RELEASE_BASE = 'https://github.com/Samuel00098/soryq-releases/releases/download/v0.4.4';

export const downloads = [
  {
    os: 'Windows',
    icon: 'windows',
    note: '10 / 11 · 64-bit',
    file: 'Windows installer (.exe)',
    href: `${RELEASE_BASE}/Soryq_0.4.4_x64-setup.exe`,
    // site-hosted (future): '/downloads/Soryq_x64-setup.exe'
  },
  {
    os: 'macOS',
    icon: 'apple',
    note: 'Apple Silicon · 64-bit',
    file: 'Disk image (.dmg)',
    href: `${RELEASE_BASE}/Soryq_0.4.4_aarch64.dmg`,
    // site-hosted (future): '/downloads/Soryq_aarch64.dmg'
  },
  {
    os: 'Linux',
    icon: 'linux',
    note: 'x86_64',
    file: 'AppImage (.AppImage)',
    href: `${RELEASE_BASE}/Soryq_0.4.4_amd64.AppImage`,
    // site-hosted (future): '/downloads/Soryq_x86_64.AppImage'
  },
];

// ── Media (real app screenshot + demo video) ──────────────────────────────
// Drop the files into `site/public/media/` (see that folder's README.txt), then
// flip the *Ready flags to true. Until then the hero shows the CSS mockup and the
// demo section shows a "coming soon" poster.
export const media = {
  screenshot: '/media/screenshot.png',
  screenshotReady: false, // true → hero shows the real screenshot instead of the mockup

  video: '/media/demo.mp4',
  videoPoster: '/media/demo-poster.png', // optional still shown before play
  videoReady: false, // true → demo section shows the real <video>
};

// ── Screenshots gallery ("A closer look") ──────────────────────────────────
// A grid of real app captures. Drop each PNG into `site/public/media/` using the
// filename below, then flip that shot's `ready` flag to true. Until then the tile
// shows a polished, labelled placeholder so the section always looks intentional.
//   • `show`  — master switch for the whole section (set false to hide it entirely).
//   • Capture tip: grab each pane at the app's native window size, 16:10-ish.
export const gallery = {
  show: true,
  shots: [
    {
      file: '/media/shot-terminal.png',
      ready: false,
      title: 'Multi-pane terminal grid',
      blurb: 'Up to four live PTY shells in a single window, with drag-to-resize layouts.',
      accent: 'var(--green)',
    },
    {
      file: '/media/shot-editor.png',
      ready: false,
      title: 'CodeMirror 6 editor',
      blurb: '15+ languages, Vim mode, minimap, and format-on-save.',
      accent: 'var(--violet)',
    },
    {
      file: '/media/shot-preview.png',
      ready: false,
      title: 'Live preview + DOM inspector',
      blurb: 'Click any element to inspect it — then send it straight to the AI prompt.',
      accent: 'var(--sky)',
    },
    {
      file: '/media/shot-ai.png',
      ready: false,
      title: 'AI assistant & orchestrator',
      blurb: 'Bring your own key; the assistant can see and drive the whole app.',
      accent: 'var(--teal)',
    },
    {
      file: '/media/shot-git.png',
      ready: false,
      title: 'Git in the sidebar',
      blurb: 'Review diffs, browse history, and commit/push in milliseconds.',
      accent: 'var(--violet-bright)',
    },
    {
      file: '/media/shot-palette.png',
      ready: false,
      title: 'Command palette',
      blurb: 'One keyboard bar to jump to files, views, terminals, and settings.',
      accent: 'var(--green)',
    },
  ],
};

// ── Pricing (placeholder until finalized) ──────────────────────────────────
export const pricing = {
  status: 'coming-soon' as 'coming-soon' | 'live',
  price: null as string | null, // e.g. '$29' — null shows "Coming soon"
  perks: [
    'Every feature, no tiers',
    'A full year of updates',
    'Priority email support',
    'Use it for commercial work',
  ],
};

export const stats = [
  { value: 'Sub-second', label: 'Cold start', sub: 'Native Tauri 2 shell' },
  { value: '~40–80 MB', label: 'Memory footprint', sub: '5–10× lighter than Electron' },
  { value: '15+', label: 'Languages', sub: 'Syntax, Vim mode, format-on-save' },
  { value: '1 window', label: 'Everything in', sub: 'Terminal · editor · preview · git' },
];

export const features = [
  {
    title: 'Multi-pane terminal grid',
    body: 'Full PTY shell sessions on xterm.js with 1–4 pane layouts, per-platform shell detection, and drag-to-resize.',
    accent: 'var(--green)',
  },
  {
    title: 'CodeMirror 6 editor',
    body: 'Syntax highlighting for 15+ languages, built-in Vim mode, minimap, word wrap, and format-on-save.',
    accent: 'var(--violet)',
  },
  {
    title: 'Live preview proxy',
    body: 'A built-in HTTP/WebSocket proxy routes your dev server through a managed port and injects dev tools automatically.',
    accent: 'var(--cyan)',
  },
  {
    title: 'AI assistant — bring your own key',
    body: 'A built-in assistant that can see and drive the whole app — voice refinement, commit messages, inline ghost-text, and an agent orchestrator. Wire up your own OpenAI, Anthropic, Google, Groq, or OpenRouter key, or run fully local with Ollama / LM Studio. Keys live in your OS keychain; nothing routes through our servers.',
    accent: 'var(--sky)',
  },
  {
    title: 'DOM inspector',
    body: 'Click any element in the live preview to inspect its tag, styles, selectors, and attributes — then send it (with a screenshot) straight to the AI prompt bar.',
    accent: 'var(--amber)',
  },
  {
    title: 'Git integration',
    body: 'Review staged/unstaged changes, inspect diffs, browse history, and commit/push — all from the sidebar in milliseconds.',
    accent: 'var(--violet-bright)',
  },
  {
    title: 'Command palette',
    body: 'One keyboard bar to jump to files, views, terminals, the formatter, and settings instantly.',
    accent: 'var(--green)',
  },
];

export const comparison = {
  cols: ['Soryq', 'VS Code', 'Warp'],
  rows: [
    { label: 'Startup speed', values: ['Sub-second (native)', '~2–5 seconds', 'Fast'], win: 0 },
    { label: 'Workspace shell', values: ['Tauri 2 (Rust)', 'Electron (Node)', 'Native (Rust)'], win: 0 },
    { label: 'Multi-pane PTY', values: ['Yes', 'Integrated tab', 'Primary focus'], win: 0 },
    { label: 'Code editor', values: ['CodeMirror 6', 'Monaco', 'None'], win: 0 },
    { label: 'Preview proxy', values: ['Yes + DOM inspector', 'Extension needed', 'None'], win: 0 },
    { label: 'Memory footprint', values: ['~40–80 MB', '~500 MB–1.5 GB', '~300–500 MB'], win: 0 },
  ],
};
