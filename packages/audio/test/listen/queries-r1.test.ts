// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R1, `audio.listen.query`'s sources and batches:
 * - the jobs process hands an operation its sources undecoded, and each is decoded when the operation reaches it
 *   (60 long files are never held at once);
 * - a sound that can't be decoded is a row naming why: the rest of an `embedSounds` batch is embedded and cached,
 *   and `sfx.searchSounds` / `music.findLibraryTrack describe` search the others, counting it `unreadable`;
 * - an explicit `win`/`hop` for find never makes more windows than the defaults would.
 */
import { err, ok, type JobRunner } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import type { MediaContext } from '@taalcut/media';
import type { DerivedJson } from '../../src/cleanup/speech-files';
import { createListenService } from '../../src/listen/analysis/service';
import { defineListenQuery } from '../../src/listen/analysis/extensions';
import type { ListenModels, ListenSource, ListenSourceList } from '../../src/listen/describe/context';
import { ListenBadInput } from '../../src/listen/errors';
import { encodeEmbedding } from '../../src/listen/search/codec';
import { createSoundEmbeddings } from '../../src/listen/search/embedding-cache';
import { embedSoundsQuery } from '../../src/listen/search/queries';
import { createSoundSearcher } from '../../src/listen/search/sound-search';
import { windowCandidates } from '../../src/listen/search/windows';
import { LISTEN_COMPONENTS } from '../../src/listen/models/files';
import { z } from 'zod';

const sound = (seconds: number): ListenSource => ({ samples: new Float32Array(48_000 * seconds).fill(0.1) });

/** Sources decoded on demand; `bad` ones fail to decode; `events` records each decode and each embedding. */
function lazySources(count: number, bad: readonly number[] = []) {
  const events: string[] = [];
  const list: ListenSourceList = {
    length: count,
    async load(index) {
      events.push(`decode ${index}`);
      return bad.includes(index)
        ? err(ListenBadInput(undefined, { detail: `source ${index}: invalid data` }))
        : ok(sound(1));
    },
  };
  let n = 0;
  const models = {
    clap: {
      async embedSource() {
        events.push(`embed ${n++}`);
        return ok({ pooled: new Float32Array(512).fill(0.04), windows: [] });
      },
    },
  } as unknown as ListenModels;
  return { list, models, events };
}

describe('sources decoded as the operation reaches them', () => {
  it('the jobs process decodes nothing up front: the operation gets a list', async () => {
    let seen: unknown;
    const probe = defineListenQuery<Record<string, never>, number>({
      op: 'probe',
      params: z.object({}) as unknown as z.ZodType<Record<string, never>>,
      sources: { min: 1, max: 60 },
      run: async ({ sources }) => ((seen = sources), ok(sources.length)),
    });
    const files = {
      resolve: async (name: keyof typeof LISTEN_COMPONENTS) =>
        ok({
          name,
          componentId: LISTEN_COMPONENTS[name],
          dir: '/m',
          modelPath: '/m/model.onnx',
          dtype: 'int8' as const,
        }),
    };
    const service = createListenService({
      // Any FFmpeg run would throw: nothing is decoded until a source is read.
      media: async () =>
        ok({
          binaries: { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' },
        } as unknown as MediaContext),
      files,
      loadModule: async () => {
        throw new Error('no onnxruntime needed');
      },
      extensions: { queries: [probe] },
    });
    const refs = Array.from({ length: 60 }, (_, i) => ({ path: `/long/${i}.wav` }));
    expect(await service.query('probe', refs, {})).toEqual(ok(60));
    expect(seen && 'load' in (seen as object)).toBe(true);
  });

  it('embedSounds decodes, embeds and lets go of one source at a time', async () => {
    const { list, models, events } = lazySources(3);
    const embedded = await embedSoundsQuery.run({ models, sources: list }, {});
    expect(embedded.ok && embedded.value).toHaveLength(3);
    expect(events).toEqual(['decode 0', 'embed 0', 'decode 1', 'embed 1', 'decode 2', 'embed 2']);
  });
});

describe('a sound that can’t be decoded', () => {
  it('is a row naming why; the rest of the batch is embedded', async () => {
    const { list, models } = lazySources(3, [1]);
    const embedded = await embedSoundsQuery.run({ models, sources: list }, {});
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;
    expect(embedded.value[1]).toEqual({ unreadable: 'audio.listen_bad_input' });
    expect(embedded.value.filter((row) => 'embedding' in row)).toHaveLength(2);
  });

  it('is left out of the search, uncached and counted; the bank and the others are still searched', async () => {
    const store = new Map<string, unknown>();
    const cache: DerivedJson = {
      read: async (key) =>
        (store.has(key) ? ok(store.get(key)) : { ok: false, error: { code: 'core.not_found' } }) as never,
      write: async (key, json) => (store.set(key, json), ok(undefined)),
    };
    const searched: string[][] = [];
    const jobs: Pick<JobRunner, 'run'> = {
      run: (async (
        _kind: unknown,
        input: { op: string; sources: { path: string }[]; params: { entries: { id: string }[] } },
      ) => {
        if (input.op === 'embedSounds') {
          const result = input.sources.map((s) =>
            s.path.includes('corrupt')
              ? { unreadable: 'audio.listen_bad_input' }
              : {
                  dtype: 'fp16',
                  embedding: encodeEmbedding(new Float32Array(512).fill(0.04)),
                  nearSilent: false,
                  durationS: 1,
                },
          );
          return ok({ op: input.op, result });
        }
        const ids = (input.params.entries as { id: string }[]).map((e) => e.id);
        searched.push(ids);
        const hits = [{ id: 'bank/whoosh' }, ...ids.map((id) => ({ id }))];
        return ok({
          op: input.op,
          result: { query: 'x', category: 'everyday', hint: false, dtype: 'fp16', stale: [], hits },
        });
      }) as unknown as JobRunner['run'],
    };
    const searcher = createSoundSearcher({ jobs, embeddings: createSoundEmbeddings({ jobs, cache }) });
    const sounds = [
      { id: 'asset:1', path: '/lib/ok-1.wav', content: 'a'.repeat(64) },
      { id: 'asset:2', path: '/lib/corrupt.m4a', content: 'b'.repeat(64) },
      { id: 'asset:3', path: '/lib/ok-3.wav', content: 'c'.repeat(64) },
    ];
    const found = await searcher.search({ query: 'a soft pop', sounds, bankDir: '/bank' });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.unreadable).toBe(1);
    expect(found.value.hits.map((hit) => hit.id)).toEqual(['bank/whoosh', 'asset:1', 'asset:3']);
    expect(searched).toEqual([['asset:1', 'asset:3']]);
    // The two that decoded are cached; the unreadable one is tried again next time.
    expect(store.size).toBe(2);
  });
});

describe('find’s window grid with an explicit window or hop', () => {
  it('never makes more windows than the defaults would for the span', () => {
    const defaults = windowCandidates(600).length;
    const tiny = windowCandidates(600, 0.25, 0.05);
    expect(tiny.length).toBe(Math.max(40, defaults));
    expect(tiny[0]).toMatchObject({ start: 0, end: 0.25 });
    expect(tiny.at(-1)?.end).toBeCloseTo(600, 6);
    expect(windowCandidates(600, 0.25).length).toBe(Math.max(40, defaults));
    // Within the budget an explicit choice is kept as asked.
    expect(windowCandidates(60, 4, 2).length).toBe(29);
  });
});
