// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timelines.gaps` and `timelines.shotList` (P3-B8) as packages/timeline answers them: every gap on V1 with its
 * number (its place among V1's clips and gaps), start, length, the slot's intent from the timeline's template
 * version (null in story mode or when the template is gone) and the cast note; and the phone's checklist: each gap
 * and each slot marked `filmRequested`, in timeline order.
 */
import {
  RationalTime,
  type GapView,
  type SequenceItem,
  type ShotListItem,
  type Template,
  type Timeline,
  type Track,
} from '@taalcut/core';

type Slot = Template['slots'][number];

export interface Position {
  readonly item: Exclude<SequenceItem, { type: 'transition' }>;
  /** Its index among V1's items (transitions included). */
  readonly itemIndex: number;
  readonly start: number;
  readonly end: number;
}

/** V1's items: clips, gaps and transitions. */
export function v1Items(timeline: Timeline): readonly SequenceItem[] {
  const track = timeline.tracks[0];
  return track?.kind === 'video' ? track.items : [];
}

/** The tracks with V1's items replaced. */
export function withV1(timeline: Timeline, items: SequenceItem[]): Track[] {
  return timeline.tracks.map((track, index): Track =>
    index === 0 && track.kind === 'video' ? { ...track, items } : track,
  );
}

/** V1's clips and gaps with where each starts and ends, in canvas frames. */
export function positionsOf(timeline: Timeline): Position[] {
  const out: Position[] = [];
  let frame = 0;
  v1Items(timeline).forEach((item, itemIndex) => {
    if (item.type === 'transition') return;
    out.push({ item, itemIndex, start: frame, end: frame + item.duration.value });
    frame += item.duration.value;
  });
  return out;
}

const slotsById = (template: Template | null) =>
  new Map<string, Slot>((template?.slots ?? []).map((slot) => [slot.id, slot]));

export function gapsOf(timeline: Timeline, template: Template | null): GapView[] {
  const slots = slotsById(template);
  const notes = new Map<string, GapView['note']>(
    (timeline.cast?.slots ?? []).map((slot) => [slot.slotId, slot.note]),
  );
  const rate = timeline.canvas.rate;
  return positionsOf(timeline).flatMap((position, index) => {
    const { item } = position;
    if (item.type !== 'gap') return [];
    const slot = item.slotId ? slots.get(item.slotId) : undefined;
    return [
      {
        gapId: item.id,
        slotId: item.slotId,
        number: index + 1,
        start: RationalTime.of(position.start, rate),
        duration: item.duration,
        intent: slot
          ? {
              text: slot.intent.text,
              shotType: slot.intent.shotType,
              motion: slot.intent.motion,
              energy: slot.intent.energy,
            }
          : null,
        note: item.slotId ? (notes.get(item.slotId) ?? null) : null,
      },
    ];
  });
}

const orientationOf = (timeline: Timeline): ShotListItem['orientation'] =>
  timeline.canvas.height > timeline.canvas.width
    ? 'portrait'
    : timeline.canvas.height < timeline.canvas.width
      ? 'landscape'
      : 'square';

export function shotListOf(timeline: Timeline, template: Template | null): ShotListItem[] {
  const slots = slotsById(template);
  const wanted = new Set<string>(
    (timeline.cast?.slots ?? []).filter((slot) => slot.note === 'filmRequested').map((slot) => slot.slotId),
  );
  const rate = timeline.canvas.rate;
  return positionsOf(timeline).flatMap((position, index) => {
    const slotId = position.item.slotId;
    if (position.item.type !== 'gap' && !(slotId && wanted.has(slotId))) return [];
    const slot = slotId ? slots.get(slotId) : undefined;
    return [
      {
        slotId,
        number: index + 1,
        what: slot?.intent.text ?? '',
        shotType: slot?.intent.shotType ?? null,
        motion: slot?.intent.motion ?? null,
        seconds: RationalTime.toSeconds(RationalTime.of(position.end - position.start, rate)),
        orientation: orientationOf(timeline),
      },
    ];
  });
}
