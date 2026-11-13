// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The spend-by-day chart's data (G8), pure: at most six named jobs (the period's biggest spenders, in that
 * order) plus Other, a stack per day in that fixed order, and a clean top for the money axis. A job keeps its
 * place whatever is emphasised or filtered, so a filter never repaints the survivors.
 */
import type { ModelModuleId, UsageSummary } from '@taalcut/core';

export const MAX_NAMED_JOBS = 6;
export type SeriesKey = ModelModuleId | 'other';

export interface DaySpend {
  /** Local date, 'YYYY-MM-DD'. */
  readonly day: string;
  readonly calls: number;
  readonly costUsd: number;
  /** One per series, in the series' order; 0 where the job spent nothing that day. */
  readonly parts: readonly { readonly key: SeriesKey; readonly costUsd: number }[];
}

export interface SpendSeries {
  readonly keys: readonly SeriesKey[];
  readonly days: readonly DaySpend[];
  /** The axis' top: a clean number at or above the biggest day. */
  readonly top: number;
}

/** 1, 2 or 5 times a power of ten, at or above `value` (a money axis reads in round steps). */
export function niceTop(value: number): number {
  if (value <= 0) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= value) return step * power;
  return 10 * power;
}

export function spendSeries(summary: UsageSummary, trimLeadingQuietDays: boolean): SpendSeries {
  const named = summary.byModule
    .filter((row) => row.costUsd > 0)
    .slice(0, MAX_NAMED_JOBS)
    .map((row) => row.module);
  const others = summary.byModule.some((row) => row.costUsd > 0 && !named.includes(row.module));
  const keys: SeriesKey[] = others ? [...named, 'other'] : named;
  let days = summary.byDay.map((day): DaySpend => {
    const parts = keys.map((key) => {
      if (key !== 'other') return { key, costUsd: day.byModule[key] ?? 0 };
      const rest = Object.entries(day.byModule)
        .filter(([module]) => !named.includes(module as ModelModuleId))
        .reduce((sum, [, cost]) => sum + (cost ?? 0), 0);
      return { key, costUsd: rest };
    });
    return { day: day.day, calls: day.calls, costUsd: day.costUsd, parts };
  });
  if (trimLeadingQuietDays) {
    const first = days.findIndex((day) => day.calls > 0);
    days = first < 0 ? [] : days.slice(first);
  }
  const biggest = days.reduce((max, day) => Math.max(max, day.costUsd), 0);
  return { keys, days, top: niceTop(biggest) };
}

/**
 * The job drawn in the accent: the only job, else the one pressed, else the biggest spender; `'none'` (a second
 * press on the pressed one) takes the accent away.
 */
export function emphasisOf(keys: readonly SeriesKey[], chosen: SeriesKey | 'none' | null): SeriesKey | null {
  if (keys.length === 1) return keys[0] ?? null;
  if (chosen === 'none') return null;
  if (chosen && keys.includes(chosen)) return chosen;
  return keys[0] ?? null;
}

/** A local date as a Date at that day's noon (formatting it never shifts it to the day before). */
export function dayDate(day: string): Date {
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12);
}
