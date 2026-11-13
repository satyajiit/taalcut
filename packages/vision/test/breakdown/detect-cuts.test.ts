// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { applyVerdicts, classifyHard, proposals, settleWithoutModel } from '../../src/breakdown/detect-cuts';
import { breakdownCutSchema, type BreakdownCut } from '../../src/breakdown/types';
import { VISION_CONFIG } from '../../src/config';
import type { SceneSample } from '../../src/media/scene';

const cfg = VISION_CONFIG.cuts;
const RATE = { num: 30000, den: 1001 };

/** Flat low scores with the given peaks: frame → score (mafd follows the score). */
function scores(length: number, peaks: Record<number, number | [number, number]>): SceneSample[] {
  return Array.from({ length }, (_, index) => {
    const peak = peaks[index];
    const [score, mafd] = Array.isArray(peak) ? peak : [peak ?? 0.5, (peak ?? 0.5) * 2];
    return { index, score, mafd };
  });
}

function cut(frame: number, overrides: Partial<BreakdownCut> = {}): BreakdownCut {
  return {
    frame,
    at: { value: frame, rate: RATE },
    kind: 'hard',
    confidence: 0.4,
    method: 'both',
    status: 'disputed',
    score: 10,
    ...overrides,
  };
}

describe('proposals', () => {
  it('keeps local peaks at or above the threshold, one per ±2 frames', () => {
    const samples = scores(60, { 10: 40, 11: 30, 20: 6, 30: 4, 40: 8, 42: 9 });
    expect(proposals(samples, cfg.proposeScore).map((p) => p.frame)).toEqual([10, 20, 42]);
  });

  it('gives a tie to the earlier frame and skips the range start', () => {
    const samples = scores(30, { 0: 50, 12: 20, 13: 20 });
    expect(proposals(samples, cfg.proposeScore).map((p) => p.frame)).toEqual([12]);
    expect(proposals(samples, cfg.proposeScore, 12)).toEqual([]);
  });

  it('marks a flash: the next frame changes back about as much', () => {
    // Frame 20 jumps (mafd 30), frame 21 jumps back (mafd 28), then quiet: a one-frame flash.
    const flash = scores(40, { 20: [30, 30], 21: [8, 28], 22: [0.5, 1] });
    expect(proposals(flash, cfg.proposeScore)).toEqual([{ frame: 20, score: 30, flashLike: true }]);
    const real = scores(40, { 20: [30, 30], 21: [0.5, 2] });
    expect(proposals(real, cfg.proposeScore)[0]?.flashLike).toBe(false);
  });

  it("proposes more with 'high' sensitivity's lower threshold", () => {
    const samples = scores(30, { 10: 4 });
    expect(proposals(samples, cfg.proposeScore)).toEqual([]);
    expect(proposals(samples, 3).map((p) => p.frame)).toEqual([10]);
  });
});

describe('classifyHard', () => {
  const at = (frame: number, score: number, flashLike = false) => ({ frame, score, flashLike });

  it('confirms a strong non-flash peak on scdet alone', () => {
    const cut = classifyHard(at(48, 60), undefined, RATE);
    expect(cut).toMatchObject({ frame: 48, method: 'scdet', status: 'confirmed', kind: 'hard', score: 60 });
    expect(cut?.at).toEqual({ value: 48, rate: RATE });
    expect(breakdownCutSchema.safeParse(cut).success).toBe(true);
  });

  it('decides weaker peaks on the embedding distance', () => {
    expect(classifyHard(at(10, 8), 0.5, RATE)).toMatchObject({
      method: 'both',
      status: 'confirmed',
      distance: 0.5,
    });
    expect(classifyHard(at(10, 8), cfg.rejectDistance / 2, RATE)).toBeNull();
    const disputed = classifyHard(at(10, 8), (cfg.rejectDistance + cfg.confirmDistance) / 2, RATE);
    expect(disputed).toMatchObject({ method: 'both', status: 'disputed' });
    expect(disputed!.confidence).toBeGreaterThan(0.25);
    expect(disputed!.confidence).toBeLessThan(0.5);
  });

  it('sends a strong flash to the embeddings instead of confirming it', () => {
    expect(classifyHard(at(10, 60, true), 0.02, RATE)).toBeNull();
    expect(classifyHard(at(10, 60, true), 0.6, RATE)).toMatchObject({ status: 'confirmed', method: 'both' });
  });

  it('without embeddings keeps only a fairly sure peak, disputed', () => {
    expect(classifyHard(at(10, cfg.unverifiedKeepScore + 1), undefined, RATE)).toMatchObject({
      method: 'scdet',
      status: 'disputed',
    });
    expect(classifyHard(at(10, cfg.unverifiedKeepScore - 1), undefined, RATE)).toBeNull();
    expect(classifyHard(at(10, 20, true), undefined, RATE)).toBeNull();
  });
});

describe('settleWithoutModel', () => {
  it('keeps the disputes one method is fairly sure of as unverified and drops the rest', () => {
    const soft = { kind: 'soft', method: 'embedding', score: undefined } as const;
    const settled = settleWithoutModel([
      cut(10, { status: 'confirmed', score: 80 }),
      cut(20, { score: cfg.unverifiedKeepScore }),
      cut(30, { score: cfg.unverifiedKeepScore - 1 }),
      // The pixels showed a blend: kept. An embedding jump alone (no transition named): dropped.
      cut(40, { ...soft, transition: 'dissolve' }),
      cut(50, { ...soft }),
    ]);
    expect(settled.map((c) => [c.frame, c.status])).toEqual([
      [10, 'confirmed'],
      [20, 'unverified'],
      [40, 'unverified'],
    ]);
  });
});

describe('applyVerdicts', () => {
  it('confirms or drops disputed cuts by the model’s verdict and leaves the rest alone', () => {
    const cuts = [cut(10, { status: 'confirmed', method: 'scdet' }), cut(20), cut(30), cut(40)];
    const applied = applyVerdicts(
      cuts,
      new Map([
        [10, { cut: false }],
        [20, { cut: true, transition: 'whip' as const }],
        [30, { cut: false }],
      ]),
    );
    expect(applied.map((c) => [c.frame, c.status, c.method, c.transition])).toEqual([
      [10, 'confirmed', 'scdet', undefined],
      [20, 'confirmed', 'vision', 'whip'],
      [40, 'disputed', 'both', undefined],
    ]);
    expect(applied[1]!.confidence).toBeGreaterThanOrEqual(0.8);
  });
});
