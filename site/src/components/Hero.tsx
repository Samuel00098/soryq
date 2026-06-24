'use client';

import { useEffect, useRef } from 'react';
import { site, media } from '@/lib/config';

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

const ChangesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 3v18h18" />
    <path d="m7 14 4-4 3 3 5-6" />
  </svg>
);

const points = [
  { icon: '⚡', text: 'No Electron · ~40–80 MB RAM' },
  { icon: '⌨️', text: 'Keyboard-driven, single window' },
  { icon: '🦀', text: 'Built on Tauri 2 (Rust) + React' },
  { icon: '🔑', text: 'Bring your own AI key · stored in your OS keychain' },
];

export function Hero() {
  const termRef = useRef<HTMLDivElement>(null);

  // Live-typing terminal. Falls back to the static markup (command + output
  // already visible) when motion is reduced.
  useEffect(() => {
    const term = termRef.current;
    const typedEl = term?.querySelector<HTMLElement>('[data-typed]');
    const outEl = term?.querySelector<HTMLElement>('[data-out]');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!term || !typedEl || !outEl || reduce) return;

    const seq = [
      { cmd: 'npm run dev', out: ['VITE ready in 312 ms', '➜ Local: http://localhost:5173'] },
      { cmd: 'git commit -m "ship it"', out: ['[main 9f2c1a] ship it', '3 files changed, 48 insertions(+)'] },
      { cmd: 'cargo build --release', out: ['Compiling soryq v0.4.4', 'Finished release in 4.2s'] },
    ];
    term.classList.add('typing');
    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      let i = 0;
      while (!cancelled) {
        const step = seq[i % seq.length];
        typedEl.textContent = '';
        outEl.innerHTML = '';
        for (const ch of step.cmd) {
          if (cancelled) return;
          typedEl.textContent += ch;
          await sleep(42 + Math.random() * 48);
        }
        await sleep(360);
        for (const line of step.out) {
          if (cancelled) return;
          const div = document.createElement('div');
          div.className = 'out-line';
          if (/^➜|insertion|Finished|changed/.test(line)) div.classList.add('dim');
          div.textContent = line;
          outEl.appendChild(div);
          requestAnimationFrame(() => div.classList.add('show'));
          await sleep(240);
        }
        await sleep(2100);
        i++;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="hero pt-[clamp(48px,7vw,90px)]">
      <div className="container grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <a
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--glass-border)] bg-[var(--glass-bg)] px-3 py-1.5 text-[0.82rem] text-soft transition-colors hover:border-[var(--glass-border-strong)] hover:text-ink"
            href="/changelog"
          >
            <span className="h-[7px] w-[7px] rounded-full bg-green shadow-[0_0_10px_var(--green)]" />
            v{site.version} is out — see what&apos;s new
          </a>

          <h1 className="text-[clamp(2.3rem,5.2vw,3.7rem)] font-extrabold leading-[1.05] tracking-[-0.03em]">
            The terminal-first workspace that <span className="text-gradient">stays out of your way</span>.
          </h1>

          <p className="mt-[22px] max-w-[52ch] text-[1.12rem] text-soft">{site.description}</p>

          <div className="mt-8 flex flex-wrap gap-3.5">
            <a className="btn btn-primary" href="#download">
              <DownloadIcon /> Download Soryq
            </a>
            <a className="btn btn-ghost" href="/changelog">
              <ChangesIcon /> See what&apos;s new
            </a>
          </div>

          <ul className="mt-[34px] flex flex-col gap-2.5 text-[0.95rem] text-soft">
            {points.map((p) => (
              <li key={p.text} className="flex items-center gap-2.5">
                <span aria-hidden="true">{p.icon}</span> {p.text}
              </li>
            ))}
          </ul>
        </div>

        {/* App-window mockup mirroring Soryq's 3-pane layout */}
        <div className="reveal relative">
          <div className="mock glass">
            <div className="mock-titlebar">
              <span className="tl tl-r" />
              <span className="tl tl-y" />
              <span className="tl tl-g" />
              <span className="mock-title mono">soryq · ~/projects/app</span>
            </div>

            {media.screenshotReady ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="mock-shot"
                src={media.screenshot}
                alt="Soryq running with a terminal grid, code editor, and live preview"
              />
            ) : (
              <div className="mock-body" ref={termRef} data-term>
                <div className="pane pane-term">
                  <div className="term-line">
                    <span className="prompt">❯</span>
                    <span className="cmd typed" data-typed>npm run dev</span>
                    <span className="caret" />
                  </div>
                  <div className="term-out" data-out>
                    <div className="out-line">VITE ready in 312 ms</div>
                    <div className="out-line dim">➜ Local: http://localhost:5173</div>
                  </div>
                </div>
                <div className="mock-cols">
                  <div className="pane pane-term2">
                    <span className="prompt green">❯</span> <span className="cmd dim">git status</span>
                    <div className="line s2" />
                    <div className="run">
                      <span className="dot-g" /> running
                    </div>
                  </div>
                  <div className="pane pane-code">
                    <div className="code"><span className="kw" /><span className="t" /></div>
                    <div className="code"><span className="fn" /><span className="t" /></div>
                    <div className="code"><span className="num" /><span className="t" /></div>
                    <div className="code"><span className="t long" /></div>
                    <div className="code"><span className="t long" /></div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div
            className="absolute inset-[10%_5%] -z-10 blur-[50px]"
            style={{ background: 'radial-gradient(60% 60% at 50% 40%, rgba(174, 182, 194, 0.38), transparent 70%)' }}
            aria-hidden="true"
          />
        </div>
      </div>
    </section>
  );
}
