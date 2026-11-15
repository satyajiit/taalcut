// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the reel's music carried longer (core's music-repeats.ts), as arithmetic. A repeat at `at` of `length`
 * makes two clocks differ: the reel's own time, and the music's clock on this timeline, on which everything from
 * `at` on is `length` later and `length` of the reel is heard twice. This module goes between the two: where a
 * reel time is heard, which reel time sounds at a moment, and the reel's beat map as it now falls. Pure.
 */
import { RationalTime, type BeatMap, type MusicRepeat, type Timeline } from '@taalcut/core';

/** A timeline's repeats, in time order (none before LONG1 and on a video never lengthened). */
export function repeatsOf(timeline: Pick<Timeline, 'mix'>): readonly MusicRepeat[] {
  return timeline.mix.musicRepeats ?? [];
}

interface Stretch {
  /** The music clock's [from, to) that plays the reel `back` seconds earlier. */
  readonly from: number;
  readonly to: number;
  readonly back: number;
}

/** The clock cut at each repeat: until the first the reel plays as it is, after each it is that much further back. */
function stretches(repeats: readonly MusicRepeat[]): Stretch[] {
  const out: Stretch[] = [];
  let from = -Infinity;
  let back = 0;
  for (const repeat of repeats) {
    const at = RationalTime.toSeconds(repeat.at);
    out.push({ from, to: at, back });
    from = at;
    back += RationalTime.toSeconds(repeat.length);
  }
  out.push({ from, to: Infinity, back });
  return out;
}

/** When a reel time is heard on the music's clock: once, more than once (bars played again), in time order. */
export function heardAt(repeats: readonly MusicRepeat[], reelSeconds: number): number[] {
  return stretches(repeats).flatMap((stretch) => {
    const clock = reelSeconds + stretch.back;
    return clock >= stretch.from && clock < stretch.to ? [clock] : [];
  });
}

/** The reel time that sounds at `clockSeconds` on the music's clock. */
export function reelTimeAt(repeats: readonly MusicRepeat[], clockSeconds: number): number {
  const stretch = stretches(repeats).find((item) => clockSeconds >= item.from && clockSeconds < item.to);
  return clockSeconds - (stretch?.back ?? 0);
}

/**
 * A beat map with one repeat carried: beats before `at` stay, and every beat from `length` before `at` on is there
 * `length` later, so the bars played again have their beats and every later beat is where the music now puts it.
 * In the map's own units, each time rounded once.
 */
export function carryBeats(beatMap: BeatMap, repeat: Pick<MusicRepeat, 'at' | 'length'>): BeatMap {
  const at = RationalTime.rescale(repeat.at, beatMap.rate, 'round').value;
  const length = RationalTime.rescale(repeat.length, beatMap.rate, 'round').value;
  if (length < 1) return beatMap;
  const downbeat = new Set(beatMap.downbeats);
  const beats: RationalTime[] = [];
  const downbeats: number[] = [];
  const add = (value: number, isDownbeat: boolean) => {
    if (isDownbeat) downbeats.push(beats.length);
    beats.push(RationalTime.of(value, beatMap.rate));
  };
  beatMap.beats.forEach((beat, index) => {
    if (beat.value < at) add(beat.value, downbeat.has(index));
  });
  beatMap.beats.forEach((beat, index) => {
    if (beat.value >= at - length) add(beat.value + length, downbeat.has(index));
  });
  return { ...beatMap, beats, downbeats };
}

/** The reel's beat map as a timeline with these repeats hears it: each repeat carried, in time order. */
export function carriedBeatMap(beatMap: BeatMap, repeats: readonly MusicRepeat[]): BeatMap {
  return repeats.reduce((map, repeat) => carryBeats(map, repeat), beatMap);
}

/**
 * The repeats with one more: those after it are later by its length (their `at` is on the clock it lengthens), and
 * the list stays in time order.
 */
export function withRepeat(repeats: readonly MusicRepeat[], added: MusicRepeat): MusicRepeat[] {
  const before = repeats.filter((repeat) => RationalTime.compare(repeat.at, added.at) < 0);
  const after = repeats
    .filter((repeat) => RationalTime.compare(repeat.at, added.at) >= 0)
    .map((repeat) => ({ ...repeat, at: RationalTime.add(repeat.at, added.length) }));
  return [...before, added, ...after];
}

/** The frames each template slot's clip was lengthened by, by slot id: a slot is this much longer than the reel's. */
export function slotAddedFrames(timeline: Pick<Timeline, 'mix'>): Map<string, number> {
  const added = new Map<string, number>();
  for (const repeat of repeatsOf(timeline))
    if (repeat.slotId) added.set(repeat.slotId, (added.get(repeat.slotId) ?? 0) + repeat.length.value);
  return added;
}
