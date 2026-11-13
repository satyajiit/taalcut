// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-B2/B3 plumbing without models: embeddings travel as exact base64; the derived cache keeps each content's
 * embedding per dtype under a `listen/` key (a hit makes no job); the searcher embeds a stale dtype again and
 * searches once more; and the `searchSounds` operation ranks bank and caller entries by audio z plus name.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DERIVED_KEY_PATTERN, ok, type JobRunner } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { ListenText } from '../../src/listen/calibrate/text';
import { createVocab, vocabTerms } from '../../src/listen/calibrate/vocab';
import type { ListenModels } from '../../src/listen/describe/context';
import { searchSoundsQuery } from '../../src/listen/search/queries';
import { bankCatalogue, bankItem, fitItem, writeCatalogue } from '../sfx-bank-helpers';
import type { DerivedJson } from '../../src/cleanup/speech-files';
import { decodeEmbedding, encodeEmbedding } from '../../src/listen/search/codec';
import { createSoundEmbeddings, embeddingKey } from '../../src/listen/search/embedding-cache';
import { createSoundSearcher } from '../../src/listen/search/sound-search';

function unit(seed: number): Float32Array {
  const v = Float32Array.from({ length: 512 }, (_, i) => Math.sin(seed * 31 + i * 0.7));
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
}

function memoryJson(): DerivedJson & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    read: async (key) =>
      (store.has(key) ? ok(store.get(key)) : { ok: false, error: { code: 'core.not_found' } }) as never,
    write: async (key, json) => {
      store.set(key, json);
      return ok(undefined);
    },
  };
}

/** A jobs runner answering embedSounds (in `dtype`) and searchSounds (stale for any other dtype). */
function fakeJobs(dtype: 'int8' | 'fp16') {
  const ops: string[] = [];
  const jobs: Pick<JobRunner, 'run'> = {
    run: (async (
      _kind: unknown,
      input: { op: string; sources: Array<{ path: string }>; params: Record<string, unknown> },
    ) => {
      ops.push(input.op);
      if (input.op === 'embedSounds')
        return ok({
          op: input.op,
          result: input.sources.map((s, i) => ({
            dtype,
            embedding: encodeEmbedding(unit(s.path.length + i)),
            nearSilent: false,
            durationS: 1,
          })),
        });
      const entries = input.params.entries as Array<{ id: string; dtype: string }>;
      return ok({
        op: input.op,
        result: {
          query: input.params.query,
          category: 'everyday',
          hint: false,
          dtype,
          stale: entries.filter((e) => e.dtype !== dtype).map((e) => e.id),
          hits: entries.filter((e) => e.dtype === dtype).map((e) => ({ id: e.id })),
        },
      });
    }) as unknown as JobRunner['run'],
  };
  return { jobs, ops };
}

describe('embeddings for search', () => {
  it('round-trip exactly as base64 and refuse anything but 512 finite values', () => {
    const v = unit(3);
    expect(decodeEmbedding(encodeEmbedding(v))).toEqual(v);
    expect(decodeEmbedding(encodeEmbedding(v.subarray(0, 10)))).toBeUndefined();
    expect(decodeEmbedding(encodeEmbedding(new Float32Array(512).fill(Number.NaN)))).toBeUndefined();
  });

  it('are keyed in the listen folder by content', () => {
    expect(embeddingKey('a'.repeat(64))).toMatch(DERIVED_KEY_PATTERN);
    expect(embeddingKey('music-pack/x/x.mp3/90')).toMatch(/^listen\//);
  });

  it('are made once in the jobs process and read from the cache after', async () => {
    const cache = memoryJson();
    const { jobs, ops } = fakeJobs('fp16');
    const embeddings = createSoundEmbeddings({ jobs, cache });
    const sounds = [{ id: 'a', path: '/a.wav', content: 'a'.repeat(64), name: 'A' }];
    const first = await embeddings.entries(sounds);
    const second = await embeddings.entries(sounds);
    expect(ops).toEqual(['embedSounds']);
    expect(second).toEqual(first);
    expect(first.ok && first.value[0]).toMatchObject({ id: 'a', dtype: 'fp16', name: 'A' });
  });

  it('a search over another dtype embeds the stale sounds again and searches once more', async () => {
    const cache = memoryJson();
    const { jobs, ops } = fakeJobs('int8');
    // Cached as fp16 by another build.
    await createSoundEmbeddings({ jobs: fakeJobs('fp16').jobs, cache }).entries([
      { id: 'a', path: '/a.wav', content: 'a'.repeat(64) },
    ]);
    const searcher = createSoundSearcher({ jobs, embeddings: createSoundEmbeddings({ jobs, cache }) });
    const sounds = [{ id: 'a', path: '/a.wav', content: 'a'.repeat(64) }];
    const found = await searcher.search({ query: 'a pop', sounds });
    expect(found.ok && found.value.hits.map((h) => h.id)).toEqual(['a']);
    expect(ops).toEqual(['searchSounds', 'embedSounds', 'searchSounds']);
    // The dtype is remembered: the next search sends int8 straight away.
    await searcher.search({ query: 'a pop', sounds });
    expect(ops.slice(3)).toEqual(['searchSounds']);
  });
});

describe('the searchSounds operation', () => {
  it('ranks the bank and the entries by audio z and name, and names entries of another dtype stale', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taalcut-search-op-'));
    try {
      const items = [bankItem(), fitItem()];
      await writeCatalogue(
        dir,
        bankCatalogue(items, {
          embeddings: [
            { model: 'clap-general-audio', dtype: 'fp16', file: 'embeddings-fp16.f32', dims: 512, rows: 2 },
          ],
        }),
      );
      const rows = Buffer.alloc(2 * 512 * 4);
      [unit(1), unit(2)].forEach((v, r) => v.forEach((x, i) => rows.writeFloatLE(x, (r * 512 + i) * 4)));
      await writeFile(join(dir, 'embeddings-fp16.f32'), rows);
      const vocab = createVocab(vocabTerms().terms.map((_, i) => unit(100 + i)));
      // The query reads like sound 2 and like the name "Mine".
      const phrase = (t: string) => (t === 'a tick' ? unit(2) : t === 'Mine' ? unit(2) : unit(t.length + 50));
      const text: ListenText = {
        embed: async () => ok({ rows: [], dtype: 'fp16', fromBank: true }),
        vocab: async () => ok(vocab),
        queries: async (texts) =>
          ok({ queries: texts.map((t) => ({ text: t, embedding: phrase(t) })), vocab }),
      };
      const models = { text } as unknown as ListenModels;
      const result = await searchSoundsQuery.run(
        { models, sources: [], audioDtype: 'fp16' },
        {
          query: 'a tick',
          bankDir: dir,
          entries: [
            { id: 'asset:1', name: 'Mine', dtype: 'fp16', embedding: encodeEmbedding(unit(2)) },
            { id: 'asset:2', dtype: 'int8', embedding: encodeEmbedding(unit(3)) },
          ],
        },
      );
      if (!result.ok) throw new Error(result.error.code);
      expect(result.value.stale).toEqual(['asset:2']);
      expect(result.value.hits.map((h) => [h.id, h.source])).toEqual([
        ['asset:1', 'entry'],
        ['fit/tick_domino', 'bank'],
        ['whoosh_fast/crisp', 'bank'],
      ]);
      const top = result.value.hits[0];
      expect(top?.rankScore).toBeCloseTo((top?.z ?? 0) + (top?.nameScore ?? 0), 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
