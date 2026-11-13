// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** FRM1-MOT: the background's move between two frames, with and without a subject in the way. */
import { describe, expect, it } from 'vitest';
import { boxShift } from '../../src/motion/estimate';
import { pairMotion } from '../../src/motion/pair';
import { levels, render, world, type Camera, type Subject } from './scene';

const size = { width: 384, height: 216 };
const field = world(7);
const at = (camera: Partial<Camera>): Camera => ({ x: 0.5, y: 0.3, zoom: 1, roll: 0, ...camera });

function measure(a: Camera, b: Camera, subjects: [Subject[], Subject[]] = [[], []], boxes = false) {
  const first = render(field, a, size, subjects[0]);
  const second = render(field, b, size, subjects[1]);
  const box = subjects[0].map(({ x, y, width, height }) => ({ x, y, width, height }));
  return pairMotion(levels(first, size), levels(second, size), { seed: 1, ...(boxes ? { boxes: box } : {}) });
}

describe('pairMotion', () => {
  it('reads a still camera as no move', () => {
    const m = measure(at({}), at({}))!;
    expect(Math.abs(m.dx)).toBeLessThan(0.001);
    expect(Math.abs(m.dy)).toBeLessThan(0.001);
    expect(Math.abs(m.scale)).toBeLessThan(0.001);
    expect(m.inliers).toBeGreaterThan(0.9);
  });

  it('reads a pan right as the picture moving left, in frame widths', () => {
    const m = measure(at({}), at({ x: 0.52 }))!;
    expect(m.dx).toBeCloseTo(-0.02, 3);
    expect(Math.abs(m.dy)).toBeLessThan(0.002);
  });

  it('reads a tilt down as the picture moving up, in frame heights', () => {
    const m = measure(at({}), at({ y: 0.31 }))!;
    // 0.01 world units is 0.01 × 384 px = 3.84 px of a 216 px frame.
    expect(m.dy).toBeCloseTo(-(0.01 * 384) / 216, 3);
  });

  it('reads a push-in as the picture growing, and a roll as a turn', () => {
    const zoom = measure(at({}), at({ zoom: 1.03 }))!;
    expect(zoom.scale).toBeCloseTo(Math.log(1.03), 3);
    const roll = measure(at({}), at({ roll: 0.01 }))!;
    expect(roll.rotation).toBeCloseTo(0.01, 3);
  });

  it('a fast pan is still found, from the whole picture’s shift', () => {
    const m = measure(at({}), at({ x: 0.6 }))!;
    expect(m.dx).toBeCloseTo(-0.1, 2);
  });

  it('keeps a subject crossing a still frame out of the background, with or without its box', () => {
    const texture = world(99, 300);
    const subject = (x: number): Subject => ({ x, y: 0.3, width: 0.18, height: 0.6, texture });
    for (const boxes of [false, true]) {
      const m = measure(at({}), at({}), [[subject(0.3)], [subject(0.34)]], boxes)!;
      expect(Math.abs(m.dx)).toBeLessThan(0.002);
      expect(m.subject?.dx).toBeCloseTo(0.04, 2);
    }
  });

  it('sees a subject held still while the background pans (tracking)', () => {
    const texture = world(5, 300);
    const subject: Subject = { x: 0.42, y: 0.25, width: 0.16, height: 0.65, texture };
    const m = measure(at({}), at({ x: 0.53 }), [[subject], [subject]])!;
    expect(m.dx).toBeCloseTo(-0.03, 3);
    expect(Math.abs(m.subject!.dx)).toBeLessThan(0.003);
  });

  it('gives up on a flat frame', () => {
    const flat = new Uint8Array(size.width * size.height).fill(90);
    expect(pairMotion(levels(flat, size), levels(flat, size), { seed: 1 })).toBeNull();
  });
});

describe('boxShift', () => {
  it('follows the largest box to the nearest one in the next frame', () => {
    const big = { x: 0.3, y: 0.2, width: 0.3, height: 0.6 };
    const small = { x: 0.8, y: 0.1, width: 0.05, height: 0.1 };
    const moved = boxShift([small, big], [{ ...small }, { ...big, x: 0.32, y: 0.19 }])!;
    expect(moved.dx).toBeCloseTo(0.02, 6);
    expect(moved.dy).toBeCloseTo(-0.01, 6);
    expect(boxShift([big], [])).toBeUndefined();
    expect(boxShift(undefined, [big])).toBeUndefined();
  });
});
