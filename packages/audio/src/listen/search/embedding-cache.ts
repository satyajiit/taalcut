// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pooled CLAP embeddings of pack and library sounds, kept in media's derived cache (D21: apart from the library's
 * vector index) by content and model dtype, and made on demand in the jobs process (`embedSounds`). One entry per
 * content holds each dtype it was embedded with, so a machine that changes builds keeps both. Reading or writing the
 * cache never fails a search: a miss is embedded again. A sound the jobs process can't decode (EAR1-R1) is left out
 * of that search, uncached, and named to `onUnreadable`: the rest of its batch is searched as usual.
 *
 * Key: `listen/<hh>/<sha256>.embed.<config>.v1.json` (core's DERIVED_KEY_PATTERN, the listen folder F7's analyses
 * use: LISTEN_CACHE_DIR).
 */
import { createHash } from 'node:crypto';
import { ok, type AsyncResult, type JobRunner } from '@taalcut/core';
import { z } from 'zod';
import type { DerivedJson } from '../../cleanup/speech-files';
import { LISTEN_CACHE_DIR } from '../analysis/cache';
import { LISTEN_CONFIG, type ListenDtype } from '../config';
import { runListenQuery } from '../jobs';
import { embedSoundsQuery, type SearchEntry } from './queries';

const HASH = /^[0-9a-f]{64}$/;
const BATCH = 60;

const recordSchema = z.object({
  embeddings: z.object({ int8: z.string().optional(), fp16: z.string().optional() }),
  nearSilent: z.boolean(),
  durationS: z.number().nonnegative(),
});
type EmbeddingRecord = z.output<typeof recordSchema>;

export function embeddingKey(content: string): string {
  const hash = HASH.test(content) ? content : createHash('sha256').update(content).digest('hex');
  return `${LISTEN_CACHE_DIR}/${hash.slice(0, 2)}/${hash}.embed.${LISTEN_CONFIG.version}.v1.json`;
}

/** A sound to search: a file the jobs process can read, and what makes its bytes unique. */
export interface EmbeddableSound {
  readonly id: string;
  readonly path: string;
  /** The library's content hash, or a stable key for a bundled file (pack, version, item). */
  readonly content: string;
  readonly name?: string;
}

export interface SoundEmbeddings {
  /**
   * Search entries for these sounds in `dtype` (the one the jobs process last reported, else fp16): cached ones as
   * they are, the rest embedded now. `embed` embeds even cached ones of another dtype.
   */
  entries(
    sounds: readonly EmbeddableSound[],
    options?: {
      readonly dtype?: ListenDtype;
      readonly signal?: AbortSignal;
      /** A sound left out because it couldn't be decoded, and why. */
      readonly onUnreadable?: (sound: EmbeddableSound, code: string) => void;
    },
  ): AsyncResult<SearchEntry[]>;
}

export function createSoundEmbeddings(deps: {
  readonly jobs: Pick<JobRunner, 'run'>;
  readonly cache?: DerivedJson;
}): SoundEmbeddings {
  async function read(sound: EmbeddableSound, signal?: AbortSignal): Promise<EmbeddingRecord | undefined> {
    if (!deps.cache) return undefined;
    const got = await deps.cache.read(embeddingKey(sound.content), signal);
    if (!got.ok) return undefined;
    const parsed = recordSchema.safeParse(got.value);
    return parsed.success ? parsed.data : undefined;
  }

  return {
    async entries(sounds, options = {}) {
      const want: ListenDtype = options.dtype ?? 'fp16';
      const records = await Promise.all(sounds.map((s) => read(s, options.signal)));
      const missing = sounds.filter((_, i) => !records[i]?.embeddings[want]);
      for (let at = 0; at < missing.length; at += BATCH) {
        const batch = missing.slice(at, at + BATCH);
        const embedded = await runListenQuery(
          deps.jobs,
          embedSoundsQuery,
          batch.map((s) => ({ path: s.path, ...(s.name ? { name: s.name.slice(0, 200) } : {}) })),
          {},
          options.signal ? { signal: options.signal } : {},
        );
        if (!embedded.ok) return embedded;
        for (const [j, row] of embedded.value.entries()) {
          const sound = batch[j];
          if (!sound) continue;
          if ('unreadable' in row) {
            options.onUnreadable?.(sound, row.unreadable);
            continue;
          }
          const i = sounds.indexOf(sound);
          const before = records[i];
          const record: EmbeddingRecord = {
            embeddings: { ...before?.embeddings, [row.dtype]: row.embedding },
            nearSilent: row.nearSilent,
            durationS: row.durationS,
          };
          records[i] = record;
          if (deps.cache) await deps.cache.write(embeddingKey(sound.content), record, options.signal);
        }
      }
      const out: SearchEntry[] = [];
      sounds.forEach((sound, i) => {
        const record = records[i];
        if (!record) return;
        const dtype: ListenDtype = record.embeddings[want] ? want : record.embeddings.fp16 ? 'fp16' : 'int8';
        const embedding = record.embeddings[dtype];
        if (!embedding) return;
        out.push({
          id: sound.id,
          dtype,
          embedding,
          ...(sound.name ? { name: sound.name.slice(0, 200) } : {}),
          ...(record.nearSilent ? { nearSilent: true } : {}),
        });
      });
      return ok(out);
    },
  };
}
