// @ts-check
import { defineConfig } from 'astro/config';

// Update `site` to your real domain once you have one (used for SEO + sitemaps).
// Resolved at build time from Vercel's production-domain env var (a bound custom
// domain like soryq.app once set, otherwise the .vercel.app domain), falling
// back to the live URL for local builds. So Astro.site (OG image absolute URL +
// sitemap) auto-switches to soryq.app on the first deploy after the domain is
// bound, with no code change. (Mirrored in src/config.ts.)
const site = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'https://site-flame-phi.vercel.app';

export default defineConfig({
  site,
});
