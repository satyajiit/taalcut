// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { FrameRate, Rect } from '@taalcut/core';
import { layoutCropAt, layoutTransform, type LayoutSize } from '@taalcut/timeline';
import type { PlannedVisual } from '../plan/types';
import { layoutSourceTime } from '../reframe/visual-layout';

/** Which source pixels sit under a caption, including the black area around a contained panel. */
export function layoutColourRegions(
  visual: PlannedVisual,
  frame: number,
  box: Rect,
  source: LayoutSize,
  canvas: LayoutSize,
  rate: FrameRate,
): { box: Rect; weight: number }[] {
  return (visual.visualLayout?.regions ?? []).flatMap((region) => {
    const crop = layoutCropAt(region, layoutSourceTime(visual, frame, rate));
    const placed = layoutTransform(region, crop, source, canvas);
    const origin = { x: placed.viewport.x + placed.x, y: placed.viewport.y + placed.y };
    const x = Math.max(box.x, placed.viewport.x, origin.x + crop.x * source.width * placed.scale);
    const y = Math.max(box.y, placed.viewport.y, origin.y + crop.y * source.height * placed.scale);
    const right = Math.min(
      box.x + box.width,
      placed.viewport.x + placed.viewport.width,
      origin.x + (crop.x + crop.width) * source.width * placed.scale,
    );
    const bottom = Math.min(
      box.y + box.height,
      placed.viewport.y + placed.viewport.height,
      origin.y + (crop.y + crop.height) * source.height * placed.scale,
    );
    if (right <= x || bottom <= y) return [];
    const left = Math.max(0, Math.floor((x - origin.x) / placed.scale));
    const top = Math.max(0, Math.floor((y - origin.y) / placed.scale));
    return [
      {
        box: {
          x: left,
          y: top,
          width: Math.max(
            1,
            Math.min(source.width - left, Math.ceil((right - origin.x) / placed.scale) - left),
          ),
          height: Math.max(
            1,
            Math.min(source.height - top, Math.ceil((bottom - origin.y) / placed.scale) - top),
          ),
        },
        weight: ((right - x) * (bottom - y)) / (box.width * box.height),
      },
    ];
  });
}
