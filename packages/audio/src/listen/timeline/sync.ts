// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each cut against the sound that answers it (earshot timeline `sync` and `_answer`), first rule wins: an onset
 * within one frame (40 ms without a frame rate) is `ok`; the nearest strong onset within 100 ms, else any, `near`; a
 * swell peaking within 300 ms, `swell`; a level peak within 150 ms rising ≥ 3 dB, `peak`; a strong onset within
 * 250 ms, `off`; else `none`. Strong is prominence ≥ min(6 dB, the 40th percentile); accents are the top 20 % and
 * ≥ 6 dB. `offsetMs` = event − cut (negative: the sound is early). Taalcut passes exact cut times; like upstream's
 * `_analyse`, cuts within 50 ms of either end of the audio are not judged when its duration is given.
 */
import {
  CUT_SYNC_MISSES,
  RationalTime,
  type CutSyncReport,
  type CutSyncStatus,
  type FrameRate,
} from '@taalcut/core';
import type { LevelEnvelopes } from '../dsp/envelopes';
import { roundTo } from '../dsp/pcm';
import { median, percentile, searchSorted } from '../dsp/stats';
import { levelPeak } from '../dsp/swells';
import { chanceShare } from './chance';
import { withinBeatReach, type ListenEvent } from './events';

/** timeline constants. */
const NEAR_S = 0.1;
const SYNC_S = 0.25;
const SWELL_S = 0.3;
const ON_BEAT_S = 0.05;
const ACCENT_DB = 6.0;
const EDGE_S = 0.05;

export interface SyncOptions {
  /** The picture's frame rate: `ok` is one frame. Default: 40 ms. */
  readonly frameRate?: FrameRate;
  /** Beat times (s), when the grid is clear or weak. */
  readonly beats?: readonly number[];
  /** The 10 ms levels, so cuts no onset answers can be met by a level peak. */
  readonly levels?: LevelEnvelopes | null;
  /** The audio's length (s): cuts within 50 ms of either end are left out, as upstream does. */
  readonly durationS?: number;
}

export interface CutAnswer {
  readonly cutIndex: number;
  /** The cut (s, 3 decimals). */
  readonly t: number;
  readonly status: CutSyncStatus;
  readonly offsetMs: number | null;
  readonly eventT?: number;
  readonly eventProminenceDb?: number;
  readonly accentOffsetMs: number | null;
  readonly beatOffsetMs?: number;
}

export interface SyncStats {
  readonly n: number;
  readonly okShare: number;
  readonly nearShare: number;
  readonly medianAbsOffsetMs: number | null;
  readonly answeredBySwell: number;
  readonly answeredByLevelPeak: number;
  /** Upstream's "without a hit" list: `none` and `off` cut times (s). */
  readonly noSound: readonly number[];
  readonly toleranceMs: number;
  readonly chance?: number;
  readonly chance100?: number;
  readonly accentMinDb?: number;
  readonly accentShare?: number;
  readonly accentChance?: number;
  readonly accentWithin100?: number;
  readonly accentChance100?: number;
  readonly onBeat?: number;
  readonly onBeatChance?: number;
}

export interface SyncResult {
  readonly items: readonly CutAnswer[];
  readonly stats: SyncStats;
}

interface Found {
  readonly t: number;
  readonly prominenceDb: number;
}

/** timeline._nearest: the closest of `ts[k−1..k+1]` within `radius` (the earlier one on a tie). */
function nearest<T extends Found>(
  t: number,
  evs: readonly T[],
  ts: readonly number[],
  radius: number,
): T | null {
  if (ts.length === 0) return null;
  const k = searchSorted(ts, t);
  let best = -1;
  for (const j of [k - 1, k, k + 1]) {
    if (j < 0 || j >= ts.length) continue;
    const d = Math.abs((ts[j] ?? 0) - t);
    if (d <= radius && (best < 0 || d < Math.abs((ts[best] ?? 0) - t))) best = j;
  }
  return best < 0 ? null : (evs[best] ?? null);
}

function strongOf(events: readonly ListenEvent[]): ListenEvent[] {
  if (events.length === 0) return [];
  const thr = Math.min(
    6.0,
    percentile(
      events.map((e) => e.prominenceDb),
      40,
    ),
  );
  return events.filter((e) => e.prominenceDb >= thr);
}

function accentsOf(events: readonly ListenEvent[]): { accents: ListenEvent[]; db: number | null } {
  if (events.length === 0) return { accents: [], db: null };
  const thr = Math.max(
    ACCENT_DB,
    percentile(
      events.map((e) => e.prominenceDb),
      80,
    ),
  );
  return { accents: events.filter((e) => e.prominenceDb >= thr), db: roundTo(thr, 1) };
}

/** timeline.sync(times, events, beats, frame_s, levels); `events` sorted by time (as analyseEvents returns them). */
export function syncToCuts(
  cuts: readonly number[],
  events: readonly ListenEvent[],
  options: SyncOptions = {},
): SyncResult {
  const strong = strongOf(events);
  const swells = events.filter((e) => e.shape === 'swell');
  const ts = events.map((e) => e.t);
  const st = strong.map((e) => e.t);
  const sw = swells.map((e) => e.t);
  const { accents, db: accentDb } = accentsOf(events);
  const at = accents.map((e) => e.t);
  const frameS = options.frameRate ? options.frameRate.den / options.frameRate.num : undefined;
  const tol1 = frameS ?? 0.04;
  const bt = options.beats && options.beats.length > 0 ? options.beats : undefined;
  const items: CutAnswer[] = [];
  cuts.forEach((cut, cutIndex) => {
    if (options.durationS !== undefined && !(cut > EDGE_S && cut < options.durationS - EDGE_S)) return;
    let found: Found | null = null;
    let status: CutSyncStatus = 'none';
    const rules: Array<[readonly Found[], readonly number[], number, CutSyncStatus]> = [
      [events, ts, tol1, 'ok'],
      [strong, st, NEAR_S, 'near'],
      [events, ts, NEAR_S, 'near'],
      [swells, sw, SWELL_S, 'swell'],
    ];
    for (const [evs, arr, radius, s] of rules) {
      found = nearest(cut, evs, arr, radius);
      if (found) {
        status = s;
        break;
      }
    }
    if (!found) {
      const pk = levelPeak(options.levels ?? null, cut);
      if (pk) {
        found = { t: pk.t, prominenceDb: pk.riseDb };
        status = 'peak';
      } else {
        found = nearest(cut, strong, st, SYNC_S);
        status = found ? 'off' : 'none';
      }
    }
    const accent = nearest(cut, accents, at, NEAR_S);
    let beatOffsetMs: number | undefined;
    if (bt) {
      let b = 0;
      for (let k = 1; k < bt.length; k++)
        if (Math.abs((bt[k] ?? 0) - cut) < Math.abs((bt[b] ?? 0) - cut)) b = k;
      beatOffsetMs = roundTo((cut - (bt[b] ?? 0)) * 1000, 1);
    }
    items.push({
      cutIndex,
      t: roundTo(cut, 3),
      status,
      offsetMs: found ? roundTo((found.t - cut) * 1000, 1) : null,
      ...(found ? { eventT: found.t, eventProminenceDb: found.prominenceDb } : {}),
      accentOffsetMs: accent ? roundTo((accent.t - cut) * 1000, 1) : null,
      ...(beatOffsetMs !== undefined ? { beatOffsetMs } : {}),
    });
  });
  return { items, stats: statsOf(items, ts, at, accentDb, tol1, bt) };
}

function share(items: readonly CutAnswer[], test: (item: CutAnswer) => boolean): number {
  return roundTo(items.filter(test).length / items.length, 3);
}

function statsOf(
  items: readonly CutAnswer[],
  ts: readonly number[],
  at: readonly number[],
  accentDb: number | null,
  tol1: number,
  bt: readonly number[] | undefined,
): SyncStats {
  const n = items.length;
  const toleranceMs = roundTo(tol1 * 1000, 1);
  if (n === 0) {
    return {
      n,
      okShare: 0,
      nearShare: 0,
      medianAbsOffsetMs: null,
      answeredBySwell: 0,
      answeredByLevelPeak: 0,
      noSound: [],
      toleranceMs,
    };
  }
  const offs = items.flatMap((i) => (i.offsetMs === null ? [] : [Math.abs(i.offsetMs)]));
  const lo = Math.min(...items.map((i) => i.t)) - 1;
  const hi = Math.max(...items.map((i) => i.t)) + 1;
  const stats: { -readonly [K in keyof SyncStats]: SyncStats[K] } = {
    n,
    okShare: share(items, (i) => i.status === 'ok'),
    nearShare: share(items, (i) => i.status === 'ok' || i.status === 'near'),
    medianAbsOffsetMs: offs.length > 0 ? roundTo(median(offs), 1) : null,
    answeredBySwell: items.filter((i) => i.status === 'swell').length,
    answeredByLevelPeak: items.filter((i) => i.status === 'peak').length,
    noSound: items.filter((i) => i.status === 'none' || i.status === 'off').map((i) => i.t),
    toleranceMs,
  };
  if (ts.length > 0) {
    stats.chance = chanceShare(ts, lo, hi, tol1);
    stats.chance100 = chanceShare(ts, lo, hi, NEAR_S);
  }
  if (at.length > 0) {
    const ao = items.map((i) => (i.accentOffsetMs === null ? 1e9 : Math.abs(i.accentOffsetMs)));
    stats.accentMinDb = accentDb ?? undefined;
    stats.accentShare = roundTo(ao.filter((v) => v <= tol1 * 1000 + 1e-6).length / n, 3);
    stats.accentChance = chanceShare(at, lo, hi, tol1);
    stats.accentWithin100 = roundTo(ao.filter((v) => v <= 100).length / n, 3);
    stats.accentChance100 = chanceShare(at, lo, hi, NEAR_S);
  }
  if (bt && bt.length > 1) {
    const bo = items.map((i) => Math.abs(i.beatOffsetMs ?? 0));
    stats.onBeat = roundTo(bo.filter((v) => v <= ON_BEAT_S * 1000).length / n, 3);
    const gaps = bt.slice(1).map((b, k) => b - (bt[k] ?? 0));
    stats.onBeatChance = roundTo(Math.min(1, (2 * ON_BEAT_S) / median(gaps)), 3);
  }
  return stats;
}

const MS_RATE = { num: 1000, den: 1 } as const;
const clampMs = (v: number) => Math.min(1000, Math.max(-1000, v));

export interface ReportOptions {
  /** The picture's frame rate, when it set the tolerance. */
  readonly frameRate?: FrameRate;
  /** The exact cut times syncToCuts was given in seconds (same order): each item's `at` is its own. */
  readonly cuts?: readonly RationalTime[];
}

/** Core's `CutSyncReport` (event times as RationalTime at 1 ms; `cutsWithoutHit` per CUT_SYNC_MISSES). */
export function toCutSyncReport(result: SyncResult, options: ReportOptions = {}): CutSyncReport {
  const misses: readonly CutSyncStatus[] = CUT_SYNC_MISSES;
  const { stats } = result;
  const { frameRate, cuts } = options;
  return {
    items: result.items.map((i) => ({
      cutIndex: i.cutIndex,
      at: cuts?.[i.cutIndex] ?? RationalTime.fromSeconds(i.t, MS_RATE),
      status: i.status,
      offsetMs: i.offsetMs === null ? null : clampMs(i.offsetMs),
      ...(i.eventT !== undefined
        ? { eventAt: RationalTime.fromSeconds(Math.max(0, i.eventT), MS_RATE) }
        : {}),
      ...(i.eventProminenceDb !== undefined
        ? { prominenceDb: Math.min(130, Math.max(0, i.eventProminenceDb)) }
        : {}),
      ...(i.accentOffsetMs !== null ? { accentOffsetMs: clampMs(i.accentOffsetMs) } : {}),
      // Beyond core's ±60 s a beat offset means no beat nearby: left out, as when no beats were given.
      ...(withinBeatReach(i.beatOffsetMs) ? { beatOffsetMs: i.beatOffsetMs } : {}),
    })),
    cutsWithoutHit: result.items.filter((i) => misses.includes(i.status)).map((i) => i.cutIndex),
    okShare: stats.okShare,
    nearShare: stats.nearShare,
    chanceShare: stats.chance ?? 0,
    medianOffsetMs: stats.medianAbsOffsetMs === null ? null : Math.min(1000, stats.medianAbsOffsetMs),
    toleranceMs: stats.toleranceMs,
    ...(frameRate ? { frameRate } : {}),
    ...(stats.onBeat !== undefined ? { onBeatShare: stats.onBeat } : {}),
    ...(stats.onBeatChance !== undefined ? { onBeatChance: stats.onBeatChance } : {}),
  };
}
