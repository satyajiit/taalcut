// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Title sets' CLAP text embeddings (EAR1-G2): the SFX bank's 246 titles that `sfx.searchSounds` matches names
 * against (sound-index.ts) cost the text model 246 × 5 templates, about 4 s, which every app start paid again on its
 * first search. They are kept in memory for the process and in media's derived cache beside the analyses (D21: the
 * `listen/` folder, F7's), so only a machine's first search makes them. A set is made with the text build the
 * queries run on (free text: the installed text model's dtype, D23), through `ListenText.queries`, so a title and a
 * query are embedded alike.
 *
 * Key: `listen/<hh>/<sha256 of set@version>.titles.<digest>.v1.json`; the digest covers LISTEN_CONFIG.version, the
 * text build (its component id, which names the dtype, and its install folder, which names the version and the
 * archive), the dtype, the templates and the titles, so a new bank, text build, dtype or config is a new key. An
 * entry that is missing, doesn't parse, or doesn't match what was asked is a miss: made again and written over.
 * Reading or writing the cache never fails a search. A make several searches wait on runs under its own signal
 * (abort.ts `shareWork`), stopped only when all of them have left: one caller's abort doesn't fail the others.
 */
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { ok, type AsyncResult } from '@taalcut/core';
import { z } from 'zod';
import type { DerivedJson } from '../../cleanup/speech-files';
import { shareWork, type SharedWork } from '../abort';
import { LISTEN_CACHE_DIR } from '../analysis/cache';
import type { ListenText } from '../calibrate/text';
import { vocabTerms } from '../calibrate/vocab';
import { LISTEN_CONFIG } from '../config';
import type { ResolvedListenModel } from '../models/files';

const DIM = LISTEN_CONFIG.clap.embedDim;
const HEX64 = /^[0-9a-f]{64}$/;
/** The entry's layout version (the key's `.v<recipe>`). */
export const TITLE_CACHE_RECIPE = 1;
/** The installed SFX bank's titles (its catalogue's `packVersion` is the set's version). */
export const SFX_BANK_TITLE_SET = 'sfx-bank';

/** Names embedded together: what they belong to, its version, and the titles in order. */
export interface TitleSet {
  readonly set: string;
  readonly version: string;
  readonly titles: readonly string[];
}

/** The text build a set is embedded with: `ResolvedListenModel`'s id, folder and dtype. */
export type TitleTextBuild = Pick<ResolvedListenModel, 'componentId' | 'dir' | 'dtype'>;

export interface TitleEmbeddings {
  /** One unit embedding per title, in order: from memory, else the derived cache, else the text model (then kept). */
  embed(set: TitleSet, signal?: AbortSignal): AsyncResult<Float32Array[]>;
}

export interface TitleEmbeddingsDeps {
  /** Embeds the titles as free-text queries are (the vocabulary's templates, the text build's dtype). */
  readonly text: Pick<ListenText, 'queries'>;
  /** The text build the queries run on: resolving it opens no session. */
  readonly textModel: (signal?: AbortSignal) => AsyncResult<TitleTextBuild>;
  /** Media's derived JSON; absent: kept in memory only. */
  readonly json?: DerivedJson;
  readonly log?: (line: string) => void;
}

const entrySchema = z.object({
  set: z.string(),
  version: z.string(),
  textBuild: z.string(),
  dtype: z.enum(['int8', 'fp16']),
  config: z.string(),
  templates: z.string().regex(HEX64),
  titles: z.string().regex(HEX64),
  count: z.int().min(0),
  /** base64 of count × 512 little-endian float32, row-major. */
  rows: z.string(),
});
type TitleEntry = z.output<typeof entrySchema>;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** What the text build is: its id (with the dtype) and the folder it is installed in (version and archive). */
const textBuildOf = (build: TitleTextBuild): string => `${build.componentId}/${basename(build.dir)}`;

function describeEntry(set: TitleSet, build: TitleTextBuild): Omit<TitleEntry, 'rows'> {
  return {
    set: set.set,
    version: set.version,
    textBuild: textBuildOf(build),
    dtype: build.dtype,
    config: LISTEN_CONFIG.version,
    templates: sha256(JSON.stringify(vocabTerms().templates)),
    titles: sha256(JSON.stringify(set.titles)),
    count: set.titles.length,
  };
}

/** `listen/<hh>/<hash>.titles.<digest>.v1.json`, a DERIVED_KEY_PATTERN key. */
export function titleCacheKey(set: TitleSet, build: TitleTextBuild): string {
  const hash = sha256(`${set.set}@${set.version}`);
  const { set: _set, version: _version, ...rest } = describeEntry(set, build);
  const digest = sha256(JSON.stringify(rest)).slice(0, 32);
  return `${LISTEN_CACHE_DIR}/${hash.slice(0, 2)}/${hash}.titles.${digest}.v${TITLE_CACHE_RECIPE}.json`;
}

function encodeRows(rows: readonly Float32Array[]): string {
  const bytes = Buffer.alloc(rows.length * DIM * 4);
  rows.forEach((row, r) => {
    for (let i = 0; i < DIM; i++) bytes.writeFloatLE(row[i] ?? 0, (r * DIM + i) * 4);
  });
  return bytes.toString('base64');
}

/** The rows when the entry is exactly the one asked for and every value is finite; undefined otherwise. */
function decodeEntry(json: unknown, expected: Omit<TitleEntry, 'rows'>): Float32Array[] | undefined {
  const parsed = entrySchema.safeParse(json);
  if (!parsed.success) return undefined;
  const { rows, ...described } = parsed.data;
  const keys = Object.keys(expected) as (keyof typeof expected)[];
  if (keys.some((k) => described[k] !== expected[k])) return undefined;
  const bytes = Buffer.from(rows, 'base64');
  if (bytes.length !== expected.count * DIM * 4) return undefined;
  const out: Float32Array[] = [];
  for (let r = 0; r < expected.count; r++) {
    const row = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) row[i] = bytes.readFloatLE((r * DIM + i) * 4);
    if (!row.every(Number.isFinite)) return undefined;
    out.push(row);
  }
  return out;
}

export function createTitleEmbeddings(deps: TitleEmbeddingsDeps): TitleEmbeddings {
  const log = deps.log ?? (() => undefined);
  /** By key; a failed or abandoned make is let go, so the next search tries again. */
  const known = new Map<string, SharedWork<Float32Array[]>>();

  async function read(key: string, expected: Omit<TitleEntry, 'rows'>, signal?: AbortSignal) {
    if (!deps.json) return undefined;
    const got = await deps.json.read(key, signal);
    return got.ok ? decodeEntry(got.value, expected) : undefined;
  }

  async function make(set: TitleSet, build: TitleTextBuild, key: string, signal?: AbortSignal) {
    const expected = describeEntry(set, build);
    const cached = await read(key, expected, signal);
    if (cached) return ok(cached);
    if (set.titles.length === 0) return ok([]);
    const embedded = await deps.text.queries(set.titles, signal);
    if (!embedded.ok) return embedded;
    const rows = embedded.value.queries.map((q) => q.embedding);
    if (deps.json) {
      const written = await deps.json.write(key, { ...expected, rows: encodeRows(rows) }, signal);
      if (!written.ok) log(`[listen] ${set.set} titles not cached (${written.error.code}): ${key}`);
    }
    return ok(rows);
  }

  return {
    async embed(set, signal) {
      const build = await deps.textModel(signal);
      if (!build.ok) return build;
      const key = titleCacheKey(set, build.value);
      let pending = known.get(key);
      if (!pending || pending.abandoned) {
        const textBuild = build.value;
        pending = shareWork((own) => make(set, textBuild, key, own));
        known.set(key, pending);
        const mine = pending;
        void mine.result.then((made) => {
          if (!made.ok && known.get(key) === mine) known.delete(key);
        });
      }
      return pending.join(signal);
    },
  };
}
