// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM2: a clip the person trims by hand is their own pick, as one they slip or swap is: its cast slot is marked
 * `userPick`, so QA reads no part verdict on it and a re-cast leaves it be. The agent's trim marks nothing, and
 * neither trim marks the neighbour that gave or took the frames.
 */
import { FrameRates, RationalTime } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { trimClip } from '../src/edits/trim';
import { buildTimeline } from './fixtures/timeline';

const f = (value: number) => RationalTime.of(value, FrameRates.fps30);
const three = () => buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] });

describe('trimClip and whose pick the clip is', () => {
  it('marks the clip the person trimmed, and not the neighbour that gave the frames', () => {
    const { timeline, ids, slots } = three();
    const trimmed = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: f(10) }, { source: 'ui' });
    if (!trimmed.ok) throw new Error(trimmed.error.code);
    const note = (index: number) =>
      trimmed.value.timeline.cast?.slots.find((slot) => slot.slotId === slots[index])?.note ?? null;
    expect(note(1)).toBe('userPick');
    expect(note(0)).toBeNull();
    expect(note(2)).toBeNull();
    expect(trimmed.value.changed).toEqual(['tracks', 'markers', 'cast']);
  });

  it('marks the first clip when the person slips it by its beginning', () => {
    const { timeline, ids, slots } = three();
    const slipped = trimClip(timeline, { clipId: ids[0]!, edge: 'start', by: f(5) }, { source: 'shortcut' });
    if (!slipped.ok) throw new Error(slipped.error.code);
    expect(slipped.value.timeline.cast?.slots.find((slot) => slot.slotId === slots[0])?.note).toBe(
      'userPick',
    );
  });

  it('marks nothing for the agent’s trim, or for a trim that moves nothing', () => {
    const { timeline, ids } = three();
    const byAgent = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: f(10) }, { source: 'agent' });
    if (!byAgent.ok) throw new Error(byAgent.error.code);
    expect(byAgent.value.timeline.cast?.slots.every((slot) => slot.note !== 'userPick')).toBe(true);
    expect(byAgent.value.changed).toEqual(['tracks', 'markers']);
    const still = trimClip(timeline, { clipId: ids[1]!, edge: 'end', by: f(0) }, { source: 'ui' });
    if (!still.ok) throw new Error(still.error.code);
    expect(still.value.timeline.cast?.slots.every((slot) => slot.note !== 'userPick')).toBe(true);
  });
});
