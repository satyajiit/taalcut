// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Analyses kept in media's derived cache (EAR1-F7, D21: CLAP and AST results live in the derived cache, apart from
 * the library's vector index), through the same `DerivedJson` port the speech cleanup analysis uses (the desktop's
 * `cacheJson` over media's DerivedCache). A key is the content hash plus a digest of the models (checkpoint and
 * dtype), LISTEN_CONFIG.version and every option, so a new model, config or question writes a new entry and a stale
 * one is never found. Reading or writing the cache never fails an analysis.
 *
 * Entries sit in core's `soundListen` derived kind's folder (`listen/`, EAR1-K1) as
 * `listen/<hh>/<hash>.listen.<digest>.v1.json`.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import type { DerivedJson } from '../../cleanup/speech-files';
import { LISTEN_CONFIG } from '../config';
import type { ListenAudio } from '../dsp/pcm';
import { ListenBadInput } from '../errors';
import { soundAnalysisSchema, type ListenOptions, type SoundAnalysis } from './schema';

export const LISTEN_CACHE_DIR = 'listen';
/** The entry's layout version (the key's `.v<recipe>`); LISTEN_CONFIG.version is in the digest. */
export const LISTEN_CACHE_RECIPE = 1;

const HASH = /^[0-9a-f]{64}$/;

/** A stable JSON of the options: object keys sorted, `install` left out (it changes how, not what). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key, v]) => v !== undefined && key !== 'install')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * `listen/<hh>/<hash>.listen.<digest>.v1.json`, a DERIVED_KEY_PATTERN key. `models` names the checkpoints and the
 * installed builds (whose ids carry the dtype), 'none' for signal processing only.
 */
export function listenCacheKey(contentHash: string, models: string, options: ListenOptions): string {
  const hash = HASH.test(contentHash) ? contentHash : createHash('sha256').update(contentHash).digest('hex');
  const digest = createHash('sha256')
    .update(`${LISTEN_CONFIG.version}\n${models}\n${canonical(options)}`)
    .digest('hex')
    .slice(0, 32);
  return `${LISTEN_CACHE_DIR}/${hash.slice(0, 2)}/${hash}.listen.${digest}.v${LISTEN_CACHE_RECIPE}.json`;
}

/** The sha256 of a file's bytes, streamed. */
export async function fileContentHash(path: string, signal?: AbortSignal): AsyncResult<string> {
  if (signal?.aborted) return err(CancelledError());
  return new Promise((resolve) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path, signal ? { signal } : {});
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', (cause) =>
      resolve(
        signal?.aborted
          ? err(CancelledError())
          : err(ListenBadInput(undefined, { detail: `${path}: ${cause.message}`.slice(0, 500) })),
      ),
    );
    stream.on('end', () => resolve(ok(hash.digest('hex'))));
  });
}

/** The sha256 of decoded samples (each channel's bytes, then the rate and the channel count). */
export function pcmContentHash(audio: ListenAudio): string {
  const hash = createHash('sha256');
  for (const channel of audio.channels)
    hash.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
  return hash.update(`${audio.sampleRate}/${audio.channels.length}`).digest('hex');
}

export interface ListenAnalysisCache {
  get(key: string, signal?: AbortSignal): Promise<SoundAnalysis | undefined>;
  put(key: string, analysis: SoundAnalysis, signal?: AbortSignal): Promise<void>;
}

/** Over derived JSON: an entry that is missing, unreadable or no longer parses is a miss. */
export function createListenAnalysisCache(
  json: DerivedJson,
  log: (line: string) => void = () => undefined,
): ListenAnalysisCache {
  return {
    async get(key, signal) {
      const read = await json.read(key, signal);
      if (!read.ok) return undefined;
      const parsed = soundAnalysisSchema.safeParse(read.value);
      return parsed.success ? parsed.data : undefined;
    },
    async put(key, analysis, signal) {
      const written = await json.write(key, analysis, signal);
      if (!written.ok) log(`[listen] analysis not cached (${written.error.code}): ${key}`);
    },
  };
}
