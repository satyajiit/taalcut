// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Rectangles for the placement solver: canvas pixels, origin top left. Pure. */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Frames of the timeline, [start, end). */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export const right = (rect: Rect) => rect.x + rect.width;
export const bottom = (rect: Rect) => rect.y + rect.height;
export const centreX = (rect: Rect) => rect.x + rect.width / 2;
export const centreY = (rect: Rect) => rect.y + rect.height / 2;
export const area = (rect: Rect) => Math.max(0, rect.width) * Math.max(0, rect.height);

export const spansOverlap = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Whether two rects share any area (touching edges don't). */
export const intersects = (a: Rect, b: Rect) =>
  a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

export function overlap(a: Rect, b: Rect): number {
  const width = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const height = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

export const inside = (inner: Rect, outer: Rect, slack = 0.5) =>
  inner.x >= outer.x - slack &&
  inner.y >= outer.y - slack &&
  right(inner) <= right(outer) + slack &&
  bottom(inner) <= bottom(outer) + slack;

export const inflate = (rect: Rect, dx: number, dy = dx): Rect => ({
  x: rect.x - dx,
  y: rect.y - dy,
  width: rect.width + 2 * dx,
  height: rect.height + 2 * dy,
});

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

export const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** `size` at (x, y), moved the least to lie inside `area` (pinned to its top left when it can't). */
export const within = (x: number, y: number, size: Size, area: Rect): Rect => ({
  x: clamp(x, area.x, right(area) - size.width),
  y: clamp(y, area.y, bottom(area) - size.height),
  width: size.width,
  height: size.height,
});

/** The gap between two rects' nearest edges (0 when they touch or overlap). */
export function edgeDistance(a: Rect, b: Rect): number {
  const dx = Math.max(0, b.x - right(a), a.x - right(b));
  const dy = Math.max(0, b.y - bottom(a), a.y - bottom(b));
  return Math.hypot(dx, dy);
}

/** Normalised (0–1) box ↔ canvas pixels. */
export const toPixels = (box: Rect, canvas: Size): Rect => ({
  x: box.x * canvas.width,
  y: box.y * canvas.height,
  width: box.width * canvas.width,
  height: box.height * canvas.height,
});

const share = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;

export function toShares(rect: Rect, canvas: Size): Rect {
  const x = share(rect.x / canvas.width);
  const y = share(rect.y / canvas.height);
  return {
    x,
    y,
    width: Math.min(1 - x, share(rect.width / canvas.width)),
    height: Math.min(1 - y, share(rect.height / canvas.height)),
  };
}
