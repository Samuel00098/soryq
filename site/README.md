# Soryq — marketing site

The public landing page for Soryq. Built with [Next.js](https://nextjs.org) (App
Router) and [Tailwind CSS v4](https://tailwindcss.com), and exported as a static
site (`output: 'export'`) so it loads fast and ranks well. Lives in this `site/`
folder, fully separate from the desktop app's build.

## Run locally

```bash
cd site
npm install
npm run dev      # http://localhost:3000
```

## Build

```bash
npm run build    # static export → site/out
npx serve out    # preview the production build locally (any static server works)
```

## Pages

- **`/`** — landing page (hero, stats, features, demo, screenshots, comparison,
  pricing, download, CTA).
- **`/changelog`** — release notes. Generated automatically from the app's root
  `CHANGELOG.md` at build time (see `src/lib/changelog.ts`), so it always matches
  the app.
- **`/privacy`**, **`/terms`** — legal pages.

## Where to edit things

- **`src/lib/config.ts`** — single source of truth: app name, tagline, version,
  contact email, downloads, pricing, feature list, and the comparison table. Edit
  here first.
- **`src/app/globals.css`** — design tokens (colors, glass surfaces) mirroring
  the app's look, the animated background, and the reusable primitives. Tailwind
  is imported here; brand tokens are exposed to utilities via the `@theme` block.
- **`src/components/*.tsx`** — page sections (Nav, Hero, Stats, Features, Demo,
  Screenshots, Comparison, Pricing, Download, CTA, Footer) plus `SiteEffects`
  (the constellation canvas, scroll-progress rail, and reveal-on-scroll).
- **`public/logo.svg`** — the Soryq mark (also used as favicon + social preview).

### Distribution (downloads)

Installers are served from the site itself. To go live:

1. Drop the built installers into `public/downloads/` (see that folder's
   `README.txt`).
2. Set `downloadsAvailable = true` in `src/lib/config.ts`. Buttons switch from
   "Coming soon" to real download links. Adjust the filenames in
   `downloads[].href` to match your builds.

> Large binaries shouldn't be committed to git — prefer uploading them on your
> host, or use Git LFS.

### Pricing

Pricing currently shows a **"Coming soon"** state with an email waitlist. To set
a price:

- In `src/lib/config.ts`, set `pricing.status = 'live'` and
  `pricing.price = '$29'` (or whatever).
- The waitlist form opens the visitor's mail client to `site.contactEmail`. For a
  real list, swap the handler in `src/components/Pricing.tsx` for a form endpoint
  (Formspree, ConvertKit, Buttondown, etc.).
- **Set `contactEmail` in `src/lib/config.ts` to your real address.**

## Deploy (Vercel)

This is a statically-exported site. The repo-root `vercel.json` already wires it
up: install/build run with `--prefix site` and the output directory is
`site/out`. Add your custom domain in Vercel → Settings → Domains; the canonical
URL, OG tags, and sitemap auto-switch to it via the `VERCEL_PROJECT_PRODUCTION_URL`
env var — no code change needed.

> The changelog reads the repo-root `CHANGELOG.md` at build time. The `prebuild`
> step (`scripts/sync-changelog.mjs`) copies it into `site/CHANGELOG.md` so the
> bundled copy is used when the repo root isn't part of the deploy context.
