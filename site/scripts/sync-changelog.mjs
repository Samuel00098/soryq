// Copies the repo-root CHANGELOG.md into site/ so it ships with the Vercel
// deploy (which only uploads the site/ directory — the root file isn't included,
// which is why the deployed /changelog page was empty). Runs as `prebuild`.
//
// Locally the repo root is present, so this refreshes site/CHANGELOG.md from the
// source of truth on every build. On Vercel only site/ is uploaded, so the root
// file is absent — we no-op and the bundled copy (uploaded from this last local
// build) is used. changelog.ts reads ./CHANGELOG.md (cwd = site/) at build time.
import { existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)); // site/scripts
const src = path.resolve(here, '../../CHANGELOG.md'); // repo root
const dest = path.resolve(here, '../CHANGELOG.md'); // site/CHANGELOG.md

if (existsSync(src)) {
  copyFileSync(src, dest);
  console.log('[sync-changelog] copied repo-root CHANGELOG.md -> site/CHANGELOG.md');
} else if (existsSync(dest)) {
  console.log('[sync-changelog] repo root not present (Vercel); using bundled site/CHANGELOG.md');
} else {
  console.warn('[sync-changelog] no CHANGELOG.md found at root or in site/ — /changelog will be empty');
}
