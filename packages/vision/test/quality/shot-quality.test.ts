// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** scoreShot on fabricated sample signals: flags, motion class, best frame, frozen and black rules. */
import { describe, expect, it } from 'vitest';
import { VISION_CONFIG } from '../../src/config';
import { exposureScore, scoreShot, type SampleSignals } from '../../src/quality/shot-quality';

function sample(index: number, over: Partial<SampleSignals> = {}): SampleSignals {
  return {
    index,
    laplacianVariance: 400,
    mean: 120,
    std: 50,
    dark: 0.01,
    bright: 0.01,
    black: false,
    shift: { x: 0, y: 0 },
    change: 5,
    ...over,
  };
}

const run = (n: number, over: (i: number) => Partial<SampleSignals> = () => ({})) =>
  Array.from({ length: n }, (_, i) => sample(i * 3, over(i)));

describe('scoreShot', () => {
  it('scores a sharp, well exposed, steady shot high with no flags and picks the sharpest frame', () => {
    const samples = run(20, (i) => (i === 7 ? { laplacianVariance: 900 } : {}));
    const result = scoreShot(samples, 0.1);
    expect(result.quality.flags).toEqual([]);
    expect(result.quality.sharpness).toBeGreaterThan(0.8);
    expect(result.quality.exposure).toBe(1);
    expect(result.quality.stability).toBe(1);
    expect(result.quality.overall).toBeGreaterThan(0.85);
    expect(result.quality.version).toBe(VISION_CONFIG.version);
    expect(result.bestFrame).toBe(21);
    expect(result.motion).toBe('static');
  });

  it('flags blur, darkness, clipping, flat and black frames', () => {
    expect(
      scoreShot(
        run(10, () => ({ laplacianVariance: 5 })),
        0.1,
      ).quality.flags,
    ).toContain('blurry');
    expect(
      scoreShot(
        run(10, () => ({ mean: 20, dark: 0.6 })),
        0.1,
      ).quality.flags,
    ).toEqual(expect.arrayContaining(['dark']));
    expect(
      scoreShot(
        run(10, () => ({ mean: 240, bright: 0.7 })),
        0.1,
      ).quality.flags,
    ).toContain('overexposed');
    expect(
      scoreShot(
        run(10, () => ({ std: 1 })),
        0.1,
      ).quality.flags,
    ).toContain('flat');
    const black = scoreShot(
      run(10, () => ({ black: true, mean: 5 })),
      0.1,
    );
    expect(black.quality.flags).toContain('black');
    expect(black.quality.overall).toBe(0);
  });

  it('reads shake from the high-pass of the shift and a steady move as a pan or tilt', () => {
    const shaky = scoreShot(
      run(30, (i) => ({ shift: { x: i % 2 ? 0.04 : -0.04, y: i % 2 ? -0.03 : 0.03 } })),
      0.1,
    );
    expect(shaky.quality.flags).toContain('shaky');
    expect(shaky.quality.stability).toBeLessThan(VISION_CONFIG.quality.shakyBelow);
    expect(shaky.motion).toBe('handheld');
    const pan = scoreShot(
      run(30, () => ({ shift: { x: 0.02, y: 0 } })),
      0.1,
    );
    expect(pan.motion).toBe('pan');
    expect(pan.quality.stability).toBeGreaterThan(0.9);
    expect(pan.energy).toBeGreaterThan(0.3);
    expect(
      scoreShot(
        run(30, () => ({ shift: { x: 0, y: -0.02 } })),
        0.1,
      ).motion,
    ).toBe('tilt');
  });

  it('marks a frame held for two seconds as frozen (freezedetect’s −60 dB rule) and halves its score', () => {
    const frozen = scoreShot(
      run(30, () => ({ change: 0.1 })),
      0.1,
    );
    expect(frozen.quality.flags).toContain('frozen');
    const moving = scoreShot(
      run(30, (i) => ({ change: i === 15 ? 5 : 0.1 })),
      0.1,
    );
    expect(moving.quality.flags).not.toContain('frozen');
    expect(frozen.quality.overall).toBeLessThan(0.6);
  });

  it('handles a one-sample shot', () => {
    const one = scoreShot([sample(0, { shift: { x: 0.5, y: 0.5 }, change: 99 })], 0.1);
    expect(one.quality.stability).toBe(1);
    expect(one.motion).toBe('static');
  });
});

describe('exposureScore', () => {
  it('is 1 in the comfortable range and falls toward black, white and clipping', () => {
    expect(exposureScore(120, 0, 0)).toBe(1);
    expect(exposureScore(20, 0.5, 0)).toBeLessThan(0.5);
    expect(exposureScore(250, 0, 0.9)).toBeLessThan(0.3);
    expect(exposureScore(120, 0.2, 0)).toBeLessThan(1);
  });
});
