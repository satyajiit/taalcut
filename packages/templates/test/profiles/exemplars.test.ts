// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Exemplars: medoids over slot centroids, ⌈n / 4⌉ of them (1–3), ties to the smaller id, every run the same. */
import type { TemplateId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { centroid, exemplarCount, medoids, type SlotVectorSet } from '../../src/profiles/exemplars';
import { syntheticId } from '../../src/profiles/synthetic-set';

const id = (n: number) => syntheticId<TemplateId>(1, n);
const set = (n: number, ...vectors: [number, number][]): SlotVectorSet => ({
  templateId: id(n),
  vectors: vectors.map(([x, y]) => new Float32Array([x, y])),
});
const angle = (degrees: number): [number, number] => [
  Math.cos((degrees * Math.PI) / 180),
  Math.sin((degrees * Math.PI) / 180),
];

describe('exemplars', () => {
  it('averages unit slot vectors into a unit centroid', () => {
    const centre = centroid([new Float32Array([2, 0]), new Float32Array([0, 3])]);
    expect(centre?.[0]).toBeCloseTo(Math.SQRT1_2);
    expect(centre?.[1]).toBeCloseTo(Math.SQRT1_2);
    expect(centroid([])).toBeNull();
    expect(centroid([new Float32Array([0, 0])])).toBeNull();
  });

  it('takes one exemplar per four members, between one and three', () => {
    expect([0, 1, 4, 5, 8, 9, 40].map(exemplarCount)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it('picks the most central member first, then the one that covers the rest best', () => {
    // Two clusters: 0°, 5°, 10° and 82°, 85°, 90°. The whole set's medoid is 10° (nearest the middle); the
    // second exemplar is the far cluster's centre, 85°, which leaves its members 3° and 5° away.
    const sets = [
      set(1, angle(0)),
      set(2, angle(5)),
      set(3, angle(10)),
      set(4, angle(82)),
      set(5, angle(85)),
      set(6, angle(90)),
    ];
    const chosen = medoids(sets);
    expect(chosen).toEqual({ ids: [id(3), id(5)], pool: 6 });
    expect(medoids([...sets].reverse())).toEqual(chosen);
  });

  it('breaks ties by the smaller id and leaves out members without vectors', () => {
    expect(medoids([set(2, [1, 0]), set(1, [0, 1])]).ids).toEqual([id(1)]);
    expect(medoids([set(3), set(2, [1, 0])])).toEqual({ ids: [id(2)], pool: 1 });
    expect(medoids([])).toEqual({ ids: [], pool: 0 });
  });
});
