// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.listen.query`'s operations (EAR1-F7): model questions about one or more sources, for the agent's tools (lane
 * A3's `audio.listen` and `audio.compare`, lane B's searches). Built in: `describe` (calibrated tags, hints and
 * AudioSet labels per source), `match` (how well each source fits some descriptions), `rank` (sources by one
 * description) and `compare` (the first source against the rest as references). A lane adds its own with
 * `defineListenQuery` and LISTEN_EXTENSIONS.queries. Every source is decoded as an analysis decodes it (source.ts),
 * when the operation reaches it (EAR1-R1: `listenSourceList`), and none is kept.
 */
import { err, ok, timeRangeSchema, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { z } from 'zod';
import { compareSound, type SoundComparison } from '../describe/compare';
import { sourceAt, sourcesFrom, type ListenSourceList } from '../describe/context';
import { describeSound, type SoundDescription } from '../describe/describe';
import { matchSound, type SoundMatch } from '../describe/match';
import { rankSounds, type SoundRanking } from '../describe/rank';
import { ListenBadInput } from '../errors';
import { defineListenQuery, type ListenQueryOp } from './extensions';
import { decodeListenSource } from './source';

/** A sound to ask about: a file the jobs process can read, and optionally a part of it. */
export const listenSourceRefSchema = z.object({
  path: z.string().min(1).max(4096),
  range: timeRangeSchema.optional(),
  /** For results: a file name or an asset's label. Plain text. */
  name: z.string().min(1).max(200).optional(),
});
export type ListenSourceRef = z.output<typeof listenSourceRefSchema>;

const text = z.string().trim().min(1).max(300);

export const describeQuery = defineListenQuery<{ readonly top?: number }, SoundDescription[]>({
  op: 'describe',
  params: z.object({ top: z.int().min(1).max(20).optional() }),
  async run({ models, sources, signal }, params) {
    const out: SoundDescription[] = [];
    for (let i = 0; i < sources.length; i++) {
      const source = await sourceAt(sources, i, signal);
      if (!source.ok) return source;
      const described = await describeSound(models, source.value, {
        ...(params.top !== undefined ? { top: params.top } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!described.ok) return described;
      out.push(described.value);
    }
    return ok(out);
  },
});

export const matchQuery = defineListenQuery<
  { readonly queries: readonly string[]; readonly alts?: readonly string[] },
  SoundMatch[]
>({
  op: 'match',
  params: z.object({ queries: z.array(text).min(1).max(20), alts: z.array(text).max(20).optional() }),
  async run({ models, sources, signal }, params) {
    const out: SoundMatch[] = [];
    for (let i = 0; i < sources.length; i++) {
      const source = await sourceAt(sources, i, signal);
      if (!source.ok) return source;
      const matched = await matchSound(models, source.value, params.queries, {
        ...(params.alts ? { alts: params.alts } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!matched.ok) return matched;
      out.push(matched.value);
    }
    return ok(out);
  },
});

export const rankQuery = defineListenQuery<{ readonly query: string; readonly top?: number }, SoundRanking>({
  op: 'rank',
  params: z.object({ query: text, top: z.int().min(1).max(50).optional() }),
  sources: { min: 1, max: 50 },
  run: ({ models, sources, signal }, params) =>
    rankSounds(models, sources, params.query, {
      ...(params.top !== undefined ? { top: params.top } : {}),
      ...(signal ? { signal } : {}),
    }),
});

/** The first source against the others (at least 2 references). */
export const compareQuery = defineListenQuery<{ readonly k?: number }, SoundComparison>({
  op: 'compare',
  params: z.object({ k: z.int().min(1).max(20).optional() }),
  sources: { min: 3, max: 51 },
  async run({ models, sources, signal }, params) {
    const first = await sourceAt(sources, 0, signal);
    if (!first.ok) return first;
    return compareSound(models, first.value, sourcesFrom(sources, 1), {
      ...(params.k !== undefined ? { k: params.k } : {}),
      ...(signal ? { signal } : {}),
    });
  },
});

export const BUILT_IN_LISTEN_QUERIES: readonly ListenQueryOp[] = [
  describeQuery,
  matchQuery,
  rankQuery,
  compareQuery,
] as readonly ListenQueryOp[];

/** The op's parameters and source count, checked before anything is decoded. */
export function checkQuery<P>(op: ListenQueryOp<P>, sources: number, params: unknown): AsyncResult<P> {
  const min = op.sources?.min ?? 1;
  const max = op.sources?.max ?? 20;
  if (sources < min || sources > max)
    return Promise.resolve(
      err(ListenBadInput(undefined, { detail: `${op.op} takes ${min} to ${max} sources, not ${sources}` })),
    );
  const parsed = op.params.safeParse(params);
  if (!parsed.success)
    return Promise.resolve(
      err(ListenBadInput(undefined, { detail: z.prettifyError(parsed.error).slice(0, 500) })),
    );
  return Promise.resolve(ok(parsed.data));
}

/**
 * The sources decoded for the models (48 kHz, ffmpeg `-ac 1`'s level), each when the operation reads it, its name
 * kept: one source's PCM at a time, not all of them up front.
 */
export function listenSourceList(refs: readonly ListenSourceRef[], media: MediaContext): ListenSourceList {
  return {
    length: refs.length,
    async load(index, signal) {
      const ref = refs[index];
      if (!ref) return err(ListenBadInput(undefined, { detail: `no source ${index}` }));
      const decoded = await decodeListenSource(ref.path, {
        media,
        ...(ref.range ? { range: ref.range } : {}),
        ...(signal ? { signal } : {}),
      });
      if (!decoded.ok) return decoded;
      return ok({ ...decoded.value.source, ...(ref.name ? { name: ref.name } : {}) });
    },
  };
}
