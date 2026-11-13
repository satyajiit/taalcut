// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.applyCleanup (P3-V9, pure edit): each planned clip becomes its kept pieces, split at the punch-ins,
 * laid end to end (the first keeps the clip's id, the rest take the plan's ids); everything after ripples
 * earlier through one time map: text, markers, caption cues (words in removed spans go) and the audio tracks.
 * The command checks the plan still fits the timeline (cleanup-commands.ts). Cleanup clips have no beat anchor
 * (speech, not beats, sets their cuts); later clips keep their content and take the anchor of their new start. A music bed ends with the shorter video. Render crossfades every join.
 */
import {
  err,
  ok,
  RationalTime,
  ValidationError,
  type CleanupPlan,
  type Clip,
  type Result,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
  type TimeRange,
} from '@taalcut/core';
import { rippleExtras } from '../edits/ripple';
import { timeMap, type Span } from '../edits/time-map';
import { refuseLocked, type EditOptions, type EditResult } from '../edits/types';
import { ItemNotFound } from '../errors';
import { medianItemFrames, positions, videoItems, withVideoItems } from '../model/sequence';
import { anchorAt, beatGrid } from '../resync/grid';
import { fitTransitions } from '../resync/neighbours';
import { complement, type Interval } from '../model/intervals';
import { segments } from './punch-ins';

type PlannedClip = CleanupPlan['clips'][number];

const malformed = (detail: string) => err(ValidationError({ field: 'plan' }, { detail }));

/** A source range as frames of the clip on the canvas; null when it isn't on whole canvas frames. */
function clipSpan(clip: Clip, range: TimeRange, timeline: Timeline): Interval | null {
  const rate = timeline.canvas.rate;
  const offset = RationalTime.subtract(range.start, clip.sourceStart);
  if (!RationalTime.isExactIn(offset, rate) || !RationalTime.isExactIn(range.duration, rate)) return null;
  const start = RationalTime.rescale(offset, rate).value;
  return { start, end: start + RationalTime.rescale(range.duration, rate).value };
}

/** The clips one planned clip becomes. */
function cleanedClips(
  clip: Clip,
  planned: PlannedClip,
  timeline: Timeline,
): Result<{ clips: Clip[]; kept: Interval[] }> {
  if (clip.media.kind !== 'video' || clip.speed !== null)
    return malformed(`${clip.id} is not a real-time video clip`);
  const spans = (ranges: readonly TimeRange[]) => ranges.map((range) => clipSpan(clip, range, timeline));
  const kept = spans(planned.keep);
  const punches = spans(planned.punch.map((punch) => punch.range));
  if (
    [...kept, ...punches].some(
      (span) => span === null || span.start < 0 || span.end > clip.duration.value || span.end <= span.start,
    )
  )
    return malformed(`${clip.id}: a range outside the clip or off the canvas frames`);
  const pieces = kept as Interval[];
  const split = segments(pieces, punches as Interval[]);
  if (split.length !== planned.newIds.length + 1)
    return malformed(`${clip.id}: ${split.length} clips, ${planned.newIds.length + 1} ids`);
  const rate = timeline.canvas.rate;
  const mediaRate = clip.media.available.start.rate;
  const clipIds: TimelineItemId[] = [clip.id, ...planned.newIds];
  // Each piece's in-point is floored to a whole media frame (the word guard's pad covers it); the punch-in
  // splits inside a piece keep that shift and round, so the piece plays continuous to within half a media frame.
  const pieceStart = (frame: number) =>
    RationalTime.rescale(
      RationalTime.add(clip.sourceStart, RationalTime.of(frame, rate)),
      mediaRate,
      'floor',
    );
  const clips = split.map(({ span, punched }, index): Clip => {
    const punch = punched ? planned.punch.find((_, at) => punches[at]?.start === span.start) : undefined;
    const piece =
      pieces.find((candidate) => span.start >= candidate.start && span.start < candidate.end) ?? span;
    const into = RationalTime.rescale(RationalTime.of(span.start - piece.start, rate), mediaRate, 'round');
    return {
      ...clip,
      id: clipIds[index] ?? clip.id,
      sourceStart: RationalTime.add(pieceStart(piece.start), into),
      duration: RationalTime.of(span.end - span.start, rate),
      syncPoint: null,
      beatAnchor: null,
      reframe: punch ? punch.reframe : clip.reframe,
    };
  });
  return ok({ clips, kept: pieces });
}

/** V1 with every planned clip replaced by its pieces, the spans removed (timeline frames) and where cuts began. */
interface Replaced {
  readonly items: SequenceItem[];
  readonly removed: Span[];
  /** Ids of the cleanup's clips (re-sync leaves them alone). */
  readonly cleaned: Set<string>;
  /** The first frame the cleanup changed; null when no clip was planned. */
  readonly firstChange: number | null;
}

function replacePlanned(
  timeline: Timeline,
  plan: CleanupPlan,
  source: EditOptions['source'],
): Result<Replaced> {
  const byClip = new Map(plan.clips.map((planned) => [planned.clipId as string, planned]));
  const items: SequenceItem[] = [];
  const removed: Span[] = [];
  const cleaned = new Set<string>();
  let firstChange: number | null = null;
  const starts = new Map(
    positions(videoItems(timeline)).map((position) => [position.itemIndex, position.start]),
  );
  for (const [index, item] of videoItems(timeline).entries()) {
    const planned = byClip.get(item.id);
    if (!planned || item.type !== 'clip') {
      items.push(item);
      continue;
    }
    const locked = refuseLocked(item, source);
    if (!locked.ok) return locked;
    const made = cleanedClips(item, planned, timeline);
    if (!made.ok) return made;
    const at = starts.get(index) ?? 0;
    for (const span of complement(made.value.kept, item.duration.value))
      removed.push({ start: at + span.start, end: at + span.end });
    firstChange ??= at;
    made.value.clips.forEach((clip) => cleaned.add(clip.id));
    items.push(...made.value.clips);
    byClip.delete(item.id);
  }
  const missing = [...byClip.keys()][0];
  if (missing) return err(ItemNotFound({ itemId: missing }));
  return ok({ items, removed, cleaned, firstChange });
}

/** Transitions fitted, and every later clip that isn't the cleanup's takes the beat anchor of its new start. */
function reanchored(timeline: Timeline, replaced: Replaced): SequenceItem[] {
  const rate = timeline.canvas.rate;
  const fitted = fitTransitions(replaced.items, rate);
  const grid = beatGrid(timeline.beatMap, rate, medianItemFrames(fitted));
  const after = replaced.firstChange ?? Number.POSITIVE_INFINITY;
  const anchored = [...fitted];
  for (const position of positions(fitted)) {
    const item = position.item;
    if (item.type !== 'clip' || replaced.cleaned.has(item.id) || position.start < after) continue;
    anchored[position.itemIndex] = { ...item, beatAnchor: anchorAt(grid, position.start, rate) };
  }
  return anchored;
}

export function applyCleanup(
  timeline: Timeline,
  plan: CleanupPlan,
  options: Pick<EditOptions, 'source'> & { readonly ids: () => TimelineItemId },
): Result<EditResult> {
  if (plan.timelineId !== timeline.id) return malformed('The plan is for another timeline');
  const replaced = replacePlanned(timeline, plan, options.source);
  if (!replaced.ok) return replaced;
  const items = reanchored(timeline, replaced.value);
  const next = rippleExtras(withVideoItems(timeline, items), timeMap(replaced.value.removed), options.ids);
  return ok({ timeline: next, changed: ['tracks', 'markers', 'captions'] });
}
