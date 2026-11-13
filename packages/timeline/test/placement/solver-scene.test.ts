// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-OVL placement fixtures, part 2: a subject that moves through the item's span, a cut under the item,
 * captions and other graphics present, a two- and three-bubble conversation, the soft costs, and the reel's side of
 * a head that moves.
 */
import { describe, expect, it } from 'vitest';
import { centreX, centreY, intersects, right } from '../../src/assembly/placement/geometry';
import { mainHeadTrack, sideOf, sideOver } from '../../src/assembly/placement/relation';
import { conversationsOf, solvePlacements } from '../../src/assembly/placement/solve';
import { bodyOf, coversHead, head, item, movingHead, scene } from './scenes';

describe('a subject that moves through the span', () => {
  it('is kept clear on every sampled frame (22)', () => {
    const s = scene({ heads: movingHead(head(130, 300), head(560, 300), 0, 150) });
    const i = item({ span: { start: 0, end: 150 } });
    const [placed] = solvePlacements([i], s);
    expect(coversHead(placed!, s, i.span, true)).toBe(false);
  });

  it('is kept clear between samples too: the ground a fast head covers is swept (23)', () => {
    // Sampled every 8 frames, the head jumps 120 px a sample; every frame in between must be clear.
    const path = movingHead(head(120, 320, 200), head(580, 320, 200), 0, 32);
    const s = scene({ heads: path, length: 40 });
    const i = item({ span: { start: 0, end: 32 }, size: { width: 240, height: 100 } });
    const [placed] = solvePlacements([i], s);
    for (let frame = 0; frame < 32; frame++)
      for (const h of path(frame)) expect(intersects(placed!.box, h)).toBe(false);
  });

  it('a head that comes on half way through is avoided from the start (24)', () => {
    const s = scene({ heads: (frame) => (frame >= 80 ? [head(400, 290)] : []) });
    const [placed] = solvePlacements([item()], s);
    expect(coversHead(placed!, s, { start: 30, end: 120 }, true)).toBe(false);
  });

  it('a cut under the item: the heads of both clips are kept clear (25)', () => {
    const s = scene({ heads: (frame) => (frame < 75 ? [head(150, 300)] : [head(560, 300, 200)]) });
    const i = item({ span: { start: 30, end: 120 } });
    const [placed] = solvePlacements([i], s);
    expect(coversHead(placed!, s, i.span, true)).toBe(false);
  });
});

describe('captions and other graphics present', () => {
  const caption = { span: { start: 0, end: 300 }, box: { x: 120, y: 1100, width: 660, height: 140 } };

  it('a bottom-band item clears the captions (26)', () => {
    const s = scene({ obstacles: [caption] });
    const [placed] = solvePlacements(
      [
        item({
          reel: { x: 390, y: 1120, width: 300, height: 110 },
          relation: { relativeTo: 'frame', zone: 'bottom' },
        }),
      ],
      s,
    );
    expect(intersects(placed!.box, caption.box)).toBe(false);
    expect(placed!.reason).toBe('moved');
  });

  it('captions and a head at once: both cleared (27)', () => {
    const s = scene({ obstacles: [caption], heads: () => [head(400, 860, 260)] });
    const i = item({
      reel: { x: 390, y: 1000, width: 300, height: 110 },
      relation: { relativeTo: 'frame', zone: 'bottom' },
    });
    const [placed] = solvePlacements([i], s);
    expect(intersects(placed!.box, caption.box)).toBe(false);
    expect(coversHead(placed!, s, i.span, true)).toBe(false);
  });

  it('a caption that is over before the item starts doesn’t move it (28)', () => {
    const s = scene({
      obstacles: [{ span: { start: 0, end: 20 }, box: { x: 120, y: 280, width: 660, height: 200 } }],
    });
    const [placed] = solvePlacements([item()], s);
    expect(placed!.reason).toBe('asReel');
  });

  it('two items on screen together never overlap (29)', () => {
    const s = scene({});
    const a = item({ id: 'a', span: { start: 0, end: 100 } });
    const b = item({ id: 'b', span: { start: 50, end: 150 } });
    const [pa, pb] = solvePlacements([a, b], s);
    expect(intersects(pa!.box, pb!.box)).toBe(false);
    expect(pa!.reason).toBe('asReel');
  });
});

describe('a conversation', () => {
  const chat = (id: string, start: number, tail: 'left' | 'right', y: number, conversation = 1) =>
    item({
      id,
      span: { start, end: start + 120 },
      size: { width: 320, height: 100 },
      chat: { tail, conversation },
      reel: { x: tail === 'left' ? 140 : 440, y, width: 320, height: 100 },
      relation: { relativeTo: 'subject', side: 'right', zone: 'top' },
    });

  it('two bubbles keep the reel’s order and sides, clear of the head (30)', () => {
    const s = scene({ heads: () => [head(130, 300, 180)] });
    const [first, second] = solvePlacements([chat('a', 0, 'left', 320), chat('b', 40, 'right', 450)], s);
    expect(centreY(second!.box)).toBeGreaterThan(centreY(first!.box));
    expect(centreX(second!.box)).toBeGreaterThan(centreX(first!.box));
    for (const placed of [first!, second!])
      expect(coversHead(placed, s, { start: 0, end: 160 }, true)).toBe(false);
  });

  it('two bubbles from one speaker share their column (31)', () => {
    const s = scene({ heads: () => [head(130, 300, 180)] });
    const [first, second] = solvePlacements([chat('a', 0, 'right', 320), chat('b', 40, 'right', 450)], s);
    expect(Math.abs(right(first!.box) - right(second!.box))).toBeLessThan(2);
    expect(centreY(second!.box)).toBeGreaterThan(centreY(first!.box));
  });

  it('three bubbles stack in the reel’s order (32)', () => {
    const s = scene({ heads: () => [head(560, 330, 200)] });
    const placed = solvePlacements(
      [chat('a', 0, 'left', 320), chat('b', 30, 'right', 440), chat('c', 60, 'left', 560)],
      s,
    );
    expect(centreY(placed[0]!.box)).toBeLessThan(centreY(placed[1]!.box));
    expect(centreY(placed[1]!.box)).toBeLessThan(centreY(placed[2]!.box));
    for (const p of placed) expect(coversHead(p, s, { start: 0, end: 180 }, true)).toBe(false);
  });

  it('a long pause starts a new conversation (33)', () => {
    const ids = conversationsOf(
      [
        { id: 'a', start: 0, end: 60 },
        { id: 'b', start: 70, end: 120 },
        { id: 'c', start: 400, end: 450 },
      ],
      60,
    );
    expect(ids.get('a')).toBe(ids.get('b'));
    expect(ids.get('c')).not.toBe(ids.get('a'));
  });
});

describe('the soft costs', () => {
  it('words on the picture avoid a busy region when the relation allows either (34)', () => {
    const salient = [{ x: 120, y: 288, width: 330, height: 300 }];
    const s = scene({ salient });
    const [placed] = solvePlacements(
      [
        item({
          reel: { x: 300, y: 300, width: 300, height: 110 },
          onPicture: true,
          size: { width: 300, height: 110 },
        }),
      ],
      s,
    );
    const share = Math.max(0, Math.min(right(placed!.box), 450) - Math.max(placed!.box.x, 120)) / 300;
    expect(share).toBeLessThan(0.6);
  });

  it('prefers the side off the body when the relation is a frame band (35)', () => {
    const h = head(500, 300, 200);
    const s = scene({ heads: () => [h] });
    const [placed] = solvePlacements([item({ reel: { x: 400, y: 520, width: 260, height: 100 } })], s);
    expect(intersects(placed!.box, bodyOf(h))).toBe(false);
  });

  it('reads the silhouette, where the track has one, as the body (36)', () => {
    const silhouette = (rect: { x: number }) => (rect.x < 450 ? 1 : 0);
    const s = scene({ silhouette });
    const [placed] = solvePlacements([item({ reel: { x: 400, y: 600, width: 260, height: 100 } })], s);
    expect(placed!.box.x).toBeGreaterThanOrEqual(450);
  });
});

describe('the reel’s side of a head that moves', () => {
  // The owner's case: the head drops through the span, so a box up and to its left sits beside the head's sweep
  // but above the head on most frames, as a viewer sees it and as the reel's relation was read.
  const heads = Array.from({ length: 8 }, (_, index) => head(400, 400 + index * 100, 200));
  const swept = { x: 400, y: 400, width: 200, height: 950 };
  const box = { x: 100, y: 300, width: 250, height: 170 };

  it('is the side the box holds on most frames, not beside the sweep (37)', () => {
    expect(sideOf(box, swept)).toBe('left');
    expect(sideOver(box, { swept, frames: [heads[4]!, ...heads] })).toBe('above');
  });

  it('a tie goes to the span’s middle (38)', () => {
    const two = [head(400, 300, 200), head(400, 1100, 200)];
    expect(sideOf(box, two[0]!)).toBe('left');
    expect(sideOf(box, two[1]!)).toBe('above');
    expect(sideOver(box, { swept, frames: two })).toBe('left');
    expect(sideOver(box, { swept, frames: [two[1]!, two[0]!] })).toBe('above');
  });

  it('no size holds the side on most frames: the box on it on the most frames, smaller if need be (40)', () => {
    // The head sweeps in from the left edge: early on nothing fits left of it, later a small box does.
    const s = scene({ heads: movingHead(head(130, 500, 200), head(420, 380, 200), 0, 150) });
    const span = { start: 0, end: 150 };
    const [placed] = solvePlacements(
      [item({ relation: { relativeTo: 'subject', side: 'left', zone: 'top', gap: 0.3 } })],
      s,
    );
    const track = mainHeadTrack(s.frames(span))!;
    const on = track.frames.filter((frame) => sideOf(placed!.box, frame) === 'left').length;
    expect(placed!.side).not.toBe('left');
    expect(on).toBeGreaterThan(0);
    expect(placed!.reason).toBe('shrunk');
    expect(coversHead(placed!, s, span)).toBe(false);
  });

  it('the solver reports that side, so retime and recast can mend it (39)', () => {
    const s = scene({ heads: movingHead(head(400, 400, 200), head(400, 1100, 200), 0, 150) });
    const [placed] = solvePlacements(
      [item({ relation: { relativeTo: 'subject', side: 'left', zone: 'top', gap: 0.3 } })],
      s,
    );
    const frames = s.frames({ start: 0, end: 150 });
    const track = mainHeadTrack(frames)!;
    expect(placed!.side).toBe(sideOver(placed!.box, track));
  });
});
