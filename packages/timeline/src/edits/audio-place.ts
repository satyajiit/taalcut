// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * audio.trim and audio.move (EDT1-OPS, SPEC "EDT1-OPS: sound"): one sound on an audio track (a voice line, an
 * effect) or the music. A trim changes one edge while the sound stays where it was in time (the in-point moves with
 * a start trim); a move puts the whole sound later or earlier. A sound never overlaps the one beside it on its track
 * nor starts before frame 0, and its media stays inside the file: `timeline.invalid_move` says how far it can go.
 * A V1 clip's sound moves with its picture, so these refuse it. The music's are its bed's window and shift
 * (`mix.music`); the beat grid stays the template's, so a move by whole beats keeps the cuts on the music's beats.
 */
import {
  defaultMusicBed,
  err,
  ok,
  RationalTime,
  TimeRange,
  type AudioItemTarget,
  type Clip,
  type ClipEdge,
  type MusicBed,
  type Result,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
  type Track,
} from '@taalcut/core';
import { InvalidMove, ItemNotFound, MediaTooShort } from '../errors';
import { toMedia } from '../model/clip-edit';
import { positions, sequenceLength, videoItems } from '../model/sequence';
import { withTransitions } from './insert-extras';
import { refuseLocked, unchanged, type EditOptions, type EditResult } from './types';

type AudioTrack = Extract<Track, { kind: 'audio' }>;
type Rate = Timeline['canvas']['rate'];

interface Placed {
  readonly start: number;
  readonly clip: Clip;
}

/** The audio track and the placed clip `clipId`, or why not. */
function findSound(
  timeline: Timeline,
  clipId: TimelineItemId,
): Result<{ track: number; placed: Placed[]; at: number }> {
  if (videoItems(timeline).some((item) => item.id === clipId))
    return err(
      InvalidMove(undefined, {
        detail: 'A video clip’s sound moves with its picture: trim or move the clip',
      }),
    );
  for (const [index, track] of timeline.tracks.entries()) {
    if (track.kind !== 'audio') continue;
    const placed = positions(track.items).flatMap(({ item, start }) =>
      item.type === 'clip' ? [{ start, clip: item }] : [],
    );
    const at = placed.findIndex((entry) => entry.clip.id === clipId);
    if (at >= 0) return ok({ track: index, placed, at });
  }
  return err(ItemNotFound({ itemId: clipId }));
}

/** Clips at their starts as a sequence: gaps between, the track's transitions kept where they still fit. */
function itemsOf(
  track: AudioTrack,
  placed: readonly Placed[],
  rate: Rate,
  ids: () => TimelineItemId,
): SequenceItem[] {
  const out: SequenceItem[] = [];
  let cursor = 0;
  for (const { start, clip } of [...placed].sort((a, b) => a.start - b.start)) {
    if (start > cursor)
      out.push({ type: 'gap', id: ids(), duration: RationalTime.of(start - cursor, rate), slotId: null });
    out.push(clip);
    cursor = start + clip.duration.value;
  }
  return withTransitions(track.items, out);
}

/** The room either side of placed clip `at`: from the end of the one before (or 0), to the start of the next. */
function room(placed: readonly Placed[], at: number): { readonly from: number; readonly to: number } {
  const before = placed[at - 1];
  const after = placed[at + 1];
  return {
    from: before ? before.start + before.clip.duration.value : 0,
    to: after ? after.start : Number.POSITIVE_INFINITY,
  };
}

function fits(clip: Clip): boolean {
  if (clip.media.kind === 'image') return true;
  const available = clip.media.available;
  const end = RationalTime.add(clip.sourceStart, clip.duration);
  return (
    RationalTime.compare(available.start, clip.sourceStart) <= 0 &&
    RationalTime.compare(end, TimeRange.end(available)) <= 0
  );
}

function soundEdit(
  timeline: Timeline,
  clipId: TimelineItemId,
  options: EditOptions & { readonly ids: () => TimelineItemId },
  change: (placed: Placed, space: { from: number; to: number }) => Result<Placed>,
): Result<EditResult> {
  const found = findSound(timeline, clipId);
  if (!found.ok) return found;
  const { track, placed, at } = found.value;
  const current = placed[at] as Placed;
  const allowed = refuseLocked(current.clip, options.source);
  if (!allowed.ok) return allowed;
  const next = change(current, room(placed, at));
  if (!next.ok) return next;
  if (next.value.start === current.start && next.value.clip === current.clip) return unchanged(timeline);
  if (!fits(next.value.clip)) return err(MediaTooShort({ clipId }));
  const audio = timeline.tracks[track] as AudioTrack;
  const moved = placed.map((entry, index) => (index === at ? next.value : entry));
  const tracks = timeline.tracks.map((t, index) =>
    index === track ? { ...audio, items: itemsOf(audio, moved, timeline.canvas.rate, options.ids) } : t,
  );
  return ok({ timeline: { ...timeline, tracks }, changed: ['tracks'] });
}

const frames = (time: RationalTime, rate: Rate) => RationalTime.rescale(time, rate, 'round').value;
const tooFar = (detail: string) => err(InvalidMove(undefined, { detail }));

function trimClipSound(
  clip: Placed,
  edge: ClipEdge,
  by: number,
  space: { from: number; to: number },
  rate: Rate,
): Result<Placed> {
  const length = clip.clip.duration.value + by;
  if (length < 1) return tooFar('The sound would last under a frame');
  if (edge === 'end') {
    if (clip.start + length > space.to)
      return tooFar(`It can grow ${space.to - clip.start - clip.clip.duration.value} frames at most`);
    return ok({ start: clip.start, clip: { ...clip.clip, duration: RationalTime.of(length, rate) } });
  }
  const start = clip.start - by;
  if (start < space.from) return tooFar(`It can grow ${clip.start - space.from} frames at most`);
  const rateOf = clip.clip.sourceStart.rate;
  const sourceStart = RationalTime.subtract(clip.clip.sourceStart, toMedia(by, rate, rateOf));
  return ok({ start, clip: { ...clip.clip, duration: RationalTime.of(length, rate), sourceStart } });
}

function moveClipSound(clip: Placed, by: number, space: { from: number; to: number }): Result<Placed> {
  const start = clip.start + by;
  if (start < space.from) return tooFar(`It can move ${clip.start - space.from} frames earlier at most`);
  if (start + clip.clip.duration.value > space.to)
    return tooFar(`It can move ${space.to - clip.start - clip.clip.duration.value} frames later at most`);
  return ok({ start, clip: clip.clip });
}

/** The music's bed after a trim or a move, or why not. */
function bedEdit(
  timeline: Timeline,
  edit: (bed: MusicBed, end: number) => Result<MusicBed>,
): Result<EditResult> {
  if (timeline.music.path === 'platformSound' || timeline.music.path === 'none')
    return err(InvalidMove(undefined, { detail: 'This timeline has no music bed to edit' }));
  const rate = timeline.canvas.rate;
  const bed = timeline.mix.music ?? defaultMusicBed(rate);
  const next = edit(bed, sequenceLength(videoItems(timeline)));
  if (!next.ok) return next;
  if (JSON.stringify(next.value) === JSON.stringify(bed)) return unchanged(timeline);
  return ok({ timeline: { ...timeline, mix: { ...timeline.mix, music: next.value } }, changed: ['mix'] });
}

export function trimSound(
  timeline: Timeline,
  input: { readonly target: AudioItemTarget; readonly edge: ClipEdge; readonly by: RationalTime },
  options: EditOptions & { readonly ids: () => TimelineItemId },
): Result<EditResult> {
  const rate = timeline.canvas.rate;
  const by = frames(input.by, rate);
  if (by === 0) return unchanged(timeline);
  if (input.target.kind === 'clip')
    return soundEdit(timeline, input.target.clipId, options, (clip, space) =>
      trimClipSound(clip, input.edge, by, space, rate),
    );
  return bedEdit(timeline, (bed, length) => {
    const at = (value: number) => RationalTime.of(value, rate);
    const end = bed.end ? bed.end.value : length;
    if (input.edge === 'start') {
      const start = Math.max(0, bed.start.value - by);
      return start >= end ? tooFar('The music would end before it starts') : ok({ ...bed, start: at(start) });
    }
    const next = end + by;
    if (next <= bed.start.value) return tooFar('The music would end before it starts');
    return ok({ ...bed, end: next >= length ? null : at(next) });
  });
}

export function moveSound(
  timeline: Timeline,
  input: { readonly target: AudioItemTarget; readonly by: RationalTime },
  options: EditOptions & { readonly ids: () => TimelineItemId },
): Result<EditResult> {
  const rate = timeline.canvas.rate;
  const by = frames(input.by, rate);
  if (by === 0) return unchanged(timeline);
  if (input.target.kind === 'clip')
    return soundEdit(timeline, input.target.clipId, options, (clip, space) => moveClipSound(clip, by, space));
  return bedEdit(timeline, (bed, length) => {
    const at = (value: number) => RationalTime.of(value, rate);
    const start = Math.max(0, bed.start.value + by);
    const end = bed.end === null ? null : bed.end.value + by;
    if (start >= (end ?? length)) return tooFar('The music would start after the video ends');
    return ok({
      ...bed,
      start: at(start),
      end: end === null || end >= length ? null : at(end),
      shift: at(bed.shift.value + by),
    });
  });
}
