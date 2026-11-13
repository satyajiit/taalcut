// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ResponsiveBones, SkeletonResult } from 'boneyard-js';

/** One skeleton's captured bones: a single snapshot, or one per window width. */
export type CapturedBones = SkeletonResult | ResponsiveBones;

const isResponsive = (captured: CapturedBones): captured is ResponsiveBones => 'breakpoints' in captured;

/**
 * A width captured with no bones (its element was folded away there: the chat list under the sidebar's rail
 * below 1100 px) takes the nearest wider width's bones, or the nearest narrower one's above the widest, so a
 * skeleton that shows at that width never draws as nothing.
 */
export function fillEmptyBreakpoints(captured: CapturedBones): CapturedBones {
  if (!isResponsive(captured)) return captured;
  const shots = Object.entries(captured.breakpoints)
    .map(([width, shot]) => ({ width: Number(width), shot }))
    .sort((a, b) => a.width - b.width);
  const full = shots.filter(({ shot }) => shot.bones.length > 0);
  if (full.length === 0 || full.length === shots.length) return captured;
  const breakpoints: Record<number, SkeletonResult> = {};
  for (const { width, shot } of shots) {
    const donor = full.find((candidate) => candidate.width >= width) ?? full.at(-1);
    breakpoints[width] = shot.bones.length > 0 || !donor ? shot : { ...donor.shot, viewportWidth: width };
  }
  return { ...captured, breakpoints };
}
