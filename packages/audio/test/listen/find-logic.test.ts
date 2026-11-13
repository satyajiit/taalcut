// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-B1's candidate logic on known signals (no models): the window grid (count, the last window flush with the end,
 * growth for long files), snapping onto a sound, two sounds in one window, edit gaps, de-duplication, the round-robin
 * pick, librosa's backtracking, strokes and events from onsets, and the query's kind.
 */
import { describe, expect, it } from 'vitest';
import { queryKindOf } from '../../src/listen/describe/find';
import { editGaps, envDb, headDb, multiSound, tailDb } from '../../src/listen/search/envelope';
import { backtrack, eventCandidates, refineStart } from '../../src/listen/search/events';
import {
  dedupe,
  selectRoundRobin,
  snapWindow,
  windowCandidates,
  type Candidate,
} from '../../src/listen/search/windows';

const SR = 48_000;

/** Quiet noise floor with decaying bursts at `at` seconds. */
function bursts(seconds: number, at: readonly number[], decayS = 0.05): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  let seed = 1;
  const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32 - 0.5) * 2;
  for (let i = 0; i < x.length; i++) x[i] = rnd() * 1e-4;
  for (const t of at) {
    const a = Math.round(t * SR);
    for (let i = 0; i < SR * decayS * 8 && a + i < x.length; i++)
      x[a + i] = (x[a + i] ?? 0) + Math.sin(i * 0.3) * 0.5 * Math.exp(-i / (decayS * SR));
  }
  return x;
}

describe('the window grid', () => {
  it('covers a short file with duration / 6 windows at half hop, the last flush with the end', () => {
    const wins = windowCandidates(13);
    expect(wins[0]).toMatchObject({ start: 0, end: 13 / 6 });
    expect(wins.at(-1)?.end).toBeCloseTo(13, 9);
    for (let i = 1; i < wins.length; i++) expect(wins[i]!.start).toBeLessThanOrEqual(wins[i - 1]!.end);
  });

  it('grows the window to 10 s, then the hop up to the window, to stay near 40', () => {
    expect(windowCandidates(70)).toHaveLength(27);
    const five = windowCandidates(300);
    expect(five[0]!.end - five[0]!.start).toBe(10);
    expect(five.length).toBeLessThanOrEqual(41);
    // An hour can't stay near 40 without gaps: the hop stops at the window.
    const hour = windowCandidates(3600);
    expect(hour).toHaveLength(360);
    expect(hour[1]!.start - hour[0]!.start).toBe(10);
  });

  it('is one window when the file is shorter than it', () => {
    expect(windowCandidates(0.8)).toEqual([{ start: 0, end: 0.8, kind: 'window', priority: 0 }]);
  });
});

describe('the envelope tests', () => {
  const x = bursts(4, [1, 2.5]);
  const env = envDb(x);

  it('frames at 5 ms and 1 ms', () => {
    expect(env).toHaveLength(800);
    expect(envDb(x, 0.001)).toHaveLength(4000);
  });

  it('a trim starting before a sound has a quiet head; one inside its decay has a loud tail', () => {
    expect(headDb(env, 0.95, 1.4)).toBeLessThan(-30);
    expect(tailDb(env, 0.95, 1.05)).toBeGreaterThan(-15);
    expect(tailDb(env, 0.95, 1.9)).toBeLessThan(-30);
  });

  it('two sounds 1.5 s apart are two sounds; one is not', () => {
    const floor = Math.min(...env);
    expect(multiSound(env, floor, 0.9, 3.2)).toBe(true);
    expect(multiSound(env, floor, 0.9, 1.8)).toBe(false);
  });

  it('an edit gap is 10 ms of exact digital silence', () => {
    const cut = bursts(1, [0.2]);
    cut.fill(0, Math.round(0.6 * SR), Math.round(0.62 * SR));
    expect(editGaps(envDb(cut), 0.5, 0.7)).toBe(true);
    expect(editGaps(envDb(cut), 0.2, 0.5)).toBe(false);
  });

  it('a window snaps back to where the sound starts and on to where it has decayed', () => {
    const floor = Math.min(...env);
    const [a, b] = snapWindow(env, floor, 1.02, 1.1, 0, 4);
    expect(a).toBeLessThanOrEqual(1.0);
    expect(a).toBeGreaterThan(0.95);
    expect(b).toBeGreaterThan(1.1);
  });
});

describe('candidates from onsets', () => {
  it('backtracks each onset to the last local minimum at or before it', () => {
    const energy = [0, 1, 3, 2, 1, 2, 5, 4, 3, 4, 6];
    expect(backtrack([2, 6, 10], energy)).toEqual([0, 4, 8]);
  });

  it('the attack is the first 1 ms frame within 30 dB of the local peak', () => {
    const x = bursts(2, [1]);
    const t = refineStart(envDb(x, 0.001), 1.02, -80);
    expect(t).toBeGreaterThanOrEqual(0.99);
    expect(t).toBeLessThanOrEqual(1.001);
  });

  it('two hits close together are strokes and one event; far apart they stay strokes', () => {
    const x = bursts(3, [0.5, 0.65, 2]);
    const env = envDb(x);
    const floor = Math.min(...env);
    const cands = eventCandidates(env, envDb(x, 0.001), floor, [0.5, 0.65, 2], 3);
    expect(cands.filter((c) => c.kind === 'stroke')).toHaveLength(3);
    const events = cands.filter((c) => c.kind === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]!.start).toBeLessThan(0.5);
    expect(events[0]!.end).toBeLessThan(2);
  });
});

describe('picking candidates', () => {
  const c = (start: number, end: number, priority = 0): Candidate => ({
    start,
    end,
    kind: 'stroke',
    priority,
  });

  it('drops a candidate overlapping a kept one by 90 % of their extent', () => {
    expect(dedupe([c(0, 1), c(0.02, 1.01), c(0.5, 1.5)])).toEqual([c(0, 1), c(0.5, 1.5)]);
  });

  it('takes the best of each 2 s stretch in turn', () => {
    const picked = selectRoundRobin([c(0.1, 0.2, 1), c(0.5, 0.6, 9), c(2.1, 2.2, 5), c(4.1, 4.2, 3)], 3);
    expect(picked.map((p) => p.priority)).toEqual([9, 5, 3]);
  });
});

describe("the query's kind", () => {
  const unit = (v: number[]) => Float32Array.from(v.map((x) => x / Math.hypot(...v)));
  const event = Array.from({ length: 6 }, () => unit([1, 0, 0]));
  const texture = Array.from({ length: 6 }, () => unit([0, 1, 0]));

  it('reads one-shot, continuous and in-between descriptions by the anchors', () => {
    expect(queryKindOf(unit([1, 0.1, 0]), [...event, ...texture]).kind).toBe('event');
    expect(queryKindOf(unit([0.1, 1, 0]), [...event, ...texture]).kind).toBe('texture');
    expect(queryKindOf(unit([0.5, 0.65, 0.3]), [...event, ...texture]).kind).toBe('either');
  });
});
