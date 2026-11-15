// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the vectors of a shot's moments, kept to the asset's current shots as the description's are. A shot described
 * again keeps only its new moments (it may have fewer), one not described in the run keeps what it has, a gone shot's
 * go, and other kinds and assets are left alone.
 */
import { ok, type Embedder } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { embedMoments, momentItemId } from '../../src/jobs/moment-vectors';
import { memoryVectorIndex } from '../helpers/vector-index';

const v = (x: number) => Float32Array.from([x, 1, 0]);
const meta = (assetId: string, kind: string) => ({ assetId, sourceId: null, kind });

/** Each text's vector holds its length, so a test can tell which note a vector is of. */
function embedder(calls: string[][] = []): Embedder {
  return {
    space: { model: 'test', revision: 'r', dimensions: 3, indexName: 'test' },
    embedTexts: async (texts, options) => {
      calls.push([options.purpose, ...texts]);
      return ok(texts.map((text) => v(text.length)));
    },
  };
}

function seeded() {
  const index = memoryVectorIndex('test', 3);
  index.upsert([
    { id: 'moment:s1:0', vector: v(1), metadata: meta('a', 'moment') },
    { id: 'moment:s1:1', vector: v(2), metadata: meta('a', 'moment') },
    { id: 'moment:s1:2', vector: v(3), metadata: meta('a', 'moment') },
    { id: 'moment:s2:0', vector: v(4), metadata: meta('a', 'moment') },
    { id: 'moment:gone:0', vector: v(5), metadata: meta('a', 'moment') },
    { id: 'description:s1', vector: v(6), metadata: meta('a', 'description') },
    { id: 'moment:other:0', vector: v(7), metadata: meta('b', 'moment') },
  ]);
  return index;
}

const input = { assetId: 'a', shots: [{ shotId: 's1' }, { shotId: 's2' }] };
const signal = new AbortController().signal;

describe('embedMoments', () => {
  it('embeds each note as a document and replaces the described shot’s set', async () => {
    const index = seeded();
    const calls: string[][] = [];
    const described = [
      {
        shotId: 's1',
        description: {
          moments: [
            { start: 0, end: 60, note: 'A street.' },
            { start: 60, end: 120, note: 'A market stall.' },
          ],
        },
      },
    ];
    const done = await embedMoments(described, input, { embedder: embedder(calls), index }, signal);
    expect(done.ok).toBe(true);
    expect(calls).toEqual([['document', 'A street.', 'A market stall.']]);
    expect([...index.rows.keys()].sort()).toEqual([
      'description:s1',
      'moment:other:0',
      // s1 had three and now has two; s2 was not described and keeps its one; the gone shot's went.
      'moment:s1:0',
      'moment:s1:1',
      'moment:s2:0',
    ]);
    expect(index.rows.get(momentItemId('s1', 1))).toMatchObject({ assetId: 'a', kind: 'moment' });
    expect(index.rows.get('moment:s1:1')?.vector[0]).toBe('A market stall.'.length);
  });

  it('drops the vectors of a shot described again without moments', async () => {
    const index = seeded();
    await embedMoments([{ shotId: 's1', description: {} }], input, { embedder: embedder(), index }, signal);
    expect([...index.rows.keys()].filter((id) => id.startsWith('moment:s1'))).toEqual([]);
    expect(index.rows.has('moment:s2:0')).toBe(true);
  });

  it('only prunes when nothing was described, and does nothing without an index', async () => {
    const index = seeded();
    await embedMoments([], input, { index }, signal);
    expect([...index.rows.keys()].filter((id) => id.startsWith('moment:')).sort()).toEqual([
      'moment:other:0',
      'moment:s1:0',
      'moment:s1:1',
      'moment:s1:2',
      'moment:s2:0',
    ]);
    expect(await embedMoments([], input, {}, signal)).toEqual({ ok: true, value: undefined });
  });
});
