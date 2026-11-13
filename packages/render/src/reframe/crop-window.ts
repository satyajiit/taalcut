// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Crop-window maths shared by framing, the composition styles and QA. All rects are fractions of the upright
 * source frame.
 *
 * The *cover window* is the largest window of the canvas aspect inside the source (what `object-fit: cover`
 * shows); a punch-in of `scale` s shows the cover window shrunk by s. The composition draws a crop as the
 * cover window placed by `object-position` (pan) and zoomed by CSS `scale: s` about `transform-origin` (the
 * punch-in's place inside it). For a crop R, the cover window V is centred on R and kept inside the source,
 * and the origin share u = (R.x − V.x) / ((1 − 1/s)·V.width) on each axis, so the visible window is
 * V.x + u·(1 − 1/s)·V.width = R.x. Both are linear in R between keys, so the drawn window moves exactly along
 * the planned path.
 */
import type { CropKey, SourceRect } from './framing-types';

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The cover window's size for a source and canvas aspect (width / height). */
export function coverWindow(sourceAspect: number, canvasAspect: number): Size {
  return sourceAspect > canvasAspect
    ? { width: canvasAspect / sourceAspect, height: 1 }
    : { width: 1, height: sourceAspect / canvasAspect };
}

/** Within `tolerance` of each other, the aspects need no crop. */
export function sameAspect(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a / b - 1) <= tolerance;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function lerpRect(a: SourceRect, b: SourceRect, share: number): SourceRect {
  return {
    x: a.x + (b.x - a.x) * share,
    y: a.y + (b.y - a.y) * share,
    width: a.width + (b.width - a.width) * share,
    height: a.height + (b.height - a.height) * share,
  };
}

/** Where `frame` falls among the keys: the key on the left, the one on the right and the share between. */
function bracket(keys: readonly CropKey[], frame: number): { left: number; right: number; share: number } {
  if (keys.length === 0 || frame <= (keys[0]?.frame ?? 0)) return { left: 0, right: 0, share: 0 };
  const last = keys.length - 1;
  if (frame > (keys[last]?.frame ?? 0)) return { left: last, right: last, share: 0 };
  let lo = 1;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((keys[mid]?.frame ?? 0) < frame) lo = mid + 1;
    else hi = mid;
  }
  const right = keys[lo]!;
  const left = keys[lo - 1]!;
  const span = right.frame - left.frame;
  return { left: lo - 1, right: lo, share: span > 0 ? (frame - left.frame) / span : 1 };
}

/** The crop at `frame` (from the visible start): linear between keys, held outside them. */
export function cropAt(keys: readonly CropKey[], frame: number): SourceRect {
  const { left, right, share } = bracket(keys, frame);
  const a = keys[left]?.rect ?? { x: 0, y: 0, width: 1, height: 1 };
  const b = keys[right]?.rect ?? a;
  return lerpRect(a, b, share);
}

/** A per-key box at `frame`: linear between two boxes, null when either side has none. */
export function boxAt(
  keys: readonly CropKey[],
  boxes: readonly (SourceRect | null)[],
  frame: number,
): SourceRect | null {
  const { left, right, share } = bracket(keys, frame);
  const a = boxes[left] ?? null;
  const b = boxes[right] ?? null;
  if (!a) return null;
  if (!b) return share === 0 ? a : null;
  return lerpRect(a, b, share);
}

export interface WindowPlacement {
  /** The cover window's top left (source fractions). */
  readonly cover: { readonly x: number; readonly y: number };
  /** Where the punch-in zooms, as a share of the element on each axis (0.5 without a punch-in). */
  readonly origin: { readonly x: number; readonly y: number };
}

/** The cover window and zoom origin that show `crop` with a punch-in of `scale`. */
export function placeWindow(crop: SourceRect, window: Size, scale: number): WindowPlacement {
  const coverX = clamp(crop.x + crop.width / 2 - window.width / 2, 0, Math.max(0, 1 - window.width));
  const coverY = clamp(crop.y + crop.height / 2 - window.height / 2, 0, Math.max(0, 1 - window.height));
  const room = (size: number) => (1 - 1 / scale) * size;
  const share = (offset: number, size: number) =>
    room(size) > 1e-9 ? clamp(offset / room(size), 0, 1) : 0.5;
  return {
    cover: { x: coverX, y: coverY },
    origin: { x: share(crop.x - coverX, window.width), y: share(crop.y - coverY, window.height) },
  };
}

/** The crop a placement shows: the inverse of placeWindow. */
export function windowCrop(placement: WindowPlacement, window: Size, scale: number): SourceRect {
  const room = (size: number) => (1 - 1 / scale) * size;
  return {
    x: placement.cover.x + placement.origin.x * room(window.width),
    y: placement.cover.y + placement.origin.y * room(window.height),
    width: window.width / scale,
    height: window.height / scale,
  };
}

/** The `object-position` share placing a cover window at `cover` inside the media region `extent`, per axis. */
export function objectPositionShare(
  cover: number,
  extentStart: number,
  extentSize: number,
  window: number,
): number {
  const room = extentSize - window;
  return room > 1e-9 ? (cover - extentStart) / room : 0.5;
}

/** The cover window position an `object-position` share shows: the inverse of objectPositionShare. */
export function coverFromShare(
  share: number,
  extentStart: number,
  extentSize: number,
  window: number,
): number {
  const room = extentSize - window;
  return room > 1e-9 ? extentStart + share * room : extentStart;
}
