// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The placement solver (FRM1-OVL, plan "ovl" 2): each made text or graphic item's box inside the safe area, in
 * time order. Hard constraints: no head (with a margin) on any sampled frame of the item's span, no caption, no
 * other item on screen with it. Among the boxes that keep them (the relation's own box, a grid over the safe area,
 * and every place flush beside a head or an obstacle) the cheapest wins: closest to the reel's relation, off the
 * person's body, off a busy background, and keeping a conversation's order and columns. With no room at the
 * reel's size it shrinks, down to QA's readable minimum; with none then it is `noRoom` at the relation's box, and
 * place-timeline.ts tries the clip's in-point and the slot's next clip. Pure and deterministic.
 */
import { conversationCost, headKeepOuts, sceneCost } from './costs';
import {
  bottom,
  inflate,
  inside,
  intersects,
  right,
  spansOverlap,
  within,
  type Rect,
  type Size,
} from './geometry';
import { mainHeadTrack, relationCost, sideOf, sideOver, targetBox } from './relation';
import type { Placed, PlacementItem, Scene, SolverConfig } from './types';

export const SOLVER_CONFIG: SolverConfig = {
  headMargin: 0.12,
  headMarginPx: 12,
  headMarginMaxPx: 56,
  itemGapPx: 12,
  shrinkSteps: [0.9, 0.8, 0.7, 0.6, 0.5, 0.4],
  columns: 24,
  rows: 48,
  conversationGapFrames: 60,
  weights: { side: 1, distance: 1.5, zone: 0.5, body: 0.5, busy: 0.25, order: 0.8, column: 0.4 },
};

/** Within this share of the canvas's diagonal of the relation's own box, an item still sits as the reel's. */
const AS_REEL_SHARE = 0.01;

function candidates(
  size: Size,
  target: Rect,
  keepOuts: readonly Rect[],
  blocked: readonly Rect[],
  scene: Scene,
  config: SolverConfig,
): Rect[] {
  const { safe } = scene;
  const gap = config.itemGapPx;
  const xs = new Set<number>([target.x]);
  const ys = new Set<number>([target.y]);
  for (let i = 0; i <= config.columns; i++) xs.add(safe.x + ((safe.width - size.width) * i) / config.columns);
  for (let j = 0; j <= config.rows; j++) ys.add(safe.y + ((safe.height - size.height) * j) / config.rows);
  // Flush beside every keep-out and obstacle: the nearest free places are there.
  for (const rect of keepOuts) {
    xs.add(rect.x - size.width - 1).add(right(rect) + 1);
    ys.add(rect.y - size.height - 1).add(bottom(rect) + 1);
  }
  for (const rect of blocked) {
    xs.add(rect.x - gap - size.width).add(right(rect) + gap);
    ys.add(rect.y - gap - size.height).add(bottom(rect) + gap);
  }
  const out: Rect[] = [];
  const seen = new Set<string>();
  for (const x of xs)
    for (const y of ys) {
      const box = within(x, y, size, safe);
      const key = `${Math.round(box.x)}:${Math.round(box.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(box);
    }
  return out;
}

interface Done {
  readonly item: PlacementItem;
  readonly placed: Placed;
}

function solveOne(item: PlacementItem, scene: Scene, done: readonly Done[], config: SolverConfig): Placed {
  const frames = scene.frames(item.span);
  const keepOuts = headKeepOuts(frames, config);
  const track = mainHeadTrack(frames);
  const head = track?.swept ?? null;
  const sideAt = (box: Rect) => (track ? sideOver(box, track) : null);
  const blocked = [
    ...scene.obstacles
      .filter((obstacle) => spansOverlap(obstacle.span, item.span))
      .map((obstacle) => obstacle.box),
    ...done.filter((other) => spansOverlap(other.item.span, item.span)).map((other) => other.placed.box),
  ];
  const diagonal = Math.hypot(scene.canvas.width, scene.canvas.height);
  // The reel's side of the head is part of fitting: a smaller item on the reel's side beats a full-size one on
  // another side, which is kept only for when no size keeps the side.
  const wanted = item.relation.relativeTo === 'subject' && head ? (item.relation.side ?? null) : null;
  let fallback: Placed | null = null;
  // When no size keeps the side on most frames: the box on the reel's side on the most frames, at any size (the
  // side still beats size; the larger size, then the lower cost, on a tie).
  const onSide = (box: Rect) =>
    track && wanted
      ? track.frames.filter((frame) => sideOf(box, frame) === wanted).length / track.frames.length
      : 0;
  let nearest: { box: Rect; cost: number; on: number; scale: number } | null = null;
  for (const scale of [1, ...config.shrinkSteps.filter((step) => step >= item.minScale)]) {
    const size = item.sizeAt(scale);
    const target = targetBox(item, size, head, scene.safe, config);
    let best: { box: Rect; cost: number } | null = null;
    let beside: { box: Rect; cost: number } | null = null;
    for (const box of candidates(size, target, keepOuts, blocked, scene, config)) {
      if (!inside(box, scene.safe)) continue;
      if (keepOuts.some((rect) => intersects(box, rect))) continue;
      if (blocked.some((rect) => intersects(inflate(box, config.itemGapPx - 1), rect))) continue;
      const cost =
        relationCost(item, box, target, head, scene, config, track) +
        sceneCost(item, box, frames, config) +
        conversationCost(item, box, done, config, scene.canvas.width);
      if (!best || cost < best.cost - 1e-9) best = { box, cost };
      if (wanted && head && sideAt(box) === wanted && (!beside || cost < beside.cost - 1e-9))
        beside = { box, cost };
      if (wanted) {
        const on = onSide(box);
        const tie = nearest && Math.abs(on - nearest.on) <= 1e-9 && nearest.scale === scale;
        if (!nearest || on > nearest.on + 1e-9 || (tie && cost < nearest.cost - 1e-9))
          nearest = { box, cost, on, scale };
      }
    }
    const chosen = wanted ? beside : best;
    if (chosen) {
      const kept = Math.hypot(chosen.box.x - target.x, chosen.box.y - target.y) <= AS_REEL_SHARE * diagonal;
      const reason = scale < 1 ? 'shrunk' : kept ? 'asReel' : 'moved';
      return {
        id: item.id,
        box: chosen.box,
        scale,
        reason,
        side: sideAt(chosen.box),
        cost: chosen.cost,
      };
    }
    if (best && !fallback)
      fallback = {
        id: item.id,
        box: best.box,
        scale,
        reason: scale < 1 ? 'shrunk' : 'moved',
        side: sideAt(best.box),
        cost: best.cost,
      };
  }
  if (nearest)
    return {
      id: item.id,
      box: nearest.box,
      scale: nearest.scale,
      reason: nearest.scale < 1 ? 'shrunk' : 'moved',
      side: sideAt(nearest.box),
      cost: nearest.cost,
    };
  if (fallback) return fallback;
  const size = item.sizeAt(1);
  const box = targetBox(item, size, head, scene.safe, config);
  return {
    id: item.id,
    box,
    scale: 1,
    reason: 'noRoom',
    side: sideAt(box),
    cost: Infinity,
  };
}

/** Every item's box, in time order (each clears the ones placed before it). */
export function solvePlacements(
  items: readonly PlacementItem[],
  scene: Scene,
  config: SolverConfig = SOLVER_CONFIG,
): Placed[] {
  const ordered = [...items].sort((a, b) => a.span.start - b.span.start || a.id.localeCompare(b.id));
  const done: Done[] = [];
  for (const item of ordered) done.push({ item, placed: solveOne(item, scene, done, config) });
  const byId = new Map(done.map((entry) => [entry.item.id, entry.placed]));
  return items.map((item) => byId.get(item.id)!);
}

/** Conversation ids for chat bubbles in time order: a new one after a pause longer than `gapFrames`. */
export function conversationsOf(
  spans: readonly { readonly id: string; readonly start: number; readonly end: number }[],
  gapFrames: number,
): Map<string, number> {
  const ordered = [...spans].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const out = new Map<string, number>();
  let conversation = 0;
  let end = -Infinity;
  for (const span of ordered) {
    if (span.start - end > gapFrames) conversation++;
    out.set(span.id, conversation);
    end = Math.max(end, span.end);
  }
  return out;
}
