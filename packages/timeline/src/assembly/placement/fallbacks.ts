// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When an item has no room even at QA's readable minimum (FRM1-OVL, plan "ovl" 3), the clip under it gets a
 * second chance before QA fails it: its in-point moves within the media's usable range, a quarter second at a time
 * and nearest first, to a moment with room (`retimed`). The slot's next clip is casting's fallback
 * (casting/recast-for-room.ts, `recast`). A try is kept only when every item over the clip then has room. An item
 * that found room only off the reel's side of the head (the relation lost) gets the same two chances, and a try
 * for it is kept only when it is then on the reel's side and no other item lost its side for it. Pure.
 */
import {
  RationalTime,
  type Clip,
  type PlacementReason,
  type SubjectSpan,
  type Timeline,
} from '@taalcut/core';
import { updateSlots } from '../../model/cast';
import { videoItems, withVideoItems } from '../../model/sequence';
import { clipMediaFits } from '../../model/speed';
import { spansOverlap } from './geometry';
import { placeOverlays, type PlaceInput, type PlacementReport, type PlaceResult } from './place-timeline';
import { placedClips, type PlacedClip } from './subjects';

export const RETIME = {
  /** Seconds between tried in-points. */
  stepSeconds: 0.25,
  /** Tries each way. */
  steps: 12,
} as const;

/** The clip on screen through the middle of a span. */
export function clipUnder(timeline: Timeline, span: PlacementReport['span']): PlacedClip | undefined {
  const middle = (span.start + span.end) / 2;
  return placedClips(timeline).find((placed) => middle >= placed.start && middle < placed.end);
}

/** The timeline with one clip replaced (same id). */
export function withClip(timeline: Timeline, clip: Clip): Timeline {
  return withVideoItems(
    timeline,
    videoItems(timeline).map((item) => (item.id === clip.id ? clip : item)),
  );
}

/** Writes `reason` into one placed item's record. */
export function withReason(timeline: Timeline, id: string, reason: PlacementReason): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.kind !== 'text'
        ? track
        : {
            ...track,
            items: track.items.map((item) => {
              if (item.id !== id) return item;
              if (item.type === 'text') return { ...item, placement: { reason } };
              return typeof item.placement === 'object'
                ? { ...item, placement: { ...item.placement, reason } }
                : item;
            }),
          },
    ),
  };
}

/** The placed items over a clip's frames: what a change to the clip must keep room for. */
export const itemsOver = (report: readonly PlacementReport[], placed: PlacedClip) =>
  new Set(report.filter((entry) => spansOverlap(entry.span, placed.seen)).map((entry) => entry.id));

/** Beside a head, but not on the reel's side of it: the reel's relation lost. */
export function sideLost(entry: PlacementReport): boolean {
  const wanted = entry.relation.relativeTo === 'subject' ? entry.relation.side : undefined;
  return Boolean(wanted && entry.side && entry.side !== wanted);
}

/** What retime and recast try to mend: no room, or the reel's side of the head lost. */
export const needsFallback = (entry: PlacementReport) => entry.reason === 'noRoom' || sideLost(entry);

/**
 * Whether a try mends `failed` (its report has every re-placed item): nobody left without room; for an item that
 * had lost its side, that item back on it and no other item off its side that wasn't before.
 */
export function mends(
  failed: PlacementReport,
  report: readonly PlacementReport[],
  tried: readonly PlacementReport[],
): boolean {
  if (tried.some((entry) => entry.reason === 'noRoom')) return false;
  if (failed.reason === 'noRoom') return true;
  const lostBefore = new Set(report.filter(sideLost).map((entry) => entry.id));
  return tried.every((entry) => !sideLost(entry) || (entry.id !== failed.id && lostBefore.has(entry.id)));
}

/** The item's entry in the report, while it still needs a fallback. */
export function stillFailing(report: readonly PlacementReport[], id: string): PlacementReport | undefined {
  const entry = report.find((candidate) => candidate.id === id);
  return entry && needsFallback(entry) ? entry : undefined;
}

/** The report with a try's entries in place of the old ones, and `id`'s reason set. */
export function merged(
  report: readonly PlacementReport[],
  tried: readonly PlacementReport[],
  id: string,
  reason: PlacementReason,
) {
  const byId = new Map(tried.map((entry) => [entry.id, entry]));
  return report.map((entry) => {
    const next = byId.get(entry.id) ?? entry;
    return next.id === id ? { ...next, reason } : next;
  });
}

function inPoints(clip: Clip): RationalTime[] {
  if (clip.media.kind !== 'video') return [];
  const rate = clip.media.available.start.rate;
  const step = Math.max(1, Math.round((RETIME.stepSeconds * rate.num) / rate.den));
  const start = RationalTime.rescale(clip.sourceStart, rate, 'round');
  const out: RationalTime[] = [];
  for (let k = 1; k <= RETIME.steps; k++)
    for (const sign of [1, -1]) out.push(RationalTime.of(start.value + sign * k * step, rate));
  return out;
}

/**
 * Each noRoom or side-lost item's clip tried at other in-points, with `wider` (its span over as far as the
 * in-points reach); the first in-point that mends it is kept.
 */
export function retimeForRoom(
  input: PlaceInput & {
    readonly result: PlaceResult;
    readonly wider: ReadonlyMap<string, SubjectSpan | undefined>;
  },
): PlaceResult {
  let { timeline, report } = input.result;
  const subjects = new Map(input.subjects);
  for (const first of input.result.report.filter(needsFallback)) {
    const failed = stillFailing(report, first.id);
    if (!failed) continue;
    const placed = clipUnder(timeline, failed.span);
    const span = placed ? input.wider.get(placed.clip.id) : undefined;
    if (!placed || !span || placed.clip.locked) continue;
    const affected = itemsOver(report, placed);
    for (const sourceStart of inPoints(placed.clip)) {
      const clip: Clip = { ...placed.clip, sourceStart, syncPoint: null };
      if (!clipMediaFits(clip, timeline.canvas.rate)) continue;
      const moved = withClip(timeline, clip);
      const cast = updateSlots(moved.cast, (slot) =>
        slot.clipId === clip.id && slot.pick
          ? { ...slot, pick: { ...slot.pick, sourceStart, syncPoint: null } }
          : slot,
      );
      const tried = placeOverlays({
        ...input,
        timeline: { ...moved, cast },
        subjects: new Map(subjects).set(clip.id, span),
        only: affected,
      });
      if (!mends(failed, report, tried.report)) continue;
      subjects.set(clip.id, span);
      timeline = withReason(tried.timeline, failed.id, 'retimed');
      report = merged(report, tried.report, failed.id, 'retimed');
      break;
    }
  }
  return { timeline, report };
}
