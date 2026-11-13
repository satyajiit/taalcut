// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { CAMERA_ROLL, DEFAULT_REEL_ID, reelById } from '#content/reels';
import { claimViolations } from '#content/claims';
import { DEMO_PHASES } from '#stores/demo';
import { DEMO } from '#components/hero/copy';
import { beatSpan, listScrollTop, liveLine, slotRows, statusLine } from '#components/demo/hero-model';
import { spriteCropPosition, squareSpritePosition } from '#components/demo/roll';

const reel = reelById(DEFAULT_REEL_ID);

describe('the hero window’s slot rows', () => {
  const rows = slotRows(reel);

  it('has one row per slot, with what it wants, how sure the AI is and its other shots', () => {
    expect(rows).toHaveLength(reel.slots.length);
    rows.forEach((row, i) => {
      expect(row.index).toBe(i);
      expect(row.role).toBe(reel.slots[i]!.role);
      expect(row.needs.length).toBeGreaterThan(0);
      expect(['high', 'medium', 'low']).toContain(row.level);
      expect(row.alternates).toBeLessThanOrEqual(3);
    });
  });

  it('is Medium where the cut was unsure, High elsewhere', () => {
    rows.forEach((row, i) => expect(row.level).toBe(reel.slots[i]!.uncertainCut ? 'medium' : 'high'));
  });

  it('reads differently on every row: no two slots share a line', () => {
    const lines = rows.map((r) => r.needs);
    expect(new Set(lines).size).toBe(lines.length);
    for (const line of lines) expect(claimViolations(line), line).toEqual([]);
  });

  it('places each slot on the reel: its timecode and the music beats it covers, from the slot data', () => {
    rows.forEach((row, i) => {
      const slot = reel.slots[i]!;
      expect(row.at).toMatch(/^\d:\d\d\.\d$/);
      expect(Number(row.at.split(':')[1])).toBeCloseTo(slot.start, 0);
      const [first, last] = row.beats!;
      expect(first).toBeGreaterThanOrEqual(1);
      expect(last).toBeGreaterThanOrEqual(first);
      expect(last).toBeLessThanOrEqual(reel.beats.length);
    });
    expect(rows[0]!.at).toBe('0:00.0');
    // Every beat the reel has falls in some slot's span, in order.
    expect(rows[0]!.beats![0]).toBe(1);
    expect(rows.at(-1)!.beats![1]).toBe(reel.beats.length);
  });

  it('counts the beats inside a slot, or the two it falls between', () => {
    const beats = [0.5, 1, 1.5, 2];
    expect(beatSpan(beats, 0, 1.2)).toEqual([1, 2]);
    expect(beatSpan(beats, 1.4, 1.6)).toEqual([3, 3]);
    expect(beatSpan(beats, 1.1, 1.4)).toEqual([2, 3]);
    expect(beatSpan(beats, 2.1, 2.5)).toEqual([4, 4]);
    expect(beatSpan([], 0, 1)).toBeNull();
    expect(DEMO.beats(3, 3)).toBe('Beat 3');
    expect(DEMO.beats(1, 11)).toBe('Beats 1–11');
    expect(DEMO.slotTitle(1, 'Hook')).toBe('Slot 1 · Hook');
  });

  it('scrolls to keep the landing row in view, one row of context above, never past the end', () => {
    expect(listScrollTop(0, 40, 5, 13)).toBe(0);
    expect(listScrollTop(1, 40, 5, 13)).toBe(0);
    expect(listScrollTop(4, 40, 5, 13)).toBe(120);
    expect(listScrollTop(12, 40, 5, 13)).toBe(320);
    expect(listScrollTop(3, 40, 5, 4)).toBe(0);
  });
});

describe('the rows’ thumbnails', () => {
  it('crop the middle of a frame to any shape, the square one unchanged', () => {
    const atlas = CAMERA_ROLL.atlas;
    expect(spriteCropPosition(atlas, 5, 1)).toBe(squareSpritePosition(atlas, 5));
    // A 3:4 crop of the first row sits between the square crop and the top.
    const tall = Number(spriteCropPosition(atlas, 0, 3 / 4).split(' ')[1]!.replace('%', ''));
    const square = Number(squareSpritePosition(atlas, 0).split(' ')[1]!.replace('%', ''));
    expect(tall).toBeGreaterThan(0);
    expect(tall).toBeLessThan(square);
  });
});

describe('the pass, said', () => {
  it('has a status line for every phase, in the app’s words', () => {
    for (const phase of DEMO_PHASES) {
      const line = statusLine(phase, 3, reel.slots.length, CAMERA_ROLL.shownCount);
      expect(line.length, phase).toBeGreaterThan(0);
      expect(claimViolations(line), phase).toEqual([]);
    }
    expect(statusLine('assembled', 3, 13, 1284)).toBe('Picking clips: 3 of 13');
    expect(statusLine('sift', 0, 13, 1284)).toBe('Searching 1,284 clips');
  });

  it('announces each step once, never once a beat, and nothing before the template is taken', () => {
    expect(liveLine('shelf', 13, 23, 1284)).toBe('');
    expect(liveLine('lift', 13, 23, 1284)).toBe('');
    const lines = (['template', 'sift', 'assembled', 'ready', 'approved'] as const).map((p) => liveLine(p, 13, 23, 1284));
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines[1]).toContain('23 music beats');
    for (const line of lines) expect(claimViolations(line)).toEqual([]);
  });
});
