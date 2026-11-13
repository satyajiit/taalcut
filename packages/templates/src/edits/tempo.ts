// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `template.setTempo` (BRK1-CMD): a beat tracker's usual mistake is half or double the tempo, so the review can
 * halve or double the beat map. Doubling puts a beat halfway between each pair; halving keeps every other beat, on
 * the side of the first downbeat. Downbeats stay where they were in time, so the bars don't move; `bpm` follows the
 * factor and `beatsPerBar` the downbeats' new spacing. The map becomes the person's (`source: 'user'`).
 */
import {
  err,
  ok,
  RationalTime,
  ValidationError,
  type BeatMap,
  type Result,
  type TempoFactor,
} from '@taalcut/core';

/** beatMapSchema's limits. */
const MAX_BEATS = 4000;
const MAX_BPM = 400;

/** The most common gap between consecutive downbeats, in beats, when it is a bar length Template v1 allows. */
function barLength(downbeats: readonly number[]): number | null {
  const gaps = new Map<number, number>();
  for (let i = 1; i < downbeats.length; i++) {
    const gap = downbeats[i]! - downbeats[i - 1]!;
    gaps.set(gap, (gaps.get(gap) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const [gap, count] of gaps) if (best === null || count > gaps.get(best)!) best = gap;
  return best !== null && best >= 2 && best <= 12 ? best : null;
}

function doubled(map: BeatMap): Result<{ beats: number[]; downbeats: number[] }> {
  const ticks = map.beats.map((beat) => beat.value);
  const beats: number[] = [];
  const moved: number[] = [];
  ticks.forEach((tick, index) => {
    moved.push(beats.length);
    beats.push(tick);
    const next = ticks[index + 1];
    const middle = next === undefined ? undefined : Math.round((tick + next) / 2);
    // Beats a tick apart have no tick between them; at the tracker's 50 per second that is 3000 BPM.
    if (middle !== undefined && middle > tick && middle < next!) beats.push(middle);
  });
  if (beats.length > MAX_BEATS)
    return err(
      ValidationError({ field: 'factor' }, { detail: `Doubling makes more than ${MAX_BEATS} beats` }),
    );
  return ok({ beats, downbeats: map.downbeats.map((index) => moved[index]!) });
}

function halved(map: BeatMap): { beats: number[]; downbeats: number[] } {
  const side = (map.downbeats[0] ?? 0) % 2;
  const beats = map.beats.flatMap((beat, index) => (index % 2 === side ? [beat.value] : []));
  // A downbeat on a beat that goes falls back to the kept beat before it (or the first).
  const downbeats = [
    ...new Set(map.downbeats.map((index) => Math.max(0, Math.floor((index - side) / 2)))),
  ].filter((index) => index < beats.length);
  return { beats, downbeats };
}

/** The beat map at `factor` times the tempo. */
export function scaleBeatMap(map: BeatMap, factor: TempoFactor): Result<BeatMap> {
  let scaled: { beats: number[]; downbeats: number[] };
  if (factor === 2) {
    const result = doubled(map);
    if (!result.ok) return result;
    scaled = result.value;
  } else scaled = halved(map);
  const bpm = map.bpm === null ? null : map.bpm * factor;
  if (bpm !== null && bpm > MAX_BPM)
    return err(ValidationError({ field: 'factor' }, { detail: `Doubling makes more than ${MAX_BPM} BPM` }));
  const bar = barLength(scaled.downbeats);
  return ok({
    ...map,
    beats: scaled.beats.map((tick) => RationalTime.of(tick, map.rate)),
    downbeats: scaled.downbeats,
    bpm,
    beatsPerBar: bar ?? map.beatsPerBar,
    source: 'user',
  });
}
