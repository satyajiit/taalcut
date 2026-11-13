// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Audio fixtures and readers for the mix and music-path suites: lavfi sources, PCM decode, alignment. */
import { join } from 'node:path';
import { runProcess, type MediaContext } from '@taalcut/media';
import { planTimeline } from '../../src/plan/render-plan';
import type { RenderPlan } from '../../src/plan/types';
import { ffmpeg } from '../support/media';
import { makeTimeline, type TimelineSpec } from '../support/timeline';

/** A plan from a test timeline (throws if planning fails: the fixtures are always valid). */
export function planOf(spec: TimelineSpec): RenderPlan {
  const plan = planTimeline(makeTimeline(spec));
  if (!plan.ok) throw new Error(plan.error.code);
  return plan.value;
}

/** A 48 kHz stereo float WAV from an aevalsrc expression of n (the sample number), `samples` long. */
export async function evalWav(ctx: MediaContext, dir: string, name: string, expr: string, samples: number) {
  const path = join(dir, `${name}.wav`);
  await ffmpeg(ctx, [
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='${expr}':s=48000:c=stereo`,
    '-af',
    `atrim=end_sample=${samples}`,
    '-c:a',
    'pcm_f32le',
    path,
  ]);
  return path;
}

/** A rectangular pulse of `width` samples at `at`, over an optional quiet bed: an exact onset to look for. */
export const pulseAt = (at: number, height = 0.5, width = 48, bed = '0') =>
  `if(between(n,${at},${at + width - 1}),${height},0)+${bed}`;

/**
 * A file's first audio stream's left channel as float samples at 48 kHz (edit list applied). The left
 * channel, not a downmix: FFmpeg's stereo-to-mono matrix scales by 1/√2 per channel.
 */
export async function decodePcm(ctx: MediaContext, path: string): Promise<Float32Array> {
  const result = await runProcess(
    ctx.binaries.ffmpeg,
    ['-v', 'error', '-i', path, '-map', '0:a:0', '-af', 'pan=mono|c0=c0', '-ar', '48000', '-f', 'f32le', '-'],
    { timeoutMs: 120_000, maxStdoutBytes: 128 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`decode failed: ${result.error.code}`);
  const bytes = result.value.stdout;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/** The first sample whose magnitude passes `threshold` at or after `from`. */
export function onset(pcm: Float32Array, threshold: number, from = 0): number {
  for (let i = from; i < pcm.length; i++) if (Math.abs(pcm[i]!) > threshold) return i;
  return -1;
}

export function peak(pcm: Float32Array, from = 0, to = pcm.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(pcm[i]!));
  return max;
}

export function rms(pcm: Float32Array, from = 0, to = pcm.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** The lag (b relative to a) in [−range, range] with the highest normalised cross-correlation. */
export function bestLag(a: Float32Array, b: Float32Array, range: number): { lag: number; score: number } {
  let best = { lag: 0, score: -Infinity };
  const length = Math.min(a.length, b.length);
  for (let lag = -range; lag <= range; lag++) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = Math.max(0, -lag); i < length - Math.max(0, lag); i++) {
      const x = a[i]!;
      const y = b[i + lag]!;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    const score = dot / Math.sqrt(na * nb || 1);
    if (score > best.score) best = { lag, score };
  }
  return best;
}
