# Soryq — marketing site

The public landing page for Soryq. Built with [Astro](https://astro.build) (static, near-zero
JS) so it loads fast and ranks well. Lives in this `site/` folder, fully separate from the desktop
app's build.

## Run locally

```bash
cd site
npm install
npm run dev      # http://localhost:4321
```

## Build

```bash
npm run build    # outputs static files to site/dist
npm run preview  # preview the production build locally
```

## Pages

- **`/`** — landing page (hero, stats, features, comparison, pricing, download, CTA).
- **`/changelog`** — release notes. Generated automatically from the app's root
  `CHANGELOG.md` at build time (see `src/changelog.ts`), so it always matches the app.

## Where to edit things

- **`src/config.ts`** — single source of truth: app name, tagline, version, contact email,
  downloads, pricing, feature list, and the comparison table. Edit here first.
- **`src/styles/global.css`** — design tokens (colors, glass surfaces) mirroring the app's look.
- **`src/components/*.astro`** — page sections (Hero, Stats, Features, Comparison, Pricing,
  Download, CTA, Footer).
- **`public/logo.svg`** — the Soryq mark (also used as favicon + social preview image).

### Distribution (downloads)

Installers are served from the site itself. To go live:

1. Drop the built installers into `public/downloads/` (see that folder's `README.txt`).
2. Set `downloadsAvailable = true` in `src/config.ts`. Buttons switch from "Coming soon"
   to real download links. Adjust the filenames in `downloads[].href` to match your builds.

> Large binaries shouldn't be committed to git — prefer uploading them on your host, or use Git LFS.

### Pricing

Pricing currently shows a **"Coming soon"** state with an email waitlist. To set a price:

- In `src/config.ts`, set `pricing.status = 'live'` and `pricing.price = '$29'` (or whatever).
- The waitlist form opens the visitor's mail client to `site.contactEmail`. For a real list,
  swap the handler in `src/components/Pricing.astro` for a form endpoint (Formspree, ConvertKit,
  Buttondown, etc.).
- **Set `contactEmail` in `src/config.ts` to your real address.**

## Deploy (Vercel)

This is a static site; any static host works. For Vercel (a private repo deploys fine):

1. Push the repo to GitHub.
2. In Vercel, **New Project → import the repo**, then set:
   - **Root Directory:** `site`
   - **Framework Preset:** Astro (auto-detected); build `npm run build`, output `dist`.
3. Add your custom domain in Vercel → Settings → Domains, then update `site` in
   `astro.config.mjs` and `url` in `src/config.ts` to match.

> The changelog reads the repo-root `CHANGELOG.md` at build time. Keep `site/` inside the
> same repo as the app (root dir `site` on Vercel) so that file is present during the build.
