// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Clips whose pictures say when they are (IX2 keyframe tests): every frame
 * one flat grey whose level is its frame number (or its GOP number), encoded
 * with a fixed keyframe interval by the software encoder; the keyframes a file
 * really has, from ffprobe's packet flags (no decode); and the mean level of
 * a raw yuv420p frame's luma plane.
 */
import {
  keyframeTimes as listKeyframeTimes,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { unwrap } from '@taalcut/core';
import { planClip, renderClip } from './clip';

export interface PlannedClip {
  readonly path: string;
  readonly plan: NormalisationPlan;
}

/** Encodes `args` to `path` and plans the result; throws when either fails (a fixture the suite needs). */
export async function plannedClip(
  ctx: MediaContext,
  path: string,
  args: readonly string[],
): Promise<PlannedClip> {
  if (!(await renderClip(ctx, path, args))) throw new Error(`fixture ${path} was not encoded`);
  const plan = await planClip(path, ctx);
  if (!plan.ok) throw new Error(`fixture ${path}: ${plan.error.code}`);
  return { path, plan: plan.value };
}

/** Luma of frame `n`: black (16) for the first `blackFrames`, then two levels a frame. */
export function rampLevel(n: number, blackFrames: number): number {
  return n < blackFrames ? 16 : 16 + 2 * n;
}

/**
 * libopenh264 arguments for a flat-grey clip: `level` is a geq expression of N. `-g` sets the keyframe interval;
 * scene-change keyframes would be at a frame anyway, and the tests read the real ones back.
 */
export function greyClipArgs(spec: {
  readonly size: string;
  readonly fps: number;
  readonly seconds: number;
  readonly gop: number;
  readonly level: string;
  readonly encoder: readonly string[];
}): string[] {
  return [
    ...['-f', 'lavfi', '-i', `nullsrc=size=${spec.size}:rate=${spec.fps}`, '-t', String(spec.seconds)],
    ...['-vf', `geq=lum='${spec.level}':cb=128:cr=128,format=yuv420p`],
    ...spec.encoder,
    ...['-b:v', '2M', '-g', String(spec.gop), '-bf', '0'],
  ];
}

/** Seconds of every keyframe packet of the first video stream (media's `keyframeTimes`, failing the test). */
export const keyframeTimes = async (ctx: MediaContext, path: string): Promise<number[]> =>
  unwrap(await listKeyframeTimes(ctx, path));

/** The first keyframe at or after each target, distinct, in order. */
export function firstKeyframesAtOrAfter(keyframes: readonly number[], targets: readonly number[]): number[] {
  const picked = targets.flatMap((target) => keyframes.find((k) => k >= target - 0.001) ?? []);
  return [...new Set(picked)];
}

/** Mean of the luma plane of one raw yuv420p frame. */
export function meanLuma(frame: Buffer, width: number, height: number): number {
  let sum = 0;
  for (let i = 0; i < width * height; i++) sum += frame[i] ?? 0;
  return sum / (width * height);
}
