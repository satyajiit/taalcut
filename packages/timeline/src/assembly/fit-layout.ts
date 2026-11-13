// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE: a template's overlays on a made video of another shape (casting/follow-canvas.ts), such as a landscape
 * reel's chat bubbles on a portrait 9:16 video. Each overlay keeps its place relative to the frame: its centre stays
 * at the same share of the width and of the height. It keeps its size in pixels against the template's frame laid
 * into the new one, scaled to fit, so its words read as they did. It stays inside the made frame's safe area: on a
 * vertical video, the rect that is clear on Shorts, Reels and TikTok at once (render's cross-post rect, which
 * render's tests hold this copy to); on another shape, a 5 % title-safe inset. A graphic's type size and its
 * bubble's width (`shapeWidth`, BRK1-GFX) keep their pixels the same way. A text item keeps a margin inside
 * it too (`textMargin`): render draws a text's background box, outline and line boxes a little outside the item's
 * box, so a box flush with the safe area's edge failed QA's safe-zone check by 10 to 27 px on the owner's path. On a
 * canvas of the template's own orientation only a text the reel had outside the safe area moves, just inside it
 * (FIX-QA, `clampText`). Pure.
 */
import { type Canvas, type Orientation, type TextTrackItem, type Track } from '@taalcut/core';
import { orientationOf } from '../casting/slots';

type TextTrack = Extract<Track, { kind: 'text' }>;
interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
type Size = Pick<Canvas, 'width' | 'height'>;

const TITLE_SAFE: Box = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };

/** Where overlays may sit on a made video, as shares of its frame. */
export const MADE_SAFE_AREAS: Readonly<Record<Orientation, Box>> = {
  // Match the default device export; explicit platform exports apply their own safe zones.
  portrait: TITLE_SAFE,
  square: TITLE_SAFE,
  landscape: TITLE_SAFE,
};

/** How much one template pixel grows on the made frame: the template's frame scaled to fit inside it. */
const fitScale = (from: Size, to: Size) => Math.min(to.width / from.width, to.height / from.height);

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** `safe` shrunk by `margin` pixels on every side (never below nothing). */
function inset(safe: Box, margin: number, to: Size): Box {
  const mx = Math.min(margin / to.width, safe.width / 2);
  const my = Math.min(margin / to.height, safe.height / 2);
  return { x: safe.x + mx, y: safe.y + my, width: safe.width - 2 * mx, height: safe.height - 2 * my };
}

/**
 * Pixels a text item keeps inside the safe area on the made frame: render's box padding and outline (about 20 px),
 * and the line boxes' reach past the cap height (0.3 of it covers the 27 px measured at a 77 px cap height).
 */
export function textMargin(size: number, to: Size): number {
  return 20 + 0.3 * size * to.height;
}

/**
 * A normalised box of the template's frame, placed on the made frame: same centre share, same pixels, inside `safe`
 * less `margin` pixels.
 */
export function fitBox(
  box: Box,
  from: Size,
  to: Size,
  safe: Box = MADE_SAFE_AREAS[orientationOf(to)],
  margin = 0,
): Box {
  if (margin > 0) safe = inset(safe, margin, to);
  const scale = fitScale(from, to);
  const width = Math.min(safe.width, (box.width * from.width * scale) / to.width);
  const height = Math.min(safe.height, (box.height * from.height * scale) / to.height);
  const x = clamp(box.x + box.width / 2 - width / 2, safe.x, safe.x + safe.width - width);
  const y = clamp(box.y + box.height / 2 - height / 2, safe.y, safe.y + safe.height - height);
  return { x, y, width, height };
}

/** A text item's cap height (a share of the canvas height), kept in pixels. */
export function fitTextSize(size: number, from: Size, to: Size): number {
  return clamp((size * from.height * fitScale(from, to)) / to.height, 0.005, 0.5);
}

function fitItem(item: TextTrackItem, from: Size, to: Size): TextTrackItem {
  if (item.type === 'text') {
    const size = fitTextSize(item.appearance.size, from, to);
    const box = fitBox(item.box, from, to, MADE_SAFE_AREAS[orientationOf(to)], textMargin(size, to));
    return { ...item, box, appearance: { ...item.appearance, size } };
  }
  const placement =
    typeof item.placement === 'object' ? { box: fitBox(item.placement.box, from, to) } : item.placement;
  // HFW1: a composition lays itself out with CSS; only its box moves.
  return { ...item, placement };
}

/**
 * FIX-QA: a template's text on a canvas of its own shape keeps its box, but one the reel had partly outside the made
 * frame's safe area (less the text's margin) is clamped inside it, same size, so QA's safe-zone check doesn't fail
 * it from the start. Only this clamp; placement itself is fitBox's.
 */
function clampText(item: TextTrackItem, to: Size): TextTrackItem {
  if (item.type !== 'text' || !item.overlayId) return item;
  const safe = inset(MADE_SAFE_AREAS[orientationOf(to)], textMargin(item.appearance.size, to), to);
  const { box } = item;
  const tolerance = 1e-9;
  const inside =
    box.x >= safe.x - tolerance &&
    box.y >= safe.y - tolerance &&
    box.x + box.width <= safe.x + safe.width + tolerance &&
    box.y + box.height <= safe.y + safe.height + tolerance;
  return inside ? item : { ...item, box: fitBox(box, to, to, safe) };
}

/** The text tracks of a template made on `to` (the template's canvas is `from`). */
export function fitTextTracks(tracks: readonly TextTrack[], from: Size, to: Size): TextTrack[] {
  const fit =
    orientationOf(from) === orientationOf(to)
      ? (item: TextTrackItem) => clampText(item, to)
      : (item: TextTrackItem) => fitItem(item, from, to);
  return tracks.map((track) => ({ ...track, items: track.items.map(fit) }));
}
