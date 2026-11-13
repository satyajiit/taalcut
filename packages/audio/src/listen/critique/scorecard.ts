// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * critique.scorecard: each metric's status against a profile, the weighted score and the verdict. Weights: critical
 * 3, major 2, minor 1; info rows (style choices) are shown but never scored. Ranges are the references' min–max
 * widened by the metric's tolerance, except the web-delivery rules for loudness (−16..−9 LUFS) and true peak
 * (≤ −1 dBTP, ≤ 0 for decoded lossy audio) and realness (the model's 'real' line). A density or duration whose
 * widened range would reach 0 keeps a floor at half the sparsest reference (rates) or none. A critical rule missed by
 * up to 2 tolerances counts as major; realness under the line is critical below 0.5, minor above.
 */
import { realnessModel, thresholdsOf } from '../realness/model';
import { pyRoundTo } from '../realness/py-round';
import { FILM_METRICS, type CritiqueProfile, type FilmMetricId, type MetricStats } from './profile';

export type ScoredWeight = 0 | 1 | 2 | 3;
export type MetricSides = 'both' | 'lower' | 'upper';
/** The critique's rows: the film metrics and realness. */
export type CritiqueRowId = FilmMetricId | 'pReal';

interface RowSpec {
  readonly weight: ScoredWeight;
  readonly tol: number;
  readonly sides: MetricSides;
  readonly practice?: readonly [number | null, number | null];
}

/** critique.SPEC, in its order (the rows and the fix order follow it). */
export const CRITIQUE_SPEC: Readonly<Record<CritiqueRowId, RowSpec>> = {
  lufsI: { weight: 3, tol: 1.0, sides: 'both', practice: [-16.0, -9.0] },
  truePeak: { weight: 2, tol: 0.5, sides: 'upper', practice: [null, -1.0] },
  pReal: { weight: 3, tol: 0.0, sides: 'lower' },
  musicFrac: { weight: 3, tol: 0.05, sides: 'lower' },
  cutsWithSound: { weight: 2, tol: 0.05, sides: 'lower' },
  lra: { weight: 2, tol: 1.0, sides: 'both' },
  crestLu: { weight: 2, tol: 0.5, sides: 'both' },
  firstSoundS: { weight: 2, tol: 0.1, sides: 'upper' },
  endSilenceS: { weight: 2, tol: 0.25, sides: 'upper' },
  maxGapS: { weight: 2, tol: 0.25, sides: 'upper' },
  finalLu: { weight: 2, tol: 1.5, sides: 'both' },
  onsetRate: { weight: 2, tol: 0.3, sides: 'both' },
  hitRate: { weight: 2, tol: 0.2, sides: 'both' },
  introLu: { weight: 1, tol: 1.5, sides: 'both' },
  endLu: { weight: 1, tol: 1.5, sides: 'both' },
  fadeS: { weight: 1, tol: 0.5, sides: 'both' },
  bandSub: { weight: 1, tol: 1.5, sides: 'both' },
  bandLow: { weight: 1, tol: 1.5, sides: 'both' },
  bandLowmid: { weight: 1, tol: 1.5, sides: 'both' },
  bandMid: { weight: 1, tol: 1.5, sides: 'both' },
  bandPresence: { weight: 1, tol: 1.5, sides: 'both' },
  bandAir: { weight: 1, tol: 1.5, sides: 'both' },
  sideToMidDb: { weight: 1, tol: 1.0, sides: 'both' },
  speechFrac: { weight: 0, tol: 0, sides: 'both' },
  tempo: { weight: 0, tol: 0, sides: 'both' },
  peakPos: { weight: 0, tol: 0, sides: 'both' },
  tailS: { weight: 0, tol: 0, sides: 'both' },
  stopdownsMin: { weight: 0, tol: 0, sides: 'both' },
  cutRate: { weight: 0, tol: 0, sides: 'both' },
  cutHitFrac: { weight: 0, tol: 0, sides: 'both' },
  cutFrameSync: { weight: 0, tol: 0, sides: 'both' },
  cutsOnBeat: { weight: 0, tol: 0, sides: 'both' },
  brightnessHz: { weight: 0, tol: 0, sides: 'both' },
  correlation: { weight: 0, tol: 0, sides: 'both' },
};
export const CRITIQUE_ROWS = Object.keys(CRITIQUE_SPEC) as CritiqueRowId[];

export type RangeBasis = 'realness model' | 'decoded lossy' | 'web' | 'references' | 'no reference data';
export type RowStatus = 'ok' | 'low' | 'high' | 'na' | 'info';

export interface ScoreRow {
  readonly id: CritiqueRowId;
  readonly value: number | null;
  readonly range: readonly [number | null, number | null];
  readonly basis: RangeBasis;
  readonly status: RowStatus;
  /** As scored (0 for info rows). */
  readonly weight: ScoredWeight;
  readonly median: number | null;
  readonly typical: readonly [number | null, number | null] | null;
  readonly chance?: number | null;
}

export type UpstreamVerdict = 'launch-grade' | 'close' | 'needs work' | 'not launch-grade' | 'n.a.';

export interface Scorecard {
  readonly verdict: UpstreamVerdict;
  /** Rounded to 3 decimals; null when nothing was scored. */
  readonly score: number | null;
  readonly inRange: number;
  readonly scored: number;
  readonly criticalIssues: number;
  readonly majorIssues: number;
  readonly rows: readonly ScoreRow[];
}

/** realness's verdict thresholds the critique scores with: file-level (the mean of a long file's windows). */
export function realThresholds(file = true): { lo: number; hi: number } {
  return thresholdsOf(realnessModel(), file);
}

const DENSITY_UNITS: readonly string[] = ['s', '/s', '/min', 'share'];

/** critique._window: (lo, hi, basis) of a row. */
export function windowOf(
  id: CritiqueRowId,
  stats: MetricStats | undefined,
  lossy: boolean,
): { lo: number | null; hi: number | null; basis: RangeBasis } {
  const spec = CRITIQUE_SPEC[id];
  if (id === 'pReal') return { lo: realThresholds().hi, hi: null, basis: 'realness model' };
  if (id === 'truePeak' && lossy) return { lo: null, hi: 0.0, basis: 'decoded lossy' };
  if (spec.practice) return { lo: spec.practice[0], hi: spec.practice[1], basis: 'web' };
  if (!stats || !stats.n || stats.min === undefined || stats.max === undefined) {
    return { lo: null, hi: null, basis: 'no reference data' };
  }
  let lo: number | null = stats.min - spec.tol;
  const hi = stats.max + spec.tol;
  const unit = FILM_METRICS[id][1];
  if (lo <= 0 && DENSITY_UNITS.includes(unit)) {
    lo = unit === '/s' && stats.min > 0 ? pyRoundTo(stats.min / 2, 3) : null;
  }
  return {
    lo: spec.sides === 'both' || spec.sides === 'lower' ? lo : null,
    hi: spec.sides === 'both' || spec.sides === 'upper' ? hi : null,
    basis: 'references',
  };
}

function statusOf(v: number | null, lo: number | null, hi: number | null): RowStatus {
  if (v === null) return 'na';
  if (lo !== null && v < lo) return 'low';
  if (hi !== null && v > hi) return 'high';
  return 'ok';
}

/** critique.scorecard: `values` per row (pReal from realness), against `profile`. */
export function scorecard(
  values: Readonly<Partial<Record<CritiqueRowId, number | null>>>,
  profile: CritiqueProfile,
  chance: Readonly<Partial<Record<CritiqueRowId, number | null>>> = {},
  lossy = false,
): Scorecard {
  const rows: ScoreRow[] = [];
  for (const id of CRITIQUE_ROWS) {
    const spec = CRITIQUE_SPEC[id];
    const stats = id === 'pReal' ? undefined : profile.metrics[id];
    const { lo, hi, basis } = windowOf(id, stats, lossy);
    const v = values[id] ?? null;
    let w = spec.weight;
    const status: RowStatus =
      basis === 'no reference data' ? 'na' : w ? statusOf(v, lo, hi) : v === null ? 'na' : 'info';
    if (id === 'pReal' && status === 'low') {
      w = (v ?? 0) < 0.5 ? 3 : 1;
    } else if (w === 3 && (status === 'low' || status === 'high')) {
      const edge = status === 'low' ? lo : hi;
      if (Math.abs((v ?? 0) - (edge ?? 0)) <= 2 * spec.tol) w = 2;
    }
    rows.push({
      id,
      value: v,
      range: [lo, hi],
      basis,
      status,
      weight: w,
      median: stats?.median ?? null,
      typical: stats?.n ? [stats.p10 ?? null, stats.p90 ?? null] : null,
      ...(id in chance ? { chance: chance[id] ?? null } : {}),
    });
  }
  const scored = rows.filter((r) => r.weight !== 0 && r.status !== 'na');
  const wsum = scored.reduce((s, r) => s + r.weight, 0);
  const score = wsum
    ? scored.filter((r) => r.status === 'ok').reduce((s, r) => s + r.weight, 0) / wsum
    : null;
  const crit = scored.filter((r) => r.weight === 3 && r.status !== 'ok').length;
  const major = scored.filter((r) => r.weight === 2 && r.status !== 'ok').length;
  const verdict: UpstreamVerdict =
    score === null
      ? 'n.a.'
      : score >= 0.9 && !crit
        ? 'launch-grade'
        : score >= 0.75 && !crit
          ? 'close'
          : score >= 0.5
            ? 'needs work'
            : 'not launch-grade';
  return {
    verdict,
    score: score === null ? null : pyRoundTo(score, 3),
    inRange: scored.filter((r) => r.status === 'ok').length,
    scored: scored.length,
    criticalIssues: crit,
    majorIssues: major,
    rows,
  };
}
