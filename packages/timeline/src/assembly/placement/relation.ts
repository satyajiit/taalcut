// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The reel's relation on the made canvas (FRM1-OVL): the head an item sits beside, the box the relation asks
 * for, and how far a candidate box is from it. The made video's people are other people in other places, so the
 * relation is kept, not the coordinates: beside the main head on the reel's side, or in the reel's band of the
 * frame. Pure.
 */
import type { OverlayPlacement } from '@taalcut/core';
import {
  area,
  bottom,
  centreX,
  centreY,
  clamp,
  right,
  union,
  within,
  type Rect,
  type Size,
} from './geometry';
import { headMarginOf } from './costs';
import type { PlacementItem, SceneFrame, SolverConfig } from './types';

type Side = NonNullable<OverlayPlacement['side']>;
type Zone = OverlayPlacement['zone'];

/** Which third of `band` a rect's centre is in. */
export function zoneOf(rect: Rect, band: Rect): Zone {
  const at = (centreY(rect) - band.y) / Math.max(1, band.height);
  return at < 1 / 3 ? 'top' : at < 2 / 3 ? 'middle' : 'bottom';
}

const ZONE_INDEX: Readonly<Record<Zone, number>> = { top: 0, middle: 1, bottom: 2 };

/** Which side of `head` a box is on: the axis it is furthest along, for their sizes. */
export function sideOf(box: Rect, head: Rect): Side {
  const dx = centreX(box) - centreX(head);
  const dy = centreY(box) - centreY(head);
  const nx = dx / Math.max(1, (box.width + head.width) / 2);
  const ny = dy / Math.max(1, (box.height + head.height) / 2);
  if (Math.abs(nx) >= Math.abs(ny)) return dx >= 0 ? 'right' : 'left';
  return dy < 0 ? 'above' : 'below';
}

const distance = (a: Rect, b: Rect) => Math.hypot(centreX(a) - centreX(b), centreY(a) - centreY(b));

/** The main person's head over a span: swept into one box, and frame by frame. */
export interface HeadTrack {
  /** One box that holds every place it was (targets and the gap are taken from it). */
  readonly swept: Rect;
  /** Where it was on each frame it was followed, the reference (the span's middle) first. */
  readonly frames: readonly Rect[];
}

/**
 * The main person's head over the frames: the largest head nearest the span's middle, followed frame to frame by
 * proximity. Null when nobody is there.
 */
export function mainHeadTrack(frames: readonly SceneFrame[]): HeadTrack | null {
  const withHeads = frames.filter((frame) => frame.heads.length > 0);
  if (withHeads.length === 0) return null;
  const middle = withHeads[Math.floor(withHeads.length / 2)]!;
  const reference = [...middle.heads].sort((a, b) => area(b) - area(a))[0]!;
  let swept = reference;
  const seen: Rect[] = [reference];
  const follow = (ordered: readonly SceneFrame[]) => {
    let last = reference;
    for (const frame of ordered) {
      const next = [...frame.heads].sort((a, b) => distance(a, last) - distance(b, last))[0];
      if (!next || distance(next, last) > 2 * Math.max(last.width, last.height)) continue;
      swept = union(swept, next);
      seen.push(next);
      last = next;
    }
  };
  const at = withHeads.indexOf(middle);
  follow(withHeads.slice(at + 1));
  follow([...withHeads.slice(0, at)].reverse());
  return { swept, frames: seen };
}

/** The main head swept over the frames, or null with nobody there. */
export const mainHead = (frames: readonly SceneFrame[]): Rect | null => mainHeadTrack(frames)?.swept ?? null;

/**
 * The side of the head a box holds over the span: the side on most frames, as the reel's relation was read and as
 * a viewer sees it (a head that moves can put a box beside its sweep but above it on most frames). A tie goes to
 * the span's middle.
 */
export function sideOver(box: Rect, track: HeadTrack): Side {
  const counts = new Map<Side, number>();
  for (const head of track.frames) {
    const side = sideOf(box, head);
    counts.set(side, (counts.get(side) ?? 0) + 1);
  }
  const middle = sideOf(box, track.frames[0]!);
  let best = middle;
  for (const [side, count] of counts) if (count > (counts.get(best) ?? 0)) best = side;
  return best;
}

/** The gap the relation keeps from the head, in pixels: the reel's share of the head's height, within reason. */
export function gapPx(relation: OverlayPlacement, head: Rect, config: SolverConfig): number {
  const margin = headMarginOf(head, config);
  return Math.max(margin + 2, clamp(relation.gap ?? 0.25, 0.1, 1.5) * head.height);
}

/**
 * The box the relation asks for, at `size`, inside `safe`: beside the main head on its side (level with it, or
 * toward the reel's band), or the reel's box for a frame relation or with nobody on screen.
 */
export function targetBox(
  item: PlacementItem,
  size: Size,
  head: Rect | null,
  safe: Rect,
  config: SolverConfig,
): Rect {
  const reelAt = within(
    centreX(item.reel) - size.width / 2,
    centreY(item.reel) - size.height / 2,
    size,
    safe,
  );
  if (item.relation.relativeTo === 'frame' || !head || !item.relation.side) return reelAt;
  const gap = gapPx(item.relation, head, config);
  const side = item.relation.side;
  if (side === 'above' || side === 'below') {
    const y = side === 'above' ? head.y - gap - size.height : bottom(head) + gap;
    // Toward the reel's own side of the head, as far as the head's half-width.
    const lean = clamp(centreX(item.reel) - centreX(head), -head.width / 2, head.width / 2);
    return within(centreX(head) + lean - size.width / 2, y, size, safe);
  }
  const x = side === 'right' ? right(head) + gap : head.x - gap - size.width;
  // Level with the head, raised or lowered toward the reel's band.
  const headZone = ZONE_INDEX[zoneOf(head, safe)];
  const wanted = ZONE_INDEX[item.relation.zone];
  const y =
    wanted < headZone
      ? centreY(head) - size.height
      : wanted > headZone
        ? centreY(head)
        : centreY(head) - size.height / 2;
  return within(x, y, size, safe);
}

/** How far a candidate is from the relation: the wrong side, the distance from its target, the wrong band. */
export function relationCost(
  item: PlacementItem,
  box: Rect,
  target: Rect,
  head: Rect | null,
  scene: { readonly canvas: Size; readonly safe: Rect },
  config: SolverConfig,
  track: HeadTrack | null = null,
): number {
  const { weights } = config;
  const diagonal = Math.hypot(scene.canvas.width, scene.canvas.height);
  let cost = (weights.distance * distance(box, target)) / diagonal;
  const zoneSteps = Math.abs(ZONE_INDEX[zoneOf(box, scene.safe)] - ZONE_INDEX[item.relation.zone]);
  const subject = item.relation.relativeTo === 'subject' && head && item.relation.side;
  // For a subject relation the band is only a tie-break.
  cost += weights.zone * zoneSteps * (subject ? 0.15 : 1);
  if (subject) {
    const side = track ? sideOver(box, track) : sideOf(box, head);
    const wanted = item.relation.side!;
    if (side !== wanted) {
      const across = (wanted === 'left' && side === 'right') || (wanted === 'right' && side === 'left');
      const flipped =
        across || (wanted === 'above' && side === 'below') || (wanted === 'below' && side === 'above');
      cost += weights.side * (flipped ? 1 : 0.6);
    }
  }
  return cost;
}

/** The band an item's centre should sit in when nothing is known of the reel but its box. */
export function frameRelation(box: Rect, frame: Rect): OverlayPlacement {
  return { relativeTo: 'frame', zone: zoneOf(box, frame) };
}
