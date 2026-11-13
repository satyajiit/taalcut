// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How an overlay comes on and goes off, from the frames round its edges (BRK1-GFX). Its presence in a frame is the
 * share of its mask (the shape less the words, or the words alone on the picture) showing its settled colour. It
 * cuts in when it is all there on its first frame; it fades when the whole mask is there but blended with what was
 * behind; it pops when it grows from its middle; it slides when it arrives from one side. A shape that is there
 * well before its words typed: with no ink first, a typing indicator; with ink growing, a typewriter. HFW1: an
 * entrance or exit is judged over the frames round it, and one the frames can't tell is `unknown`, never a cut. Pure.
 */
import type { OverlayEntrance, OverlayExit } from '@taalcut/core';
import { distance, inside, pixel, points, type PixelRect, type RegionImage, type Rgb } from './pixels';
import { FILL_NEAR } from './shape';

export interface Mask {
  /** Where the overlay's settled colour shows: the shape's rect, or the words' box. */
  readonly rect: PixelRect;
  /** Left out of the mask: the words, on a shape. */
  readonly hole: PixelRect | null;
  readonly colour: Rgb;
}

export interface Presence {
  /** Share of the mask in the overlay's colour. */
  readonly share: number;
  /** Where those pixels sit, as shares of the mask's width and height (0.5 is its middle). */
  readonly centre: { readonly x: number; readonly y: number } | null;
  /** How far their box reaches across the mask, as shares. */
  readonly extent: { readonly width: number; readonly height: number };
}

export function presence(image: RegionImage, mask: Mask): Presence {
  const { rect, hole, colour } = mask;
  let total = 0;
  let found = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points(rect)) {
    if (hole && inside(hole, x, y)) continue;
    total++;
    if (distance(pixel(image, x, y), colour) > FILL_NEAR) continue;
    found++;
    sumX += x;
    sumY += y;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const width = Math.max(1, rect.right - rect.left);
  const height = Math.max(1, rect.bottom - rect.top);
  return {
    share: total === 0 ? 0 : found / total,
    centre:
      found === 0 ? null : { x: (sumX / found - rect.left) / width, y: (sumY / found - rect.top) / height },
    extent:
      found === 0
        ? { width: 0, height: 0 }
        : { width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height },
  };
}

/** Mean RGB distance over the mask between two frames. */
export function change(a: RegionImage, b: RegionImage, mask: Mask): number {
  let total = 0;
  let sum = 0;
  for (const [x, y] of points(mask.rect, 2)) {
    if (mask.hole && inside(mask.hole, x, y)) continue;
    total++;
    sum += distance(pixel(a, x, y), pixel(b, x, y));
  }
  return total === 0 ? 0 : sum / total;
}

/** Mostly there: the settled share's this much. */
const THERE = 0.85;
/** Gone: under this much of it. */
const GONE = 0.3;

/** How a frame that is part-way on looks: blended everywhere (fade), grown from its middle (pop), or off to a side. */
function partWay(seen: Presence, full: Presence): 'fade' | 'pop' | 'slide' {
  if (!seen.centre || seen.share < 0.02) return 'fade';
  const offset = Math.abs(seen.centre.x - (full.centre?.x ?? 0.5));
  if (offset > 0.12) return 'slide';
  if (seen.extent.width < full.extent.width * 0.85 || seen.extent.height < full.extent.height * 0.85)
    return 'pop';
  return 'fade';
}

export interface EdgeFrames {
  /** Frames in order, each with its region image. */
  readonly frames: readonly { readonly frame: number; readonly image: RegionImage }[];
}

/** Under this share of its settled presence a frame shows none of the overlay. */
const ABSENT = 0.02;
/** HFW1: the frames judged round an appearance (before it, it and after) and round a disappearance. */
export const AROUND_ENTRANCE = { before: 3, after: 4 } as const;
export const AROUND_EXIT = { before: 4, after: 2 } as const;

type Move = 'fade' | 'pop' | 'slide';

/** What most of the part-way frames say; on a tie, the earliest's. */
function mostOf(moves: readonly Move[]): Move {
  const counts = new Map<Move, number>();
  for (const move of moves) counts.set(move, (counts.get(move) ?? 0) + 1);
  let best = moves[0]!;
  for (const move of moves) if ((counts.get(move) ?? 0) > (counts.get(best) ?? 0)) best = move;
  return best;
}

/**
 * How the overlay changes over `frames` (the ones round an edge): `cut` when no frame is part-way there and the
 * outside one (`outside`) shows none of it, the part-way frames' move when some are, and `unknown` when a frame the
 * judgement needs wasn't read.
 */
function edgeOf(
  edge: EdgeFrames,
  mask: Mask,
  full: Presence,
  frames: readonly number[],
  needed: readonly number[],
  outside: number,
): Move | 'cut' | 'unknown' {
  const images = new Map(edge.frames.map((entry) => [entry.frame, entry.image]));
  if (needed.some((frame) => !images.has(frame))) return 'unknown';
  const ratio = (seen: Presence) => seen.share / Math.max(full.share, 1e-6);
  const moves: Move[] = [];
  for (const frame of frames) {
    const image = images.get(frame);
    if (!image) continue;
    const seen = presence(image, mask);
    if (ratio(seen) >= ABSENT && ratio(seen) < THERE) moves.push(partWay(seen, full));
  }
  if (moves.length > 0) return mostOf(moves);
  return ratio(presence(images.get(outside)!, mask)) < ABSENT ? 'cut' : 'unknown';
}

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/**
 * HFW1: the entrance, judged over the frames round the first one the overlay shows on (`first`), never one frame:
 * `none` (a cut) when it is absent on the frame before and all there on `first` with nothing part-way between;
 * else what most part-way frames say; `unknown` when the frame before or `first` wasn't read, or it is there from
 * the reel's first frame.
 */
export function entranceOf(edge: EdgeFrames, mask: Mask, full: Presence, first: number): OverlayEntrance {
  if (first <= 0) return 'unknown';
  const frames = span(first - AROUND_ENTRANCE.before, first + AROUND_ENTRANCE.after);
  const read = edgeOf(edge, mask, full, frames, [first - 1, first], first - 1);
  return read === 'cut' ? 'none' : read;
}

/**
 * The exit, judged over the frames round the overlay's end (`end`, exclusive) the same way: `none` when it is all
 * there on its last frame and gone on the next; `unknown` when either wasn't read.
 */
export function exitOf(edge: EdgeFrames, mask: Mask, full: Presence, end: number): OverlayExit {
  const frames = span(end - AROUND_EXIT.before, end - 1 + AROUND_EXIT.after);
  const read = edgeOf(edge, mask, full, frames, [end - 1, end], end);
  return read === 'cut' ? 'none' : read;
}

/** The frames round an appearance at `first` and an end at `end` that the judgements read, within the reel. */
export function edgeFramesFor(first: number, end: number, total: number): number[] {
  return [
    ...span(first - AROUND_ENTRANCE.before - 1, first + AROUND_ENTRANCE.after),
    ...span(end - AROUND_EXIT.before, end - 1 + AROUND_EXIT.after),
  ].filter((frame) => frame >= 0 && frame < total);
}

/**
 * The first frame the shape is there, scanning back from the words' first frame through `before` (frames in
 * order, the last just before the words): it may come on before them (typing).
 */
export function shapeFirst(before: EdgeFrames, mask: Mask, full: Presence, words: number): number {
  let first = words;
  for (const entry of [...before.frames].reverse()) {
    if (entry.frame >= words) continue;
    if (presence(entry.image, mask).share < full.share * GONE) break;
    first = entry.frame;
  }
  return first;
}
