import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Static export — the site is content-only (changelog parsed at build time, no
// server runtime), so it ships as plain static files just like the old Astro
// build. Output lands in `out/` (see vercel.json). `images.unoptimized` is
// required because the Next image optimizer needs a server, which a static
// export doesn't have; our images are already sized/optimized assets.
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  // The repo root and site/ each have a lockfile; pin the tracing root to site/
  // so Next doesn't infer the workspace root (and warn) from the app's lockfile.
  outputFileTracingRoot: here,
};

export default nextConfig;
