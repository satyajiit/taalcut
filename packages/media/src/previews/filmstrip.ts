// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The filmstrip's layout (UX2, recipe 2): one JPEG sprite of frames evenly spaced in time, sized for the clip
 * page's scrubber at 2×. Its strip (56 px high) and the frame under the pointer (96 px high) both draw from it, so a
 * frame is 192 px high: the larger of the two at 2× (never more than the clip's own height). How many frames: one for
 * each slot of the widest strip (1,920 px; a slot is as wide as a frame 56 px high, never narrower than 24 px), never
 * more than the clip has. That is 20 for 16:9, 26 for 4:3, 35 for a square, 61 for 9:16 and at most 80
 * (FILMSTRIP_MAX_FRAMES), and keeps every sprite near 1.3 megapixels whatever the clip's shape. The frames run from
 * the first to the last, evenly; the cells fill a near-square grid, left to right, top to bottom.
 */
import { FILMSTRIP_MAX_FRAMES, RationalTime, type RationalTime as CoreTime } from '@taalcut/core';
import { even } from '../normalise/size';
import type { NormalisationPlan } from '../normalise/types';

export const FILMSTRIP_RECIPE = 2;
/** A frame's height: the frame under the pointer (96 px) at 2×; the strip (56 px) draws it smaller. */
export const FILMSTRIP_TILE_HEIGHT = 192;
/** The widest strip the frames are counted for, in CSS px. */
const WIDEST_STRIP = 1920;
/** The strip's height and its narrowest slot, in CSS px. */
const STRIP_HEIGHT = 56;
const NARROWEST_SLOT = 24;

export interface FilmstripTile {
  readonly time: CoreTime;
  readonly frame: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FilmstripLayout {
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly tiles: readonly FilmstripTile[];
}

/** How many frames a clip of this shape and length gets. */
export function filmstripFrameCount(aspect: number, frames: number): number {
  const slot = Math.max(NARROWEST_SLOT, STRIP_HEIGHT * aspect);
  const wanted = Math.min(FILMSTRIP_MAX_FRAMES, Math.ceil(WIDEST_STRIP / slot));
  return Math.max(1, Math.min(Math.max(1, frames), wanted));
}

export function filmstripLayout(plan: NormalisationPlan): FilmstripLayout {
  const srcW = Math.max(1, plan.source.displayWidth || plan.source.width);
  const srcH = Math.max(1, plan.source.displayHeight || plan.source.height);
  const frames = Math.max(1, plan.frames);
  const count = filmstripFrameCount(srcW / srcH, frames);
  const tileHeight = Math.min(FILMSTRIP_TILE_HEIGHT, even(srcH));
  const tileWidth = even(Math.min(srcW, (srcW / srcH) * tileHeight));
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const tiles: FilmstripTile[] = [];
  for (let index = 0; index < count; index++) {
    const frame = count === 1 ? 0 : Math.round((index * (frames - 1)) / (count - 1));
    tiles.push({
      time: RationalTime.of(frame, plan.frameRate.output),
      frame,
      x: (index % columns) * tileWidth,
      y: Math.floor(index / columns) * tileHeight,
      width: tileWidth,
      height: tileHeight,
    });
  }
  return {
    columns,
    rows,
    width: columns * tileWidth,
    height: rows * tileHeight,
    tileWidth,
    tileHeight,
    tiles,
  };
}
