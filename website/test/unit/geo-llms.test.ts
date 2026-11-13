// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { PAGES } from '#content/pages';
import { SITE } from '#content/site';
import { FEATURE_GROUPS, FEATURES } from '#content/features';
import { featureGroupOf, LLMS_SECTIONS, llmsFullTxt, llmsSections, llmsTxt } from '#lib/llms/llms-txt';
import { listedPages, mirrorPath, mirrorSegments, pageForMirror } from '#lib/llms/mirror';
import { hasMarkdown, pageMarkdown } from '#lib/llms/pages-md';
import { absolute, pageMetadata } from '#lib/seo';

/** Every link target in a Markdown text. */
function links(md: string): string[] {
  return [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
}

/** The site paths a document links to, without query or hash. */
function sitePaths(md: string): string[] {
  return links(md)
    .filter((href) => href.startsWith(SITE.origin))
    .map((href) => new URL(href).pathname);
}

const mirrors = new Set(listedPages().map((p) => mirrorPath(p.path)));
const pagePaths = new Set(PAGES.map((p) => p.path));
const servedFiles = new Set(['/llms-full.txt']);

describe('llms.txt', () => {
  const txt = llmsTxt();

  it('follows the convention: an H1, a quoted summary, then sections of links', () => {
    const lines = txt.split('\n');
    expect(lines[0]).toBe(`# ${SITE.name}`);
    expect(lines[2]).toBe(`> ${SITE.description}`);
    for (const section of [...LLMS_SECTIONS, 'Optional']) expect(txt).toContain(`\n## ${section}\n`);
  });

  it('lists every listed page under its section (a feature page under its group), linking its .md mirror', () => {
    for (const p of listedPages()) {
      const line = `- [${p.title}](${absolute(mirrorPath(p.path))}): ${p.description}`;
      expect(txt, p.path).toContain(line);
      const title = featureGroupOf(p.path)?.title ?? p.section;
      const section = txt.slice(txt.indexOf(`## ${title}\n`));
      expect(section.split('\n## ')[0], p.path).toContain(line);
    }
  });

  it('groups the feature pages as /features/ does: the index under Features, then each group as its own section', () => {
    const titles = llmsSections().map((s) => s.title);
    expect(titles).toEqual(['Product', 'Features', ...FEATURE_GROUPS.map((g) => g.title), 'Company', 'Legal']);
    expect(llmsSections().find((s) => s.title === 'Features')?.pages.map((p) => p.path)).toEqual(['/features/']);
    for (const g of FEATURE_GROUPS) {
      const listed = llmsSections().find((s) => s.title === g.title)?.pages.map((p) => p.path);
      expect(listed, g.id).toEqual(FEATURES.filter((f) => f.group === g.id).map((f) => `/features/${f.slug}/`));
    }
    expect(FEATURES).toHaveLength(11);
  });

  it('links only to mirrors and files the site serves', () => {
    for (const path of sitePaths(txt)) expect(mirrors.has(path) || servedFiles.has(path), path).toBe(true);
  });

  it('holds to the truth ledger', () => {
    expect(txt.split('\n').flatMap(claimViolations)).toEqual([]);
  });
});

describe('the .md mirrors', () => {
  it('exist for every listed page, at one scheme', () => {
    for (const p of listedPages()) {
      expect(hasMarkdown(p.path), p.path).toBe(true);
      expect(mirrorPath(p.path)).toBe(p.path === '/' ? '/index.md' : `${p.path.slice(0, -1)}.md`);
      expect(pageForMirror(mirrorSegments(p.path))?.path).toBe(p.path);
    }
    expect(mirrors.size).toBe(listedPages().length);
    expect(pageForMirror(['no-such-page.md'])).toBeUndefined();
  });

  it('open with the page’s title, description and address', () => {
    for (const p of listedPages()) {
      const md = pageMarkdown(p);
      expect(md.startsWith(`# ${p.title}\n\n> ${p.description}\n\nPage: ${absolute(p.path)}\n`), p.path).toBe(true);
      expect(md.match(/^# /gm), p.path).toHaveLength(1);
    }
  });

  it('link only to pages, mirrors and files that exist', () => {
    for (const p of listedPages()) {
      for (const path of sitePaths(pageMarkdown(p))) {
        const ok = pagePaths.has(path) || mirrors.has(path) || path.startsWith('/brand/');
        expect(ok, `${p.path} → ${path}`).toBe(true);
      }
    }
  });

  it('hold to the truth ledger, line by line', () => {
    const violations = listedPages().flatMap((p) =>
      pageMarkdown(p)
        .split('\n')
        .flatMap(claimViolations)
        .map((v) => ({ page: p.path, ...v })),
    );
    expect(violations).toEqual([]);
  });

  it('are linked from each page’s head', () => {
    for (const p of listedPages()) {
      const meta = pageMetadata(p.path);
      expect(meta.alternates?.canonical).toBe(p.path);
      expect(meta.alternates?.types).toEqual({ 'text/markdown': mirrorPath(p.path) });
    }
  });
});

describe('llms-full.txt', () => {
  const full = llmsFullTxt();

  it('holds every listed page, with one H1 for the whole file', () => {
    for (const p of listedPages()) expect(full, p.path).toContain(`\n## ${p.title}\n`);
    expect(full.match(/^# /gm)).toHaveLength(1);
  });

  it('holds to the truth ledger', () => {
    expect(full.split('\n').flatMap(claimViolations)).toEqual([]);
  });
});
