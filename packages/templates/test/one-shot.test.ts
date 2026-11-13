// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-ACC: a soft cut where the scene score and the frame embeddings show one shot is not a cut (a walking shot
 * whose embedding drifts between two hard cuts made REF1's false cut and whip), and a fade's dark tail joins the
 * shot before it (REF1's black slot at the end). Made-up scores, places and luma.
 */
import { describe, expect, it } from 'vitest';
import { BREAKDOWN_CONFIG } from '../src/breakdown/config';
import { driftSpan, fadeStart, isDrift, isFadeTail, shotChange, shotMotion } from '../src/breakdown/one-shot';

const config = BREAKDOWN_CONFIG;
/** scdet scores (0–100) for `length` frames: `base` everywhere, `cuts` at 60. */
function scores(
  length: number,
  base: number,
  cuts: readonly number[] = [],
  bumps: Record<number, number> = {},
) {
  return Array.from({ length }, (_, frame) => (cuts.includes(frame) ? 60 : (bumps[frame] ?? base)));
}
/** A picture's place along one line, frame by frame; the embedding distance between two frames is how far apart. */
const along = (place: (frame: number) => number) => (a: number, b: number) => Math.abs(place(a) - place(b));
/** Still, then a change from `from` to `to`, then still. */
const step = (from: number, to: number) => (frame: number) =>
  frame <= from ? 0 : frame >= to ? 1 : (frame - from) / (to - from);

describe('isDrift', () => {
  const flat = scores(360, 1.5, [188, 206]);

  it('a ramp that fills the shot between two hard cuts is one shot drifting', () => {
    // Hard cuts at 188 and 206; the embedding drifts the whole way as the camera walks down a street.
    const span = driftSpan({ start: 191, end: 202 }, [0, 188, 206, 360], config);
    expect(span).toEqual({ before: 188, start: 191, end: 202, after: 205 });
    expect(
      isDrift(
        span,
        along((frame) => frame * 0.02),
        flat,
        config,
      ),
    ).toBe(true);
  });

  it('a ramp that runs on to the next hard cut stops before it, and is still drift', () => {
    // The scan's window ran to the cut's frame, so the ramp ends on the next shot's first frame.
    const span = driftSpan({ start: 191, end: 206 }, [0, 188, 206, 360], config);
    expect(span).toEqual({ before: 188, start: 191, end: 205, after: 205 });
    expect(
      isDrift(
        span,
        along((frame) => (frame < 206 ? frame * 0.02 : 9)),
        flat,
        config,
      ),
    ).toBe(true);
  });

  it('a change as fast as the shot moves either side of it is drift, with room either side', () => {
    const span = driftSpan({ start: 120, end: 150 }, [0, 20, 280, 400], config);
    expect(
      isDrift(
        span,
        along((frame) => frame * 0.01),
        scores(400, 2, [20, 280]),
        config,
      ),
    ).toBe(true);
  });

  it('a pan that starts mid-shot and runs on to the cut is drift: as fast after the ramp as in it', () => {
    const span = driftSpan({ start: 120, end: 135 }, [0, 20, 160, 400], config);
    const pan = (frame: number) => Math.max(0, frame - 115) * 0.02;
    expect(isDrift(span, along(pan), scores(400, 1, [20, 160]), config)).toBe(true);
  });

  it('a dissolve between still shots is a transition', () => {
    const span = driftSpan({ start: 100, end: 111 }, [0, 40, 170, 400], config);
    expect(isDrift(span, along(step(100, 111)), scores(400, 0.2, [40, 170]), config)).toBe(false);
  });

  it('a dissolve into a moving shot is a transition: far faster than the shot moves', () => {
    const span = driftSpan({ start: 100, end: 111 }, [0, 40, 170, 400], config);
    const into = (frame: number) => step(100, 111)(frame) + Math.max(0, frame - 111) * 0.01;
    expect(isDrift(span, along(into), scores(400, 0.2, [40, 170]), config)).toBe(false);
  });

  it('a change the scene score already sees is never drift, and a frame without a vector keeps the cut', () => {
    const span = driftSpan({ start: 191, end: 202 }, [0, 188, 206, 360], config);
    const seen = scores(360, 1.5, [188, 206], { 196: config.scdet.propose + 1 });
    expect(
      isDrift(
        span,
        along((frame) => frame * 0.02),
        seen,
        config,
      ),
    ).toBe(false);
    const roomy = driftSpan({ start: 120, end: 150 }, [0, 20, 280, 400], config);
    expect(isDrift(roomy, () => null, flat, config)).toBe(false);
  });
});

describe('isFadeTail', () => {
  const luma = (values: readonly number[], from: number) =>
    values.map((value, i) => ({ frame: from + i, value }));
  // The last shot fades from 0.45 at frame 336 to black at 349; the soft cut lands at 348.
  const fadeOut = luma(
    [0.45, 0.43, 0.4, 0.36, 0.33, 0.3, 0.26, 0.22, 0.19, 0.15, 0.12, 0.09, 0.07, 0.05, 0.05, 0.05],
    336,
  );

  it('a cut inside a fade that keeps darkening to the end is the fade’s tail', () => {
    expect(isFadeTail(348, 352, fadeOut, config)).toBe(true);
  });

  it('a cut into a new shot fading up from black is not', () => {
    const fadeIn = luma([0.3, 0.2, 0.1, 0.04, 0.02, 0.06, 0.12, 0.2, 0.28, 0.35, 0.4, 0.42], 90);
    expect(isFadeTail(95, 102, fadeIn, config)).toBe(false);
  });

  it('a cut to a bright shot is not', () => {
    const bright = luma([0.5, 0.5, 0.48, 0.6, 0.62, 0.61, 0.6], 10);
    expect(isFadeTail(13, 17, bright, config)).toBe(false);
  });

  it('without luma it can’t tell, and keeps the cut', () => {
    expect(isFadeTail(348, 352, [], config)).toBe(false);
  });
});

describe('fadeStart and shotChange (BRK1 moves)', () => {
  const luma = (values: readonly number[], from: number) =>
    values.map((value, i) => ({ frame: from + i, value }));

  it('finds where a fade to black begins: the first frame of the darkening run that holds the tail', () => {
    const fade = luma([0.45, 0.46, 0.45, 0.45, 0.4, 0.34, 0.27, 0.2, 0.13, 0.07, 0.05, 0.05], 330);
    expect(fadeStart(339, fade)).toBe(333);
    expect(fadeStart(339, [])).toBeNull();
  });

  const vectors = new Map<number, Float32Array>([
    [0, Float32Array.of(1, 0)],
    [8, Float32Array.of(1, 0)],
    [52, Float32Array.of(1, 0.02)],
    [60, Float32Array.of(0.6, 0.8)],
    [66, Float32Array.of(0, 1)],
  ]);

  it('measures a shot from its first embedded frame to its last, inside the shot and before any fade', () => {
    expect(shotChange(vectors, { start: 0, end: 60 })).toBeCloseTo(0.0002, 3);
    expect(shotChange(vectors, { start: 0, end: 70 })).toBeCloseTo(1, 3);
    expect(shotChange(vectors, { start: 0, end: 70 }, 55)).toBeCloseTo(0.0002, 3);
  });

  it('can’t measure a shot without two embedded frames in it', () => {
    expect(shotChange(vectors, { start: 20, end: 40 })).toBeNull();
  });
});

describe('shotMotion (BRK1 moves)', () => {
  /** vision.motionCurve over one shot: a sample every 3 frames (10 a second at 30 fps), after its first frame. */
  const curve = (from: number, values: readonly number[]) =>
    values.map((value, i) => ({ frame: from + 3 * (i + 1), value }));

  it('averages the camera’s motion through the shot, without its fastest and slowest sample', () => {
    // A pan across the same street: the picture stays the same scene, the camera moves. A cut's blend spikes once.
    expect(shotMotion(curve(0, [0.9, 0.02, 0.03, 0.02, 0.025]), { start: 0, end: 18 })).toBeCloseTo(0.025, 6);
    // Locked off: a little sensor noise.
    expect(shotMotion(curve(0, [0.002, 0.004, 0.003, 0.001]), { start: 0, end: 15 })).toBeCloseTo(0.0025, 6);
    expect(shotMotion(curve(0, [0.04, 0.02]), { start: 0, end: 9 })).toBeCloseTo(0.03, 6);
  });

  it('reads only the shot, and stops where it fades out', () => {
    const samples = [
      ...curve(0, [0.003, 0.002, 0.004, 0.003, 0.6, 0.7, 0.8, 0.9]),
      ...curve(24, [0.5, 0.5, 0.5]),
    ];
    expect(shotMotion(samples, { start: 0, end: 24 }, 12)).toBeCloseTo(0.003, 6);
    expect(shotMotion(samples, { start: 0, end: 24 })).toBeGreaterThan(0.1);
  });

  it('can’t measure a shot the curve has no sample in', () => {
    expect(shotMotion(curve(30, [0.2, 0.2]), { start: 0, end: 30 })).toBeNull();
    expect(shotMotion([], { start: 0, end: 30 })).toBeNull();
  });
});
