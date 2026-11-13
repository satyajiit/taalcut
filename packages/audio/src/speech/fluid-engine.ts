// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Parakeet TDT 0.6B v3 through the mac-helper sidecar (`asr.load`,
 * `asr.transcribe`). The helper keeps the model between calls, so it is
 * loaded only when the helper says `asr.not_loaded` (its first call, or after
 * an idle exit): `asr.load` reloads the weights every time it is sent. A model
 * that will not load falls back to the CPU engine and logs `compute.fallback`.
 * This file does not spawn a process.
 */
import {
  CancelledError,
  computeFallbackEvent,
  cpuFallback,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type TaalcutError,
  type Transcript,
  type TranscriptWord,
} from '@taalcut/core';
import { AUDIO_CONFIG } from '../config';
import { EngineUnavailable, TranscriptionFailed } from '../errors';
import { msRange } from '../rates';
import {
  PARAKEET_LOAD,
  type AsrTranscribeResult,
  type SpeechEngine,
  type SpeechSidecar,
  type SpeechTranscribeOptions,
} from './engine';
import { spokenBase } from './route';
import { buildTranscript } from './segments';

export interface FluidEngineOptions {
  readonly fallback?: SpeechEngine;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly language?: string;
}

const PARAKEET_LANGUAGES = ['en', 'es', 'pt'] as const;
/** The helper's answer to `asr.transcribe` before a successful `asr.load` in this process. */
const NOT_LOADED = 'asr.not_loaded';

function modelWillNotLoad(error: TaalcutError): boolean {
  return error.code === 'asr.model_load_failed' || error.code === 'asr.model_missing';
}

function cancelled(signal: AbortSignal | undefined, error: TaalcutError): boolean {
  if (signal?.aborted) return true;
  return (
    error.code === 'core.cancelled' || error.code === 'helper.cancelled' || error.code === 'media.cancelled'
  );
}

function sidecarFailure(error: TaalcutError, signal?: AbortSignal): AsyncResult<Transcript> {
  if (cancelled(signal, error)) return Promise.resolve(err(CancelledError()));
  const detail = (error.detail ?? error.code).slice(0, 500);
  return Promise.resolve(err(TranscriptionFailed(undefined, { detail })));
}

function emitAneFallback(onFallback: FluidEngineOptions['onFallback'], error: TaalcutError): void {
  const detail = (error.detail ?? error.code).slice(0, 500);
  const choice = cpuFallback('accelerator_failed', detail);
  if (choice.backend === 'cpu') {
    onFallback?.(computeFallbackEvent('audio.transcribe', ['ane', 'cpu'], choice.fallback));
  }
}

export function createFluidAudioEngine(sidecar: SpeechSidecar, options?: FluidEngineOptions): SpeechEngine {
  return {
    id: 'parakeet',
    languages() {
      return PARAKEET_LANGUAGES;
    },
    transcribe(audio, request) {
      return transcribeFluid(sidecar, options, audio, request);
    },
  };
}

async function transcribeFluid(
  sidecar: SpeechSidecar,
  options: FluidEngineOptions | undefined,
  audio: string,
  request?: SpeechTranscribeOptions,
): AsyncResult<Transcript> {
  if (request?.signal?.aborted) return err(CancelledError());
  const language = request?.language ?? options?.language;
  const params = language ? { path: audio, language: spokenBase(language) } : { path: audio };
  const transcribe = () =>
    sidecar.request<AsrTranscribeResult>('asr.transcribe', params, {
      signal: request?.signal,
      onProgress: request?.onProgress,
    });
  let transcribed = await transcribe();
  if (!transcribed.ok && transcribed.error.code === NOT_LOADED) {
    const loaded = await sidecar.request('asr.load', PARAKEET_LOAD, { signal: request?.signal });
    if (!loaded.ok) return loadFailure(loaded.error, options, audio, request);
    transcribed = await transcribe();
  }
  if (!transcribed.ok) return sidecarFailure(transcribed.error, request?.signal);

  const words: TranscriptWord[] = transcribed.value.words.map((word) => ({
    text: word.text,
    range: msRange(word.startMs, Math.max(0, word.endMs - word.startMs)),
    ...(typeof word.confidence === 'number' ? { confidence: word.confidence } : {}),
  }));
  return ok(
    buildTranscript({
      language: language ?? 'und',
      engine: 'parakeet',
      model: AUDIO_CONFIG.models.parakeet,
      local: true,
      words,
    }),
  );
}

/** The weights won't load: the fallback engine when there is one, else Parakeet is unavailable. */
function loadFailure(
  error: TaalcutError,
  options: FluidEngineOptions | undefined,
  audio: string,
  request?: SpeechTranscribeOptions,
): AsyncResult<Transcript> {
  if (!modelWillNotLoad(error)) return sidecarFailure(error, request?.signal);
  if (options?.fallback) {
    emitAneFallback(options.onFallback, error);
    return options.fallback.transcribe(audio, request);
  }
  return Promise.resolve(
    err(EngineUnavailable({ engine: 'parakeet' }, { detail: error.detail ?? error.code })),
  );
}
