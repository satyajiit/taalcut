// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { segmentsFor } from '#components/home/cost-bar';
import { CostChoices, WhatItCosts } from '#components/home/what-it-costs';
import { claimViolations } from '#content/claims';
import {
  backWords,
  change,
  changeWords,
  COST_CHANGES,
  COST_OPTIONS,
  COST_SECTION,
  costInWords,
  costLines,
  type CostPeriod,
  price,
  saving,
  usd,
} from '#content/cost';
import { FAQ } from '#content/faq';
import { page } from '#content/pages';
import { llmsFullTxt } from '#lib/llms/llms-txt';
import { pageMarkdown } from '#lib/llms/pages-md';
import { filesUnder, proseLiterals, read, visibleText } from './source-files';

const PERIODS: readonly CostPeriod[] = ['month', 'year'];

/** Every percentage in a piece of text, as written: a sign (minus or hyphen) if there is one, the number, the sign. */
const percentages = (text: string) => [...text.matchAll(/[−-]?\d+(?:\.\d+)?\s?%/g)].map((m) => m[0]);

/** The change for a way, computed here from the three prices, independently of cost.ts's own arithmetic. */
function computed(id: 'cloud' | 'local'): number {
  const editor = COST_OPTIONS.find((o) => o.id === 'editor')!.usd;
  const way = COST_OPTIONS.find((o) => o.id === id)!.usd;
  return Math.round(((editor - way) / editor) * 100);
}

/** Every string the section can print, for both periods. */
function allWords(): string[] {
  const fns = PERIODS.flatMap((p) => [
    COST_SECTION.basis(p),
    COST_SECTION.savingLine('cloud', p),
    COST_SECTION.savingLine('local', p),
    ...COST_SECTION.ai.facts(p).flat(),
    ...COST_OPTIONS.map((o) => `${price(o.id, p).approx} ${usd(price(o.id, p).usd)}`),
    backWords('cloud', p),
    backWords('local', p),
  ]);
  const strings = (v: unknown): string[] =>
    typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
  return [...strings(COST_SECTION), ...strings(COST_OPTIONS), ...fns, changeWords('cloud'), changeWords('local'), costInWords(), ...costLines()];
}

/** The text a visitor reads in some server HTML. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/\s+/g, ' ');

describe('the cost comparison’s figures', () => {
  it('are the owner’s three prices (2026-11-06), the hired editor first', () => {
    expect(COST_OPTIONS.map((o) => [o.id, o.usd, o.approx])).toEqual([
      ['editor', 5000, 'about'],
      ['cloud', 500, 'about'],
      ['local', 0, 'nearly'],
    ]);
  });

  it('compute every saving and change from them, rounded honestly', () => {
    expect(saving('cloud', 'month')).toEqual({ usd: 4500, approx: null, percent: 90, percentApprox: null });
    expect(saving('cloud', 'year')).toEqual({ usd: 54_000, approx: null, percent: 90, percentApprox: null });
    expect(saving('local', 'month')).toEqual({ usd: 5000, approx: 'about', percent: 100, percentApprox: 'nearly' });
    expect(saving('local', 'year')).toEqual({ usd: 60_000, approx: 'about', percent: 100, percentApprox: 'nearly' });
    expect(COST_CHANGES).toEqual([computed('cloud'), computed('local')]);
  });

  it('write them as the site shows them', () => {
    expect(usd(5000)).toBe('$5,000');
    expect(change(90)).toBe('−90%');
    expect(backWords('cloud', 'month')).toBe('$4,500 a month back');
    expect(backWords('cloud', 'year')).toBe('$54,000 a year back');
    expect(backWords('local', 'month')).toBe('about $5,000 a month back');
    expect(backWords('local', 'year')).toBe('about $60,000 a year back');
    expect(changeWords('cloud')).toBe('−90%');
    expect(changeWords('local')).toBe('nearly −100%');
    expect(COST_SECTION.basis('month')).toBe('A month at 3–4 videos a day');
  });

  it('fill the bars in tenths of the editor’s price: all ten, one, and a sliver for nearly nothing', () => {
    expect(COST_OPTIONS.map((o) => segmentsFor(o.usd, COST_OPTIONS[0].usd))).toEqual([10, 1, 0]);
  });
});

describe('every percentage the site shows', () => {
  const allowed = new Set(COST_CHANGES.map(change));

  it('equals a change computed from the prices, in the home’s and /ai/’s server HTML', () => {
    for (const html of [renderToStaticMarkup(h(WhatItCosts)), renderToStaticMarkup(h(CostChoices))]) {
      const shown = percentages(textOf(html));
      expect(shown.length).toBeGreaterThanOrEqual(4);
      for (const p of shown) expect(allowed, p).toContain(p);
      expect(shown).toContain(change(computed('cloud')));
      expect(shown).toContain(change(computed('local')));
    }
  });

  it('equals a change computed from the prices, in the FAQ, its JSON-LD and the Markdown mirrors', () => {
    const answer = FAQ.find((f) => f.id === 'cost')!.answer;
    expect(answer).toContain(costInWords());
    const mirrors = [pageMarkdown(page('/')), pageMarkdown(page('/ai/')), pageMarkdown(page('/faq/')), llmsFullTxt()].join('\n');
    for (const line of costLines()) expect(mirrors).toContain(line);
    for (const p of percentages([answer, mirrors].join('\n'))) expect(allowed, p).toContain(p);
  });

  it('is never typed: no prose or visible text in src/ holds a percentage literal', () => {
    const files = [...filesUnder('src', ['.ts', '.tsx'])];
    const typed = files.flatMap((file) => {
      const source = read(file);
      const texts = [...proseLiterals(source), ...(file.endsWith('.tsx') ? visibleText(source) : [])];
      return texts.filter((t) => /\d\s?%/.test(t.replace(/\$\{[^}]*\}/g, ''))).map((t) => `${file}: ${t}`);
    });
    expect(typed).toEqual([]);
  });
});

describe('the cost comparison’s words', () => {
  it('hold to the truth ledger and the hedge sweep, for a month and a year', () => {
    const words = allWords();
    expect(words.length).toBeGreaterThan(30);
    expect(words.flatMap(claimViolations)).toEqual([]);
  });

  it('say the cloud AI’s bill is the visitor’s own AI, never a Taalcut price', () => {
    const cloud = COST_OPTIONS.find((o) => o.id === 'cloud')!;
    expect(cloud.line).toMatch(/Taalcut is free/);
    expect(cloud.line).toMatch(/your AI’s bill, on your ChatGPT plan or API keys/);
    expect(COST_SECTION.lead).toMatch(/^Taalcut is free/);
    expect(allWords().join('\n')).not.toMatch(/\b(subscription|plan) (to|from|with) Taalcut\b|\bTaalcut (plan|subscription|pricing|price is)\b/i);
  });

  it('keep Local only’s limits beside its price', () => {
    expect(COST_OPTIONS[2].line).toContain('Lower quality, and no AI voice or images.');
  });
});
