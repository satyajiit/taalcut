// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `audio.analyzeSpeech` (core ANALYZE_SPEECH_JOB_KIND) in the jobs process: the asset's file, content hash and
 * stored transcript come from the library, the analysis is cached as derived JSON, and a current one is reused.
 * Resource `cpu`: Silero runs on the CPU provider when WebGPU won't take it.
 */
import {
  ANALYZE_SPEECH_JOB_KIND,
  analyzeSpeechJobInputSchema,
  defineJobKind,
  err,
  ok,
  speechCleanupAnalysisSchema,
  type AssetId,
  type AsyncResult,
  type JobRegistration,
  type Transcript,
} from '@taalcut/core';
import { registerJob } from '@taalcut/media';
import { z } from 'zod';
import type { SpeechCleanupAnalyser } from './analysis';
import { CLEANUP_AUDIO_CONFIG } from './config';
import { NoTranscript } from './errors';
import { speechKey, type DerivedJson } from './speech-files';

const countsSchema = z.object({
  key: z.string(),
  reused: z.boolean(),
  fillers: z.int().nonnegative(),
  pauses: z.int().nonnegative(),
  retakes: z.int().nonnegative(),
  emphasis: z.int().nonnegative(),
  ambiguous: z.int().nonnegative(),
});
export type SpeechAnalysisCounts = z.output<typeof countsSchema>;

export const audioAnalyzeSpeechJob = defineJobKind({
  kind: ANALYZE_SPEECH_JOB_KIND,
  input: analyzeSpeechJobInputSchema,
  output: countsSchema,
  resource: 'cpu',
  priority: 'normal',
  retry: { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } },
  timeoutMs: 10 * 60 * 1000,
  // The handler reuses a current analysis of the asset's content, so the key only needs the config.
  idempotencyKey: (input) =>
    `${ANALYZE_SPEECH_JOB_KIND}:cfg${CLEANUP_AUDIO_CONFIG.configVersion}:${input.assetId}`,
});

/** What the library knows about an asset in the jobs process. */
export interface SpeechAssetReader {
  facts(
    assetId: AssetId,
    signal?: AbortSignal,
  ): AsyncResult<{
    readonly path: string;
    readonly contentHash: string;
    readonly transcript: Transcript | null;
  }>;
}

export interface AnalyzeSpeechDeps {
  readonly assets: SpeechAssetReader;
  readonly derived: DerivedJson;
  readonly analyser: SpeechCleanupAnalyser;
}

const countsOf = (
  key: string,
  reused: boolean,
  a: z.output<typeof speechCleanupAnalysisSchema>,
): SpeechAnalysisCounts => ({
  key,
  reused,
  fillers: a.fillers.length,
  pauses: a.pauses.length,
  retakes: a.retakes.length,
  emphasis: a.emphasis.length,
  ambiguous: a.ambiguous.length,
});

export async function analyzeSpeechAsset(
  deps: AnalyzeSpeechDeps,
  assetId: AssetId,
  signal?: AbortSignal,
): AsyncResult<SpeechAnalysisCounts> {
  const facts = await deps.assets.facts(assetId, signal);
  if (!facts.ok) return facts;
  const key = speechKey(facts.value.contentHash);
  const cached = await deps.derived.read(key, signal);
  if (cached.ok) {
    const parsed = speechCleanupAnalysisSchema.safeParse(cached.value);
    if (parsed.success && parsed.data.contentHash === facts.value.contentHash)
      return ok(countsOf(key, true, parsed.data));
  }
  if (!facts.value.transcript) return err(NoTranscript({ assetId }));
  const analysis = await deps.analyser.analyse({
    path: facts.value.path,
    assetId,
    contentHash: facts.value.contentHash,
    transcript: facts.value.transcript,
    ...(signal ? { signal } : {}),
  });
  if (!analysis.ok) return analysis;
  const written = await deps.derived.write(key, analysis.value, signal);
  if (!written.ok) return written;
  return ok(countsOf(key, false, analysis.value));
}

export function createCleanupJobs(deps: AnalyzeSpeechDeps): readonly JobRegistration[] {
  return [
    registerJob(audioAnalyzeSpeechJob, async (input, context) => {
      context.progress({ fraction: 0, stageKey: 'jobs.stage.analysingSpeech' });
      const done = await analyzeSpeechAsset(deps, input.assetId, context.signal);
      if (done.ok) context.progress({ fraction: 1, stageKey: 'jobs.stage.analysingSpeech' });
      return done;
    }),
  ];
}
