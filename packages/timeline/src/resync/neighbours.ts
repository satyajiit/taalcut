// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Re-sync step 4: what sits around the cuts follows them. Transitions shrink
 * to the handles left and go when nothing is left or a neighbour is no longer
 * a clip; text tied to a slot keeps its offset into that slot's clip. Both
 * leave an already valid timeline unchanged.
 */
import {
  RationalTime,
  TimeRange,
  type Clip,
  type FrameRate,
  type SequenceItem,
  type TextTrackItem,
  type Timeline,
  type Track,
} from '@taalcut/core';
import { positions, type TextTrack } from '../model/sequence';

/** Whole canvas frames of `media` time, rounded down; null means no limit (stills, ramps). */
export function handleFrames(media: RationalTime | null, rate: FrameRate): number | null {
  if (!media) return null;
  return Math.max(0, RationalTime.rescale(media, rate, 'floor').value);
}

/** Media before a real-time clip's in-point. */
export function handleBefore(clip: Clip): RationalTime | null {
  if (clip.media.kind === 'image' || clip.speed) return null;
  return RationalTime.subtract(clip.sourceStart, clip.media.available.start);
}

/** Media after a real-time clip's out-point. */
export function handleAfter(clip: Clip): RationalTime | null {
  if (clip.media.kind === 'image' || clip.speed) return null;
  const end = RationalTime.add(clip.sourceStart, clip.duration);
  return RationalTime.subtract(TimeRange.end(clip.media.available), end);
}

const clampTo = (value: number, limit: number | null) => (limit === null ? value : Math.min(value, limit));

export function fitTransitions(items: readonly SequenceItem[], rate: FrameRate): SequenceItem[] {
  const out: SequenceItem[] = [];
  items.forEach((item, index) => {
    if (item.type !== 'transition') {
      out.push(item);
      return;
    }
    const before = items[index - 1];
    const after = items[index + 1];
    if (before?.type !== 'clip' || after?.type !== 'clip') return;
    const inFrames = clampTo(
      Math.min(item.inOffset.value, before.duration.value),
      handleFrames(handleBefore(after), rate),
    );
    const outFrames = clampTo(
      Math.min(item.outOffset.value, after.duration.value),
      handleFrames(handleAfter(before), rate),
    );
    if (inFrames <= 0 && outFrames <= 0) return;
    if (inFrames === item.inOffset.value && outFrames === item.outOffset.value) out.push(item);
    else
      out.push({
        ...item,
        inOffset: RationalTime.of(Math.max(0, inFrames), rate),
        outOffset: RationalTime.of(Math.max(0, outFrames), rate),
      });
  });
  return out;
}

/** Clip starts by slot id, in frames. */
function slotStarts(items: readonly SequenceItem[]): Map<string, { start: number; end: number }> {
  const starts = new Map<string, { start: number; end: number }>();
  for (const position of positions(items))
    if (position.item.slotId) starts.set(position.item.slotId, { start: position.start, end: position.end });
  return starts;
}

function moveText<T extends TextTrackItem>(
  item: T,
  before: Map<string, { start: number }>,
  after: Map<string, { start: number; end: number }>,
  length: number,
  rate: FrameRate,
): T {
  let start = item.start.value;
  let end = start + item.duration.value;
  // Graphics (Timeline v2) are anchored by render, not by slot: they only stay inside V1 here.
  const slotId = item.type === 'text' ? item.slotId : null;
  const was = slotId ? before.get(slotId) : undefined;
  const now = slotId ? after.get(slotId) : undefined;
  if (was && now && was.start !== now.start) {
    const delta = now.start - was.start;
    start = Math.min(Math.max(start + delta, now.start), now.end - 1);
    end = start + item.duration.value;
  }
  end = Math.min(end, length);
  if (start >= end) start = Math.max(0, end - 1);
  if (start === item.start.value && end - start === item.duration.value) return item;
  return { ...item, start: RationalTime.of(start, rate), duration: RationalTime.of(end - start, rate) };
}

/** Puts each text item back in its track, or in the first text track where it doesn't overlap. */
export function repack(tracks: readonly TextTrack[]): TextTrack[] {
  const out = tracks.map((track) => ({ ...track, items: [] as TextTrackItem[] }));
  const fits = (track: TextTrack, item: TextTrackItem) => {
    const range = TimeRange.of(item.start, item.duration);
    return track.items.every((other) => !TimeRange.overlaps(range, TimeRange.of(other.start, other.duration)));
  };
  const all = tracks.flatMap((track, t) => track.items.map((item) => ({ item, t })));
  all.sort((a, b) => a.item.start.value - b.item.start.value || a.t - b.t);
  for (const { item, t } of all) {
    const home = out[t] as TextTrack;
    let target = fits(home, item) ? home : out.find((track) => fits(track, item));
    if (!target) {
      const used = new Set(out.map((track) => track.id));
      const free = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `T${n}`).find((id) => !used.has(id));
      if (!free) continue;
      target = { kind: 'text', id: free, name: free, enabled: true, items: [] };
      out.push(target);
    }
    target.items.push(item);
  }
  for (const track of out) track.items.sort((a, b) => a.start.value - b.start.value);
  return out;
}

/** Text tied to a slot follows its clip's start; everything stays inside V1. */
export function followText(before: Timeline, after: Timeline): Track[] {
  const video = after.tracks[0];
  const previous = before.tracks[0];
  if (video?.kind !== 'video' || previous?.kind !== 'video') return after.tracks;
  const rate = after.canvas.rate;
  const length = positions(video.items).at(-1)?.end ?? 0;
  const was = slotStarts(previous.items);
  const now = slotStarts(video.items);
  let changed = false;
  const tracks = after.tracks.map((track) => {
    if (track.kind !== 'text') return track;
    const items = track.items.map((item) => moveText(item, was, now, length, rate));
    if (items.some((item, index) => item !== track.items[index])) changed = true;
    return { ...track, items };
  });
  if (!changed) return tracks;
  const text = tracks.filter((track): track is TextTrack => track.kind === 'text');
  const packed = repack(text);
  return [...tracks.filter((track) => track.kind !== 'text'), ...packed];
}
