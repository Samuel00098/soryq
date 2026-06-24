import { site } from '@/lib/config';

const DownloadIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
);

export function CTA() {
  return (
    <section className="!py-[clamp(40px,7vw,80px)]">
      <div className="container">
        <div className="cta glass reveal relative overflow-hidden px-6 py-[clamp(40px,6vw,72px)] text-center">
          <div className="bloom inset-x-[10%] -top-[40%] h-[320px]" aria-hidden="true" />
          <h2 className="relative text-[clamp(1.8rem,4.5vw,2.8rem)] font-extrabold tracking-[-0.02em]">
            Ship faster, in one window.
          </h2>
          <p className="relative mx-auto mt-4 max-w-[50ch] text-[1.05rem] text-soft">
            Native, fast, and built for focus. Download {site.name} and bring your terminal, editor,
            preview, and Git together.
          </p>
          <div className="relative mt-7 flex flex-wrap justify-center gap-3.5">
            <a className="btn btn-primary" href="#download">
              <DownloadIcon /> Download Soryq
            </a>
            <a className="btn btn-ghost" href="/changelog">
              See what&apos;s new
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
