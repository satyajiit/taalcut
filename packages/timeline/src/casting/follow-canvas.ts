// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE: the made video's canvas follows the person's clips (the owner's decision, 2026-10-31). When most of
 * the clips a template cast uses have the other orientation, the video is made in theirs: a landscape reel cast
 * from portrait phone clips makes a portrait 9:16 video for Reels and Shorts. The template's cuts, beats, music and
 * overlays carry over. Assembly fits the overlay layout to the new frame (assembly/fit-layout.ts), and each clip
 * fills it with a centre crop (`fit: 'cover'`). The cast then runs again on the new canvas, so clips of its
 * orientation are a strict fit and are no longer capped as `orientationRelaxed`. A canvas the request names (a
 * person's choice) always wins. Pure.
 */
import type { Canvas, Orientation } from '@taalcut/core';
import { orientationOf } from './slots';

/** The made video's size in each orientation: the export presets' (1080×1920 for 9:16) and their landscape. */
export const MADE_CANVAS_SIZES: Readonly<
  Record<Orientation, { readonly width: number; readonly height: number }>
> = {
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};

/**
 * The orientation the picks follow, when it isn't the canvas's own: one that more than half the picks have. Null
 * when there are no picks, or no orientation has a majority, or the canvas's own does.
 */
export function followedOrientation(picks: readonly Orientation[], own: Orientation): Orientation | null {
  if (picks.length === 0) return null;
  const counts = new Map<Orientation, number>();
  for (const orientation of picks) counts.set(orientation, (counts.get(orientation) ?? 0) + 1);
  for (const [orientation, count] of counts)
    if (orientation !== own && count * 2 > picks.length) return orientation;
  return null;
}

/** The template's canvas in `orientation`: unchanged when it already is, else the made size at its rate. */
export function madeCanvas(canvas: Canvas, orientation: Orientation): Canvas {
  if (orientationOf(canvas) === orientation) return canvas;
  return { ...canvas, ...MADE_CANVAS_SIZES[orientation] };
}
