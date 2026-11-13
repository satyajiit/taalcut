// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Cut sync's rules (earshot timeline `_answer`), first match wins, on hand-made event lists; and chance. */
import { cutSyncReportSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { chanceShare } from '../../src/listen/timeline/chance';
import type { ListenEvent } from '../../src/listen/timeline/events';
import { syncToCuts, toCutSyncReport } from '../../src/listen/timeline/sync';

function ev(t: number, prominenceDb: number, shape: 'hit' | 'swell' = 'hit'): ListenEvent {
  return {
    t,
    shape,
    band: 'full',
    contrastDb: prominenceDb,
    z: 5,
    lengthMs: 50,
    prominenceDb,
    bedDb: -40,
    peakDbfs: -6,
    localLufs: -20,
    centroidHz: 1000,
  };
}

/** A level envelope (10 ms frames) flat at −40 dB with a 0.1 s bump to −30 dB centred at `peakS`. */
function levelsWithPeak(seconds: number, peakS: number) {
  const n = Math.round(seconds * 100);
  const s = new Float64Array(n).fill(-40);
  const c = Math.round(peakS * 100);
  for (let i = c - 5; i <= c + 5; i++) s[i] = -30 + Math.abs(i - c) * -0.5;
  return { full: s, high: new Float64Array(n).fill(-80) };
}

describe('cut sync', () => {
  const events = [ev(1.0, 20), ev(2.07, 3), ev(2.95, 15), ev(4.5, 12, 'swell'), ev(6.22, 18), ev(8.0, 2)];

  it('answers each cut by the first rule that matches', () => {
    const cuts = [1.02, 2.0, 3.0, 4.3, 5.5, 6.0, 7.5];
    const levels = levelsWithPeak(9, 5.6);
    const r = syncToCuts(cuts, events, { levels });
    expect(r.items.map((i) => i.status)).toEqual(['ok', 'near', 'near', 'swell', 'peak', 'off', 'none']);
    expect(r.items.map((i) => i.offsetMs)).toEqual([-20, 70, -50, 200, 100, 220, null]);
    expect(r.stats.noSound).toEqual([6, 7.5]);
    expect(r.stats.answeredBySwell).toBe(1);
    expect(r.stats.answeredByLevelPeak).toBe(1);
  });

  it('uses one frame as the ok window at the picture rate', () => {
    const r = syncToCuts([1.03], events, { frameRate: { num: 24, den: 1 } });
    expect(r.items[0]?.status).toBe('ok');
    expect(r.stats.toleranceMs).toBe(41.7);
    expect(syncToCuts([1.05], events).items[0]?.status).toBe('near');
  });

  it('leaves out cuts within 50 ms of either end and reports beats', () => {
    const r = syncToCuts([0.03, 2.95, 8.98], events, { durationS: 9, beats: [0, 1, 2, 3, 4] });
    expect(r.items.map((i) => i.cutIndex)).toEqual([1]);
    expect(r.items[0]?.beatOffsetMs).toBe(-50);
    expect(r.stats.onBeat).toBe(1);
    expect(r.stats.onBeatChance).toBe(0.1);
  });

  it('turns into core’s report, the misses by CUT_SYNC_MISSES', () => {
    const r = syncToCuts([1.0, 5.5, 7.5], events, { levels: levelsWithPeak(9, 5.6) });
    const report = toCutSyncReport(r, { frameRate: { num: 30, den: 1 } });
    expect(cutSyncReportSchema.parse(report).cutsWithoutHit).toEqual([1, 2]);
    expect(report.items[0]?.at).toEqual({ value: 1000, rate: { num: 1000, den: 1 } });
  });

  it('computes what chance gives on a 5 ms grid', () => {
    expect(chanceShare([], 0, 1, 0.04)).toBe(0);
    // Upstream's own values (timeline._chance): on the float grid the ±40 ms ends fall just outside.
    expect(chanceShare([0.5], 0, 1, 0.04)).toBe(0.08);
    expect(chanceShare([0.25, 0.75], 0, 1, 0.1)).toBe(0.405);
  });
});
