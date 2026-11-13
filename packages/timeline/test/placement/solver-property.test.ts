// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL property: on random scenes (one to four heads, still or moving, captions sometimes, one to three
 * items), wherever a brute-force search finds a free spot at any allowed size, the solver places the item and it
 * never overlaps a head, on any sampled frame, with the margin; it says `noRoom` only when it finds no spot. Seeded, so
 * a failure replays.
 */
import { describe, expect, it } from 'vitest';
import { headKeepOuts } from '../../src/assembly/placement/costs';
import { inflate, inside, intersects, spansOverlap, type Rect } from '../../src/assembly/placement/geometry';
import { SOLVER_CONFIG, solvePlacements } from '../../src/assembly/placement/solve';
import type { Obstacle, Placed, PlacementItem, Scene } from '../../src/assembly/placement/types';
import { head, item, movingHead, PORTRAIT_SAFE, scene } from './scenes';

/** mulberry32: a small seeded generator. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCase(seed: number): { scene: Scene; items: PlacementItem[] } {
  const r = random(seed);
  const people = 1 + Math.floor(r() * 4);
  const paths = Array.from({ length: people }, () => {
    const width = 120 + r() * 360;
    const from = head(60 + r() * 800, 150 + r() * 1100, width);
    const moves = r() < 0.4;
    const to = moves ? head(60 + r() * 800, from.y + (r() - 0.5) * 200, width) : from;
    return movingHead(from, to, 0, 200);
  });
  const obstacles: Obstacle[] =
    r() < 0.5
      ? [{ span: { start: 0, end: 300 }, box: { x: 120, y: 1050 + r() * 100, width: 660, height: 140 } }]
      : [];
  const items = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, index) => {
    const start = Math.floor(r() * 150);
    return item({
      id: `i${index}`,
      span: { start, end: start + 30 + Math.floor(r() * 120) },
      size: { width: 140 + r() * 400, height: 70 + r() * 140 },
      relation:
        r() < 0.5
          ? { relativeTo: 'frame', zone: (['top', 'middle', 'bottom'] as const)[Math.floor(r() * 3)]! }
          : {
              relativeTo: 'subject',
              side: (['left', 'right', 'above', 'below'] as const)[Math.floor(r() * 4)]!,
              zone: 'top',
              gap: r(),
            },
      reel: { x: 120 + r() * 500, y: 288 + r() * 800, width: 300, height: 110 },
      minScale: 0.5 + r() * 0.3,
    });
  });
  return {
    scene: scene({ heads: (frame) => paths.flatMap((path) => path(frame)), obstacles }),
    items,
  };
}

/** Whether any box of the item, at any allowed scale, on a 6 px grid, keeps every hard constraint. */
function freeSpotExists(
  target: PlacementItem,
  s: Scene,
  before: readonly { item: PlacementItem; placed: Placed }[],
) {
  const keepOuts = headKeepOuts(s.frames(target.span), SOLVER_CONFIG);
  const blocked: Rect[] = [
    ...s.obstacles.filter((o) => spansOverlap(o.span, target.span)).map((o) => o.box),
    ...before.filter((b) => spansOverlap(b.item.span, target.span)).map((b) => b.placed.box),
  ];
  for (const scale of [1, ...SOLVER_CONFIG.shrinkSteps.filter((step) => step >= target.minScale)]) {
    const size = target.sizeAt(scale);
    for (let x = PORTRAIT_SAFE.x; x + size.width <= PORTRAIT_SAFE.x + PORTRAIT_SAFE.width; x += 6)
      for (let y = PORTRAIT_SAFE.y; y + size.height <= PORTRAIT_SAFE.y + PORTRAIT_SAFE.height; y += 6) {
        const box = { x, y, ...size };
        if (keepOuts.some((k) => intersects(box, k))) continue;
        if (blocked.some((b) => intersects(inflate(box, SOLVER_CONFIG.itemGapPx - 1), b))) continue;
        return true;
      }
  }
  return false;
}

describe('the solver on random scenes', () => {
  it('never covers a head wherever a free spot exists, and says noRoom only where none does', () => {
    let free = 0;
    let none = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { scene: s, items } = randomCase(seed);
      const placed = solvePlacements(items, s);
      const ordered = items
        .map((entry, index) => ({ item: entry, placed: placed[index]! }))
        .sort((a, b) => a.item.span.start - b.item.span.start || a.item.id.localeCompare(b.item.id));
      ordered.forEach((entry, index) => {
        const exists = freeSpotExists(entry.item, s, ordered.slice(0, index));
        const keepOuts = headKeepOuts(s.frames(entry.item.span), SOLVER_CONFIG);
        const covers = keepOuts.some((k) => intersects(entry.placed.box, k));
        const label = `seed ${seed} item ${entry.item.id}`;
        if (exists) expect(entry.placed.reason, label).not.toBe('noRoom');
        // Any box it places keeps every hard constraint (it may find a spot flush to a keep-out the grid missed).
        if (entry.placed.reason !== 'noRoom') {
          free++;
          expect(covers, label).toBe(false);
          expect(inside(entry.placed.box, PORTRAIT_SAFE), label).toBe(true);
          expect(entry.placed.scale, label).toBeGreaterThanOrEqual(entry.item.minScale);
        } else none++;
      });
    }
    // Both kinds of case were exercised.
    expect(free).toBeGreaterThan(200);
    expect(none).toBeGreaterThan(0);
  }, 30_000); // 300 scenes: ~1.6 s, longer on a loaded machine
});
