// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime, type FrameRate } from '@taalcut/core';
import type { PlannedVisual } from '../plan/types';
import { sourceFramesAt, visualCurve } from '../plan/speed-curve';

export {
  layoutCropAt,
  layoutTransform,
  layoutBoxOnCanvas,
  type LayoutSize,
  type VisualRegion,
} from '@taalcut/timeline';

/** Absolute source time keeps a crop attached to the original action after a trim, split, slip or reorder. */
export function layoutSourceTime(visual: PlannedVisual, frame: number, rate: FrameRate): number {
  if (visual.holdFrame) return RationalTime.toSeconds(visual.holdFrame);
  return (
    RationalTime.toSeconds(visual.sourceIn) +
    (sourceFramesAt(visualCurve(visual, rate), frame - visual.visible.start) * rate.den) / rate.num
  );
}
