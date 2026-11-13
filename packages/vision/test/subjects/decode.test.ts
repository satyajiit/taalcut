// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: decoding the two graphs' outputs by hand-made tensors. RTMO: mmdeploy's end-to-end `dets` and
 * `keypoints`, people over the threshold. YOLOX: grids for strides 8, 16 and 32 in turn; a person is objectness ×
 * class 0.
 */
import { describe, expect, it } from 'vitest';
import { COCO_KEYPOINTS, decodeRtmo } from '../../src/subjects/rtmo';
import { decodeYolox, yoloxAnchors } from '../../src/subjects/yolox';

describe('RTMO', () => {
  const outputs = (people: { box: number[]; keypoints: number[][] }[]) => ({
    dets: { data: Float32Array.from(people.flatMap((p) => p.box)), dims: [1, people.length, 5] },
    keypoints: {
      data: Float32Array.from(people.flatMap((p) => p.keypoints.flat())),
      dims: [1, people.length, 17, 3],
    },
  });
  const points = (score: number) => Array.from({ length: 17 }, (_, k) => [10 + k, 20 + k, score]);

  it('reads each person’s box, score and 17 keypoints, and keeps those over the threshold', () => {
    const found = decodeRtmo(
      outputs([
        { box: [100, 20, 300, 340, 0.9], keypoints: points(0.8) },
        { box: [400, 20, 500, 200, 0.1], keypoints: points(0.5) },
      ]),
      { scoreThreshold: 0.3 },
    );
    if (typeof found === 'string') throw new Error(found);
    expect(found).toHaveLength(1);
    expect(found[0]!.box).toEqual({ x: 100, y: 20, width: 200, height: 320 });
    expect(found[0]!.score).toBeCloseTo(0.9);
    expect(found[0]!.keypoints).toHaveLength(COCO_KEYPOINTS.length);
    expect(found[0]!.keypoints[3]).toEqual({ x: 13, y: 23, score: expect.closeTo(0.8, 5) });
  });

  it('drops an empty box, and says when the outputs do not fit each other', () => {
    expect(
      decodeRtmo(outputs([{ box: [5, 5, 5, 9, 0.9], keypoints: points(1) }]), { scoreThreshold: 0 }),
    ).toEqual([]);
    expect(decodeRtmo({ dets: { data: new Float32Array(5), dims: [1, 1, 5] } }, { scoreThreshold: 0 })).toBe(
      'no dets or keypoints',
    );
    const short = { ...outputs([{ box: [0, 0, 1, 1, 1], keypoints: points(1) }]) };
    expect(
      decodeRtmo(
        { ...short, keypoints: { data: new Float32Array(3), dims: [1, 1, 1, 3] } },
        { scoreThreshold: 0 },
      ),
    ).toContain('keypoints holds 3 values');
  });
});

describe('YOLOX', () => {
  it('counts the anchors of each square input', () => {
    expect(yoloxAnchors(32)).toBe(16 + 4 + 1);
    expect(yoloxAnchors(416)).toBe(3549);
  });

  it('decodes people on their grid and ignores other classes', () => {
    const row = 85;
    const data = new Float32Array(21 * row);
    // Anchor 17: stride 16, cell (1, 0). A person at 0.9 × 0.8.
    data.set([0.5, 0.5, 0, Math.log(2), 0.9, 0.8], 17 * row);
    // Anchor 3: a confident chair (class 56), not a person.
    data.set([0, 0, 0, 0, 0.99], 3 * row);
    data[3 * row + 5 + 56] = 0.99;
    const decoded = decodeYolox({ data, dims: [1, 21, row] }, { size: 32, scoreThreshold: 0.5 });
    if (typeof decoded === 'string') throw new Error(decoded);
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.score).toBeCloseTo(0.72);
    const { x, y, width, height } = decoded[0]!.box;
    expect([x, y, width, height].map((value) => Math.round(value * 1e4) / 1e4)).toEqual([16, -8, 16, 32]);
  });

  it('says when the output does not fit the input', () => {
    expect(
      decodeYolox({ data: new Float32Array(85), dims: [1, 1, 85] }, { size: 32, scoreThreshold: 0.5 }),
    ).toBe('1 anchors, expected 21');
  });
});
