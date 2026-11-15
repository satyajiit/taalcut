// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: the breakdown's `grayFrames` port (templates breakdown/ports.ts) on media's raw sampler: every frame of
 * the analysis copy as a small gray picture, from one decode, for finding dissolves and fades from pixels
 * (templates breakdown/gradual.ts). A reel of three minutes at 60 frames a second is about 25 MB at 64 px.
 */
import { ok } from '@taalcut/core';
import { sampleFrames, type MediaContext, type NormalisationPlan } from '@taalcut/media';
import type { BreakdownMedia } from '@taalcut/templates';

type GrayFrames = Awaited<ReturnType<NonNullable<BreakdownMedia['grayFrames']>>>;

export async function grayFramesOf(
  path: string,
  planned: { readonly plan: NormalisationPlan; readonly media: MediaContext },
  options: { readonly longSide: number; readonly signal: AbortSignal },
): Promise<GrayFrames> {
  const frames: Uint8Array[] = [];
  const sampled = await sampleFrames(path, planned.plan, planned.media, {
    size: options.longSide,
    format: 'gray8',
    signal: options.signal,
    // The sampler's buffer is its own; each frame is copied out of it.
    onFrame: (frame) => void frames.push(new Uint8Array(frame.data)),
  });
  if (!sampled.ok) return sampled;
  return ok({ width: sampled.value.width, height: sampled.value.height, frames });
}
