// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';
import { backWords, change, changeWords, COST_CHANGES } from '#content/cost';
import { FAQ } from '#content/faq';
import { FEATURE_STEPS, FEATURES } from '#content/features';
import { PAGES } from '#content/pages';
import { PLATFORMS } from '#content/platforms';
import { PROVIDERS } from '#content/providers';
import { REELS } from '#content/reels';
import { SITE } from '#content/site';
import { filesUnder, read, visibleText } from './source-files';

/** Every string value in a content object, however deep. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the truth ledger', () => {
  it('holds for every content string', () => {
    const copy = strings([SITE.story, SITE.description, PAGES, FEATURES, FEATURE_STEPS, FAQ, PLATFORMS, PROVIDERS, REELS.map((r) => [r.label, r.title, r.slots.map((s) => [s.needs, s.pick.reason])])]);
    expect(copy.flatMap(claimViolations)).toEqual([]);
  });

  it('holds for every word on a page or component', () => {
    const files = [...filesUnder('src/app', ['.tsx']), ...filesUnder('src/components', ['.tsx'])];
    const violations = files.flatMap((file) => visibleText(read(file)).flatMap(claimViolations).map((v) => ({ file, ...v })));
    expect(violations).toEqual([]);
  });

  it('catches the claims it exists for', () => {
    for (const bad of ['Works on Windows today', 'Encrypted transfer', '80% of picks accepted', 'Trusted by creators', 'Taalcut is open source', 'Rendered in seconds', 'Download now']) {
      expect(claimViolations(bad), bad).not.toEqual([]);
    }
    expect(claimViolations('Windows comes after 1.0.')).toEqual([]);
  });

  it('allows a percentage only as one of the cost comparison’s computed changes, written as cost.ts writes them', () => {
    for (const p of COST_CHANGES) expect(claimViolations(`${backWords('cloud', 'month')}, ${change(p)} against hiring`), change(p)).toEqual([]);
    expect(claimViolations(changeWords('local'))).toEqual([]);
    const typed = ['90% less', '-90%', '−90 %', '−91%', '−9%', '−900%', '−90.0%', '−83%', '100% private', 'Save 50%', 'nearly 100% of picks', `${change(90)} and 40% more reach`];
    for (const bad of typed) expect(claimViolations(bad), bad).not.toEqual([]);
  });
});

describe('the text scanner', () => {
  it('reads the words a visitor sees and skips code', () => {
    const texts = visibleText(read('src/components/chrome/site-header.tsx'));
    expect(texts).toContain('Join the waitlist');
    expect(texts).toContain('Taalcut home');
    expect(texts.some((t) => t.includes('className'))).toBe(false);
  });
});
