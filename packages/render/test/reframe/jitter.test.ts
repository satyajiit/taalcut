// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { RationalTime, type ClipReframe } from '@taalcut/core';
import { REFRAME_CONFIG } from '../../src/reframe/config';
import { cropAt } from '../../src/reframe/crop-window';
import { planVisualFraming, type FramingInput } from '../../src/reframe/framing';
import { measureJitter } from '../../src/reframe/jitter';
import { RATE_30, noise, samplesEvery, trackOf } from './support';

const frames = 180;
const auto: ClipReframe = { mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 };
const input = (track: FramingInput['track']): FramingInput => ({
  visual: {
    kind: 'video',
    reframe: auto,
    visible: { start: 0, end: frames },
    cut: { start: 0, end: frames },
    sourceIn: RationalTime.zero(RATE_30),
    speed: null,
  },
  source: { width: 1920, height: 1080 },
  canvas: { width: 1080, height: 1920 },
  safe: { x: 120, y: 288, width: 540, height: 672 },
  captionBandTop: null,
  track,
  rate: RATE_30,
  canvasChanged: false,
});

/** The crop centre's x at every output frame, in canvas pixels, and the raw points in the same units. */
function centrePath(framing: ReturnType<typeof planVisualFraming>) {
  if (framing.kind !== 'crop') throw new Error(`expected a crop, got ${framing.kind}`);
  const width = framing.keys[0]?.rect.width ?? 1;
  const px = 1080 / width;
  const path = Array.from({ length: frames + 1 }, (_, frame) => {
    const rect = cropAt(framing.keys, frame);
    return (rect.x + rect.width / 2) * px;
  });
  const raw = framing.keys.map((key, index) => ({
    frame: key.frame,
    value: framing.raw[index] ? (framing.raw[index]?.x ?? 0) * px : null,
  }));
  return { path, raw, deadzone: REFRAME_CONFIG.deadzoneFraction * px, px };
}

describe('crop path jitter', () => {
  it('a still subject with ±3 px detection noise: no hold violations, no wobbles', () => {
    const jitter = noise(3, 3 / 1920);
    const still = () => ({
      face: { x: 0.62 + jitter(), y: 0.3 + jitter(), width: 0.08, height: 0.14 },
      human: { x: 0.6 + jitter(), y: 0.25 + jitter(), width: 0.14, height: 0.7 },
    });
    const { path, raw, deadzone } = centrePath(
      planVisualFraming(input(trackOf(samplesEvery(12, 7, still), 7))),
    );
    const report = measureJitter({ path, raw, deadzone, fps: 30 });
    expect(report.holdViolations).toEqual([]);
    expect(report.wobbles).toEqual([]);
    expect(new Set(path).size).toBe(1);
  });

  it('a walking subject: a smooth pan under the speed cap, no wobbles', () => {
    const jitter = noise(5, 3 / 1920);
    const walk = (t: number) => ({
      face: { x: 0.15 + 0.1 * t + jitter(), y: 0.3 + jitter(), width: 0.08, height: 0.14 },
      human: { x: 0.13 + 0.1 * t + jitter(), y: 0.25, width: 0.14, height: 0.7 },
    });
    const framing = planVisualFraming(input(trackOf(samplesEvery(12, 7, walk), 7)));
    const { path, raw, deadzone, px } = centrePath(framing);
    const vmax = (REFRAME_CONFIG.maxSpeedCropsPerSecond * 1080) / 30;
    for (let frame = 1; frame < path.length; frame++)
      expect(Math.abs((path[frame] ?? 0) - (path[frame - 1] ?? 0))).toBeLessThanOrEqual(vmax + 1e-6);
    expect(measureJitter({ path, raw, deadzone, fps: 30 }).wobbles).toEqual([]);
    // It really pans: the centre crosses a good part of the frame.
    expect(((path[frames] ?? 0) - (path[0] ?? 0)) / px).toBeGreaterThan(0.4);
  });

  it('catches a planted wobble', () => {
    const path = Array.from(
      { length: 90 },
      (_, frame) => 500 + (frame >= 30 && frame < 60 ? 3 * Math.sign(Math.sin(frame / 2)) : 0),
    );
    const report = measureJitter({ path, raw: [], deadzone: 9.6, fps: 30 });
    expect(report.wobbles.length).toBeGreaterThan(0);
  });

  it('catches a step while the raw point holds still', () => {
    const path = Array.from({ length: 60 }, (_, frame) => (frame < 30 ? 500 : 502));
    const raw = Array.from({ length: 20 }, (_, index) => ({ frame: index * 3, value: 500 + (index % 2) }));
    const report = measureJitter({ path, raw, deadzone: 9.6, fps: 30 });
    expect(report.holdViolations).toEqual([{ frame: 29, step: 2 }]);
  });

  it('ignores steps outside a hold and short holds', () => {
    const path = Array.from({ length: 60 }, (_, frame) => 500 + frame * 2);
    const raw = Array.from({ length: 20 }, (_, index) => ({ frame: index * 3, value: 500 + index * 6 }));
    expect(measureJitter({ path, raw, deadzone: 9.6, fps: 30 }).holdViolations).toEqual([]);
  });
});
