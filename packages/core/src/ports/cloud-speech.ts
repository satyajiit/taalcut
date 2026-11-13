// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cloud speech-to-text for model module 'speech' (Settings → Models).
 * Models are reached only through @taalcut/models (R26), and audio may not
 * import models, so the port is here: models implements it (ElevenLabs
 * Scribe v2 first, one CloudCallRecord per request with module 'speech'),
 * audio calls it. Background work uploads only under a standing consent
 * (settings/upload-consents.ts).
 */
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { SpokenLanguage, Transcript } from '../analysis/transcript';

export interface CloudTranscriptionRequest {
  /** 16 kHz mono WAV or FLAC written by media; the implementation reads and uploads it. */
  readonly path: string;
  readonly durationMs: number;
  /** A hint; absent means the provider detects the language. */
  readonly language?: SpokenLanguage;
  readonly diarize?: boolean;
  readonly signal?: AbortSignal;
  /** For the cloud-call log. */
  readonly runId?: string;
}

export interface CloudSpeechToText {
  /** True when the user's speech chain puts a cloud model before every local one. */
  cloudFirst(): boolean;
  /** Cloud providers in the speech chain, in order; empty when it has none. Consent is checked against these. */
  providers(): readonly string[];
  /** Upper-bound cost for this much audio, or null when the chain has no cloud model. */
  estimate(
    durationMs: number,
  ): { readonly usd: number; readonly provider: string; readonly model: string } | null;
  transcribe(request: CloudTranscriptionRequest): AsyncResult<Transcript>;
}

export const CloudSpeechToTextToken = createToken<CloudSpeechToText>('core.cloudSpeechToText');
