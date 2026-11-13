// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A timeline's slots on the video track, in canvas frames: consecutive clips of one slot form its span. Pure. */
import type { SlotId, Timeline } from '@taalcut/core';
import { videoItems } from '../timeline/span';

export interface SlotSpan {
  readonly slotId: SlotId;
  readonly startFrame: number;
  readonly endFrame: number;
}

export function timelineSlots(timeline: Timeline): SlotSpan[] {
  const spans: SlotSpan[] = [];
  let frame = 0;
  for (const item of videoItems(timeline)) {
    if (item.type === 'transition') continue;
    const start = frame;
    frame += item.duration.value;
    if (item.slotId === null) continue;
    const last = spans.at(-1);
    if (last && last.slotId === item.slotId && last.endFrame === start)
      spans[spans.length - 1] = { ...last, endFrame: frame };
    else spans.push({ slotId: item.slotId, startFrame: start, endFrame: frame });
  }
  return spans;
}
