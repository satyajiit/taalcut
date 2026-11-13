// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-R2 in the breakdown's listening: a sync item matches the slot on its own frame before any item a frame off
 * takes it, nearest first (P5); and a reel effect says what its offset measured, so it is placed by a take's onset
 * when the reel's event was an attack and by its apex when it was a swell (P8).
 */
import { describe, expect, it } from 'vitest';
import { RationalTime, type CutSyncItem, type SoundEvent, type TemplateListening } from '@taalcut/core';
import { reelAlign, slotListening } from '../src/index';

const rate = { num: 30, den: 1 };
/** A time at `frame` (fractional) of 30 fps. */
const at = (frame: number) => RationalTime.of(Math.round(frame * 10), { num: 300, den: 1 });
const item = (cutIndex: number, frame: number, status: CutSyncItem['status'], offsetMs: number | null) => ({
  cutIndex,
  at: at(frame),
  status,
  offsetMs,
});
const listeningOf = (items: CutSyncItem[], extra: Partial<TemplateListening> = {}) =>
  ({
    cutSync: {
      items,
      cutsWithoutHit: [],
      okShare: 0,
      nearShare: 0,
      chanceShare: 0,
      medianOffsetMs: null,
      toleranceMs: 33.3,
    },
    sfxAtCuts: [],
    events: [],
    ...extra,
  }) as unknown as TemplateListening;

describe('sync items onto slots (P5)', () => {
  it('gives a slot to the item on its frame, not to a rejected candidate one frame before it', () => {
    const listening = listeningOf([item(0, 100, 'none', null), item(1, 101, 'ok', 2)], {
      sfxAtCuts: [{ cutIndex: 1, family: 'impact', offsetMs: 2 }],
    });
    const out = slotListening(listening, [0, 101, 200], rate);
    expect(out.cutSync.items.map((i) => [i.cutIndex, i.status, i.offsetMs])).toEqual([[1, 'ok', 2]]);
    expect(out.sfxAtCuts).toEqual([{ cutIndex: 1, family: 'impact', offsetMs: 2 }]);
  });

  it('matches a frame either side nearest first, each slot once', () => {
    // Neither is on slot 2's frame 200: 200.7 rounds to 201 (0.7 away), 199.2 to 199 (0.8 away).
    const listening = listeningOf([item(0, 199.2, 'near', 40), item(1, 200.7, 'ok', 3)]);
    const out = slotListening(listening, [0, 100, 200], rate);
    expect(out.cutSync.items.map((i) => [i.cutIndex, i.offsetMs])).toEqual([[2, 3]]);
  });
});

describe('what a reel effect’s offset measured (P8)', () => {
  const event = (frame: number, shape: SoundEvent['shape']) =>
    ({ at: at(frame), shape }) as unknown as SoundEvent;
  const answered = (status: CutSyncItem['status'], eventFrame?: number) => ({
    ...item(1, 100, status, 20),
    ...(eventFrame !== undefined ? { eventAt: at(eventFrame) } : {}),
  });
  const listening = listeningOf([], { events: [event(100.6, 'hit'), event(150.6, 'swell')] });

  it('an attack aligns the take’s onset, a swell its apex; unknown keeps the apex', () => {
    expect(reelAlign(listening, answered('ok', 100.6))).toBe('onset');
    expect(reelAlign(listening, answered('near', 150.6))).toBe('apex');
    expect(reelAlign(listening, answered('swell', 150.6))).toBe('apex');
    expect(reelAlign(listening, answered('ok'))).toBe('apex');
    expect(reelAlign(listening, answered('ok', 120))).toBe('apex');
  });
});
