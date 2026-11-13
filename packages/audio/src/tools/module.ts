// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Audio analysis jobs and local DSP planning queries. Classify never uploads. */
import {
  defineTool,
  defineToolModule,
  forwardJobProgress,
  NO_TOOL_RETRY,
  ok,
  type JobRunner,
  type TimeRange,
  type ToolContextBase,
  type ToolModule,
} from '@taalcut/core';
import { fileFingerprint } from '@taalcut/media';
import type { AudioJobDeps } from '../jobs/deps';
import { rangeKey } from '../idempotency';
import { classifyClip, transcribeClip } from '../jobs/handlers';
import { audioMeasureJob, audioTrackBeatsJob } from '../jobs/kinds';
import { rangeToMs } from '../rates';
import { createRecommendDspChainTool, createSnapToGrooveTool } from './dsp-synth-tools';
import {
  classifyInputSchema,
  classifyOutputSchema,
  measureLoudnessInputSchema,
  measureLoudnessOutputSchema,
  trackBeatsInputSchema,
  trackBeatsOutputSchema,
  transcribeInputSchema,
  transcribeOutputSchema,
  type TrackBeatsOutput,
} from './schemas';

export interface AudioToolDeps extends AudioJobDeps {
  readonly jobs: JobRunner;
}

/** The tool input has no duration, so cloud cost is estimated for one minute. */
const ESTIMATE_MS = 60_000;
const HOUR_MS = 3_600_000;
const SPILL_BYTES = 8192;
const LOCAL_RETRY = { maxAttempts: 2, initialDelayMs: 1000 };
const READ = ['library', 'user-selected', 'scratch'] as const;
const TRANSCRIBE_SUMMARY =
  'Transcribes speech with word timings, picking the engine by the detected language.';

function repeatKey(path: string, range: TimeRange | undefined, language = '-'): string {
  return `${fileFingerprint(path)}:${rangeKey(range ? rangeToMs(range) : undefined)}:${language}`;
}

function sourceOf(input: { path: string; range?: TimeRange }): { path: string; range?: TimeRange } {
  return input.range ? { path: input.path, range: input.range } : { path: input.path };
}

function jobOptions(ctx: ToolContextBase) {
  return { signal: ctx.signal, onProgress: forwardJobProgress(ctx.reportProgress) };
}

function beatLine(output: TrackBeatsOutput): string {
  const spilled = 'summary' in output;
  const bpm = spilled ? output.summary.bpm : output.beatMap.bpm;
  const beats = spilled ? output.summary.beatCount : output.beatMap.beats.length;
  const downbeats = spilled ? output.summary.downbeatCount : output.beatMap.downbeats.length;
  const confidence = spilled ? output.summary.confidence : output.beatMap.confidence;
  const flags = output.flags.length > 0 ? output.flags.join(', ') : 'none';
  const tempo = bpm === null ? 'unknown bpm' : `${bpm} bpm`;
  return `${tempo}, ${beats} beats, ${downbeats} downbeats, confidence ${confidence}, flags ${flags}`;
}

function trackBeatsTool(deps: AudioToolDeps) {
  return defineTool({
    name: 'audio.trackBeats',
    version: '1.0.0',
    summary:
      "Finds the beats, downbeats and tempo of a song or a video's sound, checked against onset strength.",
    description:
      "Finds the beats, downbeats and tempo of a song or a video's sound, checked against onset strength. " +
      "Use it for a music bed or the user's own track. A map larger than 8 KiB is stored as an artifact.",
    tags: ['beats', 'tempo', 'downbeat', 'onset'],
    input: trackBeatsInputSchema,
    output: trackBeatsOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 180_000,
    retry: LOCAL_RETRY,
    permission: { filesystem: { read: READ }, network: 'none' },
    cache: { ttlMs: HOUR_MS },
    idempotencyKey: (input) => repeatKey(input.path, input.range),
    summarize: (output) => beatLine(output),
    run: async (input, ctx) => {
      const result = await deps.jobs.run(audioTrackBeatsJob, sourceOf(input), jobOptions(ctx));
      if (!result.ok) return result;
      const value = result.value;
      const flags = [...value.flags];
      const full = { beatMap: value.beatMap, downbeatSource: value.downbeatSource, flags };
      if (JSON.stringify(value).length <= SPILL_BYTES) return ok(full);
      const stored = await ctx.artifacts.put({
        mediaType: 'application/json',
        data: JSON.stringify(value),
        summary: beatLine(full),
      });
      if (!stored.ok) return stored;
      return ok({
        artifact: stored.value,
        downbeatSource: value.downbeatSource,
        flags,
        summary: {
          bpm: value.beatMap.bpm,
          beatCount: value.beatMap.beats.length,
          downbeatCount: value.beatMap.downbeats.length,
          confidence: value.beatMap.confidence,
          flags,
        },
      });
    },
  });
}

function transcribeTool(deps: AudioToolDeps, cloud: boolean) {
  const shared = {
    name: 'audio.transcribe',
    version: '1.0.0',
    summary: TRANSCRIBE_SUMMARY,
    tags: ['speech', 'transcript', 'words', 'language', ...(cloud ? (['upload'] as const) : [])],
    input: transcribeInputSchema,
    output: transcribeOutputSchema,
    timeoutMs: 900_000,
    idempotencyKey: (input: { path: string; range?: TimeRange; language?: string }) =>
      repeatKey(input.path, input.range, input.language ?? '-'),
    run: (
      input: { path: string; range?: TimeRange; language?: 'auto' | 'en' | 'es' | 'pt-BR' | 'hi' },
      ctx: ToolContextBase,
    ) => transcribeClip(deps, cloud, input, ctx),
  };
  if (!cloud) {
    return defineTool({
      ...shared,
      description: `${TRANSCRIBE_SUMMARY} Runs on this Mac; nothing leaves the device.`,
      costClass: 'local',
      sideEffect: 'read',
      retry: LOCAL_RETRY,
      permission: { filesystem: { read: READ }, network: 'none' },
      cache: { ttlMs: HOUR_MS },
    });
  }
  return defineTool({
    ...shared,
    description:
      `${TRANSCRIBE_SUMMARY} Sends the audio to the cloud speech model when upload is allowed; ` +
      'if consent is missing, the local engine runs and the result says why.',
    costClass: 'cloud',
    sideEffect: 'external',
    retry: NO_TOOL_RETRY,
    permission: {
      filesystem: { read: READ },
      network: 'internet',
      cloudModules: ['speech'],
      uploads: { what: 'user-media', consent: 'first-use' },
    },
    estimateCost: () => {
      const estimate = deps.cloud?.estimate(ESTIMATE_MS);
      const basis = estimate
        ? `${estimate.provider}/${estimate.model} for ${ESTIMATE_MS} ms; the input has no duration, so this is a one-minute stand-in`
        : `no cloud speech estimate; ${ESTIMATE_MS} ms stand-in because the input has no duration`;
      return { usd: estimate?.usd ?? 0, basis };
    },
  });
}

function classifyTool(deps: AudioToolDeps) {
  return defineTool({
    name: 'audio.classifyAudio',
    version: '1.0.0',
    summary: "Says whether a clip's sound is music, voice, original sound or a mix, with the evidence.",
    description:
      "Says whether a clip's sound is music, voice, original sound or a mix, with the evidence. " +
      'Stays on this Mac even when speech is set to a cloud model.',
    tags: ['classify', 'music', 'voice', 'silence'],
    input: classifyInputSchema,
    output: classifyOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 300_000,
    retry: LOCAL_RETRY,
    permission: { filesystem: { read: READ }, network: 'none' },
    cache: { ttlMs: HOUR_MS },
    idempotencyKey: (input) => repeatKey(input.path, input.range),
    run: (input, ctx) => classifyClip(deps, input, ctx),
  });
}

function loudnessTool(deps: AudioToolDeps) {
  return defineTool({
    name: 'audio.measureLoudness',
    version: '1.0.0',
    summary: 'Measures integrated loudness (LUFS), loudness range and true peak of a file.',
    description:
      'Measures integrated loudness (LUFS), loudness range and true peak of a file. ' +
      'Nothing is uploaded. An optional range limits the measurement.',
    tags: ['loudness', 'lufs', 'peak'],
    input: measureLoudnessInputSchema,
    output: measureLoudnessOutputSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 120_000,
    retry: LOCAL_RETRY,
    permission: { filesystem: { read: READ }, network: 'none' },
    cache: { ttlMs: HOUR_MS },
    idempotencyKey: (input) => repeatKey(input.path, input.range),
    run: async (input, ctx) => {
      const result = await deps.jobs.run(audioMeasureJob, sourceOf(input), jobOptions(ctx));
      if (!result.ok) return result;
      return ok({
        integratedLufs: result.value.integratedLufs,
        loudnessRange: result.value.loudnessRange,
        truePeakDbtp: result.value.truePeakDbtp,
      });
    },
  });
}

export function audioToolModule(deps: AudioToolDeps): ToolModule {
  const cloud = Boolean(deps.cloud?.cloudFirst()) && !deps.settings.localOnly();
  return defineToolModule({
    id: 'audio',
    tools: [
      trackBeatsTool(deps),
      transcribeTool(deps, cloud),
      classifyTool(deps),
      loudnessTool(deps),
      createRecommendDspChainTool(),
      createSnapToGrooveTool(),
    ],
  });
}
