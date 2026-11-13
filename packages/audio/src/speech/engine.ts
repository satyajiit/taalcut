// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Speech engines. Parakeet's process is media's JSON-line sidecar
 * (`createParakeetSidecar`). This file only describes the request() shape.
 */
import type { AsyncResult, ComputeFallbackEvent, Transcript } from '@taalcut/core';

export interface SpeechTranscribeOptions {
  readonly language?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
}

export interface SpeechEngine {
  readonly id: 'parakeet' | 'sherpa' | 'whisper' | 'scribe';
  languages(): readonly string[];
  transcribe(audio: string, options?: SpeechTranscribeOptions): AsyncResult<Transcript>;
}

/**
 * One round trip on the mac-helper speech service (`asr.load`, `asr.transcribe`).
 * Failures arrive as Result errors. `asr.model_load_failed` and `asr.model_missing`
 * are the codes that send Parakeet to the sherpa fallback.
 */
export interface SpeechSidecar {
  request<T>(
    method: string,
    params: unknown,
    options?: { readonly signal?: AbortSignal; readonly onProgress?: (fraction: number) => void },
  ): AsyncResult<T>;
}

export type FallbackListener = (event: ComputeFallbackEvent) => void;

/** asr.load for Parakeet TDT 0.6B v3, int8 encoder, as FluidAudio v0.17.7 pins it. */
export const PARAKEET_LOAD = { version: 'v3', encoderPrecision: 'int8' } as const;

export interface AsrWord {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence: number;
}

export interface AsrTranscribeResult {
  readonly text: string;
  readonly durationMs: number;
  readonly rtf: number;
  readonly words: readonly AsrWord[];
}
