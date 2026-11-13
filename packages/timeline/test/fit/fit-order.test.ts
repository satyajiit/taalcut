// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LRN1-TPL: the fit ranking (SPEC, "LRN1-TPL", step 5) on hand-made scores. */
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../../src/casting/config';
import { compareFits, type TemplateScore } from '../../src/fit/score-template';

/** A template's score as scoreTemplate gives it: `meanScore` over the `covered` slots of `slots`. */
function fit(
  templateId: string,
  slots: number,
  covered: number,
  meanScore: number | null,
  hook: number | null = null,
) {
  const score: TemplateScore = {
    slots,
    covered,
    coverage: covered / slots,
    meanScore,
    fitScore: meanScore === null ? null : (meanScore * covered) / slots,
    hook,
    weak: [],
  };
  return { templateId, score };
}

const ranked = (...fits: ReturnType<typeof fit>[]) =>
  [...fits].sort((a, b) => compareFits(a, b, CASTING_CONFIG)).map((item) => item.templateId);

describe('fit: the order', () => {
  it('ranks templates the footage fills completely by mean score, then hook, then template id', () => {
    expect(
      ranked(
        fit('b', 4, 4, 0.7, 0.5),
        fit('weaker', 5, 5, 0.6),
        fit('a', 4, 4, 0.7, 0.5),
        fit('hook', 6, 6, 0.7, 0.8),
      ),
    ).toEqual(['hook', 'a', 'b', 'weaker']);
  });

  it('keeps a complete template ahead of a closer one a slot short unless the closer one matches far better', () => {
    // A four-slot template a slot short keeps three quarters of its match: 0.75 × 3/4 < 0.6 < 0.9 × 3/4.
    expect(ranked(fit('closer', 4, 3, 0.75), fit('complete', 3, 3, 0.6))).toEqual(['complete', 'closer']);
    expect(ranked(fit('closer', 4, 3, 0.9), fit('complete', 3, 3, 0.6))).toEqual(['closer', 'complete']);
  });

  it('puts the template the footage was shot for, a slot short, above a complete one it hardly matches', () => {
    // The eval's hike-short set: Trail run 3 of 4 at 0.80, the gym quick cut 3 of 3 at 0.50.
    expect(ranked(fit('gym-quick', 3, 3, 0.5), fit('hike', 4, 3, 0.8))).toEqual(['hike', 'gym-quick']);
  });

  it('breaks an equal fit score by coverage', () => {
    expect(ranked(fit('short', 5, 4, 0.75), fit('complete', 4, 4, 0.6))).toEqual(['complete', 'short']);
  });

  it('puts a template the footage fills none of after every one it fills some of', () => {
    expect(ranked(fit('none', 1, 0, null), fit('nine-short', 10, 1, 0.1))).toEqual(['nine-short', 'none']);
  });

  it('treats fit scores within the tie epsilon as equal', () => {
    const near = 0.7 + CASTING_CONFIG.tieEpsilon / 2;
    expect(ranked(fit('b', 4, 4, near, 0.9), fit('a', 4, 4, 0.7, 0.1))).toEqual(['b', 'a']);
  });
});
