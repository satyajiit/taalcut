// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a sound is critiqued against (earshot profile.py): per metric, the median, p10–p90 and min–max of reference
 * films measured the same way. `launchProfile()` is the bundled profile of 7 professional launch films (vendored
 * unchanged, its snake_case keys read as this port's camelCase ids); `aggregateProfile` builds one from any films'
 * metrics, as `earshot profile` does, so a draft can be scored against its template's reel (`reference`). A file
 * that is one of the profile's films is scored leave-one-out (`referenceMatch`, `leaveOneOut`).
 */
import { RationalTime, type TemplateListening } from '@taalcut/core';
import launchFile from '@taalcut-vendor/earshot-data/launch_profile.json' with { type: 'json' };
import { percentile } from '../dsp/stats';
import { pyRoundTo } from '../realness/py-round';

/** profile.METRICS in order: group, unit and the decimals the values are rounded to. */
export const FILM_METRICS = {
  lufsI: ['loudness', 'LUFS', 1],
  truePeak: ['loudness', 'dBTP', 1],
  lra: ['loudness', 'LU', 1],
  crestLu: ['loudness', 'LU', 1],
  introLu: ['arc', 'LU', 1],
  endLu: ['arc', 'LU', 1],
  peakPos: ['arc', '0-1', 2],
  firstSoundS: ['arc', 's', 2],
  maxGapS: ['arc', 's', 2],
  endSilenceS: ['ending', 's', 2],
  fadeS: ['ending', 's', 2],
  finalLu: ['ending', 'LU', 1],
  tailS: ['ending', 's', 2],
  musicFrac: ['music', 'share', 2],
  speechFrac: ['music', 'share', 2],
  tempo: ['music', 'BPM', 0],
  onsetRate: ['density', '/s', 2],
  hitRate: ['density', '/s', 2],
  stopdownsMin: ['density', '/min', 1],
  cutRate: ['sync', '/s', 2],
  cutsWithSound: ['sync', 'share', 2],
  cutHitFrac: ['sync', 'share', 2],
  cutFrameSync: ['sync', 'share', 2],
  cutsOnBeat: ['sync', 'share', 2],
  bandSub: ['spectrum', 'dB', 1],
  bandLow: ['spectrum', 'dB', 1],
  bandLowmid: ['spectrum', 'dB', 1],
  bandMid: ['spectrum', 'dB', 1],
  bandPresence: ['spectrum', 'dB', 1],
  bandAir: ['spectrum', 'dB', 1],
  brightnessHz: ['spectrum', 'Hz', 0],
  sideToMidDb: ['stereo', 'dB', 1],
  correlation: ['stereo', 'r', 2],
} as const satisfies Record<string, readonly [string, string, number]>;
export type FilmMetricId = keyof typeof FILM_METRICS;
export const FILM_METRIC_IDS = Object.keys(FILM_METRICS) as FilmMetricId[];
/** The sync shares with a chance value: what the same cuts shifted off the picture score. */
export const CHANCE_METRICS = ['cutsWithSound', 'cutHitFrac', 'cutFrameSync', 'cutsOnBeat'] as const;
export type ChanceMetricId = (typeof CHANCE_METRICS)[number];

export type FilmValues = Readonly<Record<FilmMetricId, number | null>>;

export interface MetricStats {
  readonly n: number;
  readonly median?: number;
  readonly p10?: number;
  readonly p90?: number;
  readonly min?: number;
  readonly max?: number;
  readonly values?: readonly (number | null)[];
}

export interface ProfileFilm {
  readonly id: string;
  readonly style: string;
  readonly duration: number;
  readonly hasVideo: boolean;
  readonly metrics: FilmValues;
  readonly chance: Readonly<Partial<Record<ChanceMetricId, number | null>>>;
  readonly arc: readonly (number | null)[] | null;
}

export interface CritiqueProfile {
  readonly version: number;
  readonly n: number;
  readonly metrics: Readonly<Record<FilmMetricId, MetricStats>>;
  readonly chance: Readonly<Record<ChanceMetricId, MetricStats>>;
  readonly arc: Readonly<Record<'median' | 'p10' | 'p90', readonly (number | null)[]>> | null;
  readonly films: readonly ProfileFilm[];
  /** Set when this is a profile rebuilt without one of its films (leave-one-out). */
  readonly looOf?: string;
  readonly nFull?: number;
}

const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function camelRecord<T>(raw: Record<string, T> | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [camel(k), v]));
}

interface RawFilm {
  id: string;
  style?: string;
  duration: number;
  has_video?: boolean;
  metrics: Record<string, number | null>;
  chance?: Record<string, number | null>;
  arc?: (number | null)[] | null;
}

interface RawProfile {
  version: number;
  n: number;
  metrics: Record<string, MetricStats>;
  chance?: Record<string, MetricStats>;
  arc?: Record<'median' | 'p10' | 'p90', (number | null)[]> | null;
  films?: RawFilm[];
}

function filmValues(raw: Record<string, number | null | undefined>): FilmValues {
  return Object.fromEntries(FILM_METRIC_IDS.map((id) => [id, raw[id] ?? null])) as Record<
    FilmMetricId,
    number | null
  >;
}

/** A profile JSON as `earshot profile` writes it (snake_case keys). */
export function profileFromJson(json: unknown): CritiqueProfile {
  const raw = json as RawProfile;
  const metrics = camelRecord(raw.metrics);
  const chance = camelRecord(raw.chance);
  return {
    version: raw.version,
    n: raw.n,
    metrics: Object.fromEntries(FILM_METRIC_IDS.map((id) => [id, metrics[id] ?? { n: 0 }])) as Record<
      FilmMetricId,
      MetricStats
    >,
    chance: Object.fromEntries(CHANCE_METRICS.map((id) => [id, chance[id] ?? { n: 0 }])) as Record<
      ChanceMetricId,
      MetricStats
    >,
    arc: raw.arc ?? null,
    films: (raw.films ?? []).map((f) => ({
      id: f.id,
      style: f.style ?? '',
      duration: f.duration,
      hasVideo: f.has_video ?? true,
      metrics: filmValues(camelRecord(f.metrics)),
      chance: camelRecord(f.chance),
      arc: f.arc ?? null,
    })),
  };
}

let launch: CritiqueProfile | undefined;

/** The bundled profile of 7 professional launch films (earshot data/launch_profile.json). */
export function launchProfile(): CritiqueProfile {
  launch ??= profileFromJson(launchFile);
  return launch;
}

/** profile._stats: n, median, p10, p90, min, max (3 decimals) and the values. */
export function statsOf(values: readonly (number | null)[]): MetricStats {
  const x = values.filter((v): v is number => v !== null);
  if (x.length === 0) return { n: 0 };
  const q = (p: number) => pyRoundTo(percentile(x, p), 3);
  return {
    n: x.length,
    median: q(50),
    p10: q(10),
    p90: q(90),
    min: pyRoundTo(Math.min(...x), 3),
    max: pyRoundTo(Math.max(...x), 3),
    values: values.map((v) => (v === null ? null : pyRoundTo(v, 3))),
  };
}

/** The part of a film a profile keeps: its metrics, chance values and loudness arc. */
export interface FilmForProfile {
  readonly id: string;
  readonly style?: string;
  readonly duration: number;
  readonly hasVideo: boolean;
  readonly metrics: FilmValues;
  readonly chance?: Readonly<Partial<Record<ChanceMetricId, number | null>>>;
  readonly arc?: readonly (number | null)[] | null;
}

/** profile.aggregate: a profile from films' metrics (ids and styles already set). */
export function aggregateProfile(films: readonly FilmForProfile[]): CritiqueProfile {
  const metrics = Object.fromEntries(
    FILM_METRIC_IDS.map((id) => [id, statsOf(films.map((f) => f.metrics[id]))]),
  ) as Record<FilmMetricId, MetricStats>;
  const chance = Object.fromEntries(
    CHANCE_METRICS.map((id) => [id, statsOf(films.map((f) => f.chance?.[id] ?? null))]),
  ) as Record<ChanceMetricId, MetricStats>;
  const arcs = films.flatMap((f) => (f.arc ? [f.arc] : []));
  const arcAt = (pq: number) =>
    Array.from({ length: 11 }, (_, i) => {
      const at = arcs.flatMap((a) => (a[i] === null || a[i] === undefined ? [] : [a[i]]));
      return at.length === 0 ? null : pyRoundTo(percentile(at, pq), 1);
    });
  return {
    version: 2,
    n: films.length,
    metrics,
    chance,
    arc: arcs.length > 0 ? { median: arcAt(50), p10: arcAt(10), p90: arcAt(90) } : null,
    films: films.map((f) => ({
      id: f.id,
      style: f.style ?? '',
      duration: f.duration,
      hasVideo: f.hasVideo,
      metrics: f.metrics,
      chance: f.chance ?? {},
      arc: f.arc ?? null,
    })),
  };
}

/** What `referenceMatch` compares: the file's duration and metrics. */
export interface MatchableFilm {
  readonly duration: number;
  readonly metrics: FilmValues;
}

/**
 * critique.reference_match: the id of the profile film this file is (duration within 50 ms; at least 3 of
 * loudness, true peak, brightness and the mid band measured on both and within 0.15 LU / dB, 15 Hz), else null.
 */
export function referenceMatch(film: MatchableFilm, profile: CritiqueProfile): string | null {
  const tol: Partial<Record<FilmMetricId, number>> = {
    lufsI: 0.15,
    truePeak: 0.15,
    brightnessHz: 15,
    bandMid: 0.15,
  };
  for (const g of profile.films) {
    if (Math.abs(g.duration - film.duration) > 0.05) continue;
    const both = (Object.keys(tol) as FilmMetricId[]).filter(
      (k) => film.metrics[k] !== null && g.metrics[k] !== null,
    );
    if (
      both.length >= 3 &&
      both.every((k) => Math.abs((film.metrics[k] ?? 0) - (g.metrics[k] ?? 0)) <= (tol[k] ?? 0))
    ) {
      return g.id || 'a reference';
    }
  }
  return null;
}

/** critique.leave_one_out: the profile rebuilt without film `ref` (needs 2 others, else unchanged). */
export function leaveOneOut(profile: CritiqueProfile, ref: string): CritiqueProfile {
  const others = profile.films.filter((g) => g.id !== ref);
  if (others.length < 2) return profile;
  return { ...aggregateProfile(others), looOf: ref, nFull: profile.n };
}

/**
 * A reference profile from what a template's breakdown kept of its reel (core TemplateListening): its loudness,
 * true peak, LRA, crest, band shares, stereo width and brightness, one film's worth. The other metrics (arc,
 * ending, density, music share, sound on cuts) come from the reel's own `critiqueMetrics` (lane C's breakdown
 * writes them from `filmMetrics`) or `reel`; without either they score n.a. against this profile.
 */
export function profileFromListening(
  listening: Pick<TemplateListening, 'measures' | 'critiqueMetrics'>,
  reel?: Partial<Record<FilmMetricId, number | null>>,
): CritiqueProfile {
  const m = listening.measures;
  const duration = RationalTime.toSeconds(m.duration);
  const bands = m.bands;
  const lufs = m.lufs;
  const fromMeasures: Partial<Record<FilmMetricId, number | null>> = {
    lufsI: lufs,
    truePeak: m.truePeakDbtp,
    lra: m.lraLu,
    crestLu: m.crestLu,
    bandSub: bands?.sub ?? null,
    bandLow: bands?.low ?? null,
    bandLowmid: bands?.lowmid ?? null,
    bandMid: bands?.mid ?? null,
    bandPresence: bands?.presence ?? null,
    bandAir: bands?.air ?? null,
    // earshot scores identical channels as −40 dB (profile.MONO_DB) when the sound isn't silent.
    sideToMidDb: m.sideToMidDb ?? (lufs !== null && lufs > -69.5 ? -40 : null),
    brightnessHz: m.brightnessHz,
  };
  // The reel's own critique metrics (lane C writes them from filmMetrics) win over what the measures give.
  const kept = Object.fromEntries(
    Object.entries(listening.critiqueMetrics ?? {}).filter(([id]) =>
      FILM_METRIC_IDS.includes(id as FilmMetricId),
    ),
  ) as Partial<Record<FilmMetricId, number | null>>;
  const metrics = filmValues({ ...fromMeasures, ...kept, ...reel });
  return aggregateProfile([{ id: 'reel', duration: pyRoundTo(duration, 3), hasVideo: true, metrics }]);
}
