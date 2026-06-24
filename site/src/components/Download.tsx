import { downloads, downloadsAvailable, site } from '@/lib/config';

const icons: Record<string, string> = {
  windows: 'M3 5.5 10 4.5v7H3zM10 4.3 21 3v8.5H10zM3 12.5h7v7l-7-1zM10 12.5h11V21l-11-1.5z',
  apple:
    'M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.9-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.9c-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.6 2.3 2.8 2.2 1.1 0 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.7-2.1c.9-1.2 1.2-2.4 1.2-2.5 0 0-2.3-.9-2.5-3.5zM14.3 5.8c.6-.8 1-1.8.9-2.8-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-1 2.7 1 0 2-.5 2.7-1.2z',
  linux:
    'M12 2c-2.2 0-3.5 1.8-3.5 4 0 1.4.3 2.3.3 3.4 0 1.2-1.2 2.3-2 3.8-.9 1.6-1.8 3.3-1.8 4.7 0 .8.5 1.2 1.2 1.2.5 0 .8-.3 1.2-.6.2 1 1 1.5 2 1.7.4.6 1.4 1.1 2.6 1.1s2.2-.5 2.6-1.1c1-.2 1.8-.7 2-1.7.4.3.7.6 1.2.6.7 0 1.2-.4 1.2-1.2 0-1.4-.9-3.1-1.8-4.7-.8-1.5-2-2.6-2-3.8 0-1.1.3-2 .3-3.4 0-2.2-1.3-4-3.5-4z',
};

export function Download() {
  return (
    <section id="download">
      <div className="container">
        <div className="section-head reveal max-w-[620px]">
          <span className="eyebrow">Download</span>
          <h2 className="section-title">Get {site.name} for your platform.</h2>
          <p className="section-sub">
            Native installers for Windows, macOS, and Linux.
            {!downloadsAvailable && ' Builds are being prepared — they’ll be available here shortly.'}
          </p>
        </div>

        <div className="mx-auto grid max-w-[440px] grid-cols-1 gap-5 md:max-w-none md:grid-cols-3">
          {downloads.map((d) => (
            <article key={d.os} className="card glass reveal flex flex-col gap-[18px] p-6">
              <div className="flex items-center gap-3.5 text-ink">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d={icons[d.icon]} />
                </svg>
                <div>
                  <h3 className="text-[1.15rem] font-semibold">{d.os}</h3>
                  <span className="text-[0.82rem] text-muted">{d.note}</span>
                </div>
              </div>

              {downloadsAvailable ? (
                <a className="btn btn-primary w-full justify-center" href={d.href} download>
                  Download {d.file}
                </a>
              ) : (
                <span
                  className="btn w-full justify-center border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-muted hover:translate-y-0"
                  aria-disabled="true"
                >
                  Coming soon
                </span>
              )}

              <span className="text-center text-[0.8rem] text-muted">{d.file}</span>
            </article>
          ))}
        </div>

        <p className="mt-8 text-center text-[0.9rem] text-muted">
          Windows, macOS &amp; Linux · Signed auto-updates built in.
        </p>
      </div>
    </section>
  );
}
