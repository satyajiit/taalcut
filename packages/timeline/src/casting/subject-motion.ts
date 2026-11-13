// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: what the main person in a shot is doing over time, from FRM1-SUB's subject tracks (SPEC, "FIX-TRIM:
 * the person"). On the owner's footage the frame's motion couldn't see it: a push-in through a crowd moves the whole
 * frame at one level while the person stands, then walks. Their box can: still, its centre and size hold; walking, its
 * centre moves or it grows or shrinks, by a share of its own height each second.
 *
 * The main person, on each detect sample, is the person box nearest the last one (within one box height, and within
 * `sizeRatio` of its size), else the largest, and no pace is read across such a change of person. Their speed between two samples is the centre's move plus the change in size (log of the heights'
 * ratio), each per second and over the box's height, so a near person and a far one read alike; then a median over a
 * few samples takes out the detector's jitter. They are under way from the first run of `steadySeconds` at
 * `movingSpeed` or more, when it isn't from the first sample (the onset); they stop after the last such run, when
 * they are still for at least `steadySeconds` to the end (the stop). Faces count on a sample when one is at least `minFaceHeight` of
 * the frame. Boxes only, no identity (vision SPEC P3.4).
 */
import type { CastingConfig } from './config';

export type SubjectConfig = CastingConfig['inPoint']['subjects'];

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One moment of a track or of the reel: its time in seconds and the people boxes on it. */
export interface PeopleAt {
  readonly t: number;
  readonly people: readonly { readonly box: Box; readonly confidence: number }[];
}

/** The main person's speed (box heights a second, smoothed) at each sample they are on. */
export interface PersonPace {
  readonly t: number;
  readonly speed: number;
}

const centre = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/**
 * The main person's box on each moment that has one, in time order. `kept` is false where the box isn't the same
 * person as the one before (the last was lost, or nobody was near enough): no pace is read across it, so a crowd's
 * other people never read as the main person moving.
 */
export function mainPerson(
  moments: readonly PeopleAt[],
  config: SubjectConfig,
): { t: number; box: Box; kept: boolean }[] {
  const out: { t: number; box: Box; kept: boolean }[] = [];
  let last: Box | null = null;
  for (const moment of [...moments].sort((a, b) => a.t - b.t)) {
    const boxes = moment.people.filter(
      (person) => person.confidence >= config.minConfidence && person.box.height > 0,
    );
    if (boxes.length === 0) {
      last = null;
      continue;
    }
    let chosen: Box | null = null;
    if (last) {
      const from = centre(last);
      let nearest = Number.POSITIVE_INFINITY;
      for (const { box } of boxes) {
        const at = centre(box);
        const distance = Math.hypot(at.x - from.x, at.y - from.y) / last.height;
        const ratio = box.height / last.height;
        const sameSize = ratio <= config.sizeRatio && ratio >= 1 / config.sizeRatio;
        if (sameSize && distance <= 1 && distance < nearest) {
          nearest = distance;
          chosen = box;
        }
      }
    }
    const kept = chosen !== null;
    chosen ??= boxes.reduce(
      (big, { box }) => (box.width * box.height > big.width * big.height ? box : big),
      boxes[0]!.box,
    );
    out.push({ t: moment.t, box: chosen, kept });
    last = chosen;
  }
  return out;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * The main person's pace over the moments: per sample after the first, how far they moved since the one before in
 * their own heights a second (`aspect` is the frame's width over its height, as the boxes are shares of each), then a
 * centred median over `smoothSamples`. A gap of more than `maxGapSeconds` starts afresh.
 */
export function personPace(
  moments: readonly PeopleAt[],
  aspect: number,
  config: SubjectConfig,
): PersonPace[] {
  const track = mainPerson(moments, config);
  const raw: PersonPace[] = [];
  for (let index = 1; index < track.length; index++) {
    const a = track[index - 1]!;
    const b = track[index]!;
    const dt = b.t - a.t;
    if (!b.kept || dt <= 0 || dt > config.maxGapSeconds) continue;
    const from = centre(a.box);
    const to = centre(b.box);
    const height = (a.box.height + b.box.height) / 2;
    const shift = Math.hypot((to.x - from.x) * aspect, to.y - from.y) / height;
    const scale = Math.abs(Math.log(b.box.height / a.box.height));
    raw.push({ t: b.t, speed: (shift + scale) / dt });
  }
  const half = Math.floor(config.smoothSamples / 2);
  return raw.map((pace, index) => ({
    t: pace.t,
    speed: median(raw.slice(Math.max(0, index - half), index + half + 1).map((other) => other.speed)),
  }));
}

/** When the main person gets under way and comes to a stop, in seconds; null when they don't. */
export interface PersonMoves {
  /** The person is seen at all. */
  readonly seen: boolean;
  /** Still at first, under way from here. */
  readonly onset: number | null;
  /** Under way, then still from here to the end. */
  readonly stop: number | null;
  /** The share of paced samples at walking pace: how much of the time they move. */
  readonly movingShare: number;
}

export function personMoves(pace: readonly PersonPace[], config: SubjectConfig): PersonMoves {
  if (pace.length === 0) return { seen: false, onset: null, stop: null, movingShare: 0 };
  const moving = pace.map((sample) => sample.speed >= config.movingSpeed);
  // A run under way: from `index`, moving samples spanning at least steadySeconds (a sample's step counts).
  const step = pace.length > 1 ? (pace.at(-1)!.t - pace[0]!.t) / (pace.length - 1) : 0;
  const runFrom = (index: number): number => {
    let end = index;
    while (end + 1 < pace.length && moving[end + 1]) end++;
    return moving[index] && pace[end]!.t - pace[index]!.t + step >= config.steadySeconds - 1e-9 ? end : -1;
  };
  // The first run's start is the onset unless they are under way from the first sample; a blip before it is jitter.
  let onset: number | null = null;
  let firstRun = -1;
  let lastRunEnd = -1;
  for (let index = 0; index < pace.length; index++) {
    const end = runFrom(index);
    if (end < 0) continue;
    if (firstRun < 0) {
      firstRun = index;
      if (index > 0) onset = pace[index]!.t - step / 2;
    }
    lastRunEnd = end;
    index = end;
  }
  // After the last run, still for at least steadySeconds to the end: a stop (a dip in the last sample is not).
  const tail =
    lastRunEnd >= 0 && lastRunEnd < pace.length - 1 ? pace.at(-1)!.t - pace[lastRunEnd + 1]!.t + step : 0;
  const stop = tail >= config.steadySeconds - 1e-9 ? pace[lastRunEnd + 1]!.t - step / 2 : null;
  return { seen: true, onset, stop, movingShare: moving.filter(Boolean).length / moving.length };
}

/** A face big enough to read as someone's face, on one moment. */
export function showsFace(
  faces: readonly { readonly box: Box; readonly confidence: number }[],
  config: SubjectConfig,
): boolean {
  return faces.some(
    (face) => face.confidence >= config.minConfidence && face.box.height >= config.minFaceHeight,
  );
}
