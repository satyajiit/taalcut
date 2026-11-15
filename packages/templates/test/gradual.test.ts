// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: dissolves and fades found from pixels (breakdown/gradual.ts), on frames drawn here: two moving pictures
 * blended over known frames, faded through black, cut hard, panned, and dimmed. And what the findings become:
 * confirmed when method B finds the two sides apart, disputed (`pixels`) when it doesn't.
 */
import { describe, expect, it } from 'vitest';
import { BREAKDOWN_CONFIG, findGradual, withGradual, type CutFinding } from '../src/index';
import { clearOf, disputeSides } from '../src/breakdown/gradual-step';

const config = BREAKDOWN_CONFIG.gradual;
const WIDTH = 36;
const HEIGHT = 64;
const FPS = 30;

type Picture = (x: number, y: number, t: number) => number;
/** Diagonal stripes that drift, over slow blobs. */
const first: Picture = (x, y, t) =>
  128 + 55 * Math.sin(0.35 * x + 0.2 * y + 0.04 * t) + 40 * Math.sin(0.11 * x - 0.27 * y);
/** Rings that grow from a corner. */
const second: Picture = (x, y, t) =>
  120 + 70 * Math.sin(0.02 * ((x - 30) ** 2 + (y - 10) ** 2) ** 0.9 - 0.05 * t);

/** Frame `t` as `mix` says: how much of each picture, 0 to 1 each. */
function frames(count: number, mix: (t: number) => { a: number; b: number }, speed = 1): Uint8Array[] {
  return Array.from({ length: count }, (_, t) => {
    const { a, b } = mix(t);
    const out = new Uint8Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) {
        const value = a * first(x, y, t * speed) + b * second(x, y, t * speed);
        out[y * WIDTH + x] = Math.max(0, Math.min(255, Math.round(value)));
      }
    return out;
  });
}

/** A dissolve whose blended frames are `start`..`end`. */
const dissolve = (start: number, end: number) => (t: number) => {
  const b = Math.max(0, Math.min(1, (t - start + 1) / (end - start + 2)));
  return { a: 1 - b, b };
};

describe('findGradual', () => {
  it('finds a ten-frame dissolve between two moving pictures, to the frame', () => {
    const found = findGradual(frames(120, dissolve(50, 59)), FPS, config);
    expect(found).toHaveLength(1);
    const [transition] = found;
    expect(transition).toMatchObject({ kind: 'dissolve', bothSides: true });
    // No blended frame is called a shot's own; at most two clean frames either side are called blended.
    expect(transition!.start).toBeLessThanOrEqual(50);
    expect(transition!.start).toBeGreaterThanOrEqual(48);
    expect(transition!.end).toBeGreaterThanOrEqual(59);
    expect(transition!.end).toBeLessThanOrEqual(61);
    // The new shot starts inside it, where the second picture takes over.
    expect(transition!.frame).toBeGreaterThanOrEqual(54);
    expect(transition!.frame).toBeLessThanOrEqual(56);
  });

  it('finds a slow dissolve of a second', () => {
    const [transition, ...more] = findGradual(frames(150, dissolve(50, 79)), FPS, config);
    expect(more).toEqual([]);
    expect(transition?.kind).toBe('dissolve');
    expect(transition!.start).toBeLessThanOrEqual(50);
    expect(transition!.end).toBeGreaterThanOrEqual(79);
    expect(transition!.end - transition!.start).toBeLessThanOrEqual(40);
  });

  it('finds a fade through black as one transition, the new shot starting after the black', () => {
    // The first picture fades over frames 40 to 47, black holds 48 to 51, the second comes up over 52 to 59.
    const mix = (t: number) => ({
      a: t < 40 ? 1 : t < 48 ? 1 - (t - 39) / 9 : 0,
      b: t < 52 ? 0 : t < 60 ? (t - 51) / 9 : 1,
    });
    const found = findGradual(frames(110, mix), FPS, config);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'fade', bothSides: true });
    expect(found[0]!.start).toBeLessThanOrEqual(40);
    expect(found[0]!.end).toBeGreaterThanOrEqual(59);
    expect(found[0]!.frame).toBeGreaterThanOrEqual(52);
    expect(found[0]!.frame).toBeLessThanOrEqual(54);
  });

  it('leaves a fade out at the end of a reel, and a fade in at its start, to the other steps', () => {
    const out = (t: number) => ({ a: t < 60 ? 1 : Math.max(0, 1 - (t - 59) / 10), b: 0 });
    expect(findGradual(frames(90, out), FPS, config)).toEqual([]);
    const into = (t: number) => ({ a: 0, b: Math.min(1, t / 10) });
    expect(findGradual(frames(90, into), FPS, config)).toEqual([]);
  });

  it('finds nothing in a hard cut, a fast move, a held picture or a drop in exposure', () => {
    const cut = (t: number) => (t < 45 ? { a: 1, b: 0 } : { a: 0, b: 1 });
    expect(findGradual(frames(90, cut), FPS, config)).toEqual([]);
    expect(
      findGradual(
        frames(90, () => ({ a: 1, b: 0 }), 6),
        FPS,
        config,
      ),
    ).toEqual([]);
    expect(
      findGradual(
        frames(90, () => ({ a: 0, b: 1 }), 0),
        FPS,
        config,
      ),
    ).toEqual([]);
    // The same picture, down to a third of its light over half a second: darker, never another picture.
    const dim = (t: number) => ({ a: t < 40 ? 1 : t < 55 ? 1 - (0.7 * (t - 39)) / 15 : 0.3, b: 0 });
    expect(findGradual(frames(90, dim, 0), FPS, config)).toEqual([]);
    expect(findGradual(frames(90, dim, 0.2), FPS, config)).toEqual([]);
  });

  it('never calls a dissolve longer than the config allows a transition', () => {
    expect(findGradual(frames(200, dissolve(40, 139)), FPS, config)).toEqual([]);
  });

  it('finds none in a reel too short to hold one', () => {
    expect(findGradual(frames(6, dissolve(2, 4)), FPS, config)).toEqual([]);
  });
});

describe('withGradual', () => {
  const transition = { kind: 'dissolve', start: 296, end: 308, frame: 303, bothSides: false } as const;
  const finding = (frame: number, extra: Partial<CutFinding> = {}): CutFinding => ({
    frame,
    method: 'scdet',
    status: 'disputed',
    score: 9,
    distance: 0.12,
    ramp: null,
    ruleKeeps: false,
    ...extra,
  });

  it('confirms the transition when method B finds its two sides apart, with the frames either side of the cut', () => {
    const merged = withGradual(
      [finding(324, { method: 'both', status: 'confirmed' })],
      [transition],
      () => 0.4,
      {
        embed: BREAKDOWN_CONFIG.embed,
      },
    );
    expect(merged.map((item) => item.frame)).toEqual([303, 324]);
    expect(merged[0]).toEqual({
      frame: 303,
      method: 'both',
      status: 'confirmed',
      score: null,
      distance: 0.4,
      ramp: { start: 296, end: 308 },
      ruleKeeps: true,
      // Frames 296 to 302 are before the cut, 303 to 308 after: 309 is the new shot's first clean frame.
      blend: { kind: 'dissolve', before: 7, after: 6, confidence: 0.8 },
    });
  });

  it('disputes it as `pixels` when method B does not, and the rule keeps it unless the sides look the same', () => {
    const embed = { embed: BREAKDOWN_CONFIG.embed };
    expect(withGradual([], [transition], () => 0.12, embed)[0]).toMatchObject({
      method: 'pixels',
      status: 'disputed',
      ruleKeeps: true,
    });
    expect(withGradual([], [transition], () => null, embed)[0]).toMatchObject({
      method: 'pixels',
      status: 'disputed',
      ruleKeeps: true,
    });
    expect(withGradual([], [transition], () => 0.01, embed)[0]).toMatchObject({
      method: 'pixels',
      ruleKeeps: false,
    });
  });

  it('takes the place of what the cut methods proposed inside it', () => {
    const inside = [
      finding(300),
      finding(309),
      finding(290, { method: 'embedding', ramp: { start: 285, end: 297 } }),
      finding(295),
      finding(310),
    ];
    const merged = withGradual(inside, [{ ...transition, bothSides: true }], () => 0.5, {
      embed: BREAKDOWN_CONFIG.embed,
    });
    expect(merged.map((item) => item.frame)).toEqual([303, 310]);
    expect(merged[0]?.blend?.confidence).toBe(0.95);
  });
});

describe('the frames the Analyst is shown', () => {
  const blends = [{ start: 296, end: 308 }];

  it('are a shot’s own: its first and last frame move out of a transition, inside the shot', () => {
    expect(clearOf(303, { start: 303, end: 324 }, blends, 1)).toBe(309);
    expect(clearOf(302, { start: 0, end: 303 }, blends, -1)).toBe(295);
    expect(clearOf(120, { start: 0, end: 303 }, blends, 1)).toBe(120);
    // A shot that lies wholly inside the transition keeps its frame.
    expect(clearOf(303, { start: 303, end: 306 }, blends, 1)).toBe(303);
  });

  it('are the two pictures either side of a disputed transition, and the cut’s neighbours otherwise', () => {
    expect(disputeSides(303, 470, blends)).toEqual({ before: 295, after: 309 });
    expect(disputeSides(324, 470, blends)).toEqual({ before: 323, after: 324 });
    expect(disputeSides(0, 470, [])).toEqual({ before: 0, after: 0 });
  });
});
