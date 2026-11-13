// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime, type Box, type ClipVisualLayout } from '@taalcut/core';

export type VisualRegion = ClipVisualLayout['regions'][number];
export interface LayoutSize {
  readonly width: number;
  readonly height: number;
}

export function layoutCropAt(region: VisualRegion, sourceSeconds: number): Box {
  const first = region.keyframes[0]!;
  if (sourceSeconds <= RationalTime.toSeconds(first.at)) return first.crop;
  for (let index = 1; index < region.keyframes.length; index++) {
    const right = region.keyframes[index]!;
    const end = RationalTime.toSeconds(right.at);
    if (sourceSeconds > end) continue;
    const left = region.keyframes[index - 1]!;
    const start = RationalTime.toSeconds(left.at);
    const progress = (sourceSeconds - start) / (end - start);
    const mix = (a: number, b: number) => a + (b - a) * progress;
    return {
      x: mix(left.crop.x, right.crop.x),
      y: mix(left.crop.y, right.crop.y),
      width: mix(left.crop.width, right.crop.width),
      height: mix(left.crop.height, right.crop.height),
    };
  }
  return region.keyframes.at(-1)!.crop;
}

/** One uniform transform: never stretch landscape footage to fill a portrait panel. */
export function layoutTransform(region: VisualRegion, crop: Box, source: LayoutSize, canvas: LayoutSize) {
  const viewport = {
    x: region.viewport.x * canvas.width,
    y: region.viewport.y * canvas.height,
    width: region.viewport.width * canvas.width,
    height: region.viewport.height * canvas.height,
  };
  const sx = viewport.width / (crop.width * source.width);
  const sy = viewport.height / (crop.height * source.height);
  const scale = region.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const percent = (value: number) => Math.round(Math.max(0, value) * 1e8) / 1e6;
  return {
    viewport,
    scale,
    x: (viewport.width - crop.width * source.width * scale) / 2 - crop.x * source.width * scale,
    y: (viewport.height - crop.height * source.height * scale) / 2 - crop.y * source.height * scale,
    clipPath: `inset(${percent(crop.y)}% ${percent(1 - crop.x - crop.width)}% ${percent(1 - crop.y - crop.height)}% ${percent(crop.x)}%)`,
  };
}

/** Source boxes mapped through exactly the transform the native composition draws. */
export function layoutBoxOnCanvas(
  box: Box,
  region: VisualRegion,
  crop: Box,
  source: LayoutSize,
  canvas: LayoutSize,
): Box | null {
  const placed = layoutTransform(region, crop, source, canvas);
  const left = Math.max(box.x, crop.x);
  const top = Math.max(box.y, crop.y);
  const right = Math.min(box.x + box.width, crop.x + crop.width);
  const bottom = Math.min(box.y + box.height, crop.y + crop.height);
  const x = Math.max(placed.viewport.x, placed.viewport.x + placed.x + left * source.width * placed.scale);
  const y = Math.max(placed.viewport.y, placed.viewport.y + placed.y + top * source.height * placed.scale);
  const endX = Math.min(
    placed.viewport.x + placed.viewport.width,
    placed.viewport.x + placed.x + right * source.width * placed.scale,
  );
  const endY = Math.min(
    placed.viewport.y + placed.viewport.height,
    placed.viewport.y + placed.y + bottom * source.height * placed.scale,
  );
  return endX > x && endY > y ? { x, y, width: endX - x, height: endY - y } : null;
}
