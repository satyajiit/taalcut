// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * whisper.cpp as a SpeechEngine. How whisper runs is the decoder's business (`src/whisper`): a process per call
 * by default (`whisper-cli` on Metal, retried on the CPU when Metal fails to start), or the persistent server
 * when the caller passes one (IX-A3). Either way `-l` is never left out (the CLI's default is English), and the
 * words, loop truncation and segments are built here from whisper's tokens.
 */
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type Transcript,
} from '@taalcut/core';
import { ModelMissing, NoAudio } from '../errors';
import { createCliWhisperDecoder } from '../whisper/cli-decoder';
import {
  whisperComponent,
  whisperLanguageFlag,
  whisperModelId,
  type WhisperDecoder,
} from '../whisper/decoder';
import type { WhisperRun } from './detect';
import { type SpeechEngine, type SpeechTranscribeOptions } from './engine';
import { buildTranscript } from './segments';
import { wordsFromTokens } from './whisper-parse';

export interface WhisperEngineDeps {
  readonly binary: string;
  readonly model: string;
  /** whisper-cli `-mc` when set. Jobs omit it. */
  readonly ctx?: number;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly run?: WhisperRun;
  /** Runs whisper instead of a whisper-cli process per call (the persistent server). */
  readonly decoder?: WhisperDecoder;
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function transcriptLanguage(requested: string | undefined, detected: string | null): string | null {
  if (requested && requested !== 'auto') return requested;
  return detected;
}

async function transcribeWith(
  decoder: WhisperDecoder,
  model: string,
  audio: string,
  options?: SpeechTranscribeOptions,
): AsyncResult<Transcript> {
  if (options?.signal?.aborted) return err(CancelledError());
  if (!(await readable(model))) return err(ModelMissing({ component: whisperComponent(model) }));
  if (!(await readable(audio))) return err(NoAudio({ name: basename(audio) || audio }));
  const decoded = await decoder.transcribe({
    audio,
    model,
    language: whisperLanguageFlag(options?.language),
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
  });
  if (!decoded.ok) return decoded;
  // Loop truncation is applied to the words here. Transcript has no flag for it.
  const { words } = wordsFromTokens(decoded.value.tokens);
  return ok(
    buildTranscript({
      language: transcriptLanguage(options?.language, decoded.value.language),
      engine: 'whisper',
      model: whisperModelId(model),
      local: true,
      words,
    }),
  );
}

export function createWhisperEngine(deps: WhisperEngineDeps): SpeechEngine {
  const decoder =
    deps.decoder ??
    createCliWhisperDecoder({
      binary: deps.binary,
      ...(deps.ctx !== undefined ? { ctx: deps.ctx } : {}),
      ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
      ...(deps.run ? { run: deps.run } : {}),
    });
  return {
    id: 'whisper',
    languages() {
      // `-l auto` covers every other language. These are the codes the CLI can be asked for.
      return ['en', 'es', 'pt', 'hi'];
    },
    transcribe(audio, options) {
      return transcribeWith(decoder, deps.model, audio, options);
    },
  };
}
