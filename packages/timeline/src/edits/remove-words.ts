// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  ok,
  RationalTime,
  ValidationError,
  type Clip,
  type Result,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
  type TranscriptOccurrence,
  type TranscriptOccurrenceRef,
} from '@taalcut/core';
import { ClipLocked } from '../errors';
import { trimEnd, trimStart } from '../model/clip-edit';
import { complement } from '../model/intervals';
import { positions } from '../model/sequence';
import { fitTransitions } from '../resync/neighbours';
import { rippleExtras } from './ripple';
import { timeMap, type TimeMap } from './time-map';
import type { EditResult } from './types';

const invalid = (detail: string) => err(ValidationError({ field: 'words' }, { detail }));
const key = (word: TranscriptOccurrenceRef) => `${word.clipId}:${word.assetId}:${word.segment}:${word.word}`;
const sameRange = (a: TranscriptOccurrenceRef, b: TranscriptOccurrenceRef) =>
  RationalTime.compare(a.source.start, b.source.start) === 0 &&
  RationalTime.compare(a.source.duration, b.source.duration) === 0;

/** Cut the same intervals out of linked audio, retaining source timing and refusing any locked cut atomically. */
function cutTrack(
  items: readonly SequenceItem[],
  map: TimeMap,
  rate: Timeline['canvas']['rate'],
  ids: () => TimelineItemId,
): Result<SequenceItem[]> {
  const out: SequenceItem[] = [];
  const first = new Map<TimelineItemId, TimelineItemId>();
  const last = new Map<TimelineItemId, TimelineItemId>();
  for (const { item, start, end } of positions(items)) {
    const removed = map.removed
      .filter((span) => span.start < end && span.end > start)
      .map((span) => ({ start: Math.max(start, span.start) - start, end: Math.min(end, span.end) - start }));
    if (!removed.length) {
      out.push(item);
      first.set(item.id, item.id);
      last.set(item.id, item.id);
      continue;
    }
    if (item.type === 'clip' && item.locked) return err(ClipLocked({ clipId: item.id }));
    const kept = complement(removed, end - start);
    kept.forEach((span, index) => {
      const shortened = trimEnd(item, span.end - item.duration.value, rate);
      const piece = trimStart(shortened, span.start, rate);
      const cut = { ...piece, id: index === 0 ? item.id : ids() };
      if (cut.type === 'clip') {
        cut.slotId = index === 0 ? item.slotId : null;
        cut.syncPoint = null;
        cut.beatAnchor = null;
        cut.audio = clippedFades(cut);
      }
      if (index === 0) first.set(item.id, cut.id);
      last.set(item.id, cut.id);
      out.push(cut);
    });
  }
  const joins = items.flatMap((item, index) =>
    item.type === 'transition'
      ? [{ item, from: last.get(items[index - 1]!.id), to: first.get(items[index + 1]!.id) }]
      : [],
  );
  const joined = out.flatMap((item, index) => {
    const join = joins.find((candidate) => candidate.from === item.id && candidate.to === out[index + 1]?.id);
    return join ? [item, join.item] : [item];
  });
  return ok(fitTransitions(joined, rate));
}

function clippedFades(clip: Clip): Clip['audio'] {
  const clamp = (time: RationalTime | undefined) =>
    time ? { value: Math.min(time.value, clip.duration.value), rate: time.rate } : undefined;
  return {
    ...clip.audio,
    ...(clip.audio.fadeIn ? { fadeIn: clamp(clip.audio.fadeIn)! } : {}),
    ...(clip.audio.fadeOut ? { fadeOut: clamp(clip.audio.fadeOut)! } : {}),
  };
}

export function removeWords(
  timeline: Timeline,
  requested: readonly TranscriptOccurrenceRef[],
  available: readonly TranscriptOccurrence[],
  ids: () => TimelineItemId,
): Result<EditResult> {
  const byKey = new Map(available.map((word) => [key(word), word]));
  const spans: { start: number; end: number }[] = [];
  for (const ref of requested) {
    const occurrence = byKey.get(key(ref));
    if (!occurrence || !sameRange(occurrence, ref))
      return invalid('A selected word or its timing changed; select it again');
    const start = occurrence.range.start.value;
    spans.push({ start, end: start + occurrence.range.duration.value });
  }
  const map = timeMap(spans);
  const tracks = [] as Timeline['tracks'];
  for (const track of timeline.tracks) {
    if (track.kind === 'text') {
      tracks.push(track);
      continue;
    }
    const cut = cutTrack(track.items, map, timeline.canvas.rate, ids);
    if (!cut.ok) return cut;
    tracks.push({ ...track, items: cut.value });
  }
  if (!tracks[0]?.items.length) return invalid('Keep at least one frame in the video');
  const moved = rippleExtras(timeline, map, ids);
  const remaining = new Set(tracks[0].items.map((item) => item.id));
  const cast = timeline.cast
    ? {
        ...timeline.cast,
        slots: timeline.cast.slots.map((slot) =>
          slot.clipId && !remaining.has(slot.clipId)
            ? { ...slot, clipId: null, note: 'dropped' as const }
            : slot,
        ),
      }
    : null;
  const voiceClips = new Map(
    tracks
      .filter((track) => track.kind === 'audio' && track.role === 'voice')
      .flatMap((track) =>
        track.items
          .filter((item): item is Clip => item.type === 'clip')
          .map((clip) => [clip.id, clip] as const),
      ),
  );
  const voiceover = timeline.voiceover
    ? {
        ...timeline.voiceover,
        lines: timeline.voiceover.lines.map((line) => {
          if (!line.clipId) return line;
          const clip = voiceClips.get(line.clipId);
          return clip ? { ...line, duration: clip.duration } : { ...line, clipId: null };
        }),
      }
    : null;
  return ok({
    timeline: {
      ...moved,
      voiceover,
      cast,
      tracks: tracks.map((track, index) => (track.kind === 'text' ? moved.tracks[index]! : track)),
    },
    changed: ['tracks', 'markers', 'captions', 'cast', 'voiceover'],
  });
}
