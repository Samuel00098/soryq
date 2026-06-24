import { features } from '@/lib/config';

// Bento spans — first tile is the large featured one; index 3 is a full-width
// banner (the AI / bring-your-own-key tile).
const spans = ['big', '', '', 'full', '', '', ''];

export function Features() {
  return (
    <section id="features">
      <div className="container">
        <div className="section-head reveal max-w-[640px]">
          <span className="eyebrow">Everything in one window</span>
          <h2 className="section-title">A whole workflow, no tab-hopping.</h2>
          <p className="section-sub">
            Terminal, editor, preview, and Git — unified and keyboard-driven, so you stay in flow
            instead of juggling apps.
          </p>
        </div>

        <div className="bento">
          {features.map((f, i) => (
            <article
              key={f.title}
              className={`tile glass reveal ${spans[i] ?? ''}`}
              style={{ ['--c' as string]: f.accent }}
            >
              <span className="glyph" aria-hidden="true" />
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
