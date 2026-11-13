// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: timeline.slipClip's edit. The clip plays another part of the same shot: a new in-point (and the sync
 * point under it), the same id, place, length and speed, so no cut moves. Its cast slot's pick follows, marked the
 * person's own when the person slipped it, so a later re-cast leaves it be. The command handler works out the
 * in-point (slip-command.ts), so this stays pure.
 */
import { err, ok, RationalTime, type Result, type Timeline, type TimelineItemId } from '@taalcut/core';
import { InvalidMove, MediaTooShort } from '../errors';
import { updateSlots } from '../model/cast';
import { videoItems, withVideoItems } from '../model/sequence';
import { clipMediaFits } from '../model/speed';
import { resync } from '../resync/resync';
import { clipPosition, unchanged, type EditOptions, type EditResult } from './types';

export interface SlipTo {
  readonly sourceStart: RationalTime;
  readonly syncPoint: RationalTime | null;
}

export function slipClip(
  timeline: Timeline,
  clipId: TimelineItemId,
  to: SlipTo,
  options: EditOptions,
): Result<EditResult> {
  const found = clipPosition(timeline, clipId, options.source);
  if (!found.ok) return found;
  const clip = found.value.item;
  if (clip.media.kind !== 'video')
    return err(InvalidMove(undefined, { detail: 'A photo has no other part to play.' }));
  const sourceStart = RationalTime.rescale(to.sourceStart, clip.sourceStart.rate, 'round');
  if (RationalTime.compare(sourceStart, clip.sourceStart) === 0) return unchanged(timeline);
  const next = { ...clip, sourceStart, syncPoint: to.syncPoint };
  if (!clipMediaFits(next, timeline.canvas.rate)) return err(MediaTooShort({ clipId }));
  const items = [...videoItems(timeline)];
  items[found.value.itemIndex] = next;
  const cast = updateSlots(timeline.cast, (slot) =>
    slot.clipId === clipId && slot.pick
      ? {
          ...slot,
          pick: { ...slot.pick, sourceStart, syncPoint: to.syncPoint },
          ...(options.source === 'agent' ? {} : { note: 'userPick' as const }),
        }
      : slot,
  );
  const edited = withVideoItems({ ...timeline, cast }, items);
  const synced = resync(edited, { before: timeline, ...(options.config ? { config: options.config } : {}) });
  return ok({ timeline: synced, changed: ['tracks', 'markers', 'cast'] });
}
