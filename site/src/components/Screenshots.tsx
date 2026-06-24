import { gallery } from '@/lib/config';

// "A closer look" — a grid of real app captures. Each tile renders a framed
// screenshot once its `ready` flag is true (see config → gallery), and a
// polished, labelled placeholder until then, so the section always looks done.
export function Screenshots() {
  const shots = gallery.show ? gallery.shots : [];
  if (shots.length === 0) return null;

  return (
    <section id="screenshots">
      <div className="container">
        <div className="section-head reveal max-w-[640px]">
          <span className="eyebrow">A closer look</span>
          <h2 className="section-title">Every surface, one window.</h2>
          <p className="section-sub">
            Real captures of Soryq at work — terminal, editor, live preview, AI, and Git, each a
            keystroke away.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-6">
          {shots.map((s, i) => {
            const feature = i === 0;
            return (
              <figure
                key={s.file}
                className={`shot glass reveal flex flex-col overflow-hidden p-3 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-[var(--glass-border-strong)] ${
                  feature ? 'sm:col-span-2 lg:col-span-6' : 'lg:col-span-3'
                }`}
                style={{ ['--c' as string]: s.accent }}
              >
                <div className="relative overflow-hidden rounded-xl border border-[var(--glass-border)] bg-black/35">
                  <div className="flex items-center gap-[7px] border-b border-[var(--glass-border)] bg-white/[0.03] px-3 py-2.5" aria-hidden="true">
                    <span className="tl tl-r !h-2.5 !w-2.5" />
                    <span className="tl tl-y !h-2.5 !w-2.5" />
                    <span className="tl tl-g !h-2.5 !w-2.5" />
                  </div>
                  {s.ready ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={`block h-auto w-full object-cover ${feature ? 'aspect-[16/8]' : 'aspect-[16/10]'}`}
                      src={s.file}
                      alt={s.title}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div
                      className={`shot-ph flex flex-col items-center justify-center gap-4 ${
                        feature ? 'aspect-[16/8]' : 'aspect-[16/10]'
                      }`}
                    >
                      <span className="shot-glyph" aria-hidden="true" />
                      <span className="pill-soon">Screenshot coming soon</span>
                    </div>
                  )}
                </div>
                <figcaption className="flex flex-col gap-[3px] px-2 pb-1.5 pt-3.5">
                  <strong className="text-[1rem] font-semibold tracking-[-0.01em]">{s.title}</strong>
                  <span className="text-[0.9rem] text-soft">{s.blurb}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
