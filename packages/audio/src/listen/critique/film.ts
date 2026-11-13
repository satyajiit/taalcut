// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * profile.film_metrics: the launch metrics and event lists of one soundtrack or film, from the audio pass, the
 * picture's cuts (Taalcut passes the timeline's cuts, where earshot detects visual events in the video) and,
 * when the AudioSet model ran, the 5 s music windows. Values are rounded as upstream rounds them (FILM_METRICS),
 * because the scorecard compares the rounded values with the ranges.
 */
import type { FrameRate } from '@taalcut/core';
import type { AudioPass } from './audio-pass';
import {
  edgeOf,
  energyMean,
  finalHitTail,
  longestRun,
  loudnessArc,
  salientHits,
  select,
  stopdowns,
  type Stopdown,
} from './metrics-level';
import { chanceFrac, musicShares, nearFrac, type MusicWindow } from './metrics-time';
import { pyRoundTo } from '../realness/py-round';
import {
  CHANCE_METRICS,
  FILM_METRICS,
  FILM_METRIC_IDS,
  type ChanceMetricId,
  type FilmMetricId,
} from './profile';

/** profile.MIN_S, SHORT_S, MONO_DB and SHAPE. */
export const MIN_SCORABLE_S = 3.0;
export const SHORT_S = 10.0;
const MONO_DB = -40.0;
export const SHAPE_METRICS = [
  'lra',
  'crestLu',
  'introLu',
  'endLu',
  'finalLu',
] as const satisfies FilmMetricId[];

export interface FilmPicture {
  /** The cuts (visual events), seconds, increasing. */
  readonly cuts: readonly number[];
  /** How big each cut is (earshot's frame difference); the biggest without a hit are named first. Default: equal. */
  readonly strengths?: readonly number[];
  readonly frameRate?: FrameRate;
}

export interface FilmInput {
  readonly pass: AudioPass;
  readonly picture?: FilmPicture | null;
  /** The AudioSet 5 s windows; null when that pass didn't run (`--fast`, no model). */
  readonly music?: readonly MusicWindow[] | null;
  /** Beats (s), for the tempo and `cutsOnBeat` info rows; librosa's beat_track is not ported. */
  readonly beats?: readonly number[];
  readonly tempo?: number | null;
}

export interface FilmEvents {
  readonly hits: readonly number[];
  readonly visual: readonly number[];
  readonly visualStrength: readonly number[];
  readonly stopdowns: readonly Stopdown[];
  readonly beats: readonly number[];
  readonly musicWindows: readonly MusicWindow[] | null;
  readonly onsetsN: number;
}

export interface FilmMetrics {
  readonly duration: number;
  readonly frameRate: FrameRate | null;
  /** A picture (its cuts) was given. */
  readonly picture: boolean;
  /** Identical channels, scored as −40 dB of stereo width. */
  readonly mono: boolean;
  readonly short: boolean;
  readonly metrics: Readonly<Record<FilmMetricId, number | null>>;
  readonly chance: Readonly<Partial<Record<ChanceMetricId, number | null>>>;
  readonly arc: readonly (number | null)[] | null;
  readonly events: FilmEvents;
  /** Where sound ends (s): the last 100 ms block within 30 LU of integrated, refined. */
  readonly soundEnd: number;
}

/** profile._r with each metric's decimals; tempo and brightness as integers. */
function rounded(v: Record<FilmMetricId, number | null>): Record<FilmMetricId, number | null> {
  const out = { ...v };
  for (const id of FILM_METRIC_IDS) {
    const x = v[id];
    if (x === null || !Number.isFinite(x)) {
      out[id] = null;
      continue;
    }
    const r = pyRoundTo(x, FILM_METRICS[id][2]);
    out[id] = id === 'tempo' || id === 'brightnessHz' ? Math.trunc(r) : r;
  }
  return out;
}

export function filmMetrics(input: FilmInput): FilmMetrics {
  const { pass } = input;
  const m = pass.meas;
  const dur = m.duration;
  const lufs = m.lufs ?? -70.0;
  const { level, momentary, shortTerm, e2, env, onsets } = pass;
  const hits = salientHits(level, lufs, env, e2);
  const sd = stopdowns(level);
  const v = Object.fromEntries(FILM_METRIC_IDS.map((id) => [id, null])) as Record<
    FilmMetricId,
    number | null
  >;
  const mono = (m.sideToMidDb ?? null) === null && lufs > -69.5;
  v.lufsI = m.lufs ?? null;
  v.truePeak = m.truePeakDbtp ?? null;
  v.lra = m.lraLu ?? null;
  v.correlation = m.correlation ?? null;
  v.sideToMidDb = mono ? MONO_DB : (m.sideToMidDb ?? null);
  v.brightnessHz = m.brightnessHz ?? null;
  if (m.bandsDb) {
    v.bandSub = m.bandsDb.sub;
    v.bandLow = m.bandsDb.low;
    v.bandLowmid = m.bandsDb.lowmid;
    v.bandMid = m.bandsDb.mid;
    v.bandPresence = m.bandsDb.presence;
    v.bandAir = m.bandsDb.air;
  }
  if (m.shortTermMaxLufs !== undefined && m.lufs !== undefined) v.crestLu = m.shortTermMaxLufs - m.lufs;
  const tm = momentary.t;
  if (momentary.lufs.length > 2) {
    const edge = Math.max(0.1 * dur, 0.5);
    const intro = energyMean(select(momentary, (t) => t <= edge));
    const end = energyMean(select(momentary, (t) => t >= dur - edge));
    v.introLu = intro === null ? null : intro - lufs;
    v.endLu = end === null ? null : end - lufs;
  }
  if (shortTerm.lufs.length > 1 && dur >= 6) {
    let best = 0;
    shortTerm.lufs.forEach((l, i) => {
      if (l > (shortTerm.lufs[best] ?? -Infinity)) best = i;
    });
    v.peakPos = (shortTerm.t[best] ?? 0) / dur;
  }
  const arc = momentary.lufs.length > 2 ? loudnessArc(momentary, lufs, dur) : null;
  const lf = level.lufs;
  const tf = level.t;
  let firstLoud = -1;
  let lastAudible = -1;
  lf.forEach((l, i) => {
    if (firstLoud < 0 && l > lufs - 20) firstLoud = i;
    if (l > lufs - 30) lastAudible = i;
  });
  let tEnd = dur;
  if (firstLoud >= 0) v.firstSoundS = edgeOf(e2, tf[firstLoud] ?? 0, true);
  if (lastAudible >= 0) {
    tEnd = Math.min(dur, edgeOf(e2, tf[lastAudible] ?? 0, false));
    v.endSilenceS = Math.max(0, dur - tEnd);
    let lastFull = -1;
    momentary.lufs.forEach((l, i) => {
      if (l >= lufs - 6 && (tm[i] ?? 0) <= tEnd) lastFull = i;
    });
    if (lastFull >= 0) v.fadeS = Math.max(0, tEnd - (tm[lastFull] ?? 0) - 0.2);
    const start = v.firstSoundS || 0.0;
    const inside: boolean[] = [];
    lf.forEach((l, i) => {
      const t = tf[i] ?? 0;
      if (t >= start && t <= tEnd) inside.push(l < lufs - 30);
    });
    v.maxGapS = inside.length > 1 ? longestRun(inside) * ((tf[1] ?? 0) - (tf[0] ?? 0)) : 0.0;
    const last = select(momentary, (t) => t >= tEnd - 3.0 && t <= tEnd);
    if (last.length > 0) v.finalLu = Math.max(...last) - lufs;
    v.tailS = finalHitTail(env, onsets, tEnd);
  }
  v.onsetRate = dur > 0 ? onsets.length / dur : null;
  v.hitRate = dur > 0 ? hits.length / dur : null;
  v.stopdownsMin = dur >= 6 ? (sd.length / dur) * 60 : null;
  const beats = input.beats ?? [];
  v.tempo = beats.length > 4 ? (input.tempo ?? null) : null;
  if (dur < SHORT_S) for (const id of SHAPE_METRICS) v[id] = null;
  const music = input.music ?? null;
  if (music) {
    const shares = musicShares(music);
    v.musicFrac = shares.music;
    v.speechFrac = shares.speech;
  }
  const picture = input.picture ?? null;
  const visual: number[] = [];
  const strength: number[] = [];
  const chance: Partial<Record<ChanceMetricId, number | null>> = {};
  if (picture) {
    picture.cuts.forEach((t, i) => {
      if (t < dur) {
        visual.push(pyRoundTo(t, 3));
        strength.push(picture.strengths?.[i] ?? 1);
      }
    });
    v.cutRate = visual.length / dur;
    if (visual.length >= 3) {
      const fps = picture.frameRate ? picture.frameRate.num / picture.frameRate.den : null;
      const tolF = fps ? 1 / fps + 0.006 : 0.04 + 0.006;
      const rows: Array<[ChanceMetricId, readonly number[], number]> = [
        ['cutsWithSound', onsets, 0.1],
        ['cutHitFrac', hits, 0.1],
        ['cutFrameSync', onsets, tolF],
        ['cutsOnBeat', beats, 0.07],
      ];
      for (const [id, targets, tol] of rows) {
        if (id === 'cutsOnBeat' && beats.length === 0) continue;
        v[id] = nearFrac(visual, targets, tol);
        const c = chanceFrac(visual, targets, tol, dur);
        chance[id] = c === null ? null : pyRoundTo(c, 2);
      }
    }
  }
  return {
    duration: dur,
    frameRate: picture?.frameRate ?? null,
    picture: picture !== null,
    mono,
    short: dur < SHORT_S,
    metrics: rounded(v),
    chance,
    arc,
    events: {
      hits: hits.map((t) => pyRoundTo(t, 3)),
      visual,
      visualStrength: strength,
      stopdowns: sd,
      beats: beats.map((t) => pyRoundTo(t, 3)),
      musicWindows: music,
      onsetsN: onsets.length,
    },
    soundEnd: tEnd,
  };
}

/** The values a reference profile keeps of one film (`aggregateProfile`). */
export function filmForProfile(film: FilmMetrics, id: string, style = '') {
  return {
    id,
    style,
    duration: film.duration,
    hasVideo: film.picture,
    metrics: film.metrics,
    chance: Object.fromEntries(CHANCE_METRICS.map((k) => [k, film.chance[k] ?? null])),
    arc: film.arc,
  };
}
