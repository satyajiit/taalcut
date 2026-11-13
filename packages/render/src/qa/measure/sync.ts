// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sound timing for avSync (docs/qa-gate.md, part 3): decoded 16 kHz mono PCM
 * of the render against each planned source window, normalised
 * cross-correlation over ±250 ms. A positive lag means the render's sound is
 * late. The drift is the slope of lag over time, read over 60 s.
 */
import { err, ok, RationalTime, type AsyncResult } from '@taalcut/core';
import { FfmpegFailed, runProcess, type MediaContext } from '@taalcut/media';
import { QA_THRESHOLDS } from '../thresholds.v1';

const RATE = QA_THRESHOLDS.sync.sampleRate;

/** Mono f32 PCM at 16 kHz from `startSeconds` for `seconds`; zero-padded before the file starts. */
export async function decodePcm(
  ctx: MediaContext,
  path: string,
  window: { readonly startSeconds: number; readonly seconds: number; readonly stream?: string },
  signal?: AbortSignal,
): AsyncResult<Float32Array> {
  const total = Math.round(window.seconds * RATE);
  const lead = window.startSeconds < 0 ? Math.min(total, Math.round(-window.startSeconds * RATE)) : 0;
  const start = Math.max(0, window.startSeconds);
  const seconds = window.seconds - lead / RATE;
  const out = new Float32Array(total);
  if (seconds <= 0) return ok(out);
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      // Output-side seek: decoded from the start and trimmed by timestamp, so sample-exact. An input
      // seek into AAC lands on a packet and is off by up to a frame (1024 samples, 21 ms), which is
      // the whole avSync tolerance.
      '-i',
      path,
      '-ss',
      start.toFixed(6),
      '-t',
      seconds.toFixed(6),
      '-map',
      window.stream ?? '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(RATE),
      '-f',
      'f32le',
      '-',
    ],
    {
      // Sound only: no video session (IX3-K2).
      holdsVideoSession: false,
      timeoutMs: 120_000,
      maxStdoutBytes: (total + 16) * 4 + 1024,
      ...(signal ? { signal } : {}),
    },
  );
  if (!result.ok) return result;
  if (result.value.exitCode !== 0)
    return err(
      FfmpegFailed(
        { exitCode: result.value.exitCode ?? -1 },
        { detail: result.value.stderrTail.slice(-1000) },
      ),
    );
  const bytes = result.value.stdout;
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  out.set(samples.subarray(0, total - lead), lead);
  return ok(out);
}

export interface Correlation {
  /** Render delay against the source, ms (positive: sound late). */
  readonly lagMs: number;
  /** Peak normalised correlation, 0..1. */
  readonly peak: number;
}

/**
 * Best lag of `render` (length W) within `source` (length W + 2·maxLag, centred on the planned position).
 * Pure; normalised by the energy of both overlapping parts, so gain doesn't matter.
 */
export function correlate(render: Float32Array, source: Float32Array, maxLagSamples: number): Correlation {
  const width = render.length;
  let renderEnergy = 0;
  for (let i = 0; i < width; i++) renderEnergy += render[i]! * render[i]!;
  // Energy of source[k .. k + width) for every k, by a running sum.
  let sourceEnergy = 0;
  for (let i = 0; i < width && i < source.length; i++) sourceEnergy += source[i]! * source[i]!;
  let best = { lag: 0, value: -Infinity };
  for (let k = 0; k <= 2 * maxLagSamples && k + width <= source.length; k++) {
    if (k > 0) {
      const leaving = source[k - 1]!;
      const entering = source[k + width - 1]!;
      sourceEnergy += entering * entering - leaving * leaving;
    }
    let dot = 0;
    for (let i = 0; i < width; i++) dot += render[i]! * source[k + i]!;
    const norm = Math.sqrt(renderEnergy * Math.max(sourceEnergy, 0));
    const value = norm > 1e-12 ? dot / norm : 0;
    if (value > best.value) best = { lag: k - maxLagSamples, value };
  }
  // The render matched source content `lag` samples later than planned: the render is early by `lag`.
  return { lagMs: (-best.lag * 1000) / RATE, peak: Math.max(0, best.value) };
}

export interface SyncWindow {
  /** Render seconds where the window starts. */
  readonly at: number;
  readonly seconds: number;
  readonly source: { readonly path: string; readonly offset: RationalTime };
}

/** Correlates each window; `offset` is the source's file time at render time zero (source = render + offset). */
export async function measureWindows(
  ctx: MediaContext,
  renderPath: string,
  windows: readonly SyncWindow[],
  signal?: AbortSignal,
): AsyncResult<(Correlation & { readonly at: number })[]> {
  const maxLag = Math.round((QA_THRESHOLDS.sync.maxLagMs / 1000) * RATE);
  const results: (Correlation & { at: number })[] = [];
  for (const window of windows) {
    const sourceStart = window.at + RationalTime.toSeconds(window.source.offset) - maxLag / RATE;
    const [render, source] = await Promise.all([
      decodePcm(ctx, renderPath, { startSeconds: window.at, seconds: window.seconds }, signal),
      decodePcm(
        ctx,
        window.source.path,
        { startSeconds: sourceStart, seconds: window.seconds + (2 * maxLag) / RATE },
        signal,
      ),
    ]);
    if (!render.ok) return render;
    if (!source.ok) return source;
    results.push({ ...correlate(render.value, source.value, maxLag), at: window.at });
  }
  return ok(results);
}

/** Least-squares slope of lag (ms) over time (s), as ms over `overSeconds`; 0 with fewer than 2 points. */
export function driftOver(
  points: readonly { readonly at: number; readonly lagMs: number }[],
  overSeconds: number,
): number {
  if (points.length < 2) return 0;
  const n = points.length;
  const meanT = points.reduce((sum, point) => sum + point.at, 0) / n;
  const meanL = points.reduce((sum, point) => sum + point.lagMs, 0) / n;
  let num = 0;
  let den = 0;
  for (const point of points) {
    num += (point.at - meanT) * (point.lagMs - meanL);
    den += (point.at - meanT) ** 2;
  }
  return den > 0 ? (num / den) * overSeconds : 0;
}
