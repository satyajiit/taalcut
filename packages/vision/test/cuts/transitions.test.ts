// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C4: transitions from TransNetV2's predictions, as upstream's `predictions_to_scenes` reads them. A hard
 * cut lands where scdet's score shows a sharp change inside the transition, else after the run (on a thinned
 * stream, on the skipped grid frame that changes most); a long many-hot span without one is a dissolve placed at
 * its middle; a run on the first frame is the video's start.
 */
import { describe, expect, it } from 'vitest';
import { transitionsFrom, type SharpestChange } from '../../src/cuts/transitions';

function predictions(
  length: number,
  every: number,
  single: Record<number, number>,
  manyHot: Record<number, number> = {},
) {
  const s = new Float32Array(length);
  const m = new Float32Array(length);
  for (const [k, v] of Object.entries(single)) s[Number(k)] = v;
  for (const [k, v] of Object.entries(manyHot)) m[Number(k)] = v;
  return { every, single: s, manyHot: m };
}

/** scdet's scores over the grid: `peaks` where given, a little motion elsewhere. */
function scores(peaks: Record<number, number>) {
  const seen: [number, number][] = [];
  const locate = (after: number, upTo: number): SharpestChange | undefined => {
    seen.push([after, upTo]);
    let best: SharpestChange | undefined;
    for (let frame = after + 1; frame <= upTo; frame++) {
      const score = peaks[frame] ?? 1;
      if (!best || score > best.score) best = { frame, score };
    }
    return best;
  };
  return { seen, locate };
}

const options = { threshold: 0.5, gradualFrames: 6, cutScore: 8 };
const hot = (from: number, count: number, value = 0.8) =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [from + i, value]));

describe('transitionsFrom', () => {
  it('starts the new shot after the run of a hard cut when there are no scene scores', () => {
    const out = transitionsFrom(predictions(100, 1, { 29: 0.97 }, { 29: 0.9, 30: 0.7 }), options);
    expect(out).toEqual([
      { frame: 30, kind: 'cut', span: { from: 29, to: 30 }, probability: expect.closeTo(0.97, 5) },
    ]);
  });

  it('puts a cut on the sharp change inside the transition, even when the head peaks off it', () => {
    // ix-v1's city clip: the single-frame head peaks two frames late and the many-hot head runs 7 wide.
    const { seen, locate } = scores({ 216: 64 });
    const out = transitionsFrom(predictions(300, 1, { 218: 0.81, 219: 0.61 }, hot(215, 7, 0.85)), {
      ...options,
      locate,
    });
    expect(seen).toEqual([[214, 222]]);
    expect(out).toEqual([
      { frame: 216, kind: 'cut', span: { from: 215, to: 221 }, probability: expect.closeTo(0.81, 5) },
    ]);
  });

  it('places a cut on a thinned stream on the grid frame where the picture changes', () => {
    const { seen, locate } = scores({ 41: 30 });
    const out = transitionsFrom(predictions(50, 2, { 20: 0.9 }), { ...options, locate });
    expect(seen).toEqual([[39, 42]]);
    expect(out[0]).toMatchObject({ frame: 41, kind: 'cut', span: { from: 40, to: 41 } });
    // No sharp change there (a whip pan, two similar shots): the grid frame between the run's last stream frame
    // and the next where scdet sees the most change.
    const soft = scores({ 41: 2, 42: 3 });
    expect(
      transitionsFrom(predictions(50, 2, { 20: 0.9 }), { ...options, locate: soft.locate })[0]?.frame,
    ).toBe(42);
    expect(soft.seen).toEqual([
      [39, 42],
      [40, 42],
    ]);
  });

  it('places a dissolve at the middle of its many-hot span when nothing in it is sharp', () => {
    const { locate } = scores({});
    const out = transitionsFrom(predictions(120, 2, { 46: 0.6, 47: 0.7 }, hot(40, 15)), {
      ...options,
      locate,
    });
    expect(out).toEqual([
      { frame: 95, kind: 'dissolve', span: { from: 80, to: 109 }, probability: expect.closeTo(0.7, 5) },
    ]);
  });

  it('keeps a short span without a sharp change a cut', () => {
    const { locate } = scores({});
    const out = transitionsFrom(predictions(100, 1, { 50: 0.9 }, hot(48, 4)), { ...options, locate });
    expect(out).toMatchObject([{ frame: 51, kind: 'cut', span: { from: 48, to: 51 } }]);
  });

  it('ignores a run on the first frame and anything at or under the threshold', () => {
    expect(transitionsFrom(predictions(60, 1, { 0: 0.9, 1: 0.8, 30: 0.5 }), options)).toEqual([]);
  });

  it('finds every run, in order, and one boundary where two runs find the same change', () => {
    const out = transitionsFrom(predictions(300, 1, { 49: 0.9, 149: 0.8, 150: 0.85, 249: 0.6 }), options);
    expect(out.map((t) => t.frame)).toEqual([50, 151, 250]);
    const { locate } = scores({ 120: 40 });
    const twice = transitionsFrom(predictions(300, 1, { 117: 0.9, 121: 0.7 }, hot(116, 7)), {
      ...options,
      locate,
    });
    expect(twice.map((t) => [t.frame, t.kind])).toEqual([[120, 'cut']]);
  });
});
