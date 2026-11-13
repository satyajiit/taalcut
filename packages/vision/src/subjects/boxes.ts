// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Detector boxes: candidates in tensor pixels, greedy non-maximum suppression, and fractions of the frame. Pure. */

/** A box in pixels, top-left corner and size. */
export interface PixelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Candidate {
  readonly box: PixelBox;
  readonly score: number;
}

/** A box as fractions of the upright frame, origin top left, inside the frame. */
export interface FractionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function iou(a: PixelBox, b: PixelBox): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const both = w * h;
  return both / (a.width * a.height + b.width * b.height - both);
}

/** Highest score first; drops each candidate that overlaps a kept one by more than `threshold` IoU. */
export function nms<T extends Candidate>(candidates: readonly T[], threshold: number, limit = Infinity): T[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const candidate of sorted) {
    if (kept.length >= limit) break;
    if (kept.every((other) => iou(other.box, candidate.box) <= threshold)) kept.push(candidate);
  }
  return kept;
}

const unit = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A tensor-pixel box as fractions of the frame it was scaled from (`scale` tensor pixels per frame pixel),
 * clipped to the frame; null when nothing of it is inside.
 */
export function toFraction(
  box: PixelBox,
  scale: number,
  frame: { readonly width: number; readonly height: number },
): FractionBox | null {
  const x0 = unit(box.x / scale / frame.width);
  const y0 = unit(box.y / scale / frame.height);
  const x1 = unit((box.x + box.width) / scale / frame.width);
  const y1 = unit((box.y + box.height) / scale / frame.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
