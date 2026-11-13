// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import { confidenceOf, groupOfSlot, MAX_ROWS, otherShots, pickGroups, pickWindow, WINDOW } from '#components/demo/picks';
import { roleRuns } from '#components/demo/strip-layout';

describe('the pick list', () => {
  const reel = reelById(DEFAULT_REEL_ID);
  const groups = pickGroups(reel);

  it('has one row per run of the strip, never one per slot', () => {
    expect(groups.map((g) => [g.role, g.count])).toEqual(roleRuns(reel.slots).map((r) => [r.role, r.count]));
    expect(groups.length).toBeLessThan(reel.slots.length);
    for (const g of groups) expect(g.needs.length).toBeGreaterThan(0);
  });

  it('says how sure the AI is, the way the app does: Medium on an unsure cut, High elsewhere', () => {
    expect(confidenceOf({ uncertainCut: true })).toBe('medium');
    expect(confidenceOf({})).toBe('high');
    const counted = groups.flatMap((g) => g.levels).reduce((n, l) => n + l.count, 0);
    expect(counted).toBe(reel.slots.length);
    const unsure = reel.slots.filter((s) => s.uncertainCut).length;
    expect(groups.flatMap((g) => g.levels).filter((l) => l.level === 'medium').reduce((n, l) => n + l.count, 0)).toBe(unsure);
  });

  it('names the other shots', () => {
    expect(otherShots({ alternates: 3, count: 1 })).toBe('3 other shots');
    expect(otherShots({ alternates: 3, count: 7 })).toBe('3 other shots each');
    expect(otherShots({ alternates: 1, count: 1 })).toBe('1 other shot');
  });

  it('shows every row when they fit, and a window that follows the playhead when they don’t', () => {
    expect(pickWindow(5, 4)).toEqual([0, 5]);
    expect(pickWindow(MAX_ROWS + 3, 0)).toEqual([0, WINDOW]);
    expect(pickWindow(12, 6)).toEqual([5, 5 + WINDOW]);
    expect(pickWindow(12, 11)).toEqual([12 - WINDOW, 12]);
    for (let focus = 0; focus < 12; focus++) {
      const [from, to] = pickWindow(12, focus);
      expect(focus >= from && focus < to).toBe(true);
    }
  });

  it('finds the row that holds a slot', () => {
    for (const [i, g] of groups.entries()) {
      expect(groupOfSlot(groups, g.first)).toBe(i);
      expect(groupOfSlot(groups, g.last)).toBe(i);
    }
    expect(groupOfSlot(groups, 999)).toBe(groups.length - 1);
  });
});
