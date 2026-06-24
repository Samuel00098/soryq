import { stats } from '@/lib/config';

export function Stats() {
  return (
    <section className="!py-0 -mt-5">
      <div className="container">
        <div className="glass reveal grid grid-cols-2 px-6 py-9 md:grid-cols-4">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`px-[18px] py-2 text-center md:border-r md:border-[var(--glass-border)] md:last:border-r-0 ${
                i % 2 === 0 ? 'border-r border-[var(--glass-border)] md:border-r' : ''
              } ${i < 2 ? 'border-b border-[var(--glass-border)] pb-5 md:border-b-0 md:pb-2' : 'pt-5 md:pt-2'}`}
            >
              <span className="text-gradient-white block text-[clamp(1.5rem,3vw,2rem)] font-extrabold tracking-[-0.02em]">
                {s.value}
              </span>
              <span className="mt-1.5 block text-[0.92rem] font-semibold text-ink">{s.label}</span>
              <span className="mt-[3px] block text-[0.8rem] text-muted">{s.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
