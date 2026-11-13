// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the breakdown records where people are in the reel (core's ReelSubjects) from the subject analyser:
 * in time order at the template's rate, boxes clamped into the picture, nothing without an analyser.
 */
import { describe, expect, it } from 'vitest';
import { err, FrameRates, ok, RationalTime, reelSubjectsDuring, UnknownError } from '@taalcut/core';
import type { BreakdownAnalysers, BreakdownVision } from '../src/breakdown/ports';
import { readReelSubjects, REEL_SUBJECTS_HZ } from '../src/breakdown/reel-subjects';
import type { StepContext } from '../src/breakdown/steps';

const rate = FrameRates.fps30;

function context(subjects?: BreakdownVision['subjects']): StepContext & { asked: number[] } {
  const asked: number[] = [];
  const vision = {
    ...(subjects
      ? {
          subjects: ((path, options) => {
            asked.push(options.hz);
            return subjects(path, options);
          }) satisfies BreakdownVision['subjects'],
        }
      : {}),
  };
  return {
    path: '/exp/normalised.mp4',
    dir: '/exp',
    rate,
    total: 90,
    analysers: { vision } as unknown as BreakdownAnalysers,
    config: {} as StepContext['config'],
    signal: new AbortController().signal,
    asked,
  };
}

const head = (x: number) => ({ box: { x, y: 0.1, width: 0.2, height: 0.15 }, confidence: 0.9 });

describe("the reel's subjects (FRM1-SUB)", () => {
  it('records the samples in time order at the reel rate, boxes clamped into the picture', async () => {
    const ctx = context(async () =>
      ok({
        detector: 'vision',
        samples: [
          { frame: 15, heads: [head(0.5)], people: [] },
          {
            frame: 0,
            heads: [head(0.9)],
            people: [{ box: { x: -0.1, y: 0, width: 0.5, height: 1.2 }, confidence: 1.4 }],
          },
          // Past the reel's end: dropped.
          { frame: 120, heads: [head(0.1)], people: [] },
        ],
      }),
    );
    const read = await readReelSubjects(ctx);
    expect(ctx.asked).toEqual([REEL_SUBJECTS_HZ]);
    const subjects = read.ok ? read.value : null;
    expect(subjects?.samples.map((sample) => sample.t)).toEqual([
      RationalTime.of(0, rate),
      RationalTime.of(15, rate),
    ]);
    expect(subjects?.samples[0]?.heads[0]?.box.width).toBeCloseTo(0.1, 6);
    expect(subjects?.samples[0]?.people[0]).toEqual({
      box: { x: 0, y: 0, width: 0.4, height: 1 },
      confidence: 1,
    });
    expect(subjects?.detector).toBe('vision');
    // An overlay over frames 10–20 reads the sample at 15.
    const during = reelSubjectsDuring(subjects!, RationalTime.of(10, rate), RationalTime.of(10, rate));
    expect(during.map((sample) => sample.t.value)).toEqual([15]);
  });

  it('records nothing without an analyser, and passes a failure on (the breakdown warns and goes on)', async () => {
    expect(await readReelSubjects(context())).toEqual(ok(null));
    const failed = await readReelSubjects(context(async () => err(UnknownError())));
    expect(failed.ok).toBe(false);
  });
});
