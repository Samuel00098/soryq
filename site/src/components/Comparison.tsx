import { comparison as c } from '@/lib/config';

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-green">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const cols = 'grid-cols-[1.3fr_1fr_1fr_1fr]';

export function Comparison() {
  return (
    <section id="compare">
      <div className="container">
        <div className="section-head reveal">
          <span className="eyebrow">How it stacks up</span>
          <h2 className="section-title">Native speed, a fraction of the memory.</h2>
        </div>

        <div className="glass reveal overflow-hidden" role="table" aria-label="Feature comparison">
          {/* Horizontal scroll wrapper for narrow screens */}
          <div className="min-w-full overflow-x-auto">
            <div className="min-w-[460px]">
              <div className={`grid ${cols} border-b border-[var(--glass-border)]`} role="row">
                <div className="flex items-center bg-white/[0.03] px-[18px] py-4" role="columnheader" />
                {c.cols.map((col, i) => (
                  <div
                    key={col}
                    className={`flex items-center bg-white/[0.03] px-[18px] py-4 text-[0.95rem] font-bold ${
                      i === 0 ? 'text-[var(--teal-bright)]' : 'text-ink'
                    }`}
                    role="columnheader"
                  >
                    {col}
                  </div>
                ))}
              </div>

              {c.rows.map((r) => (
                <div key={r.label} className={`grid ${cols} border-b border-[var(--glass-border)] last:border-b-0`} role="row">
                  <div className="flex items-center px-[18px] py-4 text-[0.92rem] font-semibold text-ink" role="rowheader">
                    {r.label}
                  </div>
                  {r.values.map((v, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-[7px] px-[18px] py-4 text-[0.92rem] ${
                        i === r.win ? 'font-semibold text-ink' : 'text-soft'
                      } ${i === 0 ? 'cmp-soryq-col' : ''}`}
                      role="cell"
                    >
                      {i === r.win && <Check />}
                      {v}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
