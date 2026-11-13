// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Copies the brand files the site serves into public/brand (gitignored), so the site never keeps its own copies:
 * the logo kit's lockups, icons and social cards (design/logo/kit), the logo's motion (design/logo/motion), Kaatu
 * standing for the press kit (design/mascot) and the day-and-night art (packages/ui/src/theme/art). Kaatu's atlases are
 * the site's own 480 px sheets in public/kaatu (scripts/kaatu-atlas.mjs), not copies. Files are copied, never
 * imported, so the site still imports no Taalcut package (dependency-cruiser: website-stands-alone).
 *
 *   node scripts/brand-assets.mjs           copy (runs before dev, build and typecheck)
 *   node scripts/brand-assets.mjs --check   fail if a source file is missing
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(site, '..');
const out = join(site, 'public/brand');

const lockups = ['two-colour', 'four-colour'].flatMap((c) =>
  ['', '-small'].flatMap((s) => ['light', 'dark'].map((t) => `taalcut-horizontal${s}-${c}-${t}.svg`)),
);

/** [source relative to the repo, destination relative to public/brand] */
export const BRAND_FILES = [
  ...lockups.map((f) => [`design/logo/kit/svg/${f}`, f]),
  // The Avartan symbol alone, for the coded app window's bar and the footer (WEB2).
  ...['two-colour', 'four-colour'].flatMap((c) => ['light', 'dark'].map((t) => `taalcut-symbol-small-${c}-${t}.svg`)).map((f) => [`design/logo/kit/svg/${f}`, f]),
  ...['favicon.svg', 'favicon.ico', 'favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'maskable-512.png'].map(
    (f) => [`design/logo/kit/web/${f}`, f],
  ),
  ['design/logo/kit/social/social-preview-1280x640.png', 'social-preview-1280x640.png'],
  ['design/logo/kit/social/avatar-1024.png', 'avatar-1024.png'],
  // Kaatu standing, on a transparent background, for the press kit.
  ['design/mascot/source/concept.png', 'kaatu/kaatu-press.png'],
  ...['taalcut-mark.js', 'choreography.js', 'mark-geometry.js'].map((f) => [`design/logo/motion/${f}`, `motion/${f}`]),
  ...['sun', 'moon', 'star-1', 'star-2', 'star-3'].map((a) => [`packages/ui/src/theme/art/${a}.webp`, `theme/${a}.webp`]),
];

const missing = BRAND_FILES.filter(([from]) => !existsSync(join(repo, from))).map(([from]) => from);
if (missing.length > 0) {
  console.error(`Brand files missing:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
if (!process.argv.includes('--check')) {
  for (const [from, to] of BRAND_FILES) {
    const target = join(out, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repo, from), target);
  }
}
