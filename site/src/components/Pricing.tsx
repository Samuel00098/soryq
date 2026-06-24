'use client';

import { useState } from 'react';
import { pricing, site } from '@/lib/config';

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-green">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export function Pricing() {
  const isLive = pricing.status === 'live' && pricing.price;
  const [email, setEmail] = useState('');

  // Waitlist: opens the user's mail client pre-addressed. Swap for a real form
  // endpoint (Formspree, ConvertKit, Buttondown…) when you're ready.
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subject = encodeURIComponent(`Notify me when ${site.name} licenses launch`);
    const body = encodeURIComponent(`Please add me to the launch list.\n\nMy email: ${email.trim()}`);
    window.location.href = `mailto:${site.contactEmail}?subject=${subject}&body=${body}`;
  };

  return (
    <section id="pricing">
      <div className="container">
        <div className="section-head reveal max-w-[620px]">
          <span className="eyebrow">Pricing</span>
          <h2 className="section-title">{isLive ? 'One simple license.' : 'Pricing is on the way.'}</h2>
          <p className="section-sub">
            {isLive
              ? `Buy once, own it. ${site.name} is a focused tool with a price to match.`
              : `${site.name} is in active development and builds aren't public yet. Paid licenses launch soon — drop your email to get launch pricing and a heads-up.`}
          </p>
        </div>

        <div className="card glass reveal relative mx-auto max-w-[460px] overflow-hidden p-8 text-center sm:px-8 sm:py-10">
          <div className="bloom inset-x-0 -top-1/2 h-[260px]" aria-hidden="true" />

          <div className="relative mb-7 flex flex-col items-center gap-1">
            <span className="text-gradient-white text-[clamp(2.4rem,6vw,3.2rem)] font-extrabold tracking-[-0.02em]">
              {isLive ? pricing.price : 'Coming soon'}
            </span>
            <span className="text-[0.85rem] text-muted">{isLive ? 'one-time' : 'launching soon'}</span>
          </div>

          <ul className="relative mb-7 flex flex-col gap-3 text-left">
            {pricing.perks.map((p) => (
              <li key={p} className="flex items-center gap-[11px] text-[0.95rem] text-soft">
                <Check /> {p}
              </li>
            ))}
          </ul>

          {isLive ? (
            <a className="btn btn-primary w-full justify-center" href="#download">
              Get {site.name}
            </a>
          ) : (
            <form className="relative flex flex-col gap-[9px] sm:flex-row" onSubmit={onSubmit}>
              <input
                className="field min-w-0 flex-1"
                type="email"
                name="email"
                required
                placeholder="you@example.com"
                aria-label="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn btn-primary justify-center" type="submit">
                Notify me
              </button>
            </form>
          )}
          {!isLive && (
            <p className="relative mt-3.5 text-[0.8rem] text-muted">
              No spam — just a single email when licenses go live.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
