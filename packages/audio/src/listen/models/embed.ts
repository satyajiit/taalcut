// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The plain entry points for embedding a sound with CLAP (lane D's bank build, tests, tools): a runtime on a folder
 * of unpacked builds or the component manager, then a file or 48 kHz samples in, `vocab.embed_file`'s embedding out
 * (up to 6 evenly spaced 10 s windows, averaged, unit length).
 */
import { err, type AsyncResult, type TimeRange } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { LISTEN_CONFIG } from '../config';
import { ListenBadInput } from '../errors';
import { createAstTagger, type AstTagger } from './ast';
import { createClapAudio, type ClapAudioEncoder, type ClapSourceEmbedding } from './clap-audio';
import { decodeListenAudio } from './pcm';
import { createListenSessions, type ListenSessions, type ListenSessionsOptions } from './sessions';

export interface ListenRuntime {
  readonly sessions: ListenSessions;
  readonly clap: ClapAudioEncoder;
  readonly ast: AstTagger;
  release(): Promise<void>;
}

/** e.g. `createListenRuntime({ files: directoryListenFiles(modelsDir, 'fp16') })`. */
export function createListenRuntime(options: ListenSessionsOptions): ListenRuntime {
  const sessions = createListenSessions(options);
  return {
    sessions,
    clap: createClapAudio(sessions),
    ast: createAstTagger(sessions),
    release: () => sessions.release(),
  };
}

/** `samples`: mono at `sampleRate` (48 kHz only), at ffmpeg `-ac 1`'s level; `range` in seconds. */
export async function embedPcm(
  clap: ClapAudioEncoder,
  samples: Float32Array,
  sampleRate: number,
  options: {
    readonly range?: { readonly start?: number; readonly end?: number };
    readonly signal?: AbortSignal;
  } = {},
): AsyncResult<ClapSourceEmbedding> {
  if (sampleRate !== LISTEN_CONFIG.sampleRate) {
    return err(
      ListenBadInput(undefined, { detail: `CLAP reads 48 kHz, not ${sampleRate} Hz: decode at 48 kHz` }),
    );
  }
  if (samples.length === 0) return err(ListenBadInput(undefined, { detail: 'no samples' }));
  return clap.embedSource(samples, options.range, options.signal);
}

/** Any file media can decode, through `decodeListenAudio` (48 kHz, earshot's mono level). */
export async function embedAudioFile(
  clap: ClapAudioEncoder,
  path: string,
  options: { readonly media: MediaContext; readonly range?: TimeRange; readonly signal?: AbortSignal },
): AsyncResult<ClapSourceEmbedding> {
  const decoded = await decodeListenAudio(path, options);
  if (!decoded.ok) return decoded;
  return embedPcm(
    clap,
    decoded.value.samples,
    LISTEN_CONFIG.sampleRate,
    options.signal ? { signal: options.signal } : {},
  );
}
