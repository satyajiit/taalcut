// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The frames the poster is picked from (IX2-T2). First choice: the first
 * keyframe at or after 10, 30, 50, 70 and 90 % of the clip, decoded alone
 * (`decodeKeyframes`: no picture between keyframes is decoded). A clip whose
 * keyframes are too far apart to give at least three distinct ones (a short
 * clip, a screen recording, a Live Photo), or a route that can't skip to
 * keyframes, falls back to the exact frames at those five points, as before
 * IX2 (`decodeFrameSets`, one seek each). Either way the frames are
 * yuv420p at the thumbnail's size, in time order.
 */
import { ok, RationalTime, type AsyncResult } from '@taalcut/core';
import type { DecodeProfile } from '../decode-routes/select-route';
import type { MediaContext } from '../ffmpeg';
import { decodeFrameSets } from '../frame-sets/decode-frame-sets';
import { readSlots, removeFrameFiles, type FrameFile } from '../frame-sets/frame-files';
import { decodeKeyframes } from '../keyframes/decode-keyframes';
import type { GraphSize } from '../normalise/graph';
import type { NormalisationPlan } from '../normalise/types';

/** Where the candidates sit, as fractions of the clip. */
export const POSTER_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
/** Fewer distinct keyframes than this and the poster comes from the exact frames. */
export const MIN_KEYFRAME_CANDIDATES = 3;

export type PosterSource = 'keyframes' | 'exact';

export interface PosterFrames {
  readonly frames: readonly Buffer[];
  readonly source: PosterSource;
}

export interface PosterFrameOptions {
  readonly size: GraphSize;
  /** Scratch space for the decodes' files; they are deleted before this returns. */
  readonly dir: string;
  readonly profile?: DecodeProfile;
  readonly signal?: AbortSignal;
  /** Tests and the T1 bench: skip the keyframe read (`exact`) or force its run grouping. */
  readonly route?: { readonly exact?: boolean; readonly gapSeconds?: number };
}

/** Every frame of `files`, in slot order; the files are deleted either way. */
async function framesOf(files: readonly FrameFile[]): AsyncResult<Buffer[]> {
  try {
    const frames: Buffer[] = [];
    for (const file of files) {
      const read = await readSlots(file.path, file.slots);
      if (!read.ok) return read;
      frames.push(...file.slots.flatMap((slot) => read.value.get(slot.index) ?? []));
    }
    return ok(frames);
  } finally {
    await removeFrameFiles(files.map((file) => file.path));
  }
}

async function keyframeCandidates(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: PosterFrameOptions,
): AsyncResult<Buffer[] | undefined> {
  const duration = RationalTime.toSeconds(plan.duration);
  const decoded = await decodeKeyframes(path, plan, ctx, {
    targets: POSTER_FRACTIONS.map((fraction) => fraction * duration),
    size: options.size,
    dir: options.dir,
    timeoutMs: 120_000,
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.route?.gapSeconds !== undefined ? { gapSeconds: options.route.gapSeconds } : {}),
  });
  if (!decoded.ok) return decoded;
  if (!decoded.value) return ok(undefined);
  const frames = await framesOf(decoded.value.files);
  if (!frames.ok) return frames;
  return ok(frames.value.length >= MIN_KEYFRAME_CANDIDATES ? frames.value : undefined);
}

/** The five grid frames at 10–90 %, exactly (the rule before IX2). */
async function exactCandidates(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: PosterFrameOptions,
): AsyncResult<Buffer[]> {
  const last = Math.max(0, plan.frames - 1);
  const indexes = POSTER_FRACTIONS.map((fraction) => Math.min(last, Math.round(fraction * last)));
  const files = await decodeFrameSets(path, plan, ctx, {
    sets: [{ set: 'thumbnail', size: options.size, format: 'yuv420p', frames: indexes }],
    dir: options.dir,
    timeoutMs: 120_000,
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!files.ok) return files;
  return framesOf(files.value);
}

export async function posterFrames(
  path: string,
  plan: NormalisationPlan,
  ctx: MediaContext,
  options: PosterFrameOptions,
): AsyncResult<PosterFrames> {
  if (!options.route?.exact) {
    const keyframes = await keyframeCandidates(path, plan, ctx, options);
    if (!keyframes.ok) return keyframes;
    if (keyframes.value) return ok({ frames: keyframes.value, source: 'keyframes' });
  }
  const exact = await exactCandidates(path, plan, ctx, options);
  if (!exact.ok) return exact;
  return ok({ frames: exact.value, source: 'exact' });
}
