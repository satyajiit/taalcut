// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Usage's view in the URL (G8): the period and the three filters, so Privacy, a rate-limit card or
 * a bookmark can open a filtered view (`/settings/usage?period=7d&module=vision`). The default period (30
 * days) and an absent filter stay out of the URL, so `/settings/usage?module=agent` is the whole link.
 */
import { idSchema, MODEL_MODULE_IDS, type ModelModuleId, type ProjectId } from '@taalcut/core';
import { z } from 'zod';

export const USAGE_PERIODS = ['7d', '30d', 'month', 'all'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];
export const DEFAULT_PERIOD = '30d' satisfies UsagePeriod;

/** What the page shows; `period` is always set here (the URL leaves the default out). */
export interface UsageView {
  readonly period: UsagePeriod;
  readonly module: ModelModuleId | null;
  readonly provider: string | null;
  readonly project: ProjectId | null;
}

/** The route's search params, as TanStack Router keeps them: absent keys stay out of the URL. */
export interface UsageSearch {
  readonly period?: Exclude<UsagePeriod, typeof DEFAULT_PERIOD> | undefined;
  readonly module?: ModelModuleId | undefined;
  readonly provider?: string | undefined;
  readonly project?: ProjectId | undefined;
}

const periodSchema = z.enum(USAGE_PERIODS);
const moduleSchema = z.enum(MODEL_MODULE_IDS);
// Provider ids are short lowercase slugs ('openai', 'cloudflare-workers-ai', 'on-device').
const providerSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
const projectSchema = idSchema<'Project'>();

/** Untrusted search params in, a view out: anything unknown or malformed is dropped, never thrown on. */
export function parseUsageSearch(search: Record<string, unknown>): UsageSearch {
  const period = periodSchema.safeParse(search.period);
  const module = moduleSchema.safeParse(search.module);
  const provider = providerSchema.safeParse(search.provider);
  const project = projectSchema.safeParse(search.project);
  return {
    period: period.success && period.data !== DEFAULT_PERIOD ? period.data : undefined,
    module: module.success ? module.data : undefined,
    provider: provider.success ? provider.data : undefined,
    project: project.success ? project.data : undefined,
  };
}

export function viewOf(search: UsageSearch): UsageView {
  return {
    period: search.period ?? DEFAULT_PERIOD,
    module: search.module ?? null,
    provider: search.provider ?? null,
    project: search.project ?? null,
  };
}

/** The view back as search params: the default period and empty filters are left out. */
export function searchOf(view: UsageView): UsageSearch {
  return {
    period: view.period === DEFAULT_PERIOD ? undefined : view.period,
    module: view.module ?? undefined,
    provider: view.provider ?? undefined,
    project: view.project ?? undefined,
  };
}

export const hasFilters = (view: UsageView) =>
  view.module !== null || view.provider !== null || view.project !== null;

/** Local midnight of `now`'s day, moved by `shift` (a number of days back, or to the first of the month). */
function localDay(now: number, shift: (midnight: Date) => void): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  shift(date);
  return date.getTime();
}

const daysBack = (days: number) => (date: Date) => date.setDate(date.getDate() - days);

/** The period as epoch ms, ending now, with whole local days (or the month) at the start. */
export function periodRange(period: UsagePeriod, now: number): { from: number; to: number } {
  switch (period) {
    case '7d':
      return { from: localDay(now, daysBack(6)), to: now };
    case '30d':
      return { from: localDay(now, daysBack(29)), to: now };
    case 'month':
      return { from: localDay(now, (date) => date.setDate(1)), to: now };
    case 'all':
      // Every call counts in the totals; the chart starts at the first day with a call.
      return { from: 0, to: now };
  }
}

/** The zone the days are counted in: the Mac's. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
