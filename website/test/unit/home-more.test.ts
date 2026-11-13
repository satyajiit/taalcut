// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { waveform } from '#components/home/more-edits';
import { ideaOf, sentences } from '#components/home/more-product';
import { MoreWays } from '#components/home/more-ways';
import { claimViolations, HEDGES } from '#content/claims';
import { FEATURES } from '#content/features';
import { MORE_WAYS } from '#content/home';
import { read } from './source-files';

/** More ways to make (WEB3 lane D): the home's section for the six features beyond the reel pass. */

const MORE = FEATURES.filter((f) => f.group === 'more');

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') return [String((value as (n: number) => unknown)(7))];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('More ways to make: the words', () => {
  it('give each of the six new features a row with its one line, and no other', () => {
    expect(MORE).toHaveLength(6);
    expect(Object.keys(MORE_WAYS.rows).sort()).toEqual(MORE.map((f) => f.slug).sort());
    for (const f of MORE) expect(MORE_WAYS.rows[f.slug as keyof typeof MORE_WAYS.rows].line.length, f.slug).toBeGreaterThan(40);
  });

  it('hold to the truth ledger and the hedge sweep', () => {
    const copy = strings(MORE_WAYS);
    expect(copy.length).toBeGreaterThan(60);
    expect(copy.flatMap(claimViolations)).toEqual([]);
    for (const text of copy) for (const { pattern } of HEDGES) expect(text, text).not.toMatch(pattern);
  });

  it('name the ways in as the app does, the Mac-only ones apart (WEB3 ledger: on Ubuntu only files, folders and Wi-Fi)', () => {
    const w = MORE_WAYS.rows.import;
    expect(w.everywhere).toEqual(['Phone over Wi-Fi', 'Files', 'Folder']);
    expect(w.macWays).toEqual(['Phone on a cable', 'Camera or card', 'DJI', 'Insta360', 'Apple Photos']);
    expect(w.stages).toEqual(['Searchable', 'Available to edit', 'Checking the copy']);
  });

  it('offer the short’s lengths the app offers, and one short per video', () => {
    expect(MORE_WAYS.rows.shorts.lengths).toEqual(['30 s', '60 s', '90 s']);
    expect(MORE_WAYS.rows.shorts.parts).toEqual(['Hook', 'Context', 'Payoff']);
    expect(strings(MORE_WAYS.rows.shorts).join(' ')).not.toMatch(/\bshorts\b|batch|landscape/i);
  });

  it('show only the two plugins and the two agents the app has, with its permission levels', () => {
    const p = MORE_WAYS.rows.plugins;
    expect(p.plugins.map((x) => x.name)).toEqual(['Postiz', 'Instagram Edits']);
    expect(p.agentRows.map((x) => x.name)).toEqual(['Claude Code', 'Codex']);
    expect(p.levels).toEqual(['Read', 'Edit', 'Export']);
    for (const a of p.agentRows) expect(p.levels).toContain(a.level);
    expect(strings(p).join(' ')).not.toMatch(/comfyui|wordpress|store|marketplace/i);
  });

  it('never say Instagram is posted to directly, or that Edits gives scores on a screen', () => {
    const edits = strings([MORE_WAYS.rows['instagram-edits'], MORE_WAYS.rows['product-videos']]).join(' ');
    expect(edits).not.toMatch(/post(s|ed)? (to|on) instagram|insights|analytics|\bscores?\b/i);
  });
});

describe('More ways to make: the drawings’ data', () => {
  it('quote each idea’s line from the feature’s own summary on this site', () => {
    for (const { slug, sentence } of MORE_WAYS.rows['product-videos'].ideas) {
      const idea = ideaOf(slug, sentence);
      const f = FEATURES.find((x) => x.slug === slug)!;
      expect(idea.name).toBe(f.name);
      expect(f.summary).toContain(idea.quote);
      expect(sentences(f.summary)).toContain(idea.quote);
    }
  });

  it('draw the same waveform on the server and in the browser, every bar in range', () => {
    expect(waveform(2)).toEqual(waveform(2));
    expect(waveform(1)).not.toEqual(waveform(3));
    for (const v of waveform(4)) {
      expect(v).toBeGreaterThanOrEqual(0.2);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('More ways to make: the server HTML', () => {
  const html = renderToStaticMarkup(h(MoreWays));

  it('is the finished section: its h2, each feature’s h3 linking its page, nothing at opacity 0', () => {
    expect(html).toContain(`id="${MORE_WAYS.id}"`);
    expect(html.match(/<h2\b/g)).toHaveLength(1);
    expect(html.match(/<h3\b/g)).toHaveLength(6);
    for (const f of MORE) {
      // Next writes the trailing slash only with the site's config (trailingSlash), which Vitest doesn't load.
      expect(html, f.slug).toMatch(new RegExp(`href="/features/${f.slug}/?"`));
      expect(html, f.slug).toContain(`data-more="${f.slug}"`);
    }
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });

  it('keeps every drawing out of the accessibility tree, and its brand icons by their names', () => {
    expect(html.match(/data-slot="more-drawing"/g)).toHaveLength(6);
    expect(html.match(/data-slot="more-drawing"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*data-slot="more-drawing"/g)).toHaveLength(6);
    for (const brand of ['apple', 'youtube', 'instagram', 'claude', 'codex']) expect(html, brand).toContain(`data-brand="${brand}"`);
  });

  it('carries the licence and a stamp, and stays under 400 lines, in each of its files', () => {
    for (const name of ['more-ways', 'more-item', 'more-kit', 'more-import', 'more-shorts', 'more-edits', 'more-launch', 'more-product', 'more-plugins']) {
      const text = read(`src/components/home/${name}.tsx`);
      expect(text.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later'), name).toBe(true);
      expect(text, name).toMatch(/component: [^\n]+ · mode: Persuade · system: WEB2 Remix Vernacular/);
      expect(text.split('\n').length, name).toBeLessThanOrEqual(400);
    }
  });
});
