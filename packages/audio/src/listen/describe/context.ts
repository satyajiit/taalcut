// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What describe, match, rank, compare and sections share (EAR1-F5): the three model wrappers on one set of
 * sessions, a decoded source, and earshot's input checks. A source is 48 kHz mono at the models' level
 * (models/pcm.ts), with its channel count so the paths that upstream feeds the stereo mean can derive it.
 */
import { err, ok, type AsyncResult, type Result } from '@taalcut/core';
import type { DerivedJson } from '../../cleanup/speech-files';
import { createListenText, type ListenText } from '../calibrate/text';
import { LISTEN_CONFIG } from '../config';
import { ListenBadInput } from '../errors';
import { createAstTagger, type AstTagger } from '../models/ast';
import { createClapAudio, type ClapAudioEncoder } from '../models/clap-audio';
import type { ListenModelFiles } from '../models/files';
import { timelineMono } from '../models/pcm';
import type { ListenSessions } from '../models/sessions';
import { pyRound } from '../models/windows';
import { createTitleEmbeddings, type TitleEmbeddings } from '../search/title-cache';

const SR = LISTEN_CONFIG.sampleRate;

export interface ListenModels {
  readonly clap: ClapAudioEncoder;
  readonly ast: AstTagger;
  readonly text: ListenText;
  /** EAR1-G2: title sets' text embeddings (the SFX bank's), kept; absent (fakes): embedded on every search. */
  readonly titles?: TitleEmbeddings;
}

export interface ListenModelsOptions {
  /** Media's derived JSON, where the title embeddings are kept between starts; absent: in memory only. */
  readonly json?: DerivedJson;
  readonly log?: (line: string) => void;
}

export function createListenModels(
  sessions: ListenSessions,
  files: ListenModelFiles,
  options: ListenModelsOptions = {},
): ListenModels {
  const text = createListenText({ sessions, files });
  return {
    clap: createClapAudio(sessions),
    ast: createAstTagger(sessions),
    text,
    titles: createTitleEmbeddings({
      text,
      textModel: (signal) => sessions.model('clapText', signal),
      ...(options.json ? { json: options.json } : {}),
      ...(options.log ? { log: options.log } : {}),
    }),
  };
}

export interface ListenSource {
  /** For results: a file name or an asset's label. */
  readonly name?: string;
  /** 48 kHz mono, ffmpeg `-ac 1`'s level (`decodeListenAudio`). */
  readonly samples: Float32Array;
  /** The source's channels (default 1). */
  readonly channels?: number;
  /** The sample peak as it plays (both channels); default: the mono samples' peak. */
  readonly peakDbfs?: number;
}

/**
 * Sources an operation reaches one at a time (EAR1-R1): the jobs process decodes each as the operation asks for it
 * and keeps none, so a query over 60 long files never holds them all (on 8 GB, up to 1.8 GB of PCM at once).
 */
export interface ListenSourceList {
  readonly length: number;
  /** Source `index`, decoded now; nothing is kept, so read each once per pass. */
  load(index: number, signal?: AbortSignal): AsyncResult<ListenSource>;
}

/** Decoded sources, or a list decoded as it is read. */
export type ListenSources = readonly ListenSource[] | ListenSourceList;

const isList = (sources: ListenSources): sources is ListenSourceList => 'load' in sources;

/** Source `index` of either kind; past the end is `listen_bad_input`. */
export function sourceAt(
  sources: ListenSources,
  index: number,
  signal?: AbortSignal,
): AsyncResult<ListenSource> {
  if (isList(sources)) return sources.load(index, signal);
  const source = sources[index];
  return Promise.resolve(
    source ? ok(source) : err(ListenBadInput(undefined, { detail: `no source ${index}` })),
  );
}

/** The sources from `start` on, without decoding any. */
export function sourcesFrom(sources: ListenSources, start: number): ListenSources {
  if (!isList(sources)) return sources.slice(start);
  return {
    length: Math.max(0, sources.length - start),
    load: (index, signal) => sources.load(index + start, signal),
  };
}

/** Seconds from the source's start; `end` past the end is the end. */
export interface ListenRange {
  readonly start?: number;
  readonly end?: number;
}

export const durationOf = (source: ListenSource): number => source.samples.length / SR;

/** `audio.db(peak)`: 20·log10, floored at 1e-12. */
export function dbOf(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-12));
}

export function peakOf(samples: Float32Array): number {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return peak;
}

/** `vocab.check`: a start inside the file and an end after it. */
export function checkRange(source: ListenSource, range?: ListenRange): Result<void> {
  const duration = durationOf(source);
  if (source.samples.length === 0) return err(ListenBadInput(undefined, { detail: 'no audio' }));
  if (range?.start !== undefined && range.start < 0)
    return err(ListenBadInput(undefined, { detail: 'negative start' }));
  if (range?.start !== undefined && range.start >= duration) {
    return err(
      ListenBadInput(undefined, { detail: `start ${range.start} s is past the end (${duration} s)` }),
    );
  }
  if (range?.end !== undefined && range.end <= (range.start ?? 0)) {
    return err(ListenBadInput(undefined, { detail: 'end before start' }));
  }
  return ok(undefined);
}

/** `audio.load(start=, end=)`: samples [round(start·SR), round(end·SR)). */
export function rangeSamples(samples: Float32Array, range?: ListenRange): Float32Array {
  const a = Math.max(0, pyRound((range?.start ?? 0) * SR));
  const b = range?.end === undefined ? samples.length : Math.min(samples.length, pyRound(range.end * SR));
  return samples.subarray(Math.min(a, samples.length), Math.max(a, b));
}

/** The source's sample peak in dBFS over the range: the given one when there is no range. */
export function peakDbfs(source: ListenSource, range?: ListenRange): number {
  if (source.peakDbfs !== undefined && range === undefined) return source.peakDbfs;
  return dbOf(peakOf(rangeSamples(source.samples, range)));
}

/** timeline.py's (and describe's long-file AST's) mono: the stereo mean. */
export const meanMono = (source: ListenSource): Float32Array =>
  timelineMono({ samples: source.samples, channels: source.channels ?? 1 });

export const isNearSilent = (dbfs: number): boolean => dbfs < LISTEN_CONFIG.calibration.nearSilentDbfs;
