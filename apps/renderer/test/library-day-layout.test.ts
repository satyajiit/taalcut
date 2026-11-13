// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4 lib: the clip grid grouped by day. Each day is a block under its own heading starting on a new row; clips not
// loaded yet are one block of bones at the end; sorted by length there are no days. The window draws only the rows
// on screen, and the arrows step between days keeping their column.
import { describe, expect, it } from 'vitest';
import {
  DAY_HEADING,
  dayKeyOf,
  groupOf,
  layoutDays,
  moveInDays,
  placeOf,
  windowOf,
} from '../src/features/library/day-layout';

const metrics = { columns: 4, row: 100, gap: 12 };
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const clip = (time: number) => ({ capturedAt: time, addedAt: time });

/** Six clips on Oct 12, three on Oct 11, one on Oct 9: newest first, as the grid sorts them. */
const ITEMS = [
  ...[23, 20, 18, 15, 12, 9].map((h) => clip(at(2026, 10, 12, h))),
  ...[22, 14, 8].map((h) => clip(at(2026, 10, 11, h))),
  clip(at(2026, 10, 9)),
];

describe('library › day layout', () => {
  it('puts each day in its own block under a heading, each starting on a new row', () => {
    const layout = layoutDays(ITEMS, ITEMS.length, metrics, 'captured');
    expect(layout.groups.map((g) => [g.key, g.start, g.count, g.rows])).toEqual([
      ['2026-10-12', 0, 6, 2],
      ['2026-10-11', 6, 3, 1],
      ['2026-10-09', 9, 1, 1],
    ]);
    expect(layout.groups.map((g) => g.top)).toEqual([0, DAY_HEADING + 200, 2 * DAY_HEADING + 300]);
    expect(layout.height).toBe(3 * DAY_HEADING + 400 - 12);
    // Oct 11's first clip starts its own row under its heading.
    expect(placeOf(layout, 6)).toEqual({ column: 0, top: DAY_HEADING + 200 + DAY_HEADING });
    expect(placeOf(layout, 5)).toEqual({ column: 1, top: DAY_HEADING + 100 });
  });

  it('counts a clip with no capture time by the day it was added, and by the add day when sorted that way', () => {
    const noCapture = { capturedAt: null, addedAt: at(2026, 10, 9) };
    const layout = layoutDays([clip(at(2026, 10, 9, 8)), noCapture], 2, metrics, 'captured');
    expect(layout.groups).toHaveLength(1);
    const added = { capturedAt: at(2025, 1, 1), addedAt: at(2026, 10, 9) };
    expect(layoutDays([added], 1, metrics, 'added').groups[0]?.key).toBe('2026-10-09');
    expect(layoutDays([added], 1, metrics, 'captured').groups[0]?.key).toBe('2025-01-01');
  });

  it('keeps the clips still to load as one block of bones with no heading', () => {
    const layout = layoutDays(ITEMS.slice(0, 4), 50, metrics, 'captured');
    const rest = layout.groups.at(-1)!;
    expect([rest.key, rest.day, rest.start, rest.count, rest.heading, rest.rows]).toEqual([
      'rest',
      null,
      4,
      46,
      0,
      12,
    ]);
  });

  it('has no days when sorted by length or quality: one block, no heading', () => {
    const layout = layoutDays(ITEMS, 30, metrics, null);
    expect(layout.groups).toHaveLength(1);
    expect(layout.groups[0]).toMatchObject({ key: 'all', start: 0, count: 30, heading: 0, rows: 8 });
    expect(layoutDays([], 0, metrics, null).groups).toEqual([]);
  });

  it('draws only the rows in view, plus the overscan', () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      clip(at(2026, 10, 12) - Math.floor(i / 10) * 86_400_000),
    );
    const layout = layoutDays(many, many.length, metrics, 'captured');
    // Ten clips a day: three rows and a heading, 344 px a day.
    expect(layout.groups[1]?.top).toBe(344);
    const view = windowOf(layout, 3440, 3440 + 800, 1);
    expect(view.first).toBeGreaterThanOrEqual(90);
    expect(view.last).toBeLessThanOrEqual(140);
    expect(view.groups.every((g) => g.top + g.height > 3340 && g.top < 4340)).toBe(true);
    expect(windowOf(layoutDays([], 0, metrics, 'captured'), 0, 800)).toEqual({
      first: 0,
      last: 0,
      groups: [],
    });
  });

  it('steps between days with the arrows, keeping the column and holding to a short row', () => {
    const layout = layoutDays(ITEMS, ITEMS.length, metrics, 'captured');
    const move = (key: string, from: number) => moveInDays(key, from, ITEMS.length, layout, 2);
    // From the second row of Oct 12 (column 1) down to Oct 11's only row.
    expect(move('ArrowDown', 5)).toBe(7);
    // Column 3 of Oct 12's first row down to its short second row: its last clip.
    expect(move('ArrowDown', 3)).toBe(5);
    // Up from Oct 11 to Oct 12's last row, held to its length.
    expect(move('ArrowUp', 8)).toBe(5);
    expect(move('ArrowDown', 7)).toBe(9);
    expect(move('ArrowDown', 9)).toBe(9);
    expect(move('ArrowUp', 1)).toBe(1);
    expect(move('ArrowRight', 5)).toBe(6);
    expect(move('PageDown', 0)).toBe(6);
    expect([move('Home', 7), move('End', 2), move('Tab', 2)]).toEqual([0, 9, null]);
    expect(groupOf(layout, 9)?.key).toBe('2026-10-09');
    expect(dayKeyOf(at(2026, 1, 5))).toBe('2026-01-05');
  });
});
