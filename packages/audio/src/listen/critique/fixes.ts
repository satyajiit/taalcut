// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The critique's fixes (earshot critique `_actions` and `_tips`) as catalogue keys with values, a time where they
 * apply and, when the caller can build one, a ready command. One out-of-range metric gives one fix, followed by its
 * timestamped items (unanswered cuts, silent holes ≥ 0.5 s, music gaps, low-realness windows, the biggest cuts
 * without a hit), capped as upstream's text caps them. Keys are `audio.critique.fix.*` and `audio.critique.tip.*`
 * (CRITIQUE_MESSAGE_KEYS); render's QA and the tools word them.
 */
import type { SoundCritiqueFix } from '@taalcut/core';
import {
  FIX,
  TIP,
  cutFixes,
  fix,
  mergeSpans,
  missingOf,
  quietRealnessMiss,
  r1,
  r2,
  realnessFixes,
  realnessWindows,
  refsOf,
  silentGaps,
  unansweredCuts,
  type FixContext,
  type Params,
} from './fix-items';
import { energyMean, select } from './metrics-level';
import { MUSIC_P, MUSIC_WINDOW_S } from './metrics-time';
import type { MetricStats } from './profile';
import { realThresholds, type CritiqueRowId } from './scorecard';

export type { CritiqueCommands, FixContext } from './fix-items';
export { missingOf, quietRealnessMiss, unansweredCuts } from './fix-items';

/** The band rows: each has a Low and a High key. */
const BANDS: readonly CritiqueRowId[] = [
  'bandSub',
  'bandLow',
  'bandLowmid',
  'bandMid',
  'bandPresence',
  'bandAir',
];

/** critique._actions for one out-of-range row: its fix, then its timestamped items. */
export function metricFixes(
  id: CritiqueRowId,
  status: 'low' | 'high',
  v: number,
  refs: MetricStats,
  ctx: FixContext,
): SoundCritiqueFix[] {
  const low = status === 'low';
  const { film, pass } = ctx;
  const dur = film.duration;
  const refParams = refsOf(refs);
  const one = (key: string, params: Params = {}, at?: number) => [
    fix(FIX + key, { ...params, ...refParams }, id, at),
  ];
  switch (id) {
    case 'lufsI':
      return low
        ? one('lufsLow', { lufs: v, gainDb: r1(-14 - v), targetLufs: -14, ceilingDbtp: -1 })
        : one('lufsHigh', { lufs: v, cutDb: r1(v + 12), targetLufs: -12 });
    case 'truePeak':
      return one('truePeakHigh', { truePeakDbtp: v, ceilingDbtp: -1, lossy: ctx.lossy ? 1 : 0 });
    case 'pReal':
      return realnessFixes(v, ctx);
    case 'musicFrac': {
      const windows = film.events.musicWindows ?? [];
      const gaps = mergeSpans(
        windows
          .filter((w) => r2(w.music) < MUSIC_P)
          .map((w) => [r2(w.t), Math.min(dur, r2(w.t) + MUSIC_WINDOW_S)] as const),
      ).slice(0, 6);
      return [
        ...one('musicLow', { share: v, gaps: gaps.length }),
        ...gaps.map(([a, b]) => fix(FIX + 'musicGap', { start: r2(a), end: r2(b) }, id, a)),
      ];
    }
    case 'cutsWithSound': {
      const miss = missingOf(film.events.visual, pass.onsets);
      const un = unansweredCuts(ctx.sync);
      if (!un) {
        return [
          ...one('cutsWithoutOnset', { missing: miss.length, total: film.events.visual.length }),
          ...cutFixes(ctx, miss, 'cutNoOnset', id),
        ];
      }
      const params = {
        missing: miss.length,
        total: film.events.visual.length,
        noSound: un.none.length,
        through: Math.max(0, miss.length - un.none.length),
        more: Math.max(0, un.none.length - 8),
      };
      return [...one('cutsWithoutOnset', params), ...cutFixes(ctx, un.none, 'cutNoSound', id)];
    }
    case 'lra':
    case 'crestLu': {
      const { t: ts, lufs: ls } = pass.shortTerm;
      let iq = -1;
      let il = 0;
      ts.forEach((t, i) => {
        if (t > 0.1 * dur && t < 0.9 * dur && (iq < 0 || (ls[i] ?? 0) < (ls[iq] ?? 0))) iq = i;
        if ((ls[i] ?? -Infinity) > (ls[il] ?? -Infinity)) il = i;
      });
      const key = id === 'lra' ? 'lra' : 'crest';
      if (!low && iq >= 0) {
        const q = ts[iq] ?? 0;
        const params = {
          value: v,
          quietStart: r2(Math.max(0, q - 1.5)),
          quietEnd: r2(q + 1.5),
          quietLufs: r1(ls[iq] ?? 0),
          loudAt: r2(ts[il] ?? 0),
          loudLufs: r1(ls[il] ?? 0),
        };
        return one(`${key}High`, params, id === 'lra' ? Math.max(0, q - 1.5) : (ts[il] ?? 0));
      }
      return one(`${key}Low`, { value: v });
    }
    case 'firstSoundS': {
      const lvl = energyMean(select(pass.level, (t) => t < v));
      const lufs = pass.meas.lufs ?? -70;
      return lvl !== null && lvl > -60
        ? one('firstSoundQuiet', { at: v, levelLufs: Math.round(lvl), belowLu: Math.round(lufs - lvl) }, 0)
        : one('firstSoundSilent', { at: v }, 0);
    }
    case 'endSilenceS':
      return one('endSilence', { seconds: v, soundEnd: r2(dur - v) }, dur - v);
    case 'maxGapS': {
      const gaps = silentGaps(ctx).slice(0, 6);
      return [
        ...one('silentGaps', { longest: v, gaps: gaps.length }),
        ...gaps.map(([a, b]) => fix(FIX + 'silentGap', { start: r2(a), end: r2(b) }, id, a)),
      ];
    }
    case 'finalLu': {
      const last = film.events.visual[film.events.visual.length - 1];
      return low
        ? one('finalLow', { below: r1(-v), ...(last !== undefined ? { lastCut: last } : {}) }, last)
        : one('finalHigh', { above: v });
    }
    case 'onsetRate':
      return low ? one('onsetsSparse', { rate: v }) : one('onsetsBusy', { rate: v });
    case 'hitRate': {
      if (!low) return one('hitsMany', { rate: v });
      const big = film.events.visual
        .map((t, i) => [film.events.visualStrength[i] ?? 1, t] as const)
        .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
      const cand = missingOf(
        big.map(([, t]) => t),
        film.events.hits,
      )
        .slice(0, 6)
        .sort((a, b) => a - b);
      return [
        ...one('hitsFew', { rate: v, none: v === 0 ? 1 : 0 }),
        ...cutFixes(ctx, cand, 'hitMissing', id),
      ];
    }
    case 'introLu':
      return low
        ? one('introLow', { below: r1(-v), end: r2(0.1 * dur) }, 0)
        : one('introHigh', { above: v }, 0);
    case 'endLu':
      return low
        ? one('endLow', { below: r1(-v), start: r2(0.9 * dur) }, 0.9 * dur)
        : one('endHigh', { above: v }, 0.9 * dur);
    case 'fadeS':
      return low
        ? one('fadeHard', {}, film.soundEnd)
        : one('fadeLong', { seconds: v }, Math.max(0, film.soundEnd - v));
    case 'sideToMidDb':
      if (!low) return one('stereoWide', { db: v });
      return film.mono ? one('stereoMono') : one('stereoNarrow', { db: v });
    default:
      return BANDS.includes(id) ? one(`${id}${low ? 'Low' : 'High'}`, { shareDb: v }) : [];
  }
}

/** critique._tips: not scored, drawn from what the references do. */
export function tipFixes(
  ctx: FixContext,
  flagged: ReadonlySet<CritiqueRowId>,
  pReal: number | null,
): SoundCritiqueFix[] {
  const { film } = ctx;
  const m = film.metrics;
  const out: SoundCritiqueFix[] = [];
  const un = unansweredCuts(ctx.sync);
  if (un && un.none.length > 0 && m.cutsWithSound !== null && !flagged.has('cutsWithSound')) {
    const params = {
      count: un.none.length,
      total: film.events.visual.length,
      peakOnly: un.peak.length,
      more: Math.max(0, un.none.length - 8),
    };
    out.push(fix(TIP + 'cutsNoSound', params), ...cutFixes(ctx, un.none, 'cutNoSound'));
  }
  if (
    pReal !== null &&
    !flagged.has('pReal') &&
    pReal < realThresholds().hi &&
    quietRealnessMiss(ctx.realness, pReal)
  ) {
    const { segs } = realnessWindows(ctx.realness);
    const lowest = segs.length ? Math.min(...segs.map((q) => q.pReal)) : undefined;
    out.push(
      fix(
        TIP + 'realnessUnconfirmed',
        { pReal, hi: realThresholds().hi, ...(lowest !== undefined ? { lowest: r2(lowest) } : {}) },
        'pReal',
      ),
    );
  }
  if (m.stopdownsMin === 0 && film.events.visual.length > 0) {
    let best = 0;
    film.events.visual.forEach((t, i) => {
      const s = film.events.visualStrength[i] ?? 1;
      const b = film.events.visualStrength[best] ?? 1;
      if (s > b || (s === b && t > (film.events.visual[best] ?? 0))) best = i;
    });
    const at = film.events.visual[best] ?? 0;
    out.push(fix(TIP + 'noStopdowns', { at, cutIndex: best }, undefined, at));
  }
  if (m.speechFrac !== null && m.speechFrac >= 0.5) out.push(fix(TIP + 'voiceDuck', { share: m.speechFrac }));
  return out;
}

/** Every key the critique emits (the window's and render's catalogues word each one). */
export const CRITIQUE_MESSAGE_KEYS = [
  ...[
    'lufsLow',
    'lufsHigh',
    'truePeakHigh',
    'realnessSynthetic',
    'realnessLeaning',
    'realnessUncertain',
    'realnessWindow',
    'musicLow',
    'musicGap',
    'cutsWithoutOnset',
    'cutNoSound',
    'cutNoOnset',
    'lraHigh',
    'lraLow',
    'crestHigh',
    'crestLow',
    'firstSoundQuiet',
    'firstSoundSilent',
    'endSilence',
    'silentGaps',
    'silentGap',
    'finalLow',
    'finalHigh',
    'onsetsSparse',
    'onsetsBusy',
    'hitsFew',
    'hitMissing',
    'hitsMany',
    'introLow',
    'introHigh',
    'endLow',
    'endHigh',
    'fadeLong',
    'fadeHard',
    'stereoMono',
    'stereoNarrow',
    'stereoWide',
    ...BANDS.flatMap((b) => [`${b}Low`, `${b}High`]),
  ].map((k) => FIX + k),
  ...['cutsNoSound', 'realnessUnconfirmed', 'noStopdowns', 'voiceDuck'].map((k) => TIP + k),
] as const;
