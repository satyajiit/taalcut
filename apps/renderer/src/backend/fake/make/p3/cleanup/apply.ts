// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- core errors' `detail`: for developers, never UI copy */

/**
 * timeline.applyCleanup's edit, as @taalcut/timeline's applyCleanup makes it (P3-V9): each planned clip becomes
 * its kept pieces, split at the punch-ins, laid end to end (the first keeps the clip's id, the rest take the
 * plan's ids); the agent may not cut a clip you locked. Everything after moves earlier through one time map:
 * text, markers and caption cues (a word inside a removed span goes).
 */
import {
  mergeSpans,
  RationalTime,
  TimeRange,
  ValidationError,
  type CaptionTrack,
  type CleanupPlan,
  type Clip,
  type CommandSource,
  type Marker,
  type SequenceItem,
  type TaalcutError,
  type TextTrackItem,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { timelineError, type Edit } from '../../edits';
import { complement, segments, type Interval } from './spans';

type PlannedClip = CleanupPlan['clips'][number];

const malformed = (detail: string): Edit => ({
  ok: false,
  error: ValidationError({ field: 'plan' }, { detail }),
});

/** A source range as frames of the clip; null off whole canvas frames. */
function clipSpan(clip: Clip, range: TimeRange, rate: Timeline['canvas']['rate']): Interval | null {
  const offset = RationalTime.subtract(range.start, clip.sourceStart);
  if (!RationalTime.isExactIn(offset, rate) || !RationalTime.isExactIn(range.duration, rate)) return null;
  const start = RationalTime.rescale(offset, rate).value;
  return { start, end: start + RationalTime.rescale(range.duration, rate).value };
}

function cleanedClips(clip: Clip, planned: PlannedClip, rate: Timeline['canvas']['rate']) {
  if (clip.media.kind !== 'video' || clip.speed !== null)
    return { error: `${clip.id} is not a real-time video clip` };
  const kept = planned.keep.map((range) => clipSpan(clip, range, rate));
  const punches = planned.punch.map((punch) => clipSpan(clip, punch.range, rate));
  const pieces = kept.flatMap((span) => (span ? [span] : []));
  const punchSpans = punches.flatMap((span) => (span ? [span] : []));
  if (
    pieces.length !== kept.length ||
    punchSpans.length !== punches.length ||
    [...pieces, ...punchSpans].some(
      (span) => span.start < 0 || span.end > clip.duration.value || span.end <= span.start,
    )
  )
    return { error: `${clip.id}: a range outside the clip or off the canvas frames` };
  const split = segments(pieces, punchSpans);
  if (split.length !== planned.newIds.length + 1)
    return { error: `${clip.id}: ${split.length} clips, ${planned.newIds.length + 1} ids` };
  const mediaRate = clip.media.available.start.rate;
  const ids: TimelineItemId[] = [clip.id, ...planned.newIds];
  const pieceStart = (frame: number) =>
    RationalTime.rescale(
      RationalTime.add(clip.sourceStart, RationalTime.of(frame, rate)),
      mediaRate,
      'floor',
    );
  const clips = split.map(({ span, punched }, index): Clip => {
    const punch = punched ? planned.punch.find((_, at) => punchSpans[at]?.start === span.start) : undefined;
    const piece =
      pieces.find((candidate) => span.start >= candidate.start && span.start < candidate.end) ?? span;
    const into = RationalTime.rescale(RationalTime.of(span.start - piece.start, rate), mediaRate, 'round');
    return {
      ...clip,
      id: ids[index] ?? clip.id,
      sourceStart: RationalTime.add(pieceStart(piece.start), into),
      duration: RationalTime.of(span.end - span.start, rate),
      syncPoint: null,
      beatAnchor: null,
      reframe: punch ? punch.reframe : clip.reframe,
    };
  });
  return { clips, kept: pieces };
}

/** Old frame → new: earlier by the frames removed before it. */
function mapFrame(removed: readonly Interval[], frame: number): number {
  let gone = 0;
  for (const span of removed) {
    if (span.start >= frame) break;
    gone += Math.min(span.end, frame) - span.start;
  }
  return frame - gone;
}

function rippled(timeline: Timeline, removed: readonly Interval[]): Timeline {
  const rate = timeline.canvas.rate;
  const frames = (time: RationalTime) => RationalTime.rescale(time, rate, 'round').value;
  const span = (start: number, end: number) => ({
    start: mapFrame(removed, start),
    end: mapFrame(removed, end),
  });
  const at = (start: number, end: number) =>
    TimeRange.of(RationalTime.of(start, rate), RationalTime.of(Math.max(0, end - start), rate));
  const text = (items: readonly TextTrackItem[]) =>
    items.flatMap((item) => {
      const start = frames(item.start);
      const moved = span(start, start + frames(item.duration));
      if (moved.end - moved.start < 1) return [];
      return [
        {
          ...item,
          start: RationalTime.of(moved.start, rate),
          duration: RationalTime.of(moved.end - moved.start, rate),
        },
      ];
    });
  const markers = timeline.markers.flatMap((marker): Marker[] => {
    const start = frames(marker.range.start);
    const length = frames(marker.range.duration);
    const moved = span(start, start + length);
    if (marker.kind === 'hook')
      return [{ ...marker, range: at(moved.start, moved.start + Math.max(length, 1)) }];
    return moved.end - moved.start < 1 ? [] : [{ ...marker, range: at(moved.start, moved.end) }];
  });
  const captions: CaptionTrack | null = timeline.captions && {
    ...timeline.captions,
    cues: timeline.captions.cues.flatMap((cue) => {
      const words = cue.words.flatMap((word) => {
        const start = frames(word.range.start);
        const moved = span(start, start + frames(word.range.duration));
        return moved.end - moved.start < 1 ? [] : [{ ...word, range: at(moved.start, moved.end) }];
      });
      if (words.length === 0) return [];
      const start = frames(cue.range.start);
      const moved = span(start, start + frames(cue.range.duration));
      return [{ ...cue, words, range: at(moved.start, moved.end) }];
    }),
  };
  const tracks = timeline.tracks.map((track, index) =>
    index > 0 && track.kind === 'text' ? { ...track, items: text(track.items) } : track,
  );
  return { ...timeline, tracks, markers, captions };
}

/** The timeline with the plan applied: V1 cut, everything after it moved up. */
export function applyCleanupPlan(timeline: Timeline, plan: CleanupPlan, source: CommandSource): Edit {
  if (plan.timelineId !== timeline.id) return malformed('The plan is for another timeline');
  const video = timeline.tracks[0];
  if (video?.kind !== 'video') return malformed('No video track');
  const rate = timeline.canvas.rate;
  const byClip = new Map<string, PlannedClip>(plan.clips.map((planned) => [planned.clipId, planned]));
  const items: SequenceItem[] = [];
  const removed: Interval[] = [];
  let at = 0;
  for (const item of video.items) {
    const planned = byClip.get(item.id);
    if (!planned || item.type !== 'clip') {
      items.push(item);
      if (item.type !== 'transition') at += item.duration.value;
      continue;
    }
    if (item.locked && source === 'agent')
      return { ok: false, error: timelineError('timeline.clip_locked', { clipId: item.id }) };
    const made = cleanedClips(item, planned, rate);
    if ('error' in made) return malformed(made.error ?? '');
    for (const gap of complement(made.kept, item.duration.value))
      removed.push({ start: at + gap.start, end: at + gap.end });
    items.push(...made.clips);
    byClip.delete(item.id);
    at += item.duration.value;
  }
  const missing = [...byClip.keys()][0];
  if (missing) return { ok: false, error: timelineError('timeline.item_not_found', { itemId: missing }) };
  const tracks = timeline.tracks.map((track, index) =>
    index === 0 && track.kind === 'video' ? { ...track, items } : track,
  );
  return { ok: true, timeline: rippled({ ...timeline, tracks }, mergeSpans(removed)) };
}

/** timeline.cleanup_stale: the plan was made on another revision and its clips have changed since. */
export function staleError(revision: number): TaalcutError {
  return {
    code: 'timeline.cleanup_stale',
    messageKey: 'errors.timeline.cleanup_stale',
    retryable: false,
    params: { revision },
  };
}
