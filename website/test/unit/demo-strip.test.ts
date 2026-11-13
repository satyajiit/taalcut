// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import type { Reel, Slot, SlotRole } from '#content/schema';
import { formatTimecode } from '#components/demo/pass';
import { AFTER_CUT, filmFrameCount, fitLabel, placeMarks, roleRuns, runLabels, stripMarks } from '#components/demo/strip-layout';

/** A stand-in for measured text: 7 px a character, like an 11 px caption. */
const meter = (text: string) => text.length * 7;
const widths = { timecode: meter, flag: meter };

/** A small seeded random, so the generated reels are the same every run. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A reel of `count` slots of random lengths and roles, some of them with unsure cuts. */
function randomReel(count: number, seed: number): Reel {
  const next = random(seed);
  const roles: SlotRole[] = ['hook', 'build', 'peak', 'outro'];
  let t = 0;
  const slots: Slot[] = Array.from({ length: count }, (_, i) => {
    const length = 0.2 + next() * (i === 0 ? 6 : 1.5);
    const slot: Slot = {
      id: `s${i}`,
      role: i === 0 ? 'hook' : i === count - 1 ? 'outro' : (roles[1 + Math.floor(next() * 2)] ?? 'build'),
      start: t,
      end: t + length,
      needs: 'A shot',
      pick: { clipId: `c${i}`, reason: '', alternates: 3 },
      ...(i > 0 && next() < 0.2 ? { uncertainCut: true } : {}),
    };
    t += length;
    return slot;
  });
  const base = reelById(DEFAULT_REEL_ID);
  return { ...base, id: `r${seed}`, slots, durationSec: t };
}

describe('the strip’s role labels', () => {
  const reel = reelById(DEFAULT_REEL_ID);

  it('label each run of same-role slots once', () => {
    const runs = roleRuns(reel.slots);
    expect(runs.reduce((n, r) => n + r.count, 0)).toBe(reel.slots.length);
    for (let i = 1; i < runs.length; i++) expect(runs[i]!.role).not.toBe(runs[i - 1]!.role);
    for (const run of runs) expect(run.end - run.start).toBeCloseTo(reel.slots[run.last]!.end - reel.slots[run.first]!.start, 6);
  });

  it('say the count of a run, and drop it before dropping the label', () => {
    expect(runLabels({ role: 'build', count: 7 })).toEqual(['Build ×7', 'Build']);
    expect(runLabels({ role: 'hook', count: 1 })).toEqual(['Hook']);
    expect(fitLabel(['Build ×7', 'Build'], 60, meter)).toBe('Build ×7');
    expect(fitLabel(['Build ×7', 'Build'], 40, meter)).toBe('Build');
    expect(fitLabel(['Build ×7', 'Build'], 20, meter)).toBeNull();
  });
});

describe('the strip’s timecodes and flags', () => {
  const cases = Array.from({ length: 20 }, (_, i) => i + 1).flatMap((count) => [200, 264, 420, 760, 1100].map((w) => ({ count, w, reel: randomReel(count, count * 97 + w) })));

  it('never overlap, stay inside the strip, and keep timecodes 48 px apart, for 1 to 20 slots at any width', () => {
    for (const { reel, w } of cases) {
      const placed = placeMarks(stripMarks(reel, w, widths, formatTimecode), w);
      const boxes = placed.map((m) => [m.left, m.left + m.width] as const).sort((a, b) => a[0] - b[0]);
      for (const [l, r] of boxes) {
        expect(l).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(w + 1e-6);
      }
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0]).toBeGreaterThanOrEqual(boxes[i - 1]![1]);
      const times = placed.filter((m) => m.kind === 'timecode').map((m) => m.x);
      for (let i = 0; i < times.length; i++) for (let j = i + 1; j < times.length; j++) expect(Math.abs(times[i]! - times[j]!)).toBeGreaterThanOrEqual(48);
    }
  });

  it('always show the start and the end when the strip has room for both', () => {
    for (const { reel, w } of cases) {
      const keys = placeMarks(stripMarks(reel, w, widths, formatTimecode), w).map((m) => m.key);
      expect(keys).toContain('start');
      expect(keys).toContain('end');
    }
  });

  it('show timecodes only at the start, the role boundaries and the end', () => {
    const reel = reelById(DEFAULT_REEL_ID);
    const runs = roleRuns(reel.slots);
    const allowed = new Set([0, ...runs.map((r) => r.start), reel.slots[reel.slots.length - 1]!.end].map(formatTimecode));
    const placed = placeMarks(stripMarks(reel, 760, widths, formatTimecode), 760);
    for (const m of placed.filter((p) => p.kind === 'timecode')) expect(allowed.has(m.text)).toBe(true);
    expect(placed.find((m) => m.key === 'start')?.left).toBe(AFTER_CUT);
  });

  it('keep the sample’s unsure-cut flag under its own slot, at 320 px as at 1440', () => {
    const reel = reelById(DEFAULT_REEL_ID);
    const unsure = reel.slots.findIndex((s) => s.uncertainCut);
    expect(unsure).toBeGreaterThan(0);
    for (const w of [264, 334, 760]) {
      const flag = placeMarks(stripMarks(reel, w, widths, formatTimecode), w).find((m) => m.kind === 'flag');
      expect(flag, `at ${w}px`).toBeDefined();
      const cut = (reel.slots[unsure]!.start / reel.durationSec) * w;
      expect(Math.abs(flag!.left - cut)).toBeLessThanOrEqual(flag!.width);
    }
  });
});

describe('a filled slot’s filmstrip', () => {
  it('has frames enough to reach its far edge at any width', () => {
    for (const slot of [4, 37, 120, 372, 900]) {
      const frame = 20.8;
      expect(filmFrameCount(slot, frame) * frame).toBeGreaterThanOrEqual(slot);
    }
    expect(filmFrameCount(0, 20)).toBe(1);
  });
});
