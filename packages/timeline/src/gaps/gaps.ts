// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The empty slots of a timeline (P3-B8, R13): every gap on V1 with the slot it was meant for and that slot's
 * intent, for the agent's gap proposals and the gap-fix card; and the "film this" checklist the phone page
 * shows: one row per gap and per slot the person said they'd film.
 */
import { RationalTime, type GapView, type ShotListItem, type Template, type Timeline } from '@taalcut/core';
import { positions, videoItems } from '../model/sequence';

type Slot = Template['slots'][number];

function slotsById(template: Template | null): Map<string, Slot> {
  return new Map((template?.slots ?? []).map((slot) => [slot.id as string, slot]));
}

function intentOf(slot: Slot | undefined): GapView['intent'] {
  if (!slot) return null;
  const { text, shotType, motion, energy } = slot.intent;
  return { text, shotType, motion, energy };
}

export function gapsOf(timeline: Timeline, template: Template | null): GapView[] {
  const slots = slotsById(template);
  const notes = new Map((timeline.cast?.slots ?? []).map((slot) => [slot.slotId as string, slot.note]));
  const rate = timeline.canvas.rate;
  return positions(videoItems(timeline)).flatMap((position, index) => {
    const item = position.item;
    if (item.type !== 'gap') return [];
    return [
      {
        gapId: item.id,
        slotId: item.slotId,
        number: index + 1,
        start: RationalTime.of(position.start, rate),
        duration: item.duration,
        intent: intentOf(item.slotId ? slots.get(item.slotId) : undefined),
        note: item.slotId ? (notes.get(item.slotId) ?? null) : null,
      },
    ];
  });
}

const orientation = (timeline: Timeline): ShotListItem['orientation'] =>
  timeline.canvas.height > timeline.canvas.width
    ? 'portrait'
    : timeline.canvas.height < timeline.canvas.width
      ? 'landscape'
      : 'square';

/** One row per gap and per slot marked `filmRequested`, in timeline order. */
export function shotList(timeline: Timeline, template: Template | null): ShotListItem[] {
  const slots = slotsById(template);
  const wanted = new Set(
    (timeline.cast?.slots ?? []).filter((slot) => slot.note === 'filmRequested').map((slot) => slot.slotId as string),
  );
  const seconds = (frames: number) => RationalTime.toSeconds(RationalTime.of(frames, timeline.canvas.rate));
  return positions(videoItems(timeline)).flatMap((position, index) => {
    const item = position.item;
    const slotId = item.slotId;
    if (item.type !== 'gap' && !(slotId && wanted.has(slotId))) return [];
    const slot = slotId ? slots.get(slotId) : undefined;
    return [
      {
        slotId,
        number: index + 1,
        what: slot?.intent.text ?? '',
        shotType: slot?.intent.shotType ?? null,
        motion: slot?.intent.motion ?? null,
        seconds: seconds(position.end - position.start),
        orientation: orientation(timeline),
      },
    ];
  });
}
