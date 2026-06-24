import { media } from '@/lib/config';

export function Demo() {
  const hasPoster = media.screenshotReady || media.videoReady;
  const poster = media.videoReady ? media.videoPoster : media.screenshot;

  return (
    <section id="demo">
      <div className="container">
        <div className="section-head reveal max-w-[640px]">
          <span className="eyebrow">See it in action</span>
          <h2 className="section-title">A real workflow, start to finish.</h2>
          <p className="section-sub">
            Watch a terminal, editor, live preview, and Git move together in one window — no
            tab-hopping, no context loss.
          </p>
        </div>

        <div className="player glass reveal relative mx-auto max-w-[960px] overflow-hidden p-3.5">
          <div className="bloom inset-x-[10%] -top-[30%] h-[320px]" aria-hidden="true" />

          {media.videoReady ? (
            <video
              className="relative block aspect-[16/10] h-auto w-full rounded-xl bg-black"
              controls
              preload="none"
              playsInline
              poster={media.videoPoster}
            >
              <source src={media.video} type="video/mp4" />
              Your browser doesn&apos;t support embedded video.
            </video>
          ) : (
            <div
              className="relative flex aspect-[16/10] flex-col items-center justify-center gap-[18px] rounded-xl border border-[var(--glass-border)] bg-cover bg-center"
              style={{
                backgroundColor: 'rgba(0,0,0,0.4)',
                backgroundImage: hasPoster ? `url(${poster})` : undefined,
              }}
            >
              <span
                className="grid h-[72px] w-[72px] place-items-center rounded-full pl-1 text-[#04201d]"
                style={{
                  background: 'linear-gradient(135deg, var(--teal-bright), var(--sky))',
                  boxShadow: '0 12px 40px -8px rgba(154, 163, 176, 0.6)',
                }}
                aria-hidden="true"
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <span className="pill-soon">Demo video coming soon</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
