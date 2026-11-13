// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import type { BeatGrid } from '../../src/music/beat-grid';
import { planWarp } from '../../src/music/warp-plan';

const RATE = 48_000;
/** Beats every `beatMs` from `startMs`, a downbeat every four. */
function grid(beatMs: number, count: number, startMs = 0): BeatGrid {
  const beatsMs = Array.from({ length: count }, (_, i) => startMs + i * beatMs);
  return { beatsMs, downbeats: beatsMs.map((_, i) => i).filter((i) => i % 4 === 0) };
}

describe('planWarp', () => {
  it('gives each bar the ratio target / generated, contiguous and sample-exact', () => {
    const plan = planWarp({
      target: grid(500, 33),
      generated: grid(525, 40),
      sampleRate: RATE,
      sourceFrames: 25 * RATE,
      endMs: 16_000,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    for (const ratio of plan.value.ratios) expect(ratio).toBeCloseTo(500 / 525, 4);
    plan.value.segments.forEach((s, i) => {
      const next = plan.value.segments[i + 1];
      if (next) expect(next.sourceStart).toBe(s.sourceEnd);
    });
    const total = plan.value.segments.reduce((sum, s) => sum + s.targetLength, 0) + plan.value.leadSamples;
    expect(total).toBe(16 * RATE);
  });

  it('plays a pickup before the first paired downbeat at its own speed', () => {
    const target = grid(500, 33, 1000);
    const plan = planWarp({
      target,
      generated: grid(510, 40, 300),
      sampleRate: RATE,
      sourceFrames: 25 * RATE,
      endMs: 12_000,
    });
    expect(plan.ok && plan.value.segments[0]).toEqual({
      sourceStart: 0,
      sourceEnd: 0.3 * RATE,
      targetLength: 0.3 * RATE,
    });
    expect(plan.ok && plan.value.leadSamples).toBe(0.7 * RATE);
  });

  it('skips a leading generated downbeat when that makes the bars agree', () => {
    const generated: BeatGrid = {
      beatsMs: [0, ...grid(500, 40, 800).beatsMs],
      downbeats: [0, 1, 5, 9, 13, 17, 21],
    };
    const plan = planWarp({
      target: grid(500, 33),
      generated,
      sampleRate: RATE,
      sourceFrames: 25 * RATE,
      endMs: 10_000,
    });
    expect(plan.ok && plan.value.shift).toBe(1);
  });

  it('refuses a bar outside 0.85–1.15', () => {
    const plan = planWarp({
      target: grid(500, 33),
      generated: grid(400, 40),
      sampleRate: RATE,
      sourceFrames: 25 * RATE,
      endMs: 16_000,
    });
    expect(plan.ok ? null : plan.error.code).toBe('audio.warp_out_of_range');
  });
});
