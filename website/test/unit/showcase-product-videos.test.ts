// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { feature, FEATURES } from '#content/features';
import { PAGES } from '#content/pages';
import { framesOf } from '#components/showcase/frames';
import { PRODUCT_ROWS, ProductFragment, ProductShowcase } from '#components/showcase/product-videos/entry';
import {
  BATCHES,
  batchOf,
  captionOf,
  featureName,
  nextResearchDay,
  POST,
  POST_STATUS,
  PRODUCT,
  PRODUCT_PASS,
  PRODUCT_SOURCES,
  productPassAt,
  productPassTimes,
  SCHEDULE,
  toggleDay,
  WEEK,
} from '#components/showcase/product-videos/ideas';
import { HINT, LOOK } from '#components/showcase/product-videos/meta';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const IDEAS = BATCHES.flat();

describe('Taalcut’s video ideas', () => {
  it('are each about one of Taalcut’s features, with no feature twice', () => {
    const slugs = new Set(FEATURES.map((f) => f.slug));
    for (const idea of IDEAS) expect(slugs.has(idea.slug), idea.id).toBe(true);
    expect(new Set(IDEAS.map((i) => i.slug)).size).toBe(IDEAS.length);
    // A second round of research brings other features: no topic comes back before its days are up.
    const [first, second] = BATCHES;
    expect(first?.some((a) => second?.some((b) => b.slug === a.slug))).toBe(false);
    expect(batchOf(2)).toBe(batchOf(0));
  });

  it('quote taalcut.app word for word, from the page of the feature they are about', () => {
    const routes = new Set(PAGES.map((p) => p.path));
    for (const idea of IDEAS) {
      const f = feature(idea.slug);
      const lines = [f.definition, ...f.facts.map(([, value]) => value)];
      expect(idea.evidence.length, idea.id).toBeGreaterThanOrEqual(2);
      for (const e of idea.evidence) {
        expect(lines, `${idea.id}: ${e.excerpt}`).toContain(e.excerpt);
        expect(e.locator).toBe(`taalcut.app/features/${idea.slug}/`);
        expect(routes.has(e.locator.replace('taalcut.app', '')), e.locator).toBe(true);
      }
      expect(featureName(idea)).toBe(f.name);
    }
  });

  it('carry a sticker that quotes one of those lines word for word', () => {
    for (const idea of IDEAS) {
      expect(idea.quote.length, idea.id).toBeLessThanOrEqual(80);
      expect(idea.evidence.some((e) => e.excerpt.includes(idea.quote)), idea.id).toBe(true);
    }
  });

  it('open their videos on the owner’s footage', () => {
    for (const idea of IDEAS) expect(framesOf(idea.clipId).length, idea.id).toBeGreaterThan(0);
  });
});

describe('the research schedule', () => {
  it('names the next chosen day, and keeps at least one', () => {
    expect(nextResearchDay([1, 3, 5], 1)).toBe('Wednesday');
    expect(nextResearchDay([1, 3, 5], 5)).toBe('Monday');
    expect(nextResearchDay([1, 3, 5], 0)).toBe('Monday');
    expect(nextResearchDay([3], 3)).toBe('Wednesday');
    expect(toggleDay([3], 3)).toEqual([3]);
    expect(toggleDay([1, 5], 3)).toEqual([1, 3, 5]);
    expect(toggleDay([1, 3, 5], 1)).toEqual([3, 5]);
    expect(WEEK.map((w) => w.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});

describe('the arrival', () => {
  it('researches, brings the ideas in turn, opens the first, makes its video, then its post waits', () => {
    const before = productPassAt(-1);
    expect([before.researching, before.ideas, before.open, before.video, before.post]).toEqual([false, 0, false, 'none', false]);
    expect(productPassAt(0).researching).toBe(true);
    const end = productPassAt(PRODUCT_PASS.end);
    expect([end.researching, end.ideas, end.open, end.video, end.post]).toEqual([false, 3, true, 'ready', true]);
    let last = productPassAt(0);
    for (const at of productPassTimes()) {
      const frame = productPassAt(at);
      expect(frame.ideas).toBeGreaterThanOrEqual(last.ideas);
      last = frame;
    }
    expect(PRODUCT_PASS.end).toBeLessThan(5000);
  });
});

describe('the product showcase’s words', () => {
  it('hold to the truth ledger: no hedges, no results, posts only after approval and through Postiz', () => {
    const copy = strings([
      PRODUCT,
      PRODUCT_SOURCES,
      IDEAS.map((i) => [i.hook, i.rationale, i.angle]),
      IDEAS.map(captionOf),
      POST,
      POST_STATUS,
      HINT.title,
    ]);
    expect(copy.flatMap(claimViolations)).toEqual([]);
    const all = copy.join(' ');
    expect(all).not.toMatch(/\bdrafts?\b|\bviews\b|\blikes\b|\breach\b|\bfollowers\b|automatic(ally)? post/i);
    expect(POST_STATUS.waiting).toBe('Awaiting approval');
    expect(SCHEDULE.noveltyDays).toBeGreaterThan(0);
  });

  it('give a row to each of the feature’s facts', () => {
    expect(PRODUCT_ROWS).toHaveLength(feature('product-videos').facts.length);
    expect(LOOK.area).toBe('products');
  });
});

describe('the server HTML', () => {
  it('shows the idea reels with their quotes, why the first fits, the schedule, the video and its post awaiting approval, nothing at opacity 0', () => {
    const html = renderToStaticMarkup(h(ProductShowcase));
    expect(html).toContain('data-showcase="product-videos"');
    expect(html.match(/data-idea=/g)).toHaveLength(3);
    expect(html.match(/data-quote/g)).toHaveLength(3);
    expect(html).toContain('data-why');
    expect(html.match(/data-frame="footage"/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html.match(/data-evidence/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('Research this product on a schedule');
    expect(html).toContain('Awaiting approval');
    expect(html).toContain('Approve this post and schedule');
    expect(html).toContain('Publication uses your connected Postiz account after approval.');
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
    for (const r of PRODUCT_ROWS) {
      const scene = renderToStaticMarkup(h(r.Scene, { on: true, from: false, reduce: false, ran: false }));
      expect(scene).toContain('data-slot="vignette"');
      expect(scene).not.toMatch(/opacity:\s*0[;"]/);
    }
  });

  it('gives the index a fragment with the ideas and a quoted line', () => {
    const html = renderToStaticMarkup(h(ProductFragment));
    expect(html).toContain('data-showcase="product-videos-fragment"');
    expect(html).toContain(batchOf(0)[0]!.evidence[0]!.excerpt);
    expect(html).not.toMatch(/opacity:\s*0[;"]/);
  });
});
