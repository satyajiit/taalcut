// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { FAQ, FAQ_GROUPS } from '#content/faq';
import { FEATURE_GROUPS, FEATURES } from '#content/features';
import { page } from '#content/pages';
import { faqPageJsonLd, featureIndexJsonLd, softwareApplicationJsonLd } from '#lib/jsonld';
import { pageMarkdown } from '#lib/llms/pages-md';
import { absolute } from '#lib/seo';

/** WEB3 lane D: the eleven features in the machine-read files, and the FAQ's answers for the six new ones. */

/** The answers WEB3 adds, by id: one per new feature and the two questions around them. */
const NEW_ANSWERS = ['shorts', 'instagram-edits', 'launch-video', 'product-videos', 'posting', 'iphone', 'other-agents'] as const;

/** Sentences in an answer: full stops, question and exclamation marks followed by a space or the end. */
function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0).length;
}

describe('the SoftwareApplication JSON-LD', () => {
  it('names all eleven features, in the index’s order', () => {
    const app = softwareApplicationJsonLd();
    expect(app.featureList).toEqual(FEATURES.map((f) => f.name));
    expect(app.featureList).toHaveLength(11);
    expect(app).not.toHaveProperty('offers');
  });
});

describe('the features index JSON-LD', () => {
  const list = featureIndexJsonLd();
  const items = list.itemListElement as readonly { position: number; name: string; url: string; description: string }[];

  it('is an ordered list of the eleven pages, in their two groups', () => {
    expect(list['@type']).toBe('ItemList');
    expect(list.numberOfItems).toBe(11);
    const ordered = FEATURE_GROUPS.flatMap((g) => FEATURES.filter((f) => f.group === g.id));
    expect(items.map((i) => i.name)).toEqual(ordered.map((f) => f.name));
    expect(items.map((i) => i.position)).toEqual(ordered.map((_, i) => i + 1));
    for (const [i, f] of ordered.entries()) {
      expect(items[i]?.url).toBe(absolute(`/features/${f.slug}/`));
      expect(items[i]?.description).toBe(f.definition);
    }
  });

  it('parses back as JSON and holds to the truth ledger', () => {
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
    expect(items.flatMap((i) => [i.name, i.description]).flatMap(claimViolations)).toEqual([]);
  });
});

describe('the FAQ’s answers for the new features', () => {
  it('are there, each in a group the page shows', () => {
    for (const id of NEW_ANSWERS) {
      const entry = FAQ.find((e) => e.id === id);
      expect(entry, id).toBeDefined();
      expect(FAQ_GROUPS, id).toContain(entry!.group);
    }
  });

  it('answer first, in one to three sentences', () => {
    for (const id of NEW_ANSWERS) {
      const { answer } = FAQ.find((e) => e.id === id)!;
      expect(answer, id).toMatch(/^(Yes|No|Only)\b/);
      expect(sentenceCount(answer), id).toBeGreaterThanOrEqual(1);
      expect(sentenceCount(answer), id).toBeLessThanOrEqual(3);
    }
  });

  it('stay inside the WEB3 truth ledger', () => {
    const words = NEW_ANSWERS.map((id) => FAQ.find((e) => e.id === id)!).flatMap((e) => [e.question, e.answer]);
    expect(words.flatMap(claimViolations)).toEqual([]);
    const all = words.join(' ');
    // Taalcut stages and the user posts from Edits; it never posts to Instagram or YouTube itself.
    expect(all).not.toMatch(/posts? (directly )?(to|on) (instagram|youtube)/i);
    // Cable, cameras and Apple Photos are the Mac's; external agents are Mac only.
    expect(FAQ.find((e) => e.id === 'iphone')!.answer).toMatch(/On a Mac, an iPhone on a cable/);
    expect(FAQ.find((e) => e.id === 'other-agents')!.answer).toMatch(/^Yes, on a Mac\./);
    // One short per video, never batches; launch videos use the AI accounts you connect.
    expect(FAQ.find((e) => e.id === 'shorts')!.answer).toMatch(/one portrait short/);
    expect(FAQ.find((e) => e.id === 'launch-video')!.answer).toMatch(/AI accounts you connect/);
  });

  it('keep the FAQPage JSON-LD whole: one question per entry, each with its answer', () => {
    const ld = faqPageJsonLd();
    const main = ld.mainEntity as readonly { '@type': string; name: string; acceptedAnswer: { text: string } }[];
    expect(main).toHaveLength(FAQ.length);
    for (const [i, e] of FAQ.entries()) {
      expect(main[i]?.['@type']).toBe('Question');
      expect(main[i]?.name).toBe(e.question);
      expect(main[i]?.acceptedAnswer.text).toBe(e.answer);
    }
  });
});

describe('the .md mirrors of the home and the index', () => {
  it('list every feature under its group, the reel’s five first', () => {
    for (const path of ['/', '/features/']) {
      const md = pageMarkdown(page(path));
      let last = -1;
      for (const g of FEATURE_GROUPS) {
        const at = md.indexOf(g.title);
        expect(at, `${path} ${g.id}`).toBeGreaterThan(last);
        last = at;
        const next = FEATURE_GROUPS[FEATURE_GROUPS.indexOf(g) + 1];
        const part = md.slice(at, next ? md.indexOf(next.title) : undefined);
        for (const f of FEATURES.filter((x) => x.group === g.id)) expect(part, `${path} ${f.slug}`).toContain(f.name);
      }
    }
  });
});
