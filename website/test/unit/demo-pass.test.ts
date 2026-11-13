// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { SAMPLE_REELS as REELS } from '#content/reels';
import type { Reel } from '#content/schema';
import { DEMO_PHASES } from '#stores/demo';
import {
  beatIndexAt,
  beatLength,
  beatTime,
  formatTimecode,
  momentAt,
  passPlan,
  passStart,
  slotGeometry,
  TIMED_PHASES,
  slotIndexAt,
  tickPositions,
} from '#components/demo/pass';

/** A reel on an even grid, for tempos the placeholders don't cover. */
function gridReel(tempo: number, durationSec = 14): Reel {
  const base = REELS[0]!;
  const step = 60 / tempo;
  const beats: number[] = [];
  for (let t = 0; t < durationSec; t += step) beats.push(t);
  return { ...base, tempo, durationSec, beats };
}

describe('the pass, on the reel’s beats', () => {
  it('lasts about 6–9 seconds for every sample reel and any tempo from 60 to 180', () => {
    for (const reel of [...REELS, ...[60, 72, 90, 118, 140, 180].map((t) => gridReel(t))]) {
      const plan = passPlan(reel);
      expect(plan.total, `${reel.id} at ${reel.tempo}`).toBeGreaterThanOrEqual(6);
      expect(plan.total, `${reel.id} at ${reel.tempo}`).toBeLessThanOrEqual(9);
    }
  });

  it('starts each phase in order and lands one pick per step between the sift and the approval', () => {
    for (const reel of REELS) {
      const { phaseAt, landAt, total } = passPlan(reel);
      const starts = TIMED_PHASES.map((p) => phaseAt[p]);
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
      expect(new Set(starts).size).toBe(starts.length);
      expect(landAt).toHaveLength(reel.slots.length);
      expect(landAt[0]).toBe(phaseAt.assembled);
      for (let i = 1; i < landAt.length; i++) expect(landAt[i]!).toBeGreaterThan(landAt[i - 1]!);
      expect(landAt[landAt.length - 1]!).toBeLessThan(total);
    }
  });

  it('times every step on one of the reel’s beats (or a fold of beats)', () => {
    for (const reel of REELS) {
      const plan = passPlan(reel);
      const steps = Math.ceil(plan.total / (beatLength(reel) * plan.stride)) + 2;
      const onBeat = Array.from({ length: steps }, (_, k) => beatTime(reel, k * plan.stride));
      for (const t of [...Object.values(plan.phaseAt), ...plan.landAt]) {
        expect(Math.min(...onBeat.map((b) => Math.abs(b - t))), `${reel.id} ${t}s`).toBeLessThan(0.002);
      }
    }
  });

  it('only moves forward, and holds at ready: the pass never approves', () => {
    const plan = passPlan(REELS[0]!);
    let last = momentAt(plan, -1);
    expect(last).toEqual({ phase: 'shelf', landed: 0, reading: 0 });
    for (let t = 0; t <= plan.total + 5; t += 0.05) {
      const now = momentAt(plan, t);
      expect(DEMO_PHASES.indexOf(now.phase)).toBeGreaterThanOrEqual(DEMO_PHASES.indexOf(last.phase));
      expect(now.landed).toBeGreaterThanOrEqual(last.landed);
      expect(now.reading).toBeGreaterThanOrEqual(last.reading);
      last = now;
    }
    expect(last).toEqual({ phase: 'ready', landed: REELS[0]!.slots.length, reading: 1 });
    expect(TIMED_PHASES).not.toContain('approved');
  });

  it('lifts the bar before the template lands, and reads the beats while it does', () => {
    const plan = passPlan(REELS[0]!);
    expect(plan.phaseAt.lift).toBeGreaterThan(plan.phaseAt.shelf);
    expect(plan.phaseAt.template - plan.phaseAt.lift).toBeCloseTo(plan.step, 2);
    const mid = momentAt(plan, (plan.phaseAt.template + plan.phaseAt.sift) / 2);
    expect(mid.phase).toBe('template');
    expect(mid.reading).toBeCloseTo(0.5, 1);
    expect(momentAt(plan, plan.phaseAt.sift).reading).toBe(1);
  });

  it('starts the first pass from the shelf, and Use template or another reel from the lift', () => {
    const plan = passPlan(REELS[0]!);
    expect(passStart(plan, 0)).toBe(0);
    expect(passStart(plan, 3)).toBe(plan.phaseAt.lift);
    expect(momentAt(plan, passStart(plan, 1)).phase).toBe('lift');
  });

  it('reads beat times from the list, between beats and past its end', () => {
    const reel = { tempo: 120, beats: [0.2, 0.7, 1.2, 1.7] };
    expect(beatTime(reel, 0)).toBe(0);
    expect(beatTime(reel, 1)).toBeCloseTo(0.5);
    expect(beatTime(reel, 1.5)).toBeCloseTo(0.75);
    expect(beatTime(reel, 5)).toBeCloseTo(2.5);
    expect(beatLength({ tempo: 100, beats: [] })).toBeCloseTo(0.6);
    expect(beatIndexAt({ beats: reel.beats }, 0.1)).toBe(-1);
    expect(beatIndexAt({ beats: reel.beats }, 0.7)).toBe(1);
    expect(beatIndexAt({ beats: reel.beats }, 9)).toBe(3);
  });
});

describe('the strip’s geometry', () => {
  it('lays the slots end to end inside the strip', () => {
    for (const reel of REELS) {
      const boxes = slotGeometry(reel);
      expect(boxes[0]!.left).toBe(0);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.left).toBeCloseTo(boxes[i - 1]!.left + boxes[i - 1]!.width, 1);
      const last = boxes[boxes.length - 1]!;
      expect(last.left + last.width).toBeCloseTo(100, 1);
    }
  });

  it('clamps a slot that runs past the reel', () => {
    const reel = { durationSec: 10, slots: [{ ...REELS[0]!.slots[0]!, start: 8, end: 14 }] };
    expect(slotGeometry(reel)[0]).toMatchObject({ left: 80, width: 20 });
  });

  it('puts every beat on the strip, a downbeat every fourth', () => {
    const ticks = tickPositions(REELS[0]!);
    expect(ticks).toHaveLength(REELS[0]!.beats.length);
    expect(ticks.every((t) => t.left >= 0 && t.left <= 100)).toBe(true);
    expect(ticks.filter((t) => t.down)).toHaveLength(Math.ceil(ticks.length / 4));
  });

  it('writes timecodes the way the app does', () => {
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(2.52)).toBe('0:02.5');
    expect(formatTimecode(61.96)).toBe('1:02.0');
    expect(formatTimecode(-3)).toBe('0:00.0');
  });

  it('finds the slot playing at a moment', () => {
    const reel = REELS[0]!;
    expect(slotIndexAt(reel, 0)).toBe(0);
    expect(slotIndexAt(reel, reel.slots[2]!.start + 0.01)).toBe(2);
    expect(slotIndexAt(reel, reel.durationSec + 1)).toBe(reel.slots.length - 1);
  });
});
