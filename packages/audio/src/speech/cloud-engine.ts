// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cloud speech behind standing upload consent. The job calls
 * `transcribeCloud(path, deps)`. No consent, or local-only, is
 * `{ skipped: 'no_consent' }` and does not call the provider.
 */
import {
  CancelledError,
  err,
  ok,
  type AsyncResult,
  type CloudSpeechToText,
  type CloudTranscriptionRequest,
  type Transcript,
} from '@taalcut/core';
import { type HardwareTier } from '../config';
import { EngineUnavailable } from '../errors';
import { type SpeechEngine, type SpeechTranscribeOptions } from './engine';

export interface SpeechSettings {
  hasSpeechUploadConsent(): boolean;
  localOnly(): boolean;
  tier(): HardwareTier;
}

export interface CloudSpeechDeps {
  readonly cloud: CloudSpeechToText;
  readonly settings: SpeechSettings;
}

/** What `audio.transcribeCloud` passes. `durationMs` defaults to 0 when the job omits it. */
export interface CloudTranscribeOptions {
  readonly cloud: CloudSpeechToText;
  readonly settings: SpeechSettings;
  readonly durationMs?: number;
  readonly language?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
  readonly runId?: string;
}

const SCRIBE_LANGUAGES = ['en', 'es', 'pt', 'hi'] as const;

function blocked(settings: SpeechSettings): boolean {
  return settings.localOnly() || !settings.hasSpeechUploadConsent();
}

export async function transcribeCloud(
  path: string,
  options: CloudTranscribeOptions,
): AsyncResult<Transcript | { skipped: 'no_consent' }> {
  if (blocked(options.settings)) return ok({ skipped: 'no_consent' });
  if (options.signal?.aborted) return err(CancelledError());
  options.onProgress?.(0);
  const body: CloudTranscriptionRequest = {
    path,
    durationMs: options.durationMs ?? 0,
    ...(options.language ? { language: options.language } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.runId ? { runId: options.runId } : {}),
  };
  const transcript = await options.cloud.transcribe(body);
  if (transcript.ok) options.onProgress?.(1);
  return transcript;
}

export function createCloudSpeechEngine(
  deps: CloudSpeechDeps,
): SpeechEngine & { estimate(durationMs: number): { usd: number; provider: string; model: string } | null } {
  return {
    id: 'scribe',
    languages() {
      return SCRIBE_LANGUAGES;
    },
    estimate(durationMs) {
      return deps.cloud.estimate(durationMs);
    },
    async transcribe(path, options?: SpeechTranscribeOptions) {
      const result = await transcribeCloud(path, {
        cloud: deps.cloud,
        settings: deps.settings,
        ...(options?.signal ? { signal: options.signal } : {}),
        ...(options?.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options?.language ? { language: options.language } : {}),
      });
      if (!result.ok) return result;
      if ('skipped' in result.value) {
        return err(EngineUnavailable({ engine: 'scribe' }, { detail: 'no_consent' }));
      }
      return ok(result.value);
    },
  };
}
