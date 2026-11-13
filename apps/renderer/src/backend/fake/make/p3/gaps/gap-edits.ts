// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gap fixes (P3-B8) on the fake's documents, as packages/timeline makes them:
 * - fillGap: the gap becomes a clip of the same id, slot and length, anchored to the beat nearest its start; a
 *   still with its motion, or a video at the caller's in-point (else the middle of its media). The cast slot's
 *   pick becomes the new media with note `gapFilled`. A gap that isn't one refuses as the real one does.
 * - markForFilming: the slots' note `filmRequested`; unmarked, the note they'd have without it.
 * - punch: clips become gaps, as casting leaves a slot it found nothing for (the fake's own fixture, not a command).
 */
import {
  RationalTime,
  type CastCandidate,
  type Clip,
  type RationalTime as Time,
  type SlotCast,
  type SlotId,
  type StillMotion,
  type TaalcutError,
  type Timeline,
  type TimelineItemId,
  type TimeRange,
} from '@taalcut/core';
import { beatGrid, timelineError, type Edit } from '../../edits';
import { positionsOf, v1Items, withV1 } from './gap-reads';

export type GapFill =
  | { readonly kind: 'image'; readonly assetId: Clip['media']['assetId']; readonly stillMotion: StillMotion }
  | {
      readonly kind: 'video';
      readonly assetId: Clip['media']['assetId'];
      readonly shotId: CastCandidate['shotId'];
      /** The media's whole length at its own rate. */
      readonly available: TimeRange;
      readonly sourceStart?: Time;
    };

const manualCandidate = (
  media: Pick<CastCandidate, 'assetId' | 'shotId'>,
  sourceStart: Time,
): CastCandidate => ({
  assetId: media.assetId,
  shotId: media.shotId,
  sourceStart,
  syncPoint: null,
  score: 0,
  parts: { intent: 0, motion: 0, quality: 0, subject: 0, energy: 0, hook: null, rerank: null, penalty: 0 },
});

const keyOf = (candidate: Pick<CastCandidate, 'assetId' | 'shotId'>) => candidate.shotId ?? candidate.assetId;

/** The slot with a new pick: the old pick joins the alternates (three at most), as packages/timeline's withPick. */
function withPick(slot: SlotCast, pick: CastCandidate, clipId: TimelineItemId): SlotCast {
  const pool = [...(slot.pick ? [slot.pick] : []), ...slot.alternates];
  const alternates = pool.filter((candidate) => keyOf(candidate) !== keyOf(pick)).slice(0, 3);
  return { ...slot, pick, alternates, clipId, confidence: null, needsRerank: false, note: 'gapFilled' };
}

/** The beat nearest `frame` (ties earlier) and how far off it is; null without a beat map. */
function anchorAt(timeline: Timeline, frame: number, length: number): Clip['beatAnchor'] {
  const beats = timeline.beatMap?.beats.length ?? 0;
  const grid = beatGrid(timeline, length).slice(0, beats);
  if (grid.length === 0) return null;
  let index = 0;
  for (let i = 1; i < grid.length; i += 1)
    if (Math.abs(grid[i]! - frame) < Math.abs(grid[index]! - frame)) index = i;
  return { beatIndex: index, offset: RationalTime.of(frame - grid[index]!, timeline.canvas.rate) };
}

/** Where a video's in-point goes: the caller's if the gap's length fits after it, else the middle; null if too short. */
function inPoint(
  fill: Extract<GapFill, { kind: 'video' }>,
  frames: number,
  rate: Timeline['canvas']['rate'],
): Time | null {
  const media = fill.available;
  const needed = RationalTime.rescale(RationalTime.of(frames, rate), media.start.rate, 'ceil').value;
  const end = media.start.value + media.duration.value;
  if (needed > media.duration.value) return null;
  const wanted = fill.sourceStart
    ? RationalTime.rescale(fill.sourceStart, media.start.rate, 'floor').value
    : null;
  if (wanted !== null && wanted >= media.start.value && wanted + needed <= end)
    return RationalTime.of(wanted, media.start.rate);
  return RationalTime.of(
    media.start.value + Math.floor((media.duration.value - needed) / 2),
    media.start.rate,
  );
}

/** Why `gapId` can't be filled: not on V1, or not a gap; null when it can. */
export function gapRefusal(timeline: Timeline, gapId: TimelineItemId): TaalcutError | null {
  const position = positionsOf(timeline).find((entry) => entry.item.id === gapId);
  if (!position) return timelineError('timeline.gap_not_found', { gapId });
  return position.item.type === 'gap' ? null : timelineError('timeline.not_a_gap', { itemId: gapId });
}

export function fillGap(timeline: Timeline, gapId: TimelineItemId, fill: GapFill): Edit {
  const refused = gapRefusal(timeline, gapId);
  if (refused) return { ok: false, error: refused };
  const positions = positionsOf(timeline);
  const position = positions.find((entry) => entry.item.id === gapId);
  const gap = position?.item;
  if (!position || gap?.type !== 'gap')
    return { ok: false, error: timelineError('timeline.gap_not_found', { gapId }) };
  const rate = timeline.canvas.rate;
  const length = positions.at(-1)?.end ?? 0;
  let media: Clip['media'];
  let sourceStart = RationalTime.zero(rate);
  if (fill.kind === 'image') media = { kind: 'image', assetId: fill.assetId };
  else {
    const start = inPoint(fill, gap.duration.value, rate);
    if (!start) return { ok: false, error: timelineError('timeline.media_too_short', { clipId: gapId }) };
    sourceStart = start;
    media = { kind: 'video', assetId: fill.assetId, shotId: fill.shotId, available: fill.available };
  }
  const clip: Clip = {
    type: 'clip',
    id: gap.id,
    media,
    sourceStart,
    duration: gap.duration,
    speed: null,
    slotId: gap.slotId,
    syncPoint: null,
    beatAnchor: anchorAt(timeline, position.start, length),
    fit: 'cover',
    audio: { gainDb: 0, muted: true },
    locked: false,
    enabled: true,
    stillMotion: fill.kind === 'image' ? fill.stillMotion : null,
    reframe: null,
  };
  const pick = manualCandidate(
    { assetId: fill.assetId, shotId: fill.kind === 'video' ? fill.shotId : null },
    sourceStart,
  );
  const items = [...v1Items(timeline)];
  items[position.itemIndex] = clip;
  const tracks = withV1(timeline, items);
  const cast = timeline.cast && {
    ...timeline.cast,
    slots: timeline.cast.slots.map((slot) =>
      slot.slotId === gap.slotId ? withPick(slot, pick, clip.id) : slot,
    ),
  };
  return { ok: true, timeline: { ...timeline, tracks, cast } };
}

export function markForFilming(timeline: Timeline, slotIds: readonly SlotId[], on: boolean): Edit {
  const cast = timeline.cast;
  const known = new Set<string>((cast?.slots ?? []).map((slot) => slot.slotId));
  const missing = slotIds.find((slotId) => !known.has(slotId));
  if (!cast || missing)
    return {
      ok: false,
      error: timelineError('timeline.item_not_found', { itemId: missing ?? slotIds[0] ?? 'cast' }),
    };
  const wanted = new Set<string>(slotIds);
  let changed = false;
  const slots = cast.slots.map((slot): SlotCast => {
    if (!wanted.has(slot.slotId)) return slot;
    const note: SlotCast['note'] = on
      ? 'filmRequested'
      : slot.note === 'filmRequested'
        ? slot.pick
          ? null
          : 'noCandidates'
        : slot.note;
    if (note === slot.note) return slot;
    changed = true;
    return { ...slot, note };
  });
  return { ok: true, timeline: changed ? { ...timeline, cast: { ...cast, slots } } : timeline };
}

/** The clips at these 1-based places on V1 become gaps, their slots cast with nothing ("noCandidates"). */
export function punch(timeline: Timeline, numbers: readonly number[]): Timeline {
  const targets = new Set(numbers);
  const punched = new Set<string>();
  const items = [...v1Items(timeline)];
  positionsOf(timeline).forEach((position, index) => {
    const { item } = position;
    if (!targets.has(index + 1) || item.type !== 'clip') return;
    items[position.itemIndex] = { type: 'gap', id: item.id, duration: item.duration, slotId: item.slotId };
    if (item.slotId) punched.add(item.slotId);
  });
  const tracks = withV1(timeline, items);
  const cast = timeline.cast && {
    ...timeline.cast,
    slots: timeline.cast.slots.map((slot): SlotCast =>
      punched.has(slot.slotId)
        ? { ...slot, clipId: null, pick: null, alternates: [], confidence: null, note: 'noCandidates' }
        : slot,
    ),
  };
  return { ...timeline, tracks, cast };
}
