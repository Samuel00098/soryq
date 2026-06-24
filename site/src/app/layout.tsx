import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { site, productionUrl } from '@/lib/config';
import { SiteEffects } from '@/components/SiteEffects';
import './globals.css';

// Self-hosted via next/font — no render-blocking Google CDN request, no layout
// shift; the variables are consumed by globals.css (--font-inter / --font-jetbrains).
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

// Social cards must be a raster image (1200×630) — SVG isn't rendered by
// Twitter/X, Facebook, LinkedIn, Slack, etc. Regenerate from `og-source.svg`
// with sharp if the brand art changes.
export const metadata: Metadata = {
  metadataBase: new URL(productionUrl),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s — ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  icons: { icon: '/logo.svg' },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    url: site.url,
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: `${site.name} — ${site.tagline}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    images: ['/og.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#07080b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>
        {/* Animated mesh-gradient background (decorative, see globals.css). */}
        <div className="site-bg" aria-hidden="true">
          <span className="orb orb-1" />
          <span className="orb orb-2" />
          <span className="orb orb-3" />
          <span className="orb orb-4" />
          <span className="beam" />
          <span className="grain" />
        </div>

        {/* Futuristic HUD layer: constellation canvas + scanlines + progress rail. */}
        <canvas className="fx-net" aria-hidden="true" />
        <div className="fx-scan" aria-hidden="true" />
        <div className="fx-progress" aria-hidden="true">
          <span />
        </div>

        {children}

        <div className="hud-readout mono" aria-hidden="true">
          <span className="hud-dot" /> Soryq // v{site.version}
        </div>

        <SiteEffects />
      </body>
    </html>
  );
}
