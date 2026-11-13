// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandIcon } from '#components/brand/brand-icon';
import { BrandMark } from '#components/brand/brand-mark';
import { SVGL, SVGL_MISSING } from '#components/brand/svgl/manifest';
import { BRAND_DRAWINGS } from '#components/brand/svgl/registry';
import { PROVIDERS } from '../../src/content/providers';
import { SITE_ROOT } from './source-files';

const DIR = join(SITE_ROOT, 'src/components/brand/svgl');
const components = readdirSync(DIR)
  .filter((f) => f.endsWith('-icon.tsx'))
  .map((f) => f.replace(/-icon\.tsx$/, ''))
  .sort();

/** The brands WEB2 and WEB3 asked SVGL for. Each is an icon or recorded as missing, never drawn by us. */
const ASKED = ['openai', 'chatgpt', 'anthropic', 'claude', 'gemini', 'openrouter', 'elevenlabs', 'ollama', 'lm-studio', 'apple', 'ubuntu', 'windows', 'instagram', 'github', 'youtube', 'tiktok', 'codex', 'postiz', 'dji', 'insta360'];

describe('the SVGL brand icons', () => {
  it('has a manifest entry for every component, and a component and a registry row for every entry', () => {
    expect(components).toEqual(SVGL.map((e) => e.id).sort());
    expect(Object.keys(BRAND_DRAWINGS).sort()).toEqual(components);
  });

  it('records where each came from: the SVGL title, the routes, the brand’s pages and the date', () => {
    for (const e of SVGL) {
      expect(e.title.trim(), e.id).not.toBe('');
      expect(e.name.trim(), e.id).not.toBe('');
      expect(e.svglId, e.id).toBeGreaterThan(0);
      expect(e.url, e.id).toMatch(/^https:\/\//);
      if (e.brandUrl) expect(e.brandUrl, e.id).toMatch(/^https:\/\//);
      expect(e.retrieved, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const routes = Object.values(e.routes);
      expect(routes.length, e.id).toBeGreaterThan(0);
      for (const r of routes) expect(r, e.id).toMatch(/^https:\/\/svgl\.app\/library\/[\w.-]+\.svg$/);
      // Both drawings where SVGL has a light and a dark one.
      expect(Boolean(BRAND_DRAWINGS[e.id].dark), e.id).toBe(Boolean(e.routes.dark));
    }
  });

  it('accounts for every brand asked for: an icon, or missing with the reason', () => {
    const decided = [...SVGL.map((e) => e.id), ...SVGL_MISSING.map((m) => m.id)].sort();
    expect(decided).toEqual([...ASKED].sort());
    for (const m of SVGL_MISSING) expect(m.note.length, m.id).toBeGreaterThan(10);
  });

  it('writes valid, inert components with the licence header', () => {
    for (const file of [...components.map((id) => `${id}-icon`), 'registry']) {
      const source = readFileSync(join(DIR, `${file}.tsx`), 'utf8');
      const id = file;
      expect(source.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later\n'), id).toBe(true);
      expect(source, id).not.toMatch(/<script|foreignObject|dangerouslySetInnerHTML|\son[A-Z]\w*=|href="(?!#)|xlink:/);
    }
  });

  it('decides every icon the providers ask for', () => {
    const decided = new Set([...SVGL.map((e) => e.id), ...SVGL_MISSING.map((m) => m.id)]);
    for (const p of PROVIDERS) if (p.markId) expect(decided.has(p.markId), p.markId).toBe(true);
  });
});

describe('BrandIcon and BrandMark', () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it('draws both drawings, theme-aware, where SVGL has two, and one where it has one', () => {
    const two = html(createElement(BrandIcon, { id: 'github' }));
    expect(two).toContain('data-theme-aware=""');
    expect(two).toContain('data-variant="light"');
    expect(two).toContain('data-variant="dark"');
    const one = html(createElement(BrandIcon, { id: 'ubuntu' }));
    expect(one).not.toContain('data-theme-aware');
    expect(one).toContain('data-variant="only"');
    expect(html(createElement(BrandIcon, { id: 'github', themeAware: false, on: 'dark' }))).toMatch(/data-variant="only"[^>]*>.*fill="#ffff"/s);
  });

  it('is named, or hidden beside its name in words', () => {
    expect(html(createElement(BrandIcon, { id: 'apple', label: 'Apple' }))).toMatch(/role="img" aria-label="Apple"/);
    expect(html(createElement(BrandIcon, { id: 'apple' }))).toContain('aria-hidden="true"');
    const mark = html(createElement(BrandMark, { id: 'instagram', name: 'Instagram' }));
    expect(mark).toMatch(/data-mark="instagram".*aria-hidden="true".*Instagram<\/span>$/s);
  });

  it('keeps ids unique per use, so two icons on a page never share a gradient', () => {
    const page = html(createElement('div', null, createElement(BrandIcon, { id: 'instagram' }), createElement(BrandIcon, { id: 'instagram' })));
    const ids = [...page.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes the name alone for a brand SVGL doesn’t have', () => {
    expect(html(createElement(BrandMark, { id: 'elevenlabs', name: 'ElevenLabs' }))).toBe(
      '<span data-slot="brand-mark" class="inline-flex h-auto! items-center gap-[0.4em] whitespace-nowrap">ElevenLabs</span>',
    );
  });
});
