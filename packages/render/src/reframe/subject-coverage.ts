// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How much of the subject a crop keeps, and where a source box lands on the canvas: QA's subjectInFrame and
 * captionCoversFace, the reframe eval (`tools/evals reframe`) and render's own int test share these. Pure.
 */
import type { Rect } from '@taalcut/core';
import { REFRAME_CONFIG, type ReframeConfig } from './config';
import { cropAt } from './crop-window';
import type { CropKey, SourceRect, VisualFraming } from './framing-types';
import { boxArea } from './policy';

/** The share of `box`'s area inside `crop` (1 for an empty box: nothing of it is lost). */
export function boxInsideShare(box: SourceRect, crop: SourceRect): number {
  const area = boxArea(box);
  if (area <= 0) return 1;
  const width = Math.max(0, Math.min(box.x + box.width, crop.x + crop.width) - Math.max(box.x, crop.x));
  const height = Math.max(0, Math.min(box.y + box.height, crop.y + crop.height) - Math.max(box.y, crop.y));
  return (width * height) / area;
}

/** A source box through a crop onto the canvas, pixels, clipped to the canvas; null when nothing shows. */
export function onCanvas(
  box: SourceRect,
  crop: SourceRect,
  canvas: { readonly width: number; readonly height: number },
): Rect | null {
  const x0 = Math.max(0, ((box.x - crop.x) / crop.width) * canvas.width);
  const y0 = Math.max(0, ((box.y - crop.y) / crop.height) * canvas.height);
  const x1 = Math.min(canvas.width, ((box.x + box.width - crop.x) / crop.width) * canvas.width);
  const y1 = Math.min(canvas.height, ((box.y + box.height - crop.y) / crop.height) * canvas.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) };
}

export interface CoverageResult {
  /** Frames with a reference box (blurred pads and subject-less frames aren't counted). */
  readonly counted: number;
  /** Counted frames keeping at least `boxInsideShare` of the box. */
  readonly inside: number;
  /** inside / counted; 1 when nothing was counted. */
  readonly share: number;
  /** Counted frames that weren't inside, from the visible start. */
  readonly misses: readonly number[];
}

/**
 * Subject-in-frame over `frames` output frames of a framing: `crop(frame)` is the crop drawn (the plan, or the
 * probed crop where there is one) and `boxAt(frame)` the reference box (QA: the plan's; the eval: ground truth).
 */
export function subjectCoverage(
  frames: number,
  crop: (frame: number) => SourceRect,
  boxAt: (frame: number) => SourceRect | null,
  config: ReframeConfig = REFRAME_CONFIG,
): CoverageResult {
  let counted = 0;
  let inside = 0;
  const misses: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const box = boxAt(frame);
    if (!box) continue;
    counted++;
    if (boxInsideShare(box, crop(frame)) >= config.boxInsideShare) inside++;
    else misses.push(frame);
  }
  return { counted, inside, share: counted === 0 ? 1 : inside / counted, misses };
}

/** Subject-in-frame of a planned framing against known boxes (the eval's ground truth). */
export function framingCoverage(
  framing: VisualFraming,
  frames: number,
  truth: (frame: number) => SourceRect | null,
  config: ReframeConfig = REFRAME_CONFIG,
): CoverageResult {
  if (framing.kind !== 'crop') return { counted: 0, inside: 0, share: 1, misses: [] };
  const keys: readonly CropKey[] = framing.keys;
  return subjectCoverage(frames, (frame) => cropAt(keys, frame), truth, config);
}
