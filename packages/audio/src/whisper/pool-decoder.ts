// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The decoder port over the whisper-server pool: a transcript or a language ID is one `/inference` request on
 * the process for the request's model, answered as `verbose_json` and mapped to the CLI path's tokens.
 */
import { CancelledError, err, ok, type AsyncResult, type TaalcutError } from '@taalcut/core';
import { LanguageDetectFailed, TranscriptionFailed } from '../errors';
import type { WhisperDecoder } from './decoder';
import type { InferFailure, WhisperServerProcess } from './server-process';
import { decodedOf, languageDistribution, topLanguage, type VerboseJson } from './server-response';

export type PoolFailure = InferFailure | { readonly kind: 'launch'; readonly error: TaalcutError };
export type Inference = (process: WhisperServerProcess) => AsyncResult<VerboseJson, InferFailure>;
/** One request on the pool's process for `binary` and `model`. */
export type PoolCall = (
  binary: string,
  model: string,
  infer: Inference,
) => AsyncResult<VerboseJson, PoolFailure>;

function errorOf(
  failure: PoolFailure,
  signal: AbortSignal | undefined,
  failed: (detail: string) => TaalcutError,
): TaalcutError {
  if (failure.kind === 'launch') return failure.error;
  if (failure.kind === 'cancelled' || signal?.aborted) return CancelledError();
  return failed(failure.detail);
}

/** The decoder port over the pool's calls for one whisper-server binary. */
export function poolDecoder(call: PoolCall, binary: string): WhisperDecoder {
  return {
    mode: 'persistent',
    async transcribe(request) {
      const answer = await call(binary, request.model, (server) =>
        server.infer(
          request.audio,
          {
            response_format: 'verbose_json',
            language: request.language,
            no_language_probabilities: request.language === 'auto' ? 'false' : 'true',
          },
          {
            ...(request.signal ? { signal: request.signal } : {}),
            ...(request.onProgress ? { onProgress: request.onProgress } : {}),
          },
        ),
      );
      if (!answer.ok)
        return err(
          errorOf(answer.error, request.signal, (detail) => TranscriptionFailed(undefined, { detail })),
        );
      request.onProgress?.(1);
      return ok(decodedOf(answer.value, request.language));
    },
    async identifyLanguage(request) {
      const answer = await call(binary, request.model, (server) =>
        server.infer(
          request.audio,
          { response_format: 'verbose_json', detect_language: 'true', language: 'auto' },
          request.signal ? { signal: request.signal } : {},
        ),
      );
      if (!answer.ok)
        return err(
          errorOf(answer.error, request.signal, (detail) => LanguageDetectFailed(undefined, { detail })),
        );
      const top = topLanguage(answer.value);
      if (!top) return err(LanguageDetectFailed(undefined, { detail: 'no language probabilities' }));
      return ok({ ...top, distribution: languageDistribution(answer.value) });
    },
  };
}
