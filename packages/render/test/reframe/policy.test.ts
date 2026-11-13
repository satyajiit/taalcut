// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { REFRAME_CONFIG } from '../../src/reframe/config';
import { acceptedBoxes, chooseFraming, isAccepted, median, type ShotFacts } from '../../src/reframe/policy';
import { sampleAt } from './support';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const crop = { width: 0.316, height: 1 };
const facts = (overrides: Partial<ShotFacts> = {}): ShotFacts => ({
  hasSubject: true,
  medianSubjectArea: 0.2,
  medianBody: { width: 0.2, height: 0.6 },
  travelPx: { x: 200, y: 0 },
  ...overrides,
});

describe('box acceptance', () => {
  it('needs the minimum confidence', () => {
    expect(isAccepted({ box: box(0.4, 0.4, 0.1, 0.1), confidence: 0.49 }, REFRAME_CONFIG)).toBe(false);
    expect(isAccepted({ box: box(0.4, 0.4, 0.1, 0.1), confidence: 0.5 }, REFRAME_CONFIG)).toBe(true);
  });

  it("rejects Vision's constant-1.0 'no score' blob covering most of the frame", () => {
    expect(isAccepted({ box: box(0, 0, 0.9, 0.8), confidence: 1 }, REFRAME_CONFIG)).toBe(false);
    expect(isAccepted({ box: box(0.3, 0.3, 0.3, 0.3), confidence: 1 }, REFRAME_CONFIG)).toBe(true);
    // A high but real score on a big box is kept.
    expect(isAccepted({ box: box(0, 0, 0.9, 0.8), confidence: 0.97 }, REFRAME_CONFIG)).toBe(true);
  });

  it('uses saliency only when there is no face or human', () => {
    const withPerson = acceptedBoxes(
      sampleAt(0, { human: box(0.4, 0.2, 0.2, 0.6), saliency: box(0.1, 0.1, 0.2, 0.2) }),
      REFRAME_CONFIG,
    );
    expect(withPerson.saliency).toEqual([]);
    const alone = acceptedBoxes(sampleAt(0, { saliency: box(0.1, 0.1, 0.2, 0.2) }), REFRAME_CONFIG);
    expect(alone.saliency).toHaveLength(1);
  });
});

describe('chooseFraming', () => {
  const choose = (mode: Parameters<typeof chooseFraming>[0], shot: ShotFacts) =>
    chooseFraming(mode, shot, crop, 9.6, REFRAME_CONFIG);

  it("follows the person's forced modes without second-guessing", () => {
    expect(choose('blurPad', facts())).toEqual({ kind: 'blurPad', reason: 'forced' });
    expect(choose('centre', facts())).toEqual({ kind: 'centre', reason: 'forced' });
    expect(choose('subject', facts({ medianBody: { width: 0.9, height: 0.9 } }))).toEqual({
      kind: 'follow',
      reason: 'forced',
    });
    expect(choose('subject', facts({ hasSubject: false }))).toEqual({ kind: 'centre', reason: 'noSubject' });
  });

  it('follows a subject in auto', () => {
    expect(choose('auto', facts())).toEqual({ kind: 'follow', reason: 'subject' });
  });

  it('pads a wide static shot: no box, or a small subject, and a still path', () => {
    expect(
      choose(
        'auto',
        facts({ hasSubject: false, medianSubjectArea: null, medianBody: null, travelPx: { x: 0, y: 0 } }),
      ),
    ).toEqual({
      kind: 'blurPad',
      reason: 'wideStatic',
    });
    expect(choose('auto', facts({ medianSubjectArea: 0.03, travelPx: { x: 4, y: 2 } })).kind).toBe('blurPad');
    // A small subject that moves is followed.
    expect(choose('auto', facts({ medianSubjectArea: 0.03, travelPx: { x: 300, y: 0 } })).kind).toBe(
      'follow',
    );
  });

  it('pads when the crop shows too little of the body (9:16 footage into 16:9)', () => {
    const landscapeCrop = { width: 1, height: 0.316 };
    expect(
      chooseFraming(
        'auto',
        facts({ medianBody: { width: 0.4, height: 0.85 } }),
        landscapeCrop,
        9.6,
        REFRAME_CONFIG,
      ),
    ).toEqual({
      kind: 'blurPad',
      reason: 'subjectTooTall',
    });
  });
});

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
