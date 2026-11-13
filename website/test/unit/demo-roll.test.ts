// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { CAMERA_ROLL, ROLL_FRAMES, SAMPLE_REELS as REELS } from '#content/reels';
import type { CameraRoll, Reel } from '#content/schema';
import {
  formatCount,
  formatDay,
  groupByDay,
  pickCellSprite,
  shownDays,
  slotPicks,
  spriteStyle,
  squareSpritePosition,
  stableHash,
  wallDays,
} from '#components/demo/roll';

describe('the camera roll on the stage', () => {
  it('groups clips by day, in date order', () => {
    const days = groupByDay([...CAMERA_ROLL.clips].reverse());
    expect(days.map((d) => d.day)).toEqual([...days.map((d) => d.day)].sort());
    expect(days.reduce((n, d) => n + d.clips.length, 0)).toBe(CAMERA_ROLL.clips.length);
  });

  /** A roll over four days, so the cap and the pick-day rule have something to choose between. */
  const fourDays: CameraRoll = {
    ...CAMERA_ROLL,
    clips: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'].flatMap((day, d) =>
      [0, 1, 2].map((n) => ({ id: `d${d}-c${n}`, day, sprite: d * 3 + n, durationSec: 2 })),
    ),
  };
  const noPicks = (reel: Reel): Reel => ({ ...reel, slots: reel.slots.map((s) => ({ ...s, pick: { ...s.pick, clipId: 'none' } })) });

  it('shows the earliest days up to the cap', () => {
    const days = shownDays(fourDays, REELS.map(noPicks), 3);
    expect(days.map((d) => d.day)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('always shows a day that holds a real pick, so its flight has a cell to leave from', () => {
    const late = fourDays.clips[fourDays.clips.length - 1]!;
    const base = noPicks(REELS[0]!);
    const reel: Reel = { ...base, slots: base.slots.map((s, i) => (i === 0 ? { ...s, pick: { ...s.pick, clipId: late.id } } : s)) };
    const days = shownDays(fourDays, [reel], 2);
    expect(days.map((d) => d.day)).toContain(late.day);
    expect(days).toHaveLength(2);
    expect(slotPicks(reel, days).picks[0]).toBe(late.id);
  });

  it('picks one distinct clip per slot from the shown days, the same every time', () => {
    const days = shownDays(CAMERA_ROLL, REELS, 6);
    const shown = new Set(days.flatMap((d) => d.clips.map((c) => c.id)));
    for (const reel of REELS) {
      const a = slotPicks(reel, days);
      const b = slotPicks(reel, days);
      expect(a.picks).toEqual(b.picks);
      expect(new Set(a.picks).size).toBe(reel.slots.length);
      expect(a.picks.every((id) => shown.has(id))).toBe(true);
      for (const id of a.picks) expect(a.candidates.has(id)).toBe(true);
      const alternates = reel.slots.reduce((n, s) => n + s.pick.alternates, 0);
      expect(a.candidates.size).toBe(Math.min(reel.slots.length + alternates, shown.size));
    }
    if (REELS.length > 1) expect(slotPicks(REELS[0]!, days).picks).not.toEqual(slotPicks(REELS[1]!, days).picks);
  });

  it('copes with an empty roll', () => {
    const empty: CameraRoll = { ...CAMERA_ROLL, clips: [] };
    expect(slotPicks(REELS[0]!, shownDays(empty, REELS, 4)).picks.every((id) => id === '')).toBe(true);
  });

  it('cuts a thumbnail from the atlas by percentages, so it fits any box', () => {
    const { atlas } = CAMERA_ROLL;
    expect(spriteStyle(atlas, 0)).toMatchObject({ backgroundPosition: '0% 0%', backgroundSize: `${atlas.columns * 100}% ${atlas.rows * 100}%` });
    expect(spriteStyle(atlas, atlas.columns * atlas.rows - 1).backgroundPosition).toBe('100% 100%');
    expect(spriteStyle(atlas, 9999).backgroundPosition).toBe('100% 100%');
  });

  it('fills the wall with every frame in the atlas, under the days the roll has, and no more days than that', () => {
    const days = shownDays(CAMERA_ROLL, REELS, 8);
    const wall = wallDays(CAMERA_ROLL, ROLL_FRAMES, days);
    expect(wall.map((d) => d.day)).toEqual(groupByDay(CAMERA_ROLL.clips).map((d) => d.day));
    const cells = wall.flatMap((d) => d.cells);
    expect(cells.length).toBe(ROLL_FRAMES.length);
    expect(cells.length).toBeGreaterThan(CAMERA_ROLL.clips.length);
    // Three rows of ten or more: the hero's density floor.
    expect(cells.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cells.map((c) => c.sprite)).size).toBe(cells.length);
  });

  it('flies each pick from a cell of its own clip', () => {
    const days = shownDays(CAMERA_ROLL, REELS, 8);
    const cells = wallDays(CAMERA_ROLL, ROLL_FRAMES, days).flatMap((d) => d.cells);
    for (const reel of REELS) {
      for (const id of slotPicks(reel, days).picks) {
        const sprite = pickCellSprite(CAMERA_ROLL, cells, id);
        expect(cells.find((c) => c.sprite === sprite)?.clipId, id).toBe(id);
      }
    }
    expect(pickCellSprite(CAMERA_ROLL, cells, 'no-such-clip')).toBeUndefined();
  });

  it('crops a square from the middle of a frame, the way a camera roll shows it', () => {
    const atlas = { src: '/a.webp', columns: 16, rows: 3, cell: [90, 160] as const };
    expect(squareSpritePosition(atlas, 0)).toBe('0% 8.97%');
    expect(squareSpritePosition(atlas, 16 + 15)).toBe('100% 50%');
    expect(squareSpritePosition(atlas, 47)).toBe('100% 91.03%');
  });

  it('hashes the same text the same way', () => {
    expect(stableHash('trip:hook')).toBe(stableHash('trip:hook'));
    expect(stableHash('trip:hook')).not.toBe(stableHash('food:hook'));
  });

  it('writes days and counts as the page shows them', () => {
    expect(formatDay('2026-10-01')).toBe('Oct 1');
    expect(formatDay('not a day')).toBe('not a day');
    expect(formatCount(1284)).toBe('1,284');
  });
});
