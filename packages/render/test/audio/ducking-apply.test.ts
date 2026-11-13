// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Ducking envelopes as `volume` expressions (P3-V6): exact at the points, linear in dB, a balanced tree. */
import { describe, expect, it } from 'vitest';
import type { GainPoint } from '@taalcut/core';
import { gainAt, gainExpression } from '../../src/audio/ducking-apply';
import { busedFilterGraph, mixFilterGraph } from '../../src/audio/mix-graph';
import type { AudioMixPlan, MixSegment } from '../../src/audio/mix-types';

/** Evaluates the expression the way FFmpeg's parser reads it: if/lt/exp of `t` and decimals. */
function evaluate(expression: string, t: number): number {
  const js = expression.replace(/\bif\(/g, 'iff(');
  const run = new Function('t', 'iff', 'lt', 'exp', `return ${js};`) as (
    t: number,
    iff: (c: number, a: number, b: number) => number,
    lt: (a: number, b: number) => number,
    exp: (x: number) => number,
  ) => number;
  return run(
    t,
    (c, a, b) => (c ? a : b),
    (a, b) => (a < b ? 1 : 0),
    Math.exp,
  );
}

/** How deeply `if` nests. */
function depth(expression: string): number {
  let deepest = 0;
  const stack: boolean[] = [];
  for (let i = 0; i < expression.length; i++) {
    if (expression.startsWith('if(', i)) {
      stack.push(true);
      deepest = Math.max(deepest, stack.filter(Boolean).length);
      i += 2;
    } else if (expression[i] === '(') stack.push(false);
    else if (expression[i] === ')') stack.pop();
  }
  return deepest;
}

const dbOf = (gain: number) => 20 * Math.log10(gain);

/** A typical duck: down to the floor over the attack, held, back over the release, many times. */
function ducks(count: number): GainPoint[] {
  const points: GainPoint[] = [];
  for (let i = 0; i < count; i++) {
    const at = 48_000 + i * 96_000;
    points.push(
      { sample: at, db: 0 },
      { sample: at + 3840, db: -30 },
      { sample: at + 40_000, db: -30 },
      { sample: at + 54_400, db: 0 },
    );
  }
  return points;
}

describe('gainExpression', () => {
  it('is null when the envelope never leaves 0 dB', () => {
    expect(gainExpression([])).toBeNull();
    expect(
      gainExpression([
        { sample: 0, db: 0 },
        { sample: 48_000, db: 0 },
      ]),
    ).toBeNull();
  });

  it('gives each point its gain exactly, and dB on a straight line between points', () => {
    const points = ducks(3);
    const expression = gainExpression(points)!;
    for (const point of points)
      expect(dbOf(evaluate(expression, point.sample / 48_000))).toBeCloseTo(point.db, 9);
    // Halfway down the attack is halfway in dB (−15), not halfway in amplitude.
    expect(dbOf(evaluate(expression, (48_000 + 1920) / 48_000))).toBeCloseTo(-15, 9);
    for (let t = 0; t < 7; t += 0.0123) expect(evaluate(expression, t)).toBeCloseTo(gainAt(points, t), 9);
  });

  it('holds the first gain before the first point and the last after the last', () => {
    const points: GainPoint[] = [
      { sample: 24_000, db: -12 },
      { sample: 48_000, db: -3 },
    ];
    const expression = gainExpression(points)!;
    expect(dbOf(evaluate(expression, 0))).toBeCloseTo(-12, 9);
    expect(dbOf(evaluate(expression, 30))).toBeCloseTo(-3, 9);
  });

  it('never boosts, and reads points in any order', () => {
    const expression = gainExpression([
      { sample: 48_000, db: 6 },
      { sample: 0, db: -6 },
    ])!;
    expect(dbOf(evaluate(expression, 0))).toBeCloseTo(-6, 9);
    expect(dbOf(evaluate(expression, 2))).toBeCloseTo(0, 9);
  });

  it('nests as a balanced tree: depth grows as log n, not n', () => {
    const points = ducks(100);
    const expression = gainExpression(points)!;
    expect(depth(expression)).toBeLessThanOrEqual(Math.ceil(Math.log2(points.length + 1)));
    // One exponential per leaf, no other functions: FFmpeg evaluates it once per 128-sample frame.
    expect(expression).not.toMatch(/pow|log|sqrt|between/);
  });
});

describe('busedFilterGraph', () => {
  const segment = (id: string, kind: MixSegment['kind'], path: string): MixSegment => ({
    id,
    kind,
    path,
    inSample: 0,
    startSample: 0,
    samples: 96_000,
    gainDb: 0,
    fadeInSamples: 0,
    fadeOutSamples: 0,
    tempo: 1,
  });
  const mix: AudioMixPlan = {
    sampleRate: 48_000,
    totalSamples: 96_000,
    segments: [
      segment('voice', 'clip', 'voice.wav'),
      segment('music', 'music', 'music.wav'),
      segment('sfx', 'clip', 'sfx.wav'),
    ],
    silent: false,
    music: 'platformSound',
    referenceAudio: false,
  };
  const busOf = (s: MixSegment) => (s.kind === 'music' ? 'music' : s.id === 'sfx' ? 'effects' : 'voice');

  it('sums each bus, puts one envelope on the music and effects buses, and sums the buses', () => {
    const graph = busedFilterGraph(mix, busOf, { music: 'exp(-1)', effects: 'exp(-2)' });
    expect(graph.match(/volume='exp\(-1\)':eval=frame/g)).toHaveLength(1);
    expect(graph.match(/volume='exp\(-2\)':eval=frame/g)).toHaveLength(1);
    expect(graph).toContain('asetnsamples=n=128:p=0');
    expect(graph).toMatch(/\[bvoice\]\[bmusic\]\[beffects\]amix=inputs=3:normalize=0/);
    expect(graph.endsWith('apad=whole_len=96000,atrim=end_sample=96000[mix]')).toBe(true);
  });

  it('without envelopes still ends in [mix] with the same segment chains as the flat graph', () => {
    const graph = busedFilterGraph(mix, busOf, {});
    expect(graph).not.toContain('volume=');
    const chains = (text: string) => text.split(';').filter((part) => part.startsWith('[0:a:0]'));
    expect(chains(graph)).toEqual(chains(mixFilterGraph(mix)));
  });
});
