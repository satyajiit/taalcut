// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL's heads stage, its pure part: a clip's head samples land on the output frames through the clip's
 * in-point and place, and on the canvas through what the clip shows (a centre crop, bars, or its reframed crop
 * path); the keep-outs are each head grown by the solver's margin and swept to the next sample; and a frame sees
 * only the clips on screen then.
 */
import { describe, expect, it } from 'vitest';
import { RationalTime, type SubjectSample } from '@taalcut/core';
import { headMarginOf, SOLVER_CONFIG } from '@taalcut/timeline';
import { canvasHeadsOf, clipHeadSamples } from '../../src/engine/stages/heads';
import type { VisualFraming } from '../../src/reframe/framing-types';
import { plannedVisual } from '../support/planned';
import { RATE_30, sampleAt, trackOf } from '../reframe/support';

const canvas = { width: 1080, height: 1920 };
const landscape = { width: 1920, height: 1080 };
const W = 0.31640625;
const head = { x: 0.45, y: 0.2, width: 0.1, height: 0.2 };
const withHeads = (seconds: number, heads: (typeof head)[]): SubjectSample => ({
  ...sampleAt(seconds),
  heads: heads.map((box) => ({ box, confidence: 0.9 })),
});
const track = trackOf([withHeads(0, [head]), withHeads(0.5, [{ ...head, x: 0.5 }]), withHeads(1, [head])], 2);

describe('a clip’s heads on the canvas', () => {
  it('a landscape clip filling a portrait canvas: its centre window', () => {
    const visual = plannedVisual(60);
    const [first] = clipHeadSamples(visual, track, landscape, canvas, null, RATE_30);
    const left = (1 - W) / 2;
    expect(first?.frame).toBe(0);
    expect(first?.heads[0]?.x).toBeCloseTo(((0.45 - left) / W) * 1080, 6);
    expect(first?.heads[0]?.width).toBeCloseTo((0.1 / W) * 1080, 6);
    expect(first?.heads[0]?.y).toBeCloseTo(0.2 * 1920, 6);
  });

  it('a contained clip: between its bars', () => {
    const visual = plannedVisual(60, { fit: 'contain' });
    const [first] = clipHeadSamples(visual, track, landscape, canvas, null, RATE_30);
    const height = 1080 * (1080 / 1920);
    expect(first?.heads[0]?.x).toBeCloseTo(0.45 * 1080, 6);
    expect(first?.heads[0]?.y).toBeCloseTo((1920 - height) / 2 + 0.2 * height, 6);
  });

  it('a reframed clip: through its crop path at the sample’s frame', () => {
    const framing = {
      kind: 'crop',
      reason: 'subject',
      keys: [
        { frame: 0, rect: { x: 0.3, y: 0, width: W, height: 1 } },
        { frame: 60, rect: { x: 0.3, y: 0, width: W, height: 1 } },
      ],
      subject: [],
      scale: 1,
      faces: [],
      raw: [],
    } as VisualFraming;
    const [first] = clipHeadSamples(plannedVisual(60), track, landscape, canvas, framing, RATE_30);
    expect(first?.heads[0]?.x).toBeCloseTo(((0.45 - 0.3) / W) * 1080, 6);
  });

  it('samples land on the output frames from the clip’s in-point and place', () => {
    const visual = plannedVisual(30, {
      visible: { start: 90, end: 120 },
      cut: { start: 90, end: 120 },
      sourceIn: RationalTime.fromSeconds(0.5, RATE_30),
    });
    const samples = clipHeadSamples(visual, track, landscape, canvas, null, RATE_30);
    expect(samples.map((sample) => sample.frame)).toEqual([75, 90, 105]);
    expect(samples[1]?.next).toBe(105);
  });
});

describe('the render’s heads', () => {
  const visual = plannedVisual(60);
  const samples = clipHeadSamples(visual, track, landscape, canvas, null, RATE_30);
  const heads = canvasHeadsOf([{ visible: visual.visible, samples }], 2, 1);

  it('a frame sees the samples either side of it, and nothing off its clip', () => {
    expect(heads.at(5)).toHaveLength(2);
    expect(heads.at(60)).toHaveLength(0);
    expect(heads.clips).toBe(2);
    expect(heads.tracked).toBe(1);
  });

  it('a keep-out is the head grown by the solver’s margin and swept to the next sample', () => {
    const first = heads.keepOut[0]!;
    const a = samples[0]!.heads[0]!;
    const b = samples[1]!.heads[0]!;
    const margin = headMarginOf(a, SOLVER_CONFIG);
    expect(first.span).toEqual({ start: 0, end: 16 });
    expect(first.box.x).toBeCloseTo(Math.min(a.x, b.x) - margin, 6);
    expect(first.box.x + first.box.width).toBeCloseTo(Math.max(a.x + a.width, b.x + b.width) + margin, 6);
    expect(first.box.y).toBeCloseTo(a.y - margin, 6);
  });
});
