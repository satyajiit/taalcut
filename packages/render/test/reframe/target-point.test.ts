// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { REFRAME_CONFIG } from '../../src/reframe/config';
import {
  constrainCentre,
  followSamples,
  pickBox,
  type ConstraintFrame,
} from '../../src/reframe/target-point';
import { sampleAt } from './support';

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const options = { crop: { width: 0.316, height: 1 }, nudge: { x: 0, y: 0 }, fps: 30, config: REFRAME_CONFIG };

describe('followSamples', () => {
  it('follows the face centre when there is a face', () => {
    const [sample] = followSamples(
      [
        {
          frame: 0,
          sample: sampleAt(0, { face: box(0.6, 0.2, 0.1, 0.1), human: box(0.55, 0.15, 0.2, 0.8) }),
        },
      ],
      options,
    );
    expect(sample?.raw?.x).toBeCloseTo(0.65, 9);
    expect(sample?.raw?.y).toBeCloseTo(0.25, 9);
    expect(sample?.reference).toEqual(box(0.6, 0.2, 0.1, 0.1));
    expect(sample?.body).toEqual(box(0.55, 0.15, 0.2, 0.8));
  });

  it('follows a human box at its centre a quarter down from the top', () => {
    const [sample] = followSamples(
      [{ frame: 0, sample: sampleAt(0, { human: box(0.2, 0.1, 0.2, 0.8) }) }],
      options,
    );
    expect(sample?.raw?.x).toBeCloseTo(0.3, 9);
    expect(sample?.raw?.y).toBeCloseTo(0.3, 9);
  });

  it("keeps the point's offset inside the tracked box between detections", () => {
    const followed = followSamples(
      [
        {
          frame: 0,
          sample: sampleAt(0, { face: box(0.4, 0.2, 0.1, 0.1), tracked: box(0.35, 0.15, 0.2, 0.8) }),
        },
        { frame: 3, sample: sampleAt(0.1, { source: 'track', tracked: box(0.45, 0.15, 0.2, 0.8) }) },
      ],
      options,
    );
    // The face centre sat 0.1 right of the tracked box's left edge; the box moved 0.1 right.
    expect(followed[1]?.raw?.x).toBeCloseTo(0.55, 9);
    expect(followed[1]?.reference?.x).toBeCloseTo(0.5, 9);
  });

  it('holds the last point for a short miss, then eases to the centre after a second without a box', () => {
    const followed = followSamples(
      [
        { frame: 0, sample: sampleAt(0, { face: box(0.7, 0.2, 0.1, 0.1) }) },
        { frame: 15, sample: sampleAt(0.5) },
        { frame: 31, sample: sampleAt(1.03) },
      ],
      options,
    );
    expect(followed[1]?.raw?.x).toBeCloseTo(0.75, 9);
    expect(followed[1]?.reference).toBeNull();
    expect(followed[2]?.raw).toBeNull();
  });

  it('adds the nudge as a share of the crop', () => {
    const [sample] = followSamples([{ frame: 0, sample: sampleAt(0, { face: box(0.45, 0.45, 0.1, 0.1) }) }], {
      ...options,
      nudge: { x: 0.5, y: -0.1 },
    });
    expect(sample?.raw?.x).toBeCloseTo(0.5 + 0.158, 9);
    expect(sample?.raw?.y).toBeCloseTo(0.4, 9);
  });

  it('ignores trackers below their confidence floor', () => {
    const followed = followSamples(
      [
        { frame: 0, sample: sampleAt(0, { face: box(0.4, 0.2, 0.1, 0.1) }) },
        {
          frame: 3,
          sample: sampleAt(0.1, { source: 'track', tracked: box(0.9, 0.1, 0.1, 0.1), confidence: 0.2 }),
        },
      ],
      options,
    );
    expect(followed[1]?.raw?.x).toBeCloseTo(0.45, 9);
    expect(followed[1]?.reference).toBeNull();
  });
});

describe('pickBox', () => {
  const a = { box: box(0.1, 0.1, 0.1, 0.1), confidence: 0.9 };
  const b = { box: box(0.6, 0.1, 0.2, 0.2), confidence: 0.7 };
  it('prefers the box overlapping the previous subject, then confidence, then size', () => {
    expect(pickBox([a, b], box(0.65, 0.15, 0.1, 0.1))).toBe(b);
    expect(pickBox([a, b], null)).toBe(a);
    expect(pickBox([{ ...a, confidence: 0.7 }, b], null)).toBe(b);
    expect(pickBox([], null)).toBeNull();
  });
});

describe('constrainCentre', () => {
  // 1920×1080 source, a 9:16 crop of 607.5×1080 onto 1080×1920.
  const frame: ConstraintFrame = {
    source: { width: 1920, height: 1080 },
    crop: { width: 607.5, height: 1080 },
    canvas: { width: 1080, height: 1920 },
    safe: { x: 120, y: 288, width: 540, height: 672 },
    captionBandTop: null,
  };

  it('keeps the crop inside the source', () => {
    expect(constrainCentre({ x: 10, y: 540 }, null, frame).x).toBeCloseTo(303.75, 6);
    expect(constrainCentre({ x: 1910, y: 540 }, null, frame).x).toBeCloseTo(1920 - 303.75, 6);
  });

  it('moves the crop so the face lands inside the safe rect along the axis it can move', () => {
    // k = 1080/607.5 = 1.7778 canvas px per source px; safe spans canvas x 120…660, i.e. 67.5…371.25 source px.
    const face = { x: 900, y: 300, width: 100, height: 100 };
    const centre = constrainCentre({ x: 950, y: 540 }, face, frame);
    const left = centre.x - 303.75;
    expect((face.x - left) * (1080 / 607.5)).toBeGreaterThanOrEqual(120 - 1e-6);
    expect((face.x + face.width - left) * (1080 / 607.5)).toBeLessThanOrEqual(660 + 1e-6);
  });

  it('keeps the face whole when it cannot fit the safe rect (the body clips)', () => {
    const face = { x: 700, y: 100, width: 500, height: 500 };
    expect(constrainCentre({ x: 950, y: 540 }, face, frame).x).toBe(950);
  });

  it('keeps the face above the caption band when the crop can tilt', () => {
    const tilt: ConstraintFrame = {
      source: { width: 1080, height: 1920 },
      crop: { width: 1080, height: 607.5 },
      canvas: { width: 1920, height: 1080 },
      safe: { x: 96, y: 54, width: 1728, height: 972 },
      captionBandTop: 800,
    };
    const face = { x: 400, y: 900, width: 200, height: 200 };
    const centre = constrainCentre({ x: 540, y: 1000 }, face, tilt);
    const top = centre.y - 303.75;
    expect((face.y + face.height - top) * (1920 / 1080)).toBeLessThanOrEqual(800 + 1e-6);
  });
});
