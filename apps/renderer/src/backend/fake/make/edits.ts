// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The timeline edits as the fake runs them: the timeline SPEC's model, kept
 * small. Between two clips a trim rolls the cut; the first edge slips; the
 * last edge ripples. A move keeps every position's length, so the clip takes
 * the length of where it lands. The moved cut re-syncs to the nearest beat
 * that keeps both neighbours at least six frames long and their media in
 * range. Clip ids never change. Each function is pure: it returns the new
 * document (or why not), and `relayout` keeps beat anchors, text items and
 * captions in step with the clips.
 */
import {
  MIN_CLIP_FRAMES,
  RationalTime,
  type Clip,
  type CommandSource,
  type TaalcutError,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { beatGrid, clipsOf, relayout } from './layout';
import { centredStart, type PoolShot } from './shot-pool';

export { beatGrid } from './layout';

export type Edit = { ok: true; timeline: Timeline } | { ok: false; error: TaalcutError };

/** The timeline package's errors, as values (defineError registers a code once per process; that package owns them). */
export function timelineError(code: string, params?: Record<string, string>): TaalcutError {
  return { code, messageKey: `errors.${code}`, retryable: false, ...(params ? { params } : {}) };
}

/** Frames of media the clip shows from `sourceStart` for `frames` canvas frames fit inside its media. */
function fits(
  clip: Clip,
  sourceStart: RationalTime,
  frames: number,
  rate: Timeline['canvas']['rate'],
): boolean {
  if (clip.media.kind === 'image') return true;
  const { available } = clip.media;
  const end = RationalTime.add(sourceStart, RationalTime.of(frames, rate));
  return (
    RationalTime.compare(sourceStart, available.start) >= 0 &&
    RationalTime.compare(end, RationalTime.add(available.start, available.duration)) <= 0
  );
}

const shift = (time: RationalTime, frames: number, rate: Timeline['canvas']['rate']) =>
  RationalTime.add(time, RationalTime.rescale(RationalTime.of(frames, rate), time.rate, 'round'));

/** The grid point nearest `wanted` (ties earlier) within two beats that `ok` accepts; else `wanted` if ok. */
function snap(wanted: number, grid: readonly number[], ok: (frame: number) => boolean): number | null {
  if (grid.length === 0) return ok(wanted) ? wanted : null;
  const step = grid[1]! - grid[0]!;
  const near = grid
    .filter((point) => Math.abs(point - wanted) <= step * 2 && ok(point))
    .sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b);
  if (near[0] !== undefined) return near[0];
  return ok(wanted) ? wanted : null;
}

const findClip = (timeline: Timeline, clipId: TimelineItemId) => {
  const clips = clipsOf(timeline);
  return { clips, index: clips.findIndex((clip) => clip.id === clipId) };
};

const lockedForAgent = (clip: Clip, source: CommandSource) => clip.locked && source === 'agent';

export function swapClip(
  timeline: Timeline,
  input: { clipId: TimelineItemId; shot: PoolShot | undefined; sourceStart?: RationalTime | undefined },
  source: CommandSource,
): Edit {
  const { clips, index } = findClip(timeline, input.clipId);
  const clip = clips[index];
  if (!clip) return { ok: false, error: timelineError('timeline.item_not_found', { itemId: input.clipId }) };
  if (lockedForAgent(clip, source))
    return { ok: false, error: timelineError('timeline.clip_locked', { clipId: clip.id }) };
  const shot = input.shot;
  if (!shot) return { ok: false, error: timelineError('timeline.media_missing', { assetId: '' }) };
  const rate = timeline.canvas.rate;
  const media = {
    kind: 'video' as const,
    assetId: shot.candidate.assetId,
    shotId: shot.candidate.shotId,
    available: shot.available,
  };
  const draft: Clip = { ...clip, media, syncPoint: null };
  const wanted = input.sourceStart ?? centredStart(shot, clip.duration.value, rate);
  const start = fits(draft, wanted, clip.duration.value, rate)
    ? wanted
    : centredStart(shot, clip.duration.value, rate);
  if (!fits(draft, start, clip.duration.value, rate))
    return { ok: false, error: timelineError('timeline.media_too_short', { clipId: clip.id }) };
  if (
    clip.media.kind === 'video' &&
    clip.media.shotId === media.shotId &&
    RationalTime.equals(clip.sourceStart, start)
  )
    return { ok: true, timeline };
  const next = clips.map((item) => (item.id === clip.id ? { ...draft, sourceStart: start } : item));
  const cast = timeline.cast && {
    ...timeline.cast,
    slots: timeline.cast.slots.map((slot) => {
      if (slot.clipId !== clip.id) return slot;
      const alternates = [slot.pick, ...slot.alternates]
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
        .filter((candidate) => candidate.shotId !== shot.candidate.shotId)
        .slice(0, 3);
      return {
        ...slot,
        pick: { ...shot.candidate, sourceStart: start },
        alternates,
        note: source === 'agent' ? slot.note : ('userPick' as const),
      };
    }),
  };
  return { ok: true, timeline: relayout({ ...timeline, cast }, next, clips) };
}

/** Rolls the cut after clip `left` to `cut` (canvas frames), if both sides keep enough media. */
function rollCut(timeline: Timeline, clips: readonly Clip[], left: number, wanted: number): Edit {
  const rate = timeline.canvas.rate;
  const a = clips[left]!;
  const b = clips[left + 1]!;
  const aStart = clips.slice(0, left).reduce((sum, clip) => sum + clip.duration.value, 0);
  const oldCut = aStart + a.duration.value;
  const end = oldCut + b.duration.value;
  const length = clips.reduce((sum, clip) => sum + clip.duration.value, 0);
  const ok = (cut: number) =>
    cut - aStart >= MIN_CLIP_FRAMES &&
    end - cut >= MIN_CLIP_FRAMES &&
    fits(a, a.sourceStart, cut - aStart, rate) &&
    fits(b, shift(b.sourceStart, cut - oldCut, rate), end - cut, rate);
  const cut = snap(wanted, beatGrid(timeline, length), ok);
  if (cut === null) return { ok: false, error: timelineError('timeline.media_too_short', { clipId: a.id }) };
  if (cut === oldCut) return { ok: true, timeline };
  const next = clips.map((clip, index) => {
    if (index === left) return { ...clip, duration: RationalTime.of(cut - aStart, rate) };
    if (index === left + 1)
      return {
        ...clip,
        duration: RationalTime.of(end - cut, rate),
        sourceStart: shift(clip.sourceStart, cut - oldCut, rate),
      };
    return clip;
  });
  return { ok: true, timeline: relayout(timeline, next, clips) };
}

export function trimClip(
  timeline: Timeline,
  input: { clipId: TimelineItemId; edge: 'start' | 'end'; by: RationalTime },
  source: CommandSource,
): Edit {
  const { clips, index } = findClip(timeline, input.clipId);
  const clip = clips[index];
  if (!clip) return { ok: false, error: timelineError('timeline.item_not_found', { itemId: input.clipId }) };
  if (lockedForAgent(clip, source))
    return { ok: false, error: timelineError('timeline.clip_locked', { clipId: clip.id }) };
  const rate = timeline.canvas.rate;
  const by = RationalTime.rescale(input.by, rate, 'round').value;
  if (by === 0) return { ok: true, timeline };
  const start = clips.slice(0, index).reduce((sum, item) => sum + item.duration.value, 0);
  if (input.edge === 'end' && index < clips.length - 1)
    return rollCut(timeline, clips, index, start + clip.duration.value + by);
  if (input.edge === 'start' && index > 0) return rollCut(timeline, clips, index - 1, start - by);
  if (input.edge === 'start') {
    // The first edge slips: the in-point moves, the length stays (and the sync point goes: it was set on purpose).
    const sourceStart = shift(clip.sourceStart, -by, rate);
    if (!fits(clip, sourceStart, clip.duration.value, rate))
      return { ok: false, error: timelineError('timeline.media_too_short', { clipId: clip.id }) };
    const next = clips.map((item) =>
      item.id === clip.id ? { ...item, sourceStart, syncPoint: null } : item,
    );
    return { ok: true, timeline: relayout(timeline, next, clips) };
  }
  // The last edge ripples: the video gets longer or shorter, its end on a beat.
  const ok = (end: number) =>
    end - start >= MIN_CLIP_FRAMES && fits(clip, clip.sourceStart, end - start, rate);
  const end = snap(
    start + clip.duration.value + by,
    beatGrid(timeline, start + clip.duration.value + Math.max(0, by)),
    ok,
  );
  if (end === null)
    return { ok: false, error: timelineError('timeline.media_too_short', { clipId: clip.id }) };
  if (end === start + clip.duration.value) return { ok: true, timeline };
  const next = clips.map((item) =>
    item.id === clip.id ? { ...item, duration: RationalTime.of(end - start, rate) } : item,
  );
  return { ok: true, timeline: relayout(timeline, next, clips) };
}

export function moveClip(
  timeline: Timeline,
  input: { clipId: TimelineItemId; toIndex: number },
  source: CommandSource,
  shotOf: (clip: Clip) => PoolShot | undefined,
): Edit {
  const { clips, index } = findClip(timeline, input.clipId);
  const clip = clips[index];
  if (!clip) return { ok: false, error: timelineError('timeline.item_not_found', { itemId: input.clipId }) };
  if (lockedForAgent(clip, source))
    return { ok: false, error: timelineError('timeline.clip_locked', { clipId: clip.id }) };
  const to = Math.min(Math.max(0, input.toIndex), clips.length - 1);
  if (to === index) return { ok: true, timeline };
  const rate = timeline.canvas.rate;
  const order = [...clips];
  order.splice(index, 1);
  order.splice(to, 0, clip);
  const next: Clip[] = [];
  for (const [position, moved] of order.entries()) {
    const place = clips[position]!;
    const frames = place.duration.value;
    let sourceStart = moved.sourceStart;
    if (!fits(moved, sourceStart, frames, rate)) {
      const shot = shotOf(moved);
      sourceStart = shot ? centredStart(shot, frames, rate) : sourceStart;
      if (!fits(moved, sourceStart, frames, rate))
        return { ok: false, error: timelineError('timeline.media_too_short', { clipId: moved.id }) };
    }
    next.push({ ...moved, duration: place.duration, slotId: place.slotId, sourceStart });
  }
  // Slots stay put: each slot is filled by the clip that landed there, with the pick it came with.
  const cast = timeline.cast && {
    ...timeline.cast,
    slots: timeline.cast.slots.map((slot) => {
      const landed = next.find((item) => item.slotId === slot.slotId);
      const came = timeline.cast!.slots.find((other) => other.clipId === landed?.id);
      return landed && came
        ? { ...slot, clipId: landed.id, pick: came.pick, confidence: came.confidence, note: came.note }
        : slot;
    }),
  };
  return { ok: true, timeline: relayout({ ...timeline, cast }, next, clips) };
}

export function editText(
  timeline: Timeline,
  input: { itemId: TimelineItemId; text: string },
  source: CommandSource,
): Edit {
  let found = false;
  let same = false;
  const tracks = timeline.tracks.map((track) =>
    track.kind !== 'text'
      ? track
      : {
          ...track,
          items: track.items.map((item) => {
            if (item.id !== input.itemId || item.type !== 'text') return item;
            found = true;
            same = item.text === input.text;
            return {
              ...item,
              text: input.text,
              origin: source === 'agent' ? ('editor' as const) : ('user' as const),
            };
          }),
        },
  );
  if (!found) return { ok: false, error: timelineError('timeline.item_not_found', { itemId: input.itemId }) };
  return { ok: true, timeline: same ? timeline : { ...timeline, tracks } };
}

export function lockClip(timeline: Timeline, input: { clipId: TimelineItemId; locked: boolean }): Edit {
  const { clips, index } = findClip(timeline, input.clipId);
  const clip = clips[index];
  if (!clip) return { ok: false, error: timelineError('timeline.item_not_found', { itemId: input.clipId }) };
  if (clip.locked === input.locked) return { ok: true, timeline };
  // Only the clip's flag changes: V1's gaps and other items stay where they are.
  return {
    ok: true,
    timeline: {
      ...timeline,
      tracks: timeline.tracks.map((track, i) =>
        i === 0 && track.kind === 'video'
          ? {
              ...track,
              items: track.items.map((item) =>
                item.type === 'clip' && item.id === clip.id ? { ...item, locked: input.locked } : item,
              ),
            }
          : track,
      ),
    },
  };
}
