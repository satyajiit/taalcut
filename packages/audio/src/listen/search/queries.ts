// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Lane B's `audio.listen.query` operations (EAR1-B1, B2, B3), run in the jobs process where the models stay open:
 *
 * - `findMoment`: the best moments in one long recording for a description (describe/find.ts).
 * - `embedSounds`: each source's pooled CLAP embedding (with its dtype and near silence), for a caller's cache of
 *   pack and library sounds. A source that can't be decoded is a row naming why (EAR1-R1): one bad file in a
 *   batch of 60 doesn't fail the other 59.
 * - `searchSounds`: one description over the installed SFX bank's shipped embeddings and the caller's cached ones,
 *   ranked by the audio's calibrated z and the names (search/sound-index.ts), with genre and mood hints on request.
 *   Entries embedded with another dtype than the audio model in use come back as `stale`, to embed again. The
 *   bank's titles come from the models' title store (EAR1-G2, search/title-cache.ts): made once a machine.
 * - `bankTitles` (EAR1-G2): the bank's title embeddings made and kept ahead of a search (the jobs process's warm-up).
 */
import { err, ok, SFX_CATEGORIES, SOUND_TAG_CATEGORIES, type AsyncResult } from '@taalcut/core';
import { z } from 'zod';
import type { ListenDtype } from '../config';
import type { ListenModels, ListenSources } from '../describe/context';
import type { SpectrogramRunner } from '../dsp/spectrogram-graph';
import { dbOf, isNearSilent, peakOf, sourceAt } from '../describe/context';
import { FIND_KINDS, findMoments, type FoundMoments } from '../describe/find';
import { ListenUnavailable } from '../errors';
import { loadSfxBank, type SfxBank } from '../../sfx/bank-source';
import { decodeEmbedding, encodeEmbedding } from './codec';
import {
  createSoundIndex,
  embedNames,
  searchSoundIndex,
  type IndexedSound,
  type SoundHit,
} from './sound-index';
import { SFX_BANK_TITLE_SET, type TitleSet } from './title-cache';

/**
 * analysis/extensions.ts's ListenQueryContext and ListenQueryOp, restated here so LISTEN_EXTENSIONS can import these
 * operations without an import cycle; it checks them against its own types.
 */
interface QueryContext {
  readonly models: ListenModels;
  readonly sources: ListenSources;
  readonly spectrograms?: () => Promise<SpectrogramRunner>;
  readonly audioDtype?: ListenDtype;
  readonly signal?: AbortSignal;
}

interface QueryOp<P, R> {
  readonly op: string;
  readonly params: z.ZodType<P>;
  readonly sources?: { readonly min?: number; readonly max?: number };
  run(context: QueryContext, params: P): AsyncResult<R>;
}

const defineQuery = <P, R>(op: QueryOp<P, R>): QueryOp<P, R> => op;

const text = z.string().trim().min(1).max(300);
const dtypeSchema = z.enum(['int8', 'fp16']);

export const findMomentParamsSchema = z.object({
  query: text,
  top: z.int().min(1).max(10).optional(),
  kind: z.enum(FIND_KINDS).optional(),
  win: z.number().min(0.25).max(10).optional(),
  hop: z.number().min(0.05).max(10).optional(),
  /** Seconds from the source's start. */
  start: z.number().min(0).optional(),
  end: z.number().positive().optional(),
});
export type FindMomentParams = z.output<typeof findMomentParamsSchema>;

export const findMomentQuery = defineQuery<FindMomentParams, FoundMoments>({
  op: 'findMoment',
  params: findMomentParamsSchema,
  sources: { min: 1, max: 1 },
  async run({ models, sources, spectrograms, signal }, params) {
    if (!spectrograms) return err(ListenUnavailable({ reason: 'no_spectrograms' }));
    const source = await sourceAt(sources, 0, signal);
    if (!source.ok) return source;
    const range =
      params.start !== undefined || params.end !== undefined
        ? {
            ...(params.start !== undefined ? { start: params.start } : {}),
            ...(params.end !== undefined ? { end: params.end } : {}),
          }
        : undefined;
    return findMoments(models, source.value, params.query, {
      runner: await spectrograms(),
      ...(params.top !== undefined ? { top: params.top } : {}),
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.win !== undefined ? { win: params.win } : {}),
      ...(params.hop !== undefined ? { hop: params.hop } : {}),
      ...(range ? { range } : {}),
      ...(signal ? { signal } : {}),
    });
  },
});

export interface EmbeddedSound {
  readonly dtype: ListenDtype;
  /** base64 of 512 little-endian float32 (codec.ts). */
  readonly embedding: string;
  readonly nearSilent: boolean;
  readonly durationS: number;
}

/** A source that couldn't be decoded (not cached: the next search tries it again). */
export interface UnreadSound {
  /** Why: `audio.listen_bad_input` (not audio, unreadable) or `audio.listen_failed` (the decoder failed). */
  readonly unreadable: string;
}

const UNREADABLE = new Set(['audio.listen_bad_input', 'audio.listen_failed']);

export const embedSoundsQuery = defineQuery<Record<string, never>, Array<EmbeddedSound | UnreadSound>>({
  op: 'embedSounds',
  params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  sources: { min: 1, max: 60 },
  async run({ models, sources, audioDtype, signal }) {
    const out: Array<EmbeddedSound | UnreadSound> = [];
    for (let i = 0; i < sources.length; i++) {
      const read = await sourceAt(sources, i, signal);
      if (!read.ok && UNREADABLE.has(read.error.code)) {
        out.push({ unreadable: read.error.code });
        continue;
      }
      if (!read.ok) return read;
      const source = read.value;
      const embedded = await models.clap.embedSource(source.samples, undefined, signal);
      if (!embedded.ok) return embedded;
      out.push({
        dtype: audioDtype ?? 'fp16',
        embedding: encodeEmbedding(embedded.value.pooled),
        nearSilent: isNearSilent(source.peakDbfs ?? dbOf(peakOf(source.samples))),
        durationS: Math.round(source.samples.length / 480) / 100,
      });
    }
    return ok(out);
  },
});

export const searchEntrySchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(200).optional(),
  dtype: dtypeSchema,
  embedding: z.string().min(1).max(4000),
  nearSilent: z.boolean().optional(),
});
export type SearchEntry = z.output<typeof searchEntrySchema>;

export const searchSoundsParamsSchema = z.object({
  query: text,
  top: z.int().min(1).max(50).optional(),
  /** The installed `sfx-bank` folder; absent: the entries only. */
  bankDir: z.string().min(1).max(4096).optional(),
  bankFamily: z.enum(SFX_CATEGORIES).optional(),
  entries: z.array(searchEntrySchema).max(2000).default([]),
  hints: z.array(z.enum(SOUND_TAG_CATEGORIES)).max(4).optional(),
});
export type SearchSoundsParams = z.input<typeof searchSoundsParamsSchema>;

export interface SearchSoundsHit extends Omit<SoundHit, 'index'> {
  readonly source: 'bank' | 'entry';
}

export interface SearchSoundsResult {
  readonly query: string;
  readonly category: SoundHit['soundsLike']['category'];
  readonly hint: boolean;
  readonly dtype: ListenDtype;
  /** Entries embedded with another dtype: embed them again. */
  readonly stale: readonly string[];
  readonly hits: readonly SearchSoundsHit[];
  /** EAR1-R1: the caller's sounds left out because they couldn't be decoded (the searcher's count; none: absent). */
  readonly unreadable?: number;
}

export const searchSoundsQuery = defineQuery<SearchSoundsParams, SearchSoundsResult>({
  op: 'searchSounds',
  params: searchSoundsParamsSchema as unknown as z.ZodType<SearchSoundsParams>,
  sources: { min: 0, max: 0 },
  async run({ models, audioDtype, signal }, raw) {
    const params = searchSoundsParamsSchema.parse(raw);
    const dtype: ListenDtype = audioDtype ?? 'fp16';
    const sounds: Array<{ entry: IndexedSound; source: 'bank' | 'entry' }> = [];
    if (params.bankDir) {
      const bank = await loadSfxBank(params.bankDir);
      if (!bank.ok) return bank;
      const rows = await bank.value.embeddings(dtype);
      if (!rows.ok) return rows;
      const keep = bank.value.items.map((item) => !params.bankFamily || item.family === params.bankFamily);
      const titles = await bankTitles(models, bank.value, keep, signal);
      if (!titles.ok) return titles;
      bank.value.items.forEach((item, i) => {
        if (!keep[i]) return;
        const embedding = rows.value.rows.subarray(i * rows.value.dims, (i + 1) * rows.value.dims);
        const name = titles.value[i];
        sounds.push({ entry: { id: item.id, embedding, ...(name ? { name } : {}) }, source: 'bank' });
      });
    }
    const stale: string[] = [];
    const named: Array<{ at: number; name: string }> = [];
    for (const entry of params.entries) {
      const embedding = entry.dtype === dtype ? decodeEmbedding(entry.embedding) : undefined;
      if (!embedding) {
        stale.push(entry.id);
        continue;
      }
      if (entry.name) named.push({ at: sounds.length, name: entry.name });
      sounds.push({
        entry: { id: entry.id, embedding, ...(entry.nearSilent ? { nearSilent: true } : {}) },
        source: 'entry',
      });
    }
    const names = await embedNames(
      models,
      named.map((n) => n.name),
      signal,
    );
    if (!names.ok) return names;
    named.forEach(({ at }, j) => {
      const sound = sounds[at];
      const name = names.value[j];
      if (sound && name) sounds[at] = { ...sound, entry: { ...sound.entry, name } };
    });
    const index = createSoundIndex(sounds.map((s) => s.entry));
    const tagVocab = params.hints?.length ? await models.text.vocab(signal) : undefined;
    if (tagVocab && !tagVocab.ok) return tagVocab;
    const found = await searchSoundIndex(models, index, params.query, {
      ...(tagVocab?.ok ? { hintVocab: tagVocab.value } : {}),
      top: params.top ?? 10,
      ...(params.hints ? { hints: params.hints } : {}),
      ...(signal ? { signal } : {}),
    });
    if (!found.ok) return found;
    return ok({
      query: found.value.query,
      category: found.value.category,
      hint: found.value.hint,
      dtype,
      stale,
      hits: found.value.hits.map(({ index, ...hit }) => ({
        ...hit,
        source: sounds[index]?.source ?? 'entry',
      })),
    });
  },
});

/**
 * EAR1-G2: the bank's titles as `sfx.searchSounds` matches names, one per item (undefined where `keep` is false):
 * the models' title store (made once a machine, kept in the derived cache), else embedded now (fakes, the evals).
 */
async function bankTitles(
  models: ListenModels,
  bank: SfxBank,
  keep: readonly boolean[],
  signal?: AbortSignal,
): AsyncResult<readonly (Float32Array | undefined)[]> {
  if (models.titles) return models.titles.embed(bankTitleSet(bank), signal);
  const embedded = await embedNames(
    models,
    bank.items.filter((_, i) => keep[i]).map((item) => item.title),
    signal,
  );
  if (!embedded.ok) return embedded;
  let next = 0;
  return ok(keep.map((kept) => (kept ? embedded.value[next++] : undefined)));
}

export const bankTitleSet = (bank: SfxBank): TitleSet => ({
  set: SFX_BANK_TITLE_SET,
  version: bank.catalogue.packVersion,
  titles: bank.items.map((item) => item.title),
});

/** The jobs process's warm-up once the bank and the text model are here (roots/audio-listen-warm.ts). */
export const BANK_TITLES_OP = 'bankTitles';

/** EAR1-G2: the installed bank's title embeddings made (or found) and kept, so the next search doesn't wait. */
export const bankTitlesQuery = defineQuery<{ bankDir: string }, { titles: number }>({
  op: BANK_TITLES_OP,
  params: z.object({ bankDir: z.string().min(1).max(4096) }),
  sources: { min: 0, max: 0 },
  async run({ models, signal }, params) {
    const bank = await loadSfxBank(params.bankDir);
    if (!bank.ok) return bank;
    const titles = await bankTitles(
      models,
      bank.value,
      bank.value.items.map(() => true),
      signal,
    );
    return titles.ok ? ok({ titles: titles.value.length }) : titles;
  },
});

/** Lane B's operations (and G2's warm-up), for LISTEN_EXTENSIONS.queries. */
export const LISTEN_SEARCH_QUERIES = [
  findMomentQuery,
  embedSoundsQuery,
  searchSoundsQuery,
  bankTitlesQuery,
] as const;
