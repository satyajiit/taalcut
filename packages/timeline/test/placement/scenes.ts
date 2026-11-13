// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Synthetic scenes for the placement solver's fixtures: made-up people on a 9:16 canvas, no footage. */
import type { OverlayPlacement } from '@taalcut/core';
import { inflate, intersects, type Rect, type Size, type Span } from '../../src/assembly/placement/geometry';
import { headKeepOuts } from '../../src/assembly/placement/costs';
import { SOLVER_CONFIG } from '../../src/assembly/placement/solve';
import type { Obstacle, Placed, PlacementItem, Scene, SceneFrame } from '../../src/assembly/placement/types';

export const PORTRAIT: Size = { width: 1080, height: 1920 };
/** The made portrait safe area (fit-layout.ts MADE_SAFE_AREAS): x 120–780, y 288–1248. */
export const PORTRAIT_SAFE: Rect = { x: 120, y: 288, width: 660, height: 960 };
export const LANDSCAPE: Size = { width: 1920, height: 1080 };
export const LANDSCAPE_SAFE: Rect = { x: 96, y: 54, width: 1728, height: 972 };

/** A head about this wide at (x, y), its top left; the person's body below it. */
export const head = (x: number, y: number, width = 220): Rect => ({ x, y, width, height: width * 1.25 });
export const bodyOf = (h: Rect): Rect => ({
  x: h.x - h.width * 0.6,
  y: h.y + h.height * 0.9,
  width: h.width * 2.2,
  height: 1920,
});

export interface SceneSpec {
  readonly canvas?: Size;
  readonly safe?: Rect;
  /** Heads per frame; frames every 8 (a 4 Hz detect at 30 fps, roughly) from 0. */
  readonly heads?: (frame: number) => readonly Rect[];
  readonly salient?: readonly Rect[];
  readonly obstacles?: readonly Obstacle[];
  readonly length?: number;
  readonly silhouette?: (rect: Rect) => number;
}

export function scene(spec: SceneSpec = {}): Scene {
  const length = spec.length ?? 300;
  const all: SceneFrame[] = [];
  for (let frame = 0; frame <= length; frame += 8) {
    const heads = spec.heads?.(frame) ?? [];
    all.push({
      frame,
      heads,
      people: heads.map(bodyOf),
      salient: spec.salient ?? [],
      ...(spec.silhouette ? { silhouette: spec.silhouette } : {}),
    });
  }
  return {
    canvas: spec.canvas ?? PORTRAIT,
    safe: spec.safe ?? PORTRAIT_SAFE,
    obstacles: spec.obstacles ?? [],
    frames: (span: Span) =>
      all.filter((frame) => frame.frame >= span.start - 8 && frame.frame < span.end + 8),
  };
}

export interface ItemSpec {
  readonly id?: string;
  readonly span?: Span;
  readonly size?: Size;
  readonly relation?: OverlayPlacement;
  readonly reel?: Rect;
  readonly minScale?: number;
  readonly chat?: PlacementItem['chat'];
  readonly onPicture?: boolean;
}

export function item(spec: ItemSpec = {}): PlacementItem {
  const size = spec.size ?? { width: 300, height: 110 };
  return {
    id: spec.id ?? 'a',
    span: spec.span ?? { start: 30, end: 120 },
    sizeAt: (scale) => ({ width: size.width * scale, height: size.height * scale }),
    minScale: spec.minScale ?? 0.6,
    relation: spec.relation ?? { relativeTo: 'frame', zone: 'top' },
    reel: spec.reel ?? { x: 390, y: 300, width: size.width, height: size.height },
    ...(spec.chat ? { chat: spec.chat } : {}),
    onPicture: spec.onPicture ?? false,
  };
}

/** Every head the item's span sees (raw, and with the solver's margin), against the placed box. */
export function coversHead(placed: Placed, spec: Scene, span: Span, margin = false): boolean {
  const frames = spec.frames(span);
  const rects = margin ? headKeepOuts(frames, SOLVER_CONFIG) : frames.flatMap((frame) => frame.heads);
  return rects.some((rect) => intersects(placed.box, rect));
}

/** Heads at every frame of the span, moving linearly between `from` and `to` (for between-sample checks). */
export function movingHead(from: Rect, to: Rect, start: number, end: number) {
  return (frame: number): Rect[] => {
    const t = Math.min(1, Math.max(0, (frame - start) / Math.max(1, end - start)));
    return [
      {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        width: from.width,
        height: from.height,
      },
    ];
  };
}

export const grown = (rect: Rect, by: number) => inflate(rect, by);
