import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { releases } from '@/lib/changelog';
import { site } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Changelog',
  description: `Release notes and what's new in ${site.name}.`,
  alternates: { canonical: '/changelog' },
};

const fmt = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

export default function ChangelogPage() {
  return (
    <>
      <Nav />

      <main className="log pt-[clamp(40px,6vw,72px)]">
        <header className="container mx-auto mb-[clamp(40px,6vw,64px)] max-w-[680px] text-center">
          <span className="eyebrow">Changelog</span>
          <h1 className="section-title">What&apos;s new in {site.name}</h1>
          <p className="section-sub mx-auto">Every notable change, newest first.</p>
        </header>

        <div className="container timeline">
          {releases.map((r) => (
            <article className="release reveal" id={`v${r.version}`} key={r.version}>
              <div className="rel-meta">
                <a className="ver" href={`#v${r.version}`}>
                  v{r.version}
                </a>
                <time dateTime={r.date}>{fmt(r.date)}</time>
              </div>

              <div className="rel-body glass">
                <ul>
                  {r.entries.map((e, i) =>
                    e.tag === 'Section' ? (
                      <li className="grp" key={i}>
                        <h4 dangerouslySetInnerHTML={{ __html: e.html }} />
                      </li>
                    ) : (
                      <li key={i}>
                        <span className={`tag t-${e.tag.toLowerCase()}`}>{e.tag}</span>
                        <span className="rel-txt" dangerouslySetInnerHTML={{ __html: e.html }} />
                      </li>
                    ),
                  )}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </main>

      <Footer />
    </>
  );
}
