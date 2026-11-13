// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEATURES } from '#content/features';
import { PAGES } from '#content/pages';
import { FOOTER_LINKS, NAV } from '#content/site';
import { SITE_ROOT, filesUnder } from './source-files';

/** The exported path of each static page.tsx (dynamic segments expanded from their content). */
function routes(): string[] {
  const statics = filesUnder('src/app', ['page.tsx'])
    .map((f) => f.replace(/^src\/app/, '').replace(/page\.tsx$/, ''))
    .filter((p) => !p.includes('['));
  return [...statics, ...FEATURES.map((f) => `/features/${f.slug}/`)].sort();
}

describe('the page registry', () => {
  it('has one entry per route, and a route per entry', () => {
    expect(PAGES.map((p) => p.path).sort()).toEqual(routes());
  });

  it('keeps descriptions short enough for a search result', () => {
    for (const p of PAGES) expect(p.description.length, p.path).toBeLessThanOrEqual(160);
  });

  it('links only to pages that exist', () => {
    const paths = new Set(PAGES.map((p) => p.path));
    for (const link of [...NAV, ...FOOTER_LINKS]) expect(paths.has(link.href), link.href).toBe(true);
  });

  it('keeps every feature page in the registry', () => {
    expect(existsSync(join(SITE_ROOT, 'src/app/features/[slug]/page.tsx'))).toBe(true);
    expect(FEATURES.map((f) => `/features/${f.slug}/`).every((p) => PAGES.some((e) => e.path === p))).toBe(true);
  });
});
