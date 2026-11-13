// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { jumps, SOFT_CANDIDATE_DISTANCE } from '../../src/breakdown/soft-cuts';
import {
  classifyTransition,
  crossover,
  difference,
  isBlend,
  laplacianVariance,
  softEvidence,
} from '../../src/breakdown/transition';
import type { SampledFrame } from '../../src/media/frames';

const SIZE = 24;

/** Deterministic texture: values 30–225, so fades and blends stay inside 0–255. */
function texture(seed: number): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE);
  let state = seed * 2654435761;
  for (let i = 0; i < data.length; i++) {
    state = (state * 1103515245 + 12345) >>> 0;
    data[i] = 30 + ((state >>> 16) % 196);
  }
  return data;
}

function frame(index: number, data: Uint8Array): SampledFrame {
  return { index, width: SIZE, height: SIZE, data };
}

function mix(a: Uint8Array, b: Uint8Array, alpha: number, gain = 1): Uint8Array {
  return a.map((v, i) => Math.round(gain * ((1 - alpha) * v + alpha * (b[i] ?? 0))));
}

/** A shifted copy: the same picture moved `dx` pixels right (motion inside one shot). */
function shifted(data: Uint8Array, dx: number): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) out[y * SIZE + x] = data[y * SIZE + ((x - dx + SIZE) % SIZE)] ?? 0;
  return out;
}

/** A 1-D box blur along rows, `radius` px: what a whip pan smears the picture into. */
function blurred(data: Uint8Array, radius: number): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += data[y * SIZE + ((x + k + SIZE) % SIZE)] ?? 0;
      out[y * SIZE + x] = Math.round(sum / (2 * radius + 1));
    }
  return out;
}

const A = texture(1);
const B = texture(2);

describe('jumps', () => {
  /** Unit vectors at cumulative angles, so neighbour distances are exactly `steps`. */
  function vectors(frames: number[], steps: number[]): Map<number, Float32Array> {
    let angle = 0;
    return new Map(
      frames.map((f, i) => {
        if (i > 0) angle += Math.acos(1 - (steps[i - 1] ?? 0));
        return [f, Float32Array.of(Math.cos(angle), Math.sin(angle))];
      }),
    );
  }

  const frames = [0, 15, 30, 45, 60, 75, 90];
  const steps = [0.02, 0.2, 0.25, 0.01, 0.3, 0.05];

  it('merges adjacent jumps into one span, keeping the largest distance', () => {
    const spans = jumps(frames, vectors(frames, steps), []);
    expect(spans.map((s) => [s.from, s.to])).toEqual([
      [15, 45],
      [60, 75],
    ]);
    expect(spans[0]!.distance).toBeCloseTo(0.25, 4);
    expect(spans[1]!.distance).toBeCloseTo(0.3, 4);
  });

  it('skips a jump a hard cut explains, inside the samples or within 2 frames after', () => {
    expect(jumps(frames, vectors(frames, steps), [66]).map((s) => s.from)).toEqual([15]);
    expect(jumps(frames, vectors(frames, steps), [77]).map((s) => s.from)).toEqual([15]);
    expect(jumps(frames, vectors(frames, steps), [78]).map((s) => s.from)).toEqual([15, 60]);
  });

  it('ignores jumps under the candidate distance and missing vectors', () => {
    const small = jumps(
      frames,
      vectors(
        frames,
        steps.map(() => SOFT_CANDIDATE_DISTANCE - 0.01),
      ),
      [],
    );
    expect(small).toEqual([]);
    const sparse = vectors(frames, steps);
    sparse.delete(30);
    expect(jumps(frames, sparse, []).map((s) => [s.from, s.to])).toEqual([[60, 75]]);
  });
});

describe('transition evidence', () => {
  const dissolve = [0, 0.2, 0.4, 0.6, 0.8, 1].map((alpha, i) => frame(100 + i, mix(A, B, alpha)));

  it('recognises a dissolve as a blend and finds where it passes half', () => {
    expect(isBlend(dissolve)).toBe(true);
    expect(crossover(dissolve)).toBe(103);
    expect(classifyTransition(dissolve)).toBe('dissolve');
    expect(softEvidence(dissolve)).toEqual({ blend: true, transition: 'dissolve', frame: 103 });
  });

  it('does not call motion inside a shot a blend', () => {
    const pan = [0, 1, 2, 3, 4, 5].map((dx, i) => frame(10 + i, shifted(A, dx)));
    expect(isBlend(pan)).toBe(false);
    // A hard change with no blend in between is not one either: the inner frames sit at the ends.
    const hard = [A, A, A, B, B, B].map((d, i) => frame(i, d));
    expect(isBlend(hard)).toBe(false);
  });

  it('calls a dip to black a fade', () => {
    const black = new Uint8Array(SIZE * SIZE);
    const fade = [A, mix(A, A, 0, 0.5), black, mix(B, B, 0, 0.5), B].map((d, i) => frame(i, d));
    expect(classifyTransition(fade)).toBe('fade');
  });

  it('calls a blurred jump between still frames a whip', () => {
    const whip = [A, A, A, A, blurred(A, 6), blurred(B, 6), B, B, B, B].map((d, i) => frame(i, d));
    expect(laplacianVariance(frame(0, blurred(A, 6)))).toBeLessThan(0.5 * laplacianVariance(frame(0, A)));
    expect(classifyTransition(whip)).toBe('whip');
  });

  it('needs three frames', () => {
    expect(softEvidence(dissolve.slice(0, 2))).toBeUndefined();
    expect(difference(frame(0, A), frame(0, A))).toBe(0);
  });
});
