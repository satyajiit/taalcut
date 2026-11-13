// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Loudness through FFmpeg: EBU R128 measurement (ebur128 with true peak)
 * and loudnorm's two passes. FFmpeg has no GPU audio filters, so this is
 * ADR 0002's accepted CPU exception, recorded once per process by the
 * reporter the composition root makes (createAudioFallbackReporter).
 */
import {
  CancelledError,
  computeFallbackEvent,
  cpuFallback,
  defineError,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type TaalcutError,
} from '@taalcut/core';
import { MediaCancelled, runFfmpeg, type MediaContext } from '@taalcut/media';
import { platformGpu } from '../engine/video-route';

/** FFmpeg ran but printed no measurement we could read (an empty or broken stream). */
export const LoudnessUnmeasured = defineError('render.loudness_unmeasured');

/** Room left under the preset's true-peak ceiling for the AAC encode's overshoot (research section 3). */
export const AAC_HEADROOM_DB = 0.5;
/** loudnorm's loudness-range target: wide, so linear normalisation is rarely refused for range. */
export const LOUDNORM_LRA = 20;
/** Below this the mix is treated as silence: loudnorm has nothing to measure. */
export const SILENCE_LUFS = -70;

export interface LoudnessTarget {
  readonly integratedLufs: number;
  readonly truePeakDbtp: number;
}

export interface LoudnessMeasure {
  readonly integratedLufs: number;
  readonly truePeakDbtp: number;
  readonly lra: number;
}

/** loudnorm's first-pass JSON, the values its second pass takes. */
export interface LoudnormStats {
  readonly inputI: number;
  readonly inputTp: number;
  readonly inputLra: number;
  readonly inputThresh: number;
  readonly targetOffset: number;
}

/** Media's cancellation as core's, which is what render's callers expect. */
export function asCoreError(error: TaalcutError): TaalcutError {
  return MediaCancelled.is(error) ? CancelledError() : error;
}

/** One `compute.fallback` for audio per process: the root makes one reporter and hands it to every mix. */
export function createAudioFallbackReporter(
  onFallback?: (event: ComputeFallbackEvent) => void,
  platform: NodeJS.Platform = process.platform,
): () => void {
  let reported = false;
  return () => {
    if (reported || !onFallback) return;
    reported = true;
    const choice = cpuFallback('no_accelerator', 'FFmpeg has no GPU audio filters (loudnorm, amix, ebur128)');
    if (choice.backend === 'cpu')
      onFallback(computeFallbackEvent('render.audioMix', platformGpu(platform), choice.fallback));
  };
}

const number = (text: string | undefined): number => {
  if (text === undefined) return Number.NaN;
  if (/^-inf/.test(text.trim())) return Number.NEGATIVE_INFINITY;
  if (/^\+?inf/.test(text.trim())) return Number.POSITIVE_INFINITY;
  return Number(text);
};

/** The summary ebur128 prints at the end of a run. */
export function parseEbur128Summary(stderr: string): LoudnessMeasure | null {
  const at = stderr.lastIndexOf('Summary:');
  if (at < 0) return null;
  const summary = stderr.slice(at);
  const integrated = /I:\s+(\S+)\s+LUFS/.exec(summary)?.[1];
  const lra = /LRA:\s+(\S+)\s+LU/.exec(summary)?.[1];
  const peak = /Peak:\s+(\S+)\s+dBFS/.exec(summary)?.[1];
  const measure = { integratedLufs: number(integrated), truePeakDbtp: number(peak), lra: number(lra) };
  return Object.values(measure).some(Number.isNaN) ? null : measure;
}

/** The JSON block loudnorm prints with print_format=json. */
export function parseLoudnormJson(stderr: string): LoudnormStats | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const json = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const stats = {
      inputI: number(json.input_i),
      inputTp: number(json.input_tp),
      inputLra: number(json.input_lra),
      inputThresh: number(json.input_thresh),
      targetOffset: number(json.target_offset),
    };
    return Object.values(stats).some(Number.isNaN) ? null : stats;
  } catch {
    return null;
  }
}

/** The first audio stream's EBU R128 loudness. TODO(media): media's measureLoudness (P2-L5) replaces this. */
export async function measureLoudness(
  ctx: MediaContext,
  path: string,
  options: { readonly signal?: AbortSignal } = {},
): AsyncResult<LoudnessMeasure> {
  const run = await runFfmpeg(
    ctx,
    ['-v', 'info', '-i', path, '-map', '0:a:0', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'],
    {
      holdsVideoSession: false,
      stderrTailBytes: 16_384,
      timeoutMs: 600_000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!run.ok) return err(asCoreError(run.error));
  const measure = parseEbur128Summary(run.value.stderrTail);
  return measure
    ? ok(measure)
    : err(LoudnessUnmeasured(undefined, { detail: run.value.stderrTail.slice(-2000) }));
}

/** The loudnorm filter both passes share: the target, with headroom under the preset's true peak. */
export function loudnormTarget(target: LoudnessTarget): string {
  const truePeak = (target.truePeakDbtp - AAC_HEADROOM_DB).toFixed(1);
  return `loudnorm=I=${target.integratedLufs}:TP=${truePeak}:LRA=${LOUDNORM_LRA}`;
}

/** Pass 1: what loudnorm measures on the first audio stream. */
export async function loudnormPass1(
  ctx: MediaContext,
  path: string,
  target: LoudnessTarget,
  options: { readonly signal?: AbortSignal } = {},
): AsyncResult<LoudnormStats> {
  const run = await runFfmpeg(
    ctx,
    [
      '-v',
      'info',
      '-i',
      path,
      '-map',
      '0:a:0',
      '-af',
      `${loudnormTarget(target)}:print_format=json`,
      '-f',
      'null',
      '-',
    ],
    {
      holdsVideoSession: false,
      stderrTailBytes: 16_384,
      timeoutMs: 600_000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  if (!run.ok) return err(asCoreError(run.error));
  const stats = parseLoudnormJson(run.value.stderrTail);
  return stats
    ? ok(stats)
    : err(LoudnessUnmeasured(undefined, { detail: run.value.stderrTail.slice(-2000) }));
}

/** Pass 2: linear gain from pass 1's measurements (loudnorm itself falls back to dynamic when it must). */
export function loudnormPass2Filter(target: LoudnessTarget, stats: LoudnormStats): string {
  const fixed = (value: number) => value.toFixed(2);
  return (
    `${loudnormTarget(target)}:measured_I=${fixed(stats.inputI)}:measured_TP=${fixed(stats.inputTp)}` +
    `:measured_LRA=${fixed(stats.inputLra)}:measured_thresh=${fixed(stats.inputThresh)}` +
    `:offset=${fixed(stats.targetOffset)}:linear=true:print_format=summary`
  );
}

/** True when there is nothing to normalise: digital silence or a level under the R128 absolute gate. */
export function isSilent(stats: LoudnormStats): boolean {
  return !Number.isFinite(stats.inputI) || stats.inputI < SILENCE_LUFS;
}
