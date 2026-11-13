// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-C5: an asset's description vectors kept to its current shots. New ones are written, a current shot's
 * old one stays (a run that described nothing keeps them all), a gone shot's goes, and other assets and kinds
 * are left alone.
 */
import { describe, expect, it } from 'vitest';
import { keepShotVectors } from '../../src/jobs/shot-vectors';
import { memoryVectorIndex } from '../helpers/vector-index';

const v = (x: number) => Float32Array.from([x, 1, 0]);
const meta = (assetId: string, kind: string) => ({ assetId, sourceId: null, kind });

function seeded() {
  const index = memoryVectorIndex('test', 3);
  index.upsert([
    { id: 'description:kept', vector: v(1), metadata: meta('a', 'description') },
    { id: 'description:gone', vector: v(2), metadata: meta('a', 'description') },
    { id: 'frame:gone:0', vector: v(3), metadata: meta('a', 'frame') },
    { id: 'description:other', vector: v(4), metadata: meta('b', 'description') },
  ]);
  return index;
}

describe('keepShotVectors', () => {
  it('writes the new vectors, keeps the current shots’ others and drops a gone shot’s', () => {
    const index = seeded();
    const removed = keepShotVectors(index, {
      assetId: 'a',
      sourceId: null,
      kind: 'description',
      current: ['description:kept', 'description:new'],
      items: [{ id: 'description:new', vector: v(5), metadata: meta('a', 'description') }],
    });
    expect(removed).toEqual({ ok: true, value: 1 });
    expect([...index.rows.keys()].sort()).toEqual([
      'description:kept',
      'description:new',
      'description:other',
      'frame:gone:0',
    ]);
    expect(index.rows.get('description:kept')?.kind).toBe('description');
  });

  it('prunes without writing when nothing was described', () => {
    const index = seeded();
    keepShotVectors(index, {
      assetId: 'a',
      sourceId: null,
      kind: 'description',
      current: ['description:kept'],
      items: [],
    });
    expect(index.rows.has('description:kept')).toBe(true);
    expect(index.rows.has('description:gone')).toBe(false);
  });
});
