// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Handlers for the audio job kinds. The jobs process registers `createAudioJobs(deps)`. */
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  err,
  forwardJobProgress,
  ok,
  RationalTime,
  type AsyncResult,
  type JobRegistration,
  type JobRunner,
  type TimeRange,
  type ToolContextBase,
  type Transcript,
  registerJob,
} from '@taalcut/core';
import { createBeatTracker } from '../beats/tracker';
import { AUDIO_CONFIG } from '../config';
import { BeatTrackingFailed, EngineUnavailable, ModelMissing } from '../errors';
import { extractSpeechSlice } from '../measure/extract';
import { classifyAudio } from '../measure/classify';
import { measureAudio } from '../measure/measure';
import { musicScoreOf, speechRatioOf } from '../measure/score';
import type { AudioClassification, MeasureResult } from '../measure/types';
import { msRange, rangeToMs } from '../rates';
import { transcribeCloud } from '../speech/cloud-engine';
import { detectLanguage } from '../speech/detect';
import { createFluidAudioEngine } from '../speech/fluid-engine';
import { routeTranscription, type DetectedLanguages } from '../speech/route';
import { createSherpaParakeetEngine } from '../speech/sherpa-engine';
import { createWhisperEngine } from '../speech/whisper-engine';
import type { AudioJobDeps } from './deps';
import {
  AUDIO_JOB_STAGES,
  audioDetectLanguageJob,
  audioMeasureJob,
  audioTrackBeatsJob,
  audioTranscribeCloudJob,
  audioTranscribeParakeetJob,
  audioTranscribeWhisperJob,
  reportStage as stage,
} from './kinds';

function finiteMeasure(value: MeasureResult): MeasureResult {
  // JSON job output cannot store Infinity. ±120 keeps the sign and the silence rule.
  const finite = (n: number) => (Number.isFinite(n) ? n : n < 0 ? -120 : 120);
  return {
    ...value,
    integratedLufs: finite(value.integratedLufs),
    loudnessRange: finite(value.loudnessRange),
    truePeakDbtp: finite(value.truePeakDbtp),
    stretches: [...value.stretches],
    slices: [...value.slices],
  };
}

async function beatModelReady(modelDir: string) {
  try {
    await access(join(modelDir, 'beat_this.onnx'));
    return ok(undefined);
  } catch {
    return err(ModelMissing({ component: 'beat-this' }));
  }
}

export function createAudioJobs(deps: AudioJobDeps): readonly JobRegistration[] {
  return [
    registerJob(audioMeasureJob, async (input, context) => {
      stage(context, 0, AUDIO_JOB_STAGES.measuring);
      const measured = await measureAudio(input.path, input.plan, deps.media, {
        signal: context.signal,
        ...(input.range ? { range: input.range } : {}),
      });
      if (!measured.ok) return measured;
      stage(context, 1, AUDIO_JOB_STAGES.measuring);
      return ok(finiteMeasure(measured.value));
    }),
    registerJob(audioDetectLanguageJob, async (input, context) => {
      stage(context, 0, AUDIO_JOB_STAGES.detecting);
      if (input.slices.length === 0) {
        stage(context, 1, AUDIO_JOB_STAGES.detecting);
        return ok({ language: null, probability: null, perSlice: [] });
      }
      const detected = await detectLanguage(
        input.slices.map((slice) => slice.path),
        { binary: deps.whisper.binary, model: deps.whisper.tiny, signal: context.signal },
      );
      if (!detected.ok) return detected;
      stage(context, 1, AUDIO_JOB_STAGES.detecting);
      return ok({
        language: detected.value.language,
        probability: detected.value.probability,
        perSlice: detected.value.perSlice.map((slice) => ({
          language: slice.language,
          probability: slice.probability,
        })),
      });
    }),
    registerJob(audioTranscribeParakeetJob, async (input, context) => {
      stage(context, 0, AUDIO_JOB_STAGES.transcribing);
      if (!deps.sidecar)
        return err(
          EngineUnavailable({ engine: 'parakeet' }, { detail: 'no Parakeet helper in this process' }),
        );
      const fallback = deps.sherpa
        ? createSherpaParakeetEngine({
            runtimeDir: deps.sherpa.runtimeDir,
            modelDir: deps.sherpa.modelDir,
          })
        : undefined;
      const engine = createFluidAudioEngine(deps.sidecar, {
        ...(fallback ? { fallback } : {}),
        ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
      });
      const transcript = await engine.transcribe(input.path, {
        language: input.language,
        signal: context.signal,
        onProgress: (fraction) => stage(context, fraction, AUDIO_JOB_STAGES.transcribing),
      });
      if (transcript.ok) stage(context, 1, AUDIO_JOB_STAGES.transcribing);
      return transcript;
    }),
    registerJob(audioTranscribeWhisperJob, async (input, context) => {
      stage(context, 0, AUDIO_JOB_STAGES.transcribing);
      const engine = createWhisperEngine({
        binary: deps.whisper.binary,
        model: input.model === 'small' ? deps.whisper.small : deps.whisper.medium,
        ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
      });
      const transcript = await engine.transcribe(input.path, {
        language: input.language,
        signal: context.signal,
        onProgress: (fraction) => stage(context, fraction, AUDIO_JOB_STAGES.transcribing),
      });
      if (transcript.ok) stage(context, 1, AUDIO_JOB_STAGES.transcribing);
      return transcript;
    }),
    registerJob(audioTranscribeCloudJob, async (input, context) => {
      stage(context, 0, AUDIO_JOB_STAGES.transcribing);
      if (!deps.cloud)
        return err(
          EngineUnavailable({ engine: 'scribe' }, { detail: 'no cloud speech engine in this process' }),
        );
      const transcript = await transcribeCloud(input.path, {
        cloud: deps.cloud,
        settings: deps.settings,
        signal: context.signal,
        onProgress: (fraction) => stage(context, fraction, AUDIO_JOB_STAGES.transcribing),
        ...(input.language ? { language: input.language } : {}),
      });
      if (transcript.ok) stage(context, 1, AUDIO_JOB_STAGES.transcribing);
      return transcript;
    }),
    registerJob(audioTrackBeatsJob, async (input, context) => {
      stage(context, 0, AUDIO_JOB_STAGES.tracking);
      const ready = await beatModelReady(deps.beats.modelDir);
      if (!ready.ok) return ready;
      const tracker = createBeatTracker({
        onnx: deps.beats.onnx,
        modelDir: deps.beats.modelDir,
        media: deps.media,
        ...(deps.onFallback ? { onFallback: deps.onFallback } : {}),
      });
      const tracked = await tracker.trackBeats(
        { path: input.path },
        { signal: context.signal, ...(input.range ? { range: input.range } : {}) },
      );
      if (!tracked.ok) return tracked;
      const parsed = audioTrackBeatsJob.output.safeParse(tracked.value);
      if (!parsed.success) {
        return err(BeatTrackingFailed(undefined, { detail: 'beat analysis did not match the job output' }));
      }
      stage(context, 1, AUDIO_JOB_STAGES.tracking);
      return ok(parsed.data);
    }),
  ];
}

export interface ToolClip {
  readonly path: string;
  readonly range?: TimeRange;
  readonly language?: 'auto' | 'en' | 'es' | 'pt-BR' | 'hi';
}

export interface ToolTranscript {
  readonly language: string | null;
  readonly engine: Transcript['engine'];
  readonly model: string;
  readonly local: boolean;
  readonly text: string;
  readonly transcript: {
    readonly id: string;
    readonly mediaType: string;
    readonly bytes: number;
    readonly summary: string;
  };
  readonly cloudSkipped?: 'no_consent';
}

function toolJob(ctx: ToolContextBase) {
  return { signal: ctx.signal, onProgress: forwardJobProgress(ctx.reportProgress) };
}

function clipSource(input: ToolClip): { path: string; range?: TimeRange } {
  return input.range ? { path: input.path, range: input.range } : { path: input.path };
}

function localRoute(deps: AudioJobDeps, detected: DetectedLanguages) {
  return routeTranscription(detected, { tier: deps.settings.tier(), cloudFirst: false, consent: false });
}

function silentTranscript(deps: AudioJobDeps): Transcript {
  const route = localRoute(deps, { language: null, probability: null, perSlice: [] });
  return {
    version: 1,
    language: 'und',
    segments: [],
    engine: route.engine === 'parakeet' ? 'parakeet' : 'whisper',
    model: route.model,
    local: true,
    wordTiming: 'native',
  };
}

async function storeTranscript(
  ctx: ToolContextBase,
  written: Transcript,
  cloudSkipped?: 'no_consent',
): AsyncResult<ToolTranscript> {
  // LIB1-LANG: a transcriber names a language even over nothing written down; an empty transcript names none (`und`).
  const blank = !written.segments.some((segment) => segment.text.trim() !== '');
  const transcript = blank ? { ...written, language: 'und' } : written;
  const text = transcript.segments
    .map((segment) => segment.text)
    .join(' ')
    .slice(0, 4000);
  const stored = await ctx.artifacts.put({
    mediaType: 'application/json',
    data: JSON.stringify(transcript),
    summary:
      transcript.segments.length === 0
        ? 'Empty transcript. No speech was transcribed.'
        : `Transcript in ${transcript.language} from ${transcript.engine}, ${transcript.segments.length} segments.`,
  });
  if (!stored.ok) return stored;
  return ok({
    language: transcript.language,
    engine: transcript.engine,
    model: transcript.model,
    local: transcript.local,
    text,
    transcript: stored.value,
    ...(cloudSkipped ? { cloudSkipped } : {}),
  });
}

async function detectForTool(
  deps: AudioJobDeps,
  jobs: JobRunner,
  input: ToolClip,
  measured: MeasureResult,
  ctx: ToolContextBase,
): AsyncResult<DetectedLanguages> {
  if (input.language && input.language !== 'auto') {
    return ok({ language: input.language, probability: 1, perSlice: [{ language: input.language, probability: 1 }] });
  }
  const slices = measured.slices.length > 0 ? measured.slices : [msRange(0, Math.max(measured.durationMs, 1))];
  const dir = await mkdtemp(join(tmpdir(), 'taalcut-audio-'));
  try {
    const paths: { path: string }[] = [];
    for (let i = 0; i < slices.length; i += 1) {
      const slice = slices[i];
      if (!slice) continue;
      const dest = join(dir, `slice-${i}.wav`);
      const written = await extractSpeechSlice(deps.media, input.path, rangeToMs(slice), dest, ctx.signal);
      if (!written.ok) return written;
      paths.push({ path: dest });
    }
    return await jobs.run(audioDetectLanguageJob, { path: input.path, slices: paths }, toolJob(ctx));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function transcribeLocal(
  deps: AudioJobDeps,
  jobs: JobRunner,
  input: ToolClip,
  detected: DetectedLanguages,
  ctx: ToolContextBase,
): AsyncResult<Transcript> {
  const route = localRoute(deps, detected);
  if (route.engine === 'parakeet') {
    return jobs.run(audioTranscribeParakeetJob, { ...clipSource(input), language: route.language ?? 'en' }, toolJob(ctx));
  }
  const model = route.whisperModel ?? (deps.settings.tier() === 'minimum' ? 'small' : 'medium');
  return jobs.run(
    audioTranscribeWhisperJob,
    { ...clipSource(input), language: route.whisperLanguage ?? route.language ?? 'auto', model },
    toolJob(ctx),
  );
}

/** Measure, then the local or cloud transcript. Under 1 s of non-silent audio is not transcribed. */
export async function transcribeClip(
  deps: AudioJobDeps & { readonly jobs: JobRunner },
  cloud: boolean,
  input: ToolClip,
  ctx: ToolContextBase,
): AsyncResult<ToolTranscript> {
  const measured = await deps.jobs.run(audioMeasureJob, clipSource(input), toolJob(ctx));
  if (!measured.ok) return measured;
  if (measured.value.nonSilentMs < AUDIO_CONFIG.silence.minNonSilentMs) {
    return storeTranscript(ctx, silentTranscript(deps));
  }
  const detected = await detectForTool(deps, deps.jobs, input, measured.value, ctx);
  if (!detected.ok) return detected;
  if (!cloud) {
    const local = await transcribeLocal(deps, deps.jobs, input, detected.value, ctx);
    if (!local.ok) return local;
    return storeTranscript(ctx, local.value);
  }
  const hint = input.language && input.language !== 'auto' ? input.language : (detected.value.language ?? undefined);
  const remote = await deps.jobs.run(
    audioTranscribeCloudJob,
    { ...clipSource(input), ...(hint ? { language: hint } : {}) },
    toolJob(ctx),
  );
  if (!remote.ok) return remote;
  if ('skipped' in remote.value) {
    const local = await transcribeLocal(deps, deps.jobs, input, detected.value, ctx);
    if (!local.ok) return local;
    return storeTranscript(ctx, local.value, 'no_consent');
  }
  return storeTranscript(ctx, remote.value);
}

function frameAudible(startMs: number, endMs: number, stretches: readonly TimeRange[]): boolean {
  for (const stretch of stretches) {
    const span = rangeToMs(stretch);
    if (startMs < span.endMs && endMs > span.startMs) return true;
  }
  return false;
}

/** Measure, beats and a local transcript. Never calls the cloud transcribe job. */
export async function classifyClip(
  deps: AudioJobDeps & { readonly jobs: JobRunner },
  input: ToolClip,
  ctx: ToolContextBase,
): AsyncResult<AudioClassification> {
  const measured = await deps.jobs.run(audioMeasureJob, clipSource(input), toolJob(ctx));
  if (!measured.ok) return measured;
  const value = measured.value;
  if (value.nonSilentMs < AUDIO_CONFIG.silence.minNonSilentMs) {
    return ok(
      classifyAudio({
        speechRatio: 0,
        musicScore: 0,
        integratedLufs: value.integratedLufs,
        nonSilentRatio: value.nonSilentRatio,
      }),
    );
  }
  const beats = await deps.jobs.run(audioTrackBeatsJob, clipSource(input), toolJob(ctx));
  if (!beats.ok) return beats;
  const detected = await detectForTool(deps, deps.jobs, input, value, ctx);
  if (!detected.ok) return detected;
  const transcript = await transcribeLocal(deps, deps.jobs, input, detected.value, ctx);
  if (!transcript.ok) return transcript;
  const words = transcript.value.segments.flatMap((segment) => [...segment.words]);
  const origin = input.range ? rangeToMs(input.range).startMs : 0;
  const frameMs = 1000 / AUDIO_CONFIG.beats.fps;
  const peaks = beats.value.envelope.peaks;
  const nonSilent = peaks.map((_, index) =>
    frameAudible(origin + index * frameMs, origin + (index + 1) * frameMs, value.stretches),
  );
  const beatMs = beats.value.beatMap.beats.map((beat) => Math.round(RationalTime.toSeconds(beat) * 1000));
  const intervals: number[] = [];
  for (let i = 1; i < beatMs.length; i += 1) intervals.push((beatMs[i] ?? 0) - (beatMs[i - 1] ?? 0));
  let max = 0;
  for (const peak of peaks) if (peak > max) max = peak;
  const musicScore =
    max <= 0 ? 0 : musicScoreOf(peaks.map((peak) => peak / max), nonSilent, intervals);
  return ok(
    classifyAudio({
      speechRatio: speechRatioOf(words, value.durationMs),
      musicScore,
      integratedLufs: value.integratedLufs,
      nonSilentRatio: value.nonSilentRatio,
    }),
  );
}
