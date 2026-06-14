// ── Complete changelog, parsed from the project's CHANGELOG.md ──────────────
// Runs at build time (Node). Reads the real CHANGELOG.md so the page always
// matches the app's release history — nothing to maintain by hand here.
import fs from 'node:fs';
import path from 'node:path';

export type ChangeTag = 'New' | 'Improved' | 'Fixed' | 'Security' | 'Removed' | 'Internal' | 'Section';

export interface ChangeEntry {
  tag: ChangeTag;
  html: string; // inline-markdown already converted to safe HTML
}

export interface Release {
  version: string;
  date: string; // ISO yyyy-mm-dd
  entries: ChangeEntry[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Minimal inline markdown: **bold** and `code`. Input is our own changelog,
// but we escape first anyway so stray angle brackets never inject markup.
function inline(s: string): string {
  let out = escapeHtml(s.trim());
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function tagFor(heading: string): ChangeTag {
  const h = heading.trim().toLowerCase();
  if (h.startsWith('add')) return 'New';
  if (h.startsWith('chang')) return 'Improved';
  if (h.startsWith('fix')) return 'Fixed';
  if (h.startsWith('secur')) return 'Security';
  if (h.startsWith('remov')) return 'Removed';
  if (h.startsWith('internal')) return 'Internal';
  if (h.startsWith('initial')) return 'New';
  return 'Improved';
}

function readChangelog(): string {
  const candidates = [
    path.resolve(process.cwd(), '../CHANGELOG.md'),
    path.resolve(process.cwd(), 'CHANGELOG.md'),
    path.resolve(process.cwd(), '../../CHANGELOG.md'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
    } catch {
      /* keep trying */
    }
  }
  return '';
}

function parse(raw: string): Release[] {
  const lines = raw.split(/\r?\n/);
  const releases: Release[] = [];
  let cur: Release | null = null;
  let curTag: ChangeTag = 'New';
  let last: ChangeEntry | null = null;

  const reRelease = /^##\s+\[v?([^\]]+)\]\s*-\s*(.+?)\s*$/;
  const reCategory = /^###\s+(.+?)\s*$/;
  const reBoldOnly = /^\*\*(.+?)\*\*\s*$/;
  const reBullet = /^[-*]\s+(.+?)\s*$/;

  for (const line of lines) {
    const mRel = line.match(reRelease);
    if (mRel) {
      cur = { version: mRel[1].trim(), date: mRel[2].trim(), entries: [] };
      releases.push(cur);
      curTag = 'New';
      last = null;
      continue;
    }
    if (!cur) continue;

    const mCat = line.match(reCategory);
    if (mCat) {
      curTag = tagFor(mCat[1]);
      last = null;
      continue;
    }

    const mBold = line.match(reBoldOnly);
    if (mBold) {
      cur.entries.push({ tag: 'Section', html: inline(mBold[1]) });
      last = null;
      continue;
    }

    const mBullet = line.match(reBullet);
    if (mBullet) {
      last = { tag: curTag, html: inline(mBullet[1]) };
      cur.entries.push(last);
      continue;
    }

    // Indented continuation of the previous bullet (multi-line entries).
    if (/^\s+\S/.test(line) && last && last.tag !== 'Section') {
      last.html += ' ' + inline(line);
      continue;
    }

    if (line.trim() === '') last = null;
  }

  return releases.filter((r) => r.entries.length > 0);
}

export const releases: Release[] = parse(readChangelog());
