// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Loudness, non-silent stretches and up to three 10 s slices. */
import { basename } from 'node:path';
import { err, ok, RationalTime, type AsyncResult, type TimeRange } from '@taalcut/core';
import { measureLoudness, type MediaContext } from '@taalcut/media';
import { AUDIO_CONFIG } from '../config';
import { NoAudio } from '../errors';
import { msRange, rangeToMs } from '../rates';
import { detectSilences } from './silence';
import type { AudioPlan, LoudnessReading, MeasureResult } from './types';

function planOffsetMs(plan: AudioPlan | undefined): number {
  if (!plan?.audioStart) return 0;
  return Math.round(RationalTime.toSeconds(plan.audioStart) * 1000);
}

export function stretchesOf(
  durationMs: number,
  silences: readonly { startMs: number; endMs: number }[],
  originMs: number,
): TimeRange[] {
  const sorted = [...silences].sort((a, b) => a.startMs - b.startMs);
  const stretches: TimeRange[] = [];
  let cursor = 0;
  for (const silence of sorted) {
    const start = Math.min(durationMs, Math.max(0, silence.startMs));
    const end = Math.min(durationMs, Math.max(0, silence.endMs));
    if (start - cursor >= 1) stretches.push(msRange(originMs + cursor, start - cursor));
    cursor = Math.max(cursor, end);
  }
  if (durationMs - cursor >= 1) stretches.push(msRange(originMs + cursor, durationMs - cursor));
  return stretches;
}

/** A slice stays inside one stretch. A stretch longer than 10 s yields its first 10 s, then the rest. */
function slicesOf(stretches: readonly TimeRange[]): TimeRange[] {
  const slices: TimeRange[] = [];
  const size = AUDIO_CONFIG.language.sliceMs;
  const max = AUDIO_CONFIG.language.maxSlices;
  for (const stretch of stretches) {
    const span = rangeToMs(stretch);
    let cursor = span.startMs;
    while (slices.length < max && span.endMs - cursor >= 1) {
      const duration = Math.min(size, span.endMs - cursor);
      slices.push(msRange(cursor, duration));
      cursor += duration;
    }
  }
  return slices;
}

export async function measureAudio(
  path: string,
  plan: AudioPlan | undefined,
  ctx: MediaContext,
  options?: { signal?: AbortSignal; range?: TimeRange },
): AsyncResult<MeasureResult> {
  const range = options?.range ? rangeToMs(options.range) : undefined;
  const window = { ...(options?.signal ? { signal: options.signal } : {}), ...(range ? { range } : {}) };
  const [loudness, silences] = await Promise.all([
    readLoudness(path, ctx, options),
    detectSilences(ctx, path, window),
  ]);
  if (!loudness.ok) return loudness;
  if (!silences.ok) return silences;
  const originMs = (range?.startMs ?? 0) + planOffsetMs(plan);
  const stretches = stretchesOf(silences.value.durationMs, silences.value.silences, originMs);
  let nonSilentMs = 0;
  for (const stretch of stretches) {
    const span = rangeToMs(stretch);
    nonSilentMs += span.endMs - span.startMs;
  }
  const durationMs = silences.value.durationMs;
  return ok({
    ...loudness.value,
    durationMs,
    nonSilentMs,
    nonSilentRatio: durationMs === 0 ? 0 : nonSilentMs / durationMs,
    stretches,
    slices: slicesOf(stretches),
  });
}

/** JSON and `z.number()` reject Infinity. ±120 keeps the sign and the −50 LUFS rule. */
export function finiteLoudness(value: number): number {
  if (Number.isFinite(value)) return value;
  return value < 0 ? -120 : 120;
}

function readLoudness(
  path: string,
  ctx: MediaContext,
  options?: { signal?: AbortSignal; range?: TimeRange },
): AsyncResult<LoudnessReading> {
  return measureLoudness(path, ctx, {
    ...(options?.signal ? { signal: options.signal } : {}),
    ...(options?.range ? { range: options.range } : {}),
  }).then((reading) => {
    if (!reading.ok) {
      const detail = reading.error.detail ?? '';
      const missing =
        reading.error.code === 'media.file_not_found' ||
        reading.error.code === 'media.unsupported_media' ||
        /does not contain any stream|matches no streams|no audio stream|ebur128 summary missing/i.test(
          detail,
        );
      if (missing) return err(NoAudio({ name: basename(path) || path }, detail ? { detail } : {}));
      return reading;
    }
    return ok({
      integratedLufs: finiteLoudness(reading.value.integratedLufs),
      loudnessRange: finiteLoudness(reading.value.loudnessRange),
      truePeakDbtp: finiteLoudness(reading.value.truePeakDbtp),
    });
  });
}
