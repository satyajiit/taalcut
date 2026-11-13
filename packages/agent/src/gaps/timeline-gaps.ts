// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A stored timeline's gaps (SPEC section 26), pure, from core's Timeline: the cast says which slots have no
 * pick and which a gap fix already touched; V1 says where each sits. Slots are numbered as the cast board
 * numbers them. The composition root reads the timeline (and the slots' intents, from the timeline service's
 * gaps or the template) and passes them in.
 *
 * FIX-GAPS: a weak pick is a gap again, read by the timeline lane's own rule (`weakOf`, its `weakPickOf` with the
 * shots' descriptions): the person sees a wrong clip otherwise. Its default fix never films or replaces it blindly:
 * it swaps only to a candidate that clearly fits better, else the clip stays (BRK1-MAKE's eleven unsure picks then
 * settle as kept, and the two real gaps are not buried). A clip that isn't weak is listed as `picked`, so a swap
 * shows in the stored timeline. FIX-ASK: each slot says what of the template's it carries (its text, its graphics),
 * and the timeline counts its shots, so the ask policy can weigh the gaps against the whole video.
 */
import { RationalTime, type GapView, type SlotCast, type Timeline } from '@taalcut/core';
import type { GapCarry, GapSlot, GapTimeline, SwapTarget, WeakPickInfo } from './gap-types';

export interface GapTimelineOptions {
  /** The format's shortest length, when the template's format has one. */
  readonly minDuration: RationalTime | null;
  /** A slot's intent in words, when known. */
  readonly intentOf?: (slotId: string) => GapView['intent'];
  /** FIX-GAPS: the slot's weak pick, by the timeline lane's rule; absent or null: no slot is weak. */
  readonly weakOf?: (slot: SlotCast) => WeakPickInfo | null;
  /** FIX-ASK: what of the template's the slot carries (its text overlays, the graphics drawing them). */
  readonly carriesOf?: (slotId: string) => readonly GapCarry[];
}

interface Placed {
  readonly id: string;
  readonly type: 'clip' | 'gap' | 'program';
  readonly slotId: string | null;
  readonly start: RationalTime;
  readonly duration: RationalTime;
  readonly media: SwapTarget | null;
}

/** V1's clips and gaps with their start times (transitions overlap their neighbours and take no time). */
function placed(timeline: Timeline): { items: Placed[]; duration: RationalTime } {
  const track = timeline.tracks.find((t) => t.kind === 'video' && t.id === 'V1') ?? timeline.tracks[0];
  let at = RationalTime.zero(timeline.canvas.rate);
  const items: Placed[] = [];
  for (const item of track?.kind === 'video' ? track.items : []) {
    if (item.type === 'transition') continue;
    const media =
      item.type === 'clip'
        ? {
            assetId: item.media.assetId,
            shotId: item.media.kind === 'video' ? item.media.shotId : null,
          }
        : null;
    items.push({
      id: item.id,
      type: item.type,
      slotId: item.slotId,
      start: at,
      duration: item.duration,
      media,
    });
    at = RationalTime.add(at, item.duration);
  }
  return { items, duration: at };
}

export function gapTimelineOf(timeline: Timeline, options: GapTimelineOptions): GapTimeline {
  const { items, duration } = placed(timeline);
  const slots: GapSlot[] = [];
  for (const [index, cast] of (timeline.cast?.slots ?? []).entries()) {
    const intent = options.intentOf?.(cast.slotId) ?? null;
    const carries = options.carriesOf?.(cast.slotId) ?? [];
    const base = {
      slotId: cast.slotId,
      number: index + 1,
      intent,
      note: cast.note,
      ...(carries.length > 0 ? { carries } : {}),
    };
    if (cast.note === 'dropped') {
      const zero = RationalTime.zero(timeline.canvas.rate);
      slots.push({
        ...base,
        gapId: cast.clipId ?? cast.slotId,
        start: zero,
        duration: zero,
        state: 'dropped',
      });
      continue;
    }
    const item = cast.clipId
      ? items.find((i) => i.type === 'clip' && i.id === cast.clipId)
      : items.find((i) => i.type === 'gap' && i.slotId === cast.slotId);
    if (!item) continue;
    const where = { gapId: item.id, start: item.start, duration: item.duration };
    if (!cast.clipId) {
      slots.push({ ...base, ...where, state: 'empty' });
      continue;
    }
    const current = item.media ? { current: item.media } : {};
    const weak = cast.note === 'gapFilled' ? null : (options.weakOf?.(cast) ?? null);
    if (cast.note === 'gapFilled') slots.push({ ...base, ...where, ...current, state: 'filled' });
    else if (weak) slots.push({ ...base, ...where, ...current, state: 'weak', weak });
    else slots.push({ ...base, ...where, ...current, state: 'picked' });
  }
  return {
    timelineId: timeline.id,
    projectId: timeline.projectId,
    revision: timeline.revision,
    duration,
    minDuration: options.minDuration,
    slots,
    slotCount: slots.filter((slot) => slot.state !== 'dropped').length,
  };
}
