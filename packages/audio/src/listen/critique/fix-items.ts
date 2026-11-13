// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The pieces the critique's fixes are made of (fixes.ts): one fix as a key with values and a time, the timestamped
 * items (cuts without sound, silent holes, low-realness windows) and upstream's helpers behind them.
 */
import { RationalTime, type SoundCritiqueFix, type SoundCritiqueMetricId } from '@taalcut/core';
import type { SyncResult } from '../timeline/sync';
import type { RealnessResult } from '../realness/realness';
import { pyRoundTo } from '../realness/py-round';
import type { AudioPass } from './audio-pass';
import type { FilmMetrics } from './film';
import type { MetricStats } from './profile';
import { realThresholds, type CritiqueRowId } from './scorecard';

/** Builds ready commands for fixes; the caller knows the project, the timeline and its hits. */
export interface CritiqueCommands {
  /** A command that puts a sound on cut `cutIndex` (at `atS` seconds), e.g. `sfx.setHits` with one hit added. */
  hitOnCut?(cut: {
    readonly cutIndex: number;
    readonly atS: number;
  }): SoundCritiqueFix['command'] | undefined;
}

export interface FixContext {
  readonly film: FilmMetrics;
  readonly pass: AudioPass;
  readonly sync: SyncResult | null;
  readonly realness: RealnessResult | null;
  readonly lossy: boolean;
  readonly commands?: CritiqueCommands;
}

export type Params = Record<string, number | string>;
export const FIX = 'audio.critique.fix.';
export const TIP = 'audio.critique.tip.';
const MS_RATE = { num: 1000, den: 1 } as const;
export const r1 = (v: number) => pyRoundTo(v, 1);
export const r2 = (v: number) => pyRoundTo(v, 2);
export const r3 = (v: number) => pyRoundTo(v, 3);

export function fix(key: string, params: Params, metricId?: CritiqueRowId, at?: number): SoundCritiqueFix {
  const clean: Params = {};
  for (const [k, v] of Object.entries(params)) if (typeof v === 'string' || Number.isFinite(v)) clean[k] = v;
  return {
    ...(metricId ? { metricId: metricId as SoundCritiqueMetricId } : {}),
    messageKey: key,
    params: clean,
    ...(at !== undefined ? { at: RationalTime.fromSeconds(Math.max(0, at), MS_RATE) } : {}),
  };
}

export function refsOf(refs: MetricStats): Params {
  return refs.n && refs.min !== undefined && refs.max !== undefined
    ? { refMin: refs.min, refMax: refs.max }
    : {};
}

/** critique._missing: the events with no target within ±tol. */
export function missingOf(events: readonly number[], targets: readonly number[], tol = 0.1): number[] {
  return events.filter((t) => !targets.some((x) => Math.abs(x - t) <= tol));
}

/** critique._ranges: touching spans merged. */
export function mergeSpans(spans: readonly (readonly [number, number])[]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = b;
    else out.push([a, b]);
  }
  return out;
}

/** The cuts no sound answers (sync `none` and `off`, the timeline's matcher), and those met only by a level peak. */
export function unansweredCuts(sync: SyncResult | null): { none: number[]; peak: number[] } | null {
  if (!sync) return null;
  return {
    none: sync.items.filter((i) => i.status === 'none' || i.status === 'off').map((i) => i.t),
    peak: sync.items.filter((i) => i.status === 'peak').map((i) => i.t),
  };
}

/** One fix per cut (first 8, as upstream lists them), each with the caller's command when it builds one. */
export function cutFixes(
  ctx: FixContext,
  times: readonly number[],
  key: string,
  metricId?: CritiqueRowId,
): SoundCritiqueFix[] {
  const visual = ctx.film.events.visual;
  return times.slice(0, 8).map((t) => {
    const cutIndex = visual.findIndex((v) => Math.abs(v - t) < 5e-4);
    const base = fix(FIX + key, { cutIndex, t: r3(t) }, metricId, t);
    const command = cutIndex >= 0 ? ctx.commands?.hitOnCut?.({ cutIndex, atS: t }) : undefined;
    return command ? { ...base, command } : base;
  });
}

export function realnessWindows(r: RealnessResult | null) {
  const lo = realThresholds(false).lo;
  const segs = (r?.segments ?? []).filter((q) => q.pReal !== null) as {
    start: number;
    end: number;
    pReal: number;
  }[];
  const flagged = segs.filter((q) => q.pReal <= lo).sort((a, b) => a.pReal - b.pReal);
  return { segs, flagged, lo };
}

/** critique._quiet_realness_miss: realness between 0.5 and the 'real' line with no window leaning synthesized. */
export function quietRealnessMiss(r: RealnessResult | null, v: number | null): boolean {
  return v !== null && v >= 0.5 && !realnessWindows(r).segs.some((q) => q.pReal < 0.5);
}

export function realnessFixes(v: number, ctx: FixContext): SoundCritiqueFix[] {
  const t = realThresholds(Boolean(ctx.realness?.segments));
  const { segs, flagged, lo } = realnessWindows(ctx.realness);
  if (quietRealnessMiss(ctx.realness, v)) return [];
  const head: Params =
    v <= t.lo
      ? { pReal: v, threshold: t.lo }
      : v < 0.5
        ? { pReal: v, lo: t.lo, hi: t.hi }
        : { pReal: v, hi: t.hi };
  const key = v <= t.lo ? 'realnessSynthetic' : v < 0.5 ? 'realnessLeaning' : 'realnessUncertain';
  const pick: typeof segs = [];
  for (const q of flagged.length ? flagged : [...segs].sort((a, b) => a.pReal - b.pReal)) {
    if (pick.every((x) => Math.abs(q.start - x.start) >= 2.0)) pick.push(q);
  }
  const shown = pick.slice(0, flagged.length ? 6 : 3).sort((a, b) => a.start - b.start);
  const more = flagged.length > shown.length ? flagged.length - shown.length : 0;
  return [
    fix(FIX + key, { ...head, windowThreshold: lo, windows: shown.length, more }, 'pReal'),
    ...shown.map((q) =>
      fix(
        FIX + 'realnessWindow',
        { start: q.start, end: q.end, pReal: r2(q.pReal), flagged: flagged.length ? 1 : 0 },
        'pReal',
        q.start,
      ),
    ),
  ];
}

export function silentGaps(ctx: FixContext): [number, number][] {
  const { level } = ctx.pass;
  const m = ctx.film.metrics;
  const lufs = ctx.pass.meas.lufs ?? -70;
  const h = (level.t[1] ?? 0) - (level.t[0] ?? 0);
  const out: [number, number][] = [];
  let run: number[] = [];
  level.t.forEach((t, i) => {
    if ((level.lufs[i] ?? 0) < lufs - 30) {
      run.push(t);
      return;
    }
    if (run.length === 0) return;
    const first = run[0] ?? 0;
    if (
      run.length * h >= 0.5 &&
      first > (m.firstSoundS || 0) &&
      t < ctx.film.duration - (m.endSilenceS || 0)
    ) {
      out.push([first - 0.05, (run[run.length - 1] ?? 0) + 0.05]);
    }
    run = [];
  });
  return out;
}
