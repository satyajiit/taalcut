// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The transcript kinds (IX-A4): the asset's speech PCM (the audio pass language ID kept, or a new pass) through
 * one engine, the PCM removed when the job ends. The PCM is the WAV the transcript always read (16 kHz mono,
 * aligned to the video start, so word times line up with frames).
 * - whisper: on Metal, the persistent server when there is one; Hindi and every language Parakeet doesn't
 *   speak, and Parakeet's own when it isn't installed (logged, not a CPU fallback).
 * - parakeet: the mac helper on the Neural Engine (sherpa-onnx on the CPU when Core ML won't load, a logged
 *   fallback); whisper when the helper isn't there.
 * - route: the pre-IX kind, either engine chosen here.
 * Cloud speech is never used for background indexing.
 */
import { err, type AsyncResult, type JobContext, type Transcript } from '@taalcut/core';
import { EngineUnavailable, ModelMissing } from '../errors';
import { createFluidAudioEngine } from '../speech/fluid-engine';
import { routeTranscription, type TranscriptionRoute } from '../speech/route';
import { createSherpaParakeetEngine } from '../speech/sherpa-engine';
import { createWhisperEngine } from '../speech/whisper-engine';
import type { AudioIndexJobDeps } from './deps';
import type { TranscribeAssetInput } from './index-kinds';
import { AUDIO_JOB_STAGES, reportStage } from './kinds';

export type TranscriptEngineChoice = 'whisper' | 'parakeet' | 'route';

type Progress = (fraction: number) => void;

function stage(context: JobContext, fraction: number): void {
  reportStage(context, fraction, AUDIO_JOB_STAGES.transcribing);
}

/** The tier's whisper model, else the other size when only that one is installed. */
function whisperModel(deps: AudioIndexJobDeps, route: TranscriptionRoute): string | undefined {
  const preferred = route.whisperModel === 'small' ? deps.whisper.small : deps.whisper.medium;
  const other = route.whisperModel === 'small' ? deps.whisper.medium : deps.whisper.small;
  return [preferred, other].find((path) => path !== '');
}

function whisperTranscript(
  deps: AudioIndexJobDeps,
  route: TranscriptionRoute,
  wav: string,
  signal: AbortSignal,
  onProgress: Progress,
): AsyncResult<Transcript> {
  if (!deps.decoder && !deps.whisper.binary)
    return Promise.resolve(err(ModelMissing({ component: 'whisper-cpp' })));
  const model = whisperModel(deps, route);
  if (!model) {
    const component = route.whisperModel === 'small' ? 'whisper-small-q8-0' : 'whisper-medium-q5-0';
    return Promise.resolve(err(ModelMissing({ component })));
  }
  const whisper = createWhisperEngine({
    binary: deps.whisper.binary,
    model,
    ...(deps.decoder ? { decoder: deps.decoder } : {}),
    ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
  });
  // Parakeet's languages go to whisper by name; anything else stays `auto` (the route's own flag).
  const language =
    route.engine === 'parakeet' ? (route.language ?? 'auto') : (route.whisperLanguage ?? 'auto');
  return whisper.transcribe(wav, { language, signal, onProgress });
}

async function parakeetTranscript(
  deps: AudioIndexJobDeps,
  route: TranscriptionRoute,
  wav: string,
  signal: AbortSignal,
  onProgress: Progress,
): AsyncResult<Transcript> {
  if (!deps.sidecar) {
    deps.log?.('[audio] parakeet is not installed; whisper on Metal transcribes this asset');
    return whisperTranscript(deps, route, wav, signal, onProgress);
  }
  const fallback = deps.sherpa
    ? createSherpaParakeetEngine({ runtimeDir: deps.sherpa.runtimeDir, modelDir: deps.sherpa.modelDir })
    : undefined;
  const engine = createFluidAudioEngine(deps.sidecar, {
    ...(fallback ? { fallback } : {}),
    ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
  });
  const language = route.language ?? undefined;
  const parakeet = await engine.transcribe(wav, { ...(language ? { language } : {}), signal, onProgress });
  if (parakeet.ok || parakeet.error.code !== EngineUnavailable.code) return parakeet;
  deps.log?.(
    `[audio] parakeet unavailable (${parakeet.error.detail ?? 'no detail'}); whisper on Metal instead`,
  );
  return whisperTranscript(deps, route, wav, signal, onProgress);
}

export async function transcribeAsset(
  deps: AudioIndexJobDeps,
  input: TranscribeAssetInput,
  context: JobContext,
  choice: TranscriptEngineChoice,
): AsyncResult<Transcript> {
  stage(context, 0);
  const route = routeTranscription(
    { language: input.language, probability: null, perSlice: input.perSlice },
    { tier: deps.settings.tier(), cloudFirst: false, consent: false },
  );
  const asset = { path: input.path, contentHash: input.contentHash, plan: input.plan };
  const lease = await deps.store.acquire(asset, deps.media, context.signal);
  if (!lease.ok) return lease;
  try {
    stage(context, 0.2);
    const wav = lease.value.pass.pcm.path;
    const onProgress = (fraction: number) => stage(context, 0.2 + 0.8 * fraction);
    const parakeet = choice === 'parakeet' || (choice === 'route' && route.engine === 'parakeet');
    const transcript = parakeet
      ? await parakeetTranscript(deps, route, wav, context.signal, onProgress)
      : await whisperTranscript(deps, route, wav, context.signal, onProgress);
    if (transcript.ok) stage(context, 1);
    return transcript;
  } finally {
    // The asset's indexing is done with its audio: the PCM goes now, not at the idle sweep.
    await lease.value.release();
  }
}
