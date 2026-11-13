// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2: the stand-in Maker reads which slots a video.done refusal names, to leave them with its reason. */
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../src/anthropic-view';
import {
  nextDoneReasons,
  refusedSlots,
  STAND_IN_DONE_CALLS,
  STAND_IN_SLOT_REASON,
} from '../src/make-flow-maker';

describe('the stand-in Maker', () => {
  it('reads the slots a refusal names, once each, in order', () => {
    expect(refusedSlots('slot 2: slotFace … Slot 12: slotNeeds … slot 2: slotFraming')).toEqual([2, 12]);
    expect(refusedSlots('There is no draft of this timeline yet')).toEqual([]);
  });

  it('gives every slot the refusals so far named a reason, until video.done passes or names none it left out', () => {
    const done = (result: string, slots: number[] = []): ToolCall => ({
      name: 'video_done',
      input: { reasons: slots.map((slot) => ({ slot, reason: STAND_IN_SLOT_REASON })) },
      result,
    });
    const first = done('Error core.validation: slot 3: slotMotion … slot 5: slotMotion … and 1 more slots.');
    expect(nextDoneReasons([first])).toEqual([3, 5]);
    const second = done('Error core.validation: slot 9: slotMotion (1 count).', [3, 5]);
    expect(nextDoneReasons([first, second])).toEqual([3, 5, 9]);
    const passed = done(JSON.stringify({ renderId: '00000000000000000000000001' }), [3, 5, 9]);
    expect(nextDoneReasons([first, second, passed])).toBeNull();
    const qa = done('Error core.validation: the draft fails QA: loudness.', [3, 5, 9]);
    expect(nextDoneReasons([first, second, qa])).toBeNull();
    const many = Array.from({ length: STAND_IN_DONE_CALLS }, (_, n) => done(`slot ${n + 1}: slotFace`));
    expect(nextDoneReasons(many)).toBeNull();
  });
});
