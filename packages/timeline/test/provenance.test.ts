// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { FrameRates, newId, RationalTime, TimeRange, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { moveClip } from '../src/edits/move';
import { swapClip } from '../src/edits/swap';
import { slotProvenance } from '../src/model/provenance';
import { buildTimeline } from './fixtures/timeline';

const rate = FrameRates.fps30;
const at = (value: number) => RationalTime.of(value, rate);
const user = { source: 'ui' } as const;
const agent = { source: 'agent' } as const;

function swapIn(
  timeline: Timeline,
  clipId: Parameters<typeof swapClip>[1]['clipId'],
  source: typeof user | typeof agent,
) {
  const media = {
    kind: 'video' as const,
    assetId: newId<'Asset'>(),
    shotId: newId<'Shot'>(),
    available: TimeRange.of(at(0), at(600)),
  };
  const swapped = swapClip(
    timeline,
    { clipId, from: 'search' },
    { media, sourceStart: at(10), syncPoint: at(10), candidate: null },
    source,
  );
  if (!swapped.ok) throw new Error(swapped.error.code);
  return swapped.value.timeline;
}

describe('slotProvenance', () => {
  it('counts every slot as the AI pick when nothing changed', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    expect(slotProvenance(timeline, timeline)).toEqual({
      slots: 3,
      slotsKeptAi: 3,
      slotsSwappedByUser: 0,
      orderChanged: false,
      breakdownEdited: false,
    });
  });

  it('tells a user swap from an agent fix', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const byUser = swapIn(timeline, ids[0]!, user);
    const byAgent = swapIn(byUser, ids[2]!, agent);
    expect(slotProvenance(timeline, byAgent)).toMatchObject({
      slotsKeptAi: 1,
      slotsSwappedByUser: 1,
      orderChanged: false,
    });
    // Without the assembly only the notes are left: the agent's fix reads as its pick.
    expect(slotProvenance(null, byAgent)).toMatchObject({ slotsKeptAi: 2, slotsSwappedByUser: 1 });
  });

  it('sees a move as an order change, not a swap', () => {
    const { timeline, ids } = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });
    const moved = moveClip(timeline, { clipId: ids[0]!, toIndex: 2 }, user);
    if (!moved.ok) throw new Error(moved.error.code);
    const facts = slotProvenance(timeline, moved.value.timeline);
    expect(facts.orderChanged).toBe(true);
    expect(facts.slotsSwappedByUser).toBe(0);
    expect(facts.slotsKeptAi).toBeLessThan(3);
  });

  it('reports an edited template and a timeline without a cast', () => {
    const { timeline } = buildTimeline({ clips: [{ frames: 30 }], cast: false });
    const edited = { ...timeline, template: { id: newId<'Template'>(), version: 2 } };
    expect(slotProvenance(null, edited)).toEqual({
      slots: 0,
      slotsKeptAi: 0,
      slotsSwappedByUser: 0,
      orderChanged: false,
      breakdownEdited: true,
    });
  });
});
