// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G3: the `select` expressions for picked frames, ranges and passed thresholds. Up to 32 frames it is the
 * plain sum every earlier release built; past that a binary search. Each expression is read the way FFmpeg reads
 * it (helpers/ffmpeg-expr.ts, with its depth rule) to check it keeps exactly its frames and stays shallow however
 * many there are.
 */
import { describe, expect, it } from 'vitest';
import { framesExpression as publicFramesExpression } from '@taalcut/media';
import { pickedFrames, pickFilters } from '../../src/frame-sets/branch-graph';
import { selectFrames } from '../../src/normalise/filters';
import {
  FLAT_FRAMES,
  framesExpression,
  passedCount,
  rangesExpression,
  selectedFrames,
} from '../../src/normalise/frame-select';
import { FFMPEG_MAX_DEPTH, parseExpression } from '../helpers/ffmpeg-expr';

/** A fixed pseudo-random sequence (LCG), so the sets are the same every run. */
function sequence(seed: number) {
  let state = seed;
  return () => (state = (state * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
}

function sparseWithRuns(count: number, span: number, seed: number): number[] {
  const next = sequence(seed);
  const frames = new Set<number>();
  while (frames.size < count) {
    const start = Math.floor(next() * span);
    const length = next() < 0.2 ? 1 + Math.floor(next() * 12) : 1;
    for (let i = 0; i < length && frames.size < count; i++) frames.add(start + i);
  }
  return [...frames];
}

/** The frames 0…`last` an expression on `n` keeps. */
function keptFrames(text: string, last: number): number[] {
  const parsed = parseExpression(text);
  return Array.from({ length: last + 1 }, (_, n) => n).filter((n) => parsed.evaluate({ n }) !== 0);
}

const sets: [string, number[]][] = [
  ['33 apart', Array.from({ length: FLAT_FRAMES + 1 }, (_, i) => i * 7)],
  [
    '120: sparse, then a run',
    Array.from({ length: 100 }, (_, i) => i * 11 + (i % 3)).concat(
      [...Array(20).keys()].map((i) => 1150 + i),
    ),
  ],
  ['400 apart', Array.from({ length: 400 }, (_, i) => i * 3)],
  ['5000 random, some in runs, over 3 hours', sparseWithRuns(5000, 30 * 60 * 60 * 3, 7)],
];

describe('framesExpression', () => {
  it('keeps the plain sum up to 32 frames: same text, first-seen order, repeats dropped', () => {
    const frames = [9, 3, 3.7, -2, 9, 40];
    expect(framesExpression(frames)).toBe('eq(n\\,9)+eq(n\\,3)+eq(n\\,0)+eq(n\\,40)');
    expect(publicFramesExpression(frames)).toBe(framesExpression(frames));
    expect(selectFrames(frames)).toBe(
      "select='eq(n\\,9)+eq(n\\,3)+eq(n\\,0)+eq(n\\,40)',setpts=N/FRAME_RATE/TB",
    );
    expect(pickFilters({ frames: [5, 1] })).toEqual([
      "select='eq(n\\,5)+eq(n\\,1)'",
      'setpts=N/FRAME_RATE/TB',
    ]);
    expect(framesExpression([])).toBe('eq(n\\,0)');
    const flat = Array.from({ length: FLAT_FRAMES }, (_, i) => i * 2);
    expect(framesExpression(flat)).toBe(flat.map((i) => `eq(n\\,${i})`).join('+'));
  });

  it.for(sets)('%s: keeps exactly its frames, well inside FFmpeg’s depth', ([, frames]) => {
    const text = framesExpression(frames);
    expect(text.startsWith('if(lt(n\\,')).toBe(true);
    const parsed = parseExpression(text);
    const wanted = new Set(frames);
    const last = Math.max(...frames);
    for (let n = 0; n <= last + 2; n++) {
      if ((parsed.evaluate({ n }) !== 0) !== wanted.has(n)) throw new Error(`frame ${n}`);
    }
    // The depth grows with the log of the runs: 5000 frames stay under a fifth of the limit.
    expect(parsed.depth).toBeLessThanOrEqual(20);
    expect(parsed.depth).toBeLessThan(FFMPEG_MAX_DEPTH);
    // About 15 characters a frame (more for long indexes), whatever the order asked.
    expect(text.length / wanted.size).toBeLessThan(24);
    expect(framesExpression([...frames].reverse().concat(frames))).toBe(text);
  });

  it('merges consecutive frames into ranges', () => {
    const run = Array.from({ length: 10_000 }, (_, i) => i);
    expect(framesExpression(run)).toBe('between(n\\,0\\,9999)');
    const text = framesExpression([...run.slice(0, 50), 100, 300, ...run.slice(500, 600)]);
    expect(text).toBe('between(n\\,0\\,49)+eq(n\\,100)+eq(n\\,300)+between(n\\,500\\,599)');
  });

  it('cleans frames as the plain sum does (whole, not negative), and pickedFrames lists them in order', () => {
    const frames = [...Array.from({ length: 40 }, (_, i) => 80 - 2 * i), -5, 3.9, 3];
    const kept = keptFrames(framesExpression(frames), 89);
    expect(kept).toEqual(pickedFrames({ frames }, 90));
    expect(kept.slice(0, 3)).toEqual([0, 2, 3]);
  });
});

describe('rangesExpression', () => {
  it('keeps every frame of the ranges, overlapping or out of order; none keeps nothing', () => {
    const text = rangesExpression([
      { first: 40, last: 44 },
      { first: 2, last: 4 },
      { first: 3, last: 9 },
      { first: 10, last: 10 },
      { first: 20, last: 19 },
    ]);
    expect(text).toBe('between(n\\,2\\,10)+between(n\\,40\\,44)');
    expect(rangesExpression([])).toBe('0');
    expect(keptFrames(rangesExpression([]), 5)).toEqual([]);
  });

  it('300 shots of 1 to 30 frames with gaps: exactly their frames, shallow', () => {
    const next = sequence(3);
    const runs: { first: number; last: number }[] = [];
    let at = 0;
    for (let shot = 0; shot < 300; shot++) {
      at += 1 + Math.floor(next() * 20);
      const length = 1 + Math.floor(next() * 30);
      runs.push({ first: at, last: at + length - 1 });
      at += length;
    }
    const text = rangesExpression([...runs].reverse());
    const parsed = parseExpression(text);
    expect(parsed.depth).toBeLessThanOrEqual(16);
    const wanted = runs.flatMap((run) =>
      Array.from({ length: run.last - run.first + 1 }, (_, i) => run.first + i),
    );
    expect(keptFrames(text, at + 5)).toEqual(wanted);
  });
});

describe('non-finite input (EAR1-R4)', () => {
  const many = (extra: number[]) => [
    ...Array.from({ length: FLAT_FRAMES + 8 }, (_, i) => 10 + i * 3),
    ...extra,
  ];

  it('framesExpression keeps the frames selectedFrames names: none for NaN or +Infinity, frame 0 for -Infinity', () => {
    for (const frames of [[Number.NaN], [Number.POSITIVE_INFINITY], [Number.NaN, Number.POSITIVE_INFINITY]]) {
      expect(selectedFrames(frames)).toEqual([]);
      expect(framesExpression(frames)).toBe('0');
      expect(keptFrames(framesExpression(frames), 5)).toEqual([]);
    }
    // As the plain sum read it: -Infinity is a negative, clamped to frame 0.
    expect(selectedFrames([Number.NEGATIVE_INFINITY, 4])).toEqual([0, 4]);
    expect(framesExpression([Number.NEGATIVE_INFINITY, 4])).toBe('eq(n\\,0)+eq(n\\,4)');
    expect(framesExpression([Number.NaN, 7, Number.POSITIVE_INFINITY])).toBe('eq(n\\,7)');
    // The same past the plain sum, through the search.
    const frames = many([Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]);
    const last = 10 + (FLAT_FRAMES + 7) * 3 + 2;
    expect(keptFrames(framesExpression(frames), last)).toEqual(selectedFrames(frames).sort((a, b) => a - b));
    expect(keptFrames(framesExpression(frames), last)[0]).toBe(0);
    // Nothing asked still keeps frame 0, as every release has.
    expect(framesExpression([])).toBe('eq(n\\,0)');
  });

  it('rangesExpression clamps infinite ends and drops NaN ones', () => {
    expect(rangesExpression([{ first: 3, last: Number.POSITIVE_INFINITY }])).toBe('gte(n\\,3)');
    expect(keptFrames(rangesExpression([{ first: 3, last: Number.POSITIVE_INFINITY }]), 9)).toEqual([
      3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(rangesExpression([{ first: Number.NEGATIVE_INFINITY, last: 2 }])).toBe('between(n\\,0\\,2)');
    for (const run of [
      { first: Number.NaN, last: 4 },
      { first: 1, last: Number.NaN },
      { first: Number.POSITIVE_INFINITY, last: Number.POSITIVE_INFINITY },
      { first: 0, last: Number.NEGATIVE_INFINITY },
    ])
      expect(rangesExpression([run])).toBe('0');
    // An open run swallows every later one, in the flat sum and through the search.
    expect(
      rangesExpression([
        { first: 8, last: 9 },
        { first: 2, last: Number.POSITIVE_INFINITY },
      ]),
    ).toBe('gte(n\\,2)');
    const runs = Array.from({ length: 40 }, (_, i) => ({ first: i * 10, last: i * 10 + 2 }));
    const open = rangesExpression([...runs, { first: 395, last: Number.POSITIVE_INFINITY }]);
    const kept = keptFrames(open, 420);
    expect(kept.filter((n) => n >= 395)).toEqual(Array.from({ length: 26 }, (_, i) => 395 + i));
    expect(kept.filter((n) => n < 395)).toEqual(
      runs.flatMap((run) => [run.first, run.first + 1, run.first + 2]).filter((n) => n < 395),
    );
  });
});

describe('passedCount', () => {
  const count = (text: string, at: number) => parseExpression(text).evaluate({ t: at });

  it('is the plain sum up to 32 thresholds, in the order given; NaN passes none', () => {
    expect(passedCount('t', [2, 1], (v) => v.toFixed(1))).toBe('gte(t\\,2.0)+gte(t\\,1.0)');
    expect(count(passedCount('t', [2, 1]), Number.NaN)).toBe(0);
    expect(passedCount('t', [])).toBe('0');
  });

  it('counts 5000 thresholds (with repeats) at any time, shallow', () => {
    const next = sequence(11);
    const thresholds = Array.from({ length: 5000 }, () => Math.round(next() * 6000) / 10);
    thresholds.push(...thresholds.slice(0, 50));
    const text = passedCount('t', thresholds);
    expect(parseExpression(text).depth).toBeLessThanOrEqual(24);
    for (const at of [Number.NaN, -1, 0, 0.05, 12.3, 299.95, 300, 450.1, 600, 601]) {
      expect(count(text, at), `${at}`).toBe(thresholds.filter((value) => at >= value).length);
    }
  });
});
