// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL placement fixtures, part 1: faces in each zone, two people, a face that fills the frame. Every case
 * with a free spot ends clear of every head (with the margin); every other case is the documented fallback.
 */
import { describe, expect, it } from 'vitest';
import { bottom, inside, right } from '../../src/assembly/placement/geometry';
import { solvePlacements } from '../../src/assembly/placement/solve';
import { coversHead, head, item, LANDSCAPE, LANDSCAPE_SAFE, PORTRAIT_SAFE, scene } from './scenes';

const one = (spec: Parameters<typeof scene>[0], itemSpec: Parameters<typeof item>[0] = {}) => {
  const s = scene(spec);
  const i = item(itemSpec);
  const [placed] = solvePlacements([i], s);
  return { s, i, placed: placed! };
};

describe('with nobody on screen', () => {
  it('keeps the reel’s box (1)', () => {
    const { placed, i } = one({});
    expect(placed.reason).toBe('asReel');
    expect(placed.box.x).toBeCloseTo(i.reel.x, 0);
    expect(placed.box.y).toBeCloseTo(i.reel.y, 0);
  });

  it('keeps a bottom-band box where the reel had it (2)', () => {
    const reel = { x: 300, y: 1100, width: 300, height: 110 };
    const { placed } = one({}, { reel, relation: { relativeTo: 'frame', zone: 'bottom' } });
    expect(placed.reason).toBe('asReel');
    expect(placed.box.y).toBeCloseTo(1100, 0);
  });

  it('clamps a box past the safe area inside it (3)', () => {
    const { placed } = one({}, { reel: { x: 900, y: 100, width: 300, height: 110 } });
    expect(inside(placed.box, PORTRAIT_SAFE)).toBe(true);
    expect(placed.reason).toBe('asReel');
  });
});

describe('a face in each zone', () => {
  it('top: the reel’s box over the head moves off it (4)', () => {
    const { placed, s, i } = one({ heads: () => [head(400, 290)] });
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.reason).toBe('moved');
  });

  it('top: beside the head on the reel’s side, level with it (5)', () => {
    const h = head(150, 320, 200);
    const { placed, s, i } = one(
      { heads: () => [h] },
      {
        relation: { relativeTo: 'subject', side: 'right', zone: 'top', gap: 0.2 },
        size: { width: 300, height: 110 },
      },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.side).toBe('right');
    expect(placed.box.x).toBeGreaterThanOrEqual(right(h));
  });

  it('middle: a left relation sits left of the head (6)', () => {
    const h = head(560, 650, 200);
    const { placed, s, i } = one(
      { heads: () => [h] },
      {
        relation: { relativeTo: 'subject', side: 'left', zone: 'middle' },
        size: { width: 280, height: 100 },
      },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.side).toBe('left');
  });

  it('bottom: an above relation sits over the head (7)', () => {
    const h = head(360, 950, 200);
    const { placed, s, i } = one(
      { heads: () => [h] },
      { relation: { relativeTo: 'subject', side: 'above', zone: 'bottom' } },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.side).toBe('above');
    expect(bottom(placed.box)).toBeLessThanOrEqual(h.y);
  });

  it('top: a below relation sits under the head (8)', () => {
    const h = head(400, 300, 180);
    const { placed, s, i } = one(
      { heads: () => [h] },
      { relation: { relativeTo: 'subject', side: 'below', zone: 'middle' } },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.side).toBe('below');
  });

  it('an above relation with no room above the head moves to a side, clear of it (9)', () => {
    const h = head(380, 300, 220);
    const { placed, s, i } = one(
      { heads: () => [h] },
      { relation: { relativeTo: 'subject', side: 'above', zone: 'top' }, size: { width: 260, height: 100 } },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.reason).not.toBe('noRoom');
  });

  it('a frame relation in the middle band, with a head in the middle, moves the least (10)', () => {
    const reel = { x: 390, y: 700, width: 300, height: 110 };
    const { placed, s, i } = one(
      { heads: () => [head(420, 640, 240)] },
      { reel, relation: { relativeTo: 'frame', zone: 'middle' } },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.reason).toBe('moved');
  });

  it('a small head far from the reel’s box changes nothing (11)', () => {
    const { placed } = one({ heads: () => [head(650, 1100, 80)] });
    expect(placed.reason).toBe('asReel');
  });

  it('keeps the reel’s gap from the head (12)', () => {
    const h = head(140, 400, 200);
    const { placed } = one(
      { heads: () => [h] },
      { relation: { relativeTo: 'subject', side: 'right', zone: 'top', gap: 0.5 } },
    );
    expect(placed.box.x - right(h)).toBeCloseTo(0.5 * h.height, 0);
  });

  it('keeps the margin round the head too, not only the head (13)', () => {
    const h = head(140, 400, 200);
    const { placed, s, i } = one(
      { heads: () => [h] },
      { relation: { relativeTo: 'subject', side: 'right', zone: 'top', gap: 0 } },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.box.x - right(h)).toBeGreaterThanOrEqual(Math.min(56, 0.12 * h.height));
  });
});

describe('two people', () => {
  it('beside the main (larger) head, clear of the other (14)', () => {
    const big = head(150, 360, 230);
    const small = head(600, 420, 150);
    const { placed, s, i } = one(
      { heads: () => [big, small] },
      { relation: { relativeTo: 'subject', side: 'right', zone: 'top' }, size: { width: 200, height: 90 } },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.side).toBe('right');
  });

  it('side by side across the frame: above or below them both (15)', () => {
    const { placed, s, i } = one({ heads: () => [head(130, 500, 300), head(470, 500, 300)] });
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.reason).not.toBe('noRoom');
  });

  it('one above the other: in the free column (16)', () => {
    const { placed, s, i } = one(
      { heads: () => [head(130, 300, 260), head(130, 760, 260)] },
      {
        relation: { relativeTo: 'frame', zone: 'middle' },
        reel: { x: 200, y: 700, width: 300, height: 110 },
      },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
  });
});

describe('a face that fills the frame', () => {
  it('shrinks into the room left beside it (17)', () => {
    const h = { x: 120, y: 288, width: 500, height: 960 };
    const { placed, s, i } = one(
      { heads: () => [h] },
      { size: { width: 140, height: 120 }, relation: { relativeTo: 'subject', side: 'right', zone: 'top' } },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.reason).toBe('shrunk');
    expect(placed.scale).toBeLessThan(1);
    expect(placed.scale).toBeGreaterThanOrEqual(0.6);
  });

  it('with no room at QA’s smallest size, is noRoom, never a silent cover (18)', () => {
    const { placed } = one({ heads: () => [{ x: 60, y: 200, width: 960, height: 1200 }] });
    expect(placed.reason).toBe('noRoom');
    expect(placed.cost).toBe(Infinity);
  });

  it('never goes below its smallest scale (19)', () => {
    const h = { x: 120, y: 288, width: 600, height: 960 };
    const { placed } = one({ heads: () => [h] }, { size: { width: 120, height: 100 }, minScale: 0.8 });
    expect(placed.reason).toBe('noRoom');
  });
});

describe('a landscape canvas', () => {
  it('beside a centred head on the reel’s side (20)', () => {
    const h = head(840, 300, 240);
    const { placed, s, i } = one(
      { canvas: LANDSCAPE, safe: LANDSCAPE_SAFE, heads: () => [h] },
      {
        relation: { relativeTo: 'subject', side: 'left', zone: 'top' },
        reel: { x: 500, y: 300, width: 300, height: 110 },
      },
    );
    expect(coversHead(placed, s, i.span, true)).toBe(false);
    expect(placed.side).toBe('left');
  });

  it('is deterministic (21)', () => {
    const spec = { heads: () => [head(400, 290), head(150, 800, 150)] };
    const a = one(spec).placed;
    const b = one(spec).placed;
    expect(a).toEqual(b);
  });
});
