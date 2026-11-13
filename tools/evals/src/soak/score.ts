// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Growth strictly above this fails the soak. 10% exactly passes. */
export const GROWTH_LIMIT = 0.1;
/** Samples before this offset are warm-up and are not part of either hour. */
export const WARMUP_MS = 15 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

/** 1-based inclusive render indexes for the full `renders-50` comparison. */
export const RENDER_EARLY_FROM = 6;
export const RENDER_EARLY_TO = 15;
export const RENDER_LATE_FROM = 41;
export const RENDER_LATE_TO = 50;

export interface SoakProcessRss {
  name: string;
  rssBytes: number;
}

/** One RSS observation. `at` is milliseconds from the start of the scenario. */
export interface SoakRssSample {
  at: number;
  /** 1-based render counter. Set only for the renders scenario. */
  renderIndex?: number;
  processes: readonly SoakProcessRss[];
}

export interface ProcessGrowth {
  process: string;
  early: number;
  late: number;
  /** Null when the early median is 0, so the ratio is not reported as Infinity. */
  ratio: number | null;
}

export interface GrowthScore {
  growth: ProcessGrowth[];
  verdict: 'pass' | 'fail' | 'missing';
  reasons: string[];
}

export interface TimeWindows {
  durationMs: number;
  warmupMs?: number;
  hourMs?: number;
}

export interface RenderWindows {
  earlyFrom: number;
  earlyTo: number;
  lateFrom: number;
  lateTo: number;
}

/** Odd length is the middle value. Even length is the mean of the two middle values. */
function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median of an empty list');
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  const right = sorted[mid];
  if (right === undefined) throw new Error('median of an empty list');
  if (sorted.length % 2 === 1) return right;
  const left = sorted[mid - 1];
  if (left === undefined) throw new Error('median of an empty list');
  return (left + right) / 2;
}

function collect(
  samples: readonly SoakRssSample[],
  accept: (sample: SoakRssSample) => boolean,
): Map<string, number[]> {
  const byProcess = new Map<string, number[]>();
  for (const sample of samples) {
    if (!accept(sample)) continue;
    for (const process of sample.processes) {
      const list = byProcess.get(process.name);
      if (list === undefined) byProcess.set(process.name, [process.rssBytes]);
      else list.push(process.rssBytes);
    }
  }
  return byProcess;
}

function judge(early: Map<string, number[]>, late: Map<string, number[]>): GrowthScore {
  const names = [...new Set([...early.keys(), ...late.keys()])].sort();
  if (names.length === 0) return { growth: [], verdict: 'missing', reasons: ['missing-samples'] };
  const growth: ProcessGrowth[] = [];
  const reasons: string[] = [];
  let missing = false;
  let failed = false;
  for (const process of names) {
    const earlyValues = early.get(process);
    const lateValues = late.get(process);
    if (earlyValues === undefined || lateValues === undefined) {
      missing = true;
      reasons.push(`missing-samples:${process}`);
      continue;
    }
    const earlyMedian = median(earlyValues);
    const lateMedian = median(lateValues);
    if (!Number.isFinite(earlyMedian) || !Number.isFinite(lateMedian)) {
      failed = true;
      reasons.push(`non-finite-rss:${process}`);
      continue;
    }
    if (earlyMedian === 0) {
      failed = true;
      growth.push({ process, early: earlyMedian, late: lateMedian, ratio: null });
      reasons.push(`zero-early-rss:${process}`);
      continue;
    }
    const ratio = (lateMedian - earlyMedian) / earlyMedian;
    growth.push({ process, early: earlyMedian, late: lateMedian, ratio });
    if (ratio > GROWTH_LIMIT) {
      failed = true;
      reasons.push(`growth:${process}`);
    }
  }
  const verdict = failed ? 'fail' : missing ? 'missing' : 'pass';
  return { growth, verdict, reasons };
}

/**
 * Median RSS of the last hour against the median of the first hour after warm-up.
 * Warm-up is `[0, warmup)`. The early hour is `[warmup, warmup + hour)`.
 * The late hour is `[duration - hour, duration]`.
 */
export function scoreTimeGrowth(samples: readonly SoakRssSample[], windows: TimeWindows): GrowthScore {
  const warmupMs = windows.warmupMs ?? WARMUP_MS;
  const hourMs = windows.hourMs ?? HOUR_MS;
  const lateStart = windows.durationMs - hourMs;
  const early = collect(samples, (sample) => sample.at >= warmupMs && sample.at < warmupMs + hourMs);
  const late = collect(samples, (sample) => sample.at >= lateStart && sample.at <= windows.durationMs);
  return judge(early, late);
}

/** Median RSS of renders `lateFrom`–`lateTo` against renders `earlyFrom`–`earlyTo` (1-based, inclusive). */
export function scoreRenderGrowth(
  samples: readonly SoakRssSample[],
  windows: RenderWindows = {
    earlyFrom: RENDER_EARLY_FROM,
    earlyTo: RENDER_EARLY_TO,
    lateFrom: RENDER_LATE_FROM,
    lateTo: RENDER_LATE_TO,
  },
): GrowthScore {
  const inSpan = (index: number | undefined, from: number, to: number) =>
    index !== undefined && index >= from && index <= to;
  const early = collect(samples, (sample) => inSpan(sample.renderIndex, windows.earlyFrom, windows.earlyTo));
  const late = collect(samples, (sample) => inSpan(sample.renderIndex, windows.lateFrom, windows.lateTo));
  return judge(early, late);
}

/** Scenarios that do not measure RSS (the update sequence is already short). */
export function growthNotApplicable(): GrowthScore {
  return { growth: [], verdict: 'pass', reasons: [] };
}
