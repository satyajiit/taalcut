// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * mixAudio: an AudioMixPlan to an AAC track of exactly the planned length,
 * at the preset's loudness (SPEC section 8). Three FFmpeg runs:
 *
 * 1. render the graph once to 32-bit float WAV (sample-exact, no clipping);
 * 2. loudnorm pass 1 measures it;
 * 3. pass 2 applies the measured gain (linear), resamples back to 48 kHz,
 *    trims and pads to the exact count, and encodes with FFmpeg's native
 *    `aac`. Its 1024-sample priming is cancelled by the MP4 edit list;
 *    `aac_at` would add 2112 samples and is not used.
 *
 * A plan that is silent on purpose skips loudness and writes an `anullsrc`
 * track of exact length, so the file still has the audio stream platforms
 * expect.
 */
import { rm } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import { err, ok, ValidationError, type AsyncResult } from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import {
  asCoreError,
  isSilent,
  loudnormPass1,
  loudnormPass2Filter,
  measureLoudness,
  type LoudnessMeasure,
  type LoudnessTarget,
} from './loudness';
import { MIX_SAMPLE_RATE, mixFilterGraph, type AudioMixPlan } from './mix-plan';

export interface MixOptions {
  /** The AAC file to write (.m4a). */
  readonly out: string;
  readonly signal?: AbortSignal;
  /** Fraction done, 0 to 1. */
  readonly onProgress?: (fraction: number) => void;
  readonly loudness: LoudnessTarget;
  readonly bitrateKbps: number;
  readonly sampleRate: typeof MIX_SAMPLE_RATE;
  /** Where the intermediate WAV goes (default: next to `out`). */
  readonly workDir?: string;
  /** Records the CPU audio path once per process (createAudioFallbackReporter). */
  readonly reportFallback?: () => void;
  /** The plan's graph as built elsewhere (bused with ducking envelopes, mix-graph.ts); default mixFilterGraph. */
  readonly graph?: string;
}

export interface MixResult {
  readonly path: string;
  readonly samples: number;
  /** EBU R128 of the written file; null for a silent track. */
  readonly measured: LoudnessMeasure | null;
}

const LONG_RUN_MS = 30 * 60_000;

function runOptions(signal: AbortSignal | undefined, extra: Record<string, unknown> = {}) {
  // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
  return { holdsVideoSession: false, timeoutMs: LONG_RUN_MS, ...(signal ? { signal } : {}), ...extra };
}

/** Progress of one run as a slice [from, to] of the whole mix. */
function slice(options: { readonly onProgress?: (fraction: number) => void }, from: number, to: number) {
  const report = options.onProgress;
  if (!report) return {};
  return {
    onProgress: (progress: { readonly percent?: number; readonly done: boolean }) =>
      report(from + ((to - from) * (progress.done ? 100 : (progress.percent ?? 0))) / 100),
  };
}

const exactLength = (samples: number) => `apad=whole_len=${samples},atrim=end_sample=${samples}`;
const aacArgs = (bitrateKbps: number) => [
  '-c:a',
  'aac',
  '-b:a',
  `${bitrateKbps}k`,
  '-ar',
  '48000',
  '-ac',
  '2',
];

/** Step 1 alone: the plan's graph to float WAV, exactly `totalSamples` long. Tests read it sample by sample. */
export async function renderMix(
  mix: AudioMixPlan,
  ctx: MediaContext,
  options: {
    readonly out: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (fraction: number) => void;
    /** A graph over the plan's segments (one input each) ending in `[mix]`; default mixFilterGraph. */
    readonly graph?: string;
  },
): AsyncResult<{ readonly path: string; readonly samples: number }> {
  if (mix.totalSamples <= 0) return err(ValidationError({ field: 'totalSamples' }));
  const inputs = mix.segments.flatMap((segment) => ['-i', segment.path]);
  const args =
    mix.segments.length === 0
      ? ['-f', 'lavfi', '-i', `anullsrc=r=${MIX_SAMPLE_RATE}:cl=stereo`, '-af', exactLength(mix.totalSamples)]
      : [...inputs, '-filter_complex', options.graph ?? mixFilterGraph(mix), '-map', '[mix]'];
  const run = await runFfmpeg(
    ctx,
    ['-y', ...args, '-c:a', 'pcm_f32le', '-ar', '48000', '-ac', '2', options.out],
    {
      ...runOptions(options.signal),
      duration: { value: mix.totalSamples, rate: MIX_SAMPLE_RATE },
      ...slice(options, 0, 1),
    },
  );
  if (!run.ok) return err(asCoreError(run.error));
  return ok({ path: options.out, samples: mix.totalSamples });
}

/** Two loudnorm passes from `input` (any file with audio) to an AAC file of `samples` samples. */
async function normaliseTo(
  input: string,
  ctx: MediaContext,
  options: MixOptions & { readonly samples: number },
  progress: { readonly from: number },
): AsyncResult<MixResult> {
  options.reportFallback?.();
  const span = 1 - progress.from;
  const stats = await loudnormPass1(
    ctx,
    input,
    options.loudness,
    options.signal ? { signal: options.signal } : {},
  );
  if (!stats.ok) return stats;
  options.onProgress?.(progress.from + span * 0.4);
  const exact = [exactLength(options.samples)];
  // Digital silence (or under the absolute gate) has no loudness to correct: encode it as it is.
  const filters = isSilent(stats.value)
    ? ['aresample=48000', 'asetpts=N/SR/TB', ...exact]
    : [loudnormPass2Filter(options.loudness, stats.value), 'aresample=48000', 'asetpts=N/SR/TB', ...exact];
  const encode = await runFfmpeg(
    ctx,
    [
      '-y',
      '-i',
      input,
      '-map',
      '0:a:0',
      '-af',
      filters.join(','),
      ...aacArgs(options.bitrateKbps),
      options.out,
    ],
    {
      ...runOptions(options.signal),
      duration: { value: options.samples, rate: MIX_SAMPLE_RATE },
      ...slice(options, progress.from + span * 0.4, progress.from + span * 0.9),
    },
  );
  if (!encode.ok) return err(asCoreError(encode.error));
  const measured = await measureLoudness(ctx, options.out, options.signal ? { signal: options.signal } : {});
  if (!measured.ok) return measured;
  options.onProgress?.(1);
  return ok({ path: options.out, samples: options.samples, measured: measured.value });
}

/** The plan's sound as one loudness-normalised AAC track of exact length. */
export async function mixAudio(
  mix: AudioMixPlan,
  ctx: MediaContext,
  options: MixOptions,
): AsyncResult<MixResult> {
  if (mix.totalSamples <= 0) return err(ValidationError({ field: 'totalSamples' }));
  if (mix.silent) {
    const silence = await runFfmpeg(
      ctx,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=${MIX_SAMPLE_RATE}:cl=stereo`,
        '-af',
        exactLength(mix.totalSamples),
        ...aacArgs(options.bitrateKbps),
        options.out,
      ],
      runOptions(options.signal),
    );
    if (!silence.ok) return err(asCoreError(silence.error));
    options.onProgress?.(1);
    return ok({ path: options.out, samples: mix.totalSamples, measured: null });
  }
  const wav = join(options.workDir ?? dirname(options.out), `${basename(options.out)}.mix.wav`);
  try {
    const rendered = await renderMix(mix, ctx, {
      out: wav,
      ...(options.graph ? { graph: options.graph } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: (f: number) => options.onProgress?.(f * 0.5) } : {}),
    });
    if (!rendered.ok) return rendered;
    return await normaliseTo(wav, ctx, { ...options, samples: mix.totalSamples }, { from: 0.5 });
  } finally {
    await rm(wav, { force: true });
  }
}

/**
 * QA's `renormaliseAudio` auto fix: a fresh two-pass normalisation of a file's first audio stream (the
 * muxed render or the mixed track), written as a new AAC file. Video is untouched; remux afterwards.
 */
export async function renormaliseAudio(
  file: string,
  ctx: MediaContext,
  /** `samples`: the render's exact sample count, round(N · 48000 · den / num). */
  options: Omit<MixOptions, 'sampleRate' | 'workDir'> & { readonly samples: number },
): AsyncResult<MixResult> {
  return normaliseTo(file, ctx, { ...options, sampleRate: MIX_SAMPLE_RATE }, { from: 0 });
}

/**
 * Puts a mixed track under a silent picture: stream copy, audio and video both from 0 (the AAC edit
 * list cancels the priming), moov first. `videoBitstreamFilter` lets the finishing stage tag colour
 * (h264_metadata) in the same pass.
 */
export async function muxAudio(
  videoFile: string,
  audioFile: string,
  out: string,
  ctx: MediaContext,
  options: {
    readonly signal?: AbortSignal;
    readonly videoBitstreamFilter?: string;
    /** The copied video's colour options (`-color_primaries` …): the stream's and the MP4 `colr` box's values. */
    readonly videoColour?: readonly string[];
  } = {},
): AsyncResult<{ readonly path: string }> {
  const run = await runFfmpeg(
    ctx,
    [
      '-y',
      '-i',
      videoFile,
      '-i',
      audioFile,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c',
      'copy',
      ...(options.videoBitstreamFilter ? ['-bsf:v', options.videoBitstreamFilter] : []),
      ...(options.videoColour ?? []),
      '-movflags',
      '+faststart+write_colr',
      '-fflags',
      '+bitexact',
      out,
    ],
    runOptions(options.signal),
  );
  if (!run.ok) return err(asCoreError(run.error));
  return ok({ path: out });
}
