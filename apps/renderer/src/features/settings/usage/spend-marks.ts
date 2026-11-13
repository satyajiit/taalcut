// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How a job's mark is filled in Spend by day, in the chart and its legend alike (G8, dataviz "emphasis"): the job
 * in focus in the accent (primary-strong); the others neutral, paler (rule-strong) while one leads, ink-3 when
 * none does.
 */
import type { SeriesKey } from './spend-series';

export function markFill(inFocus: boolean, emphasis: SeriesKey | null): string {
  if (inFocus) return 'bg-primary-strong';
  return emphasis ? 'bg-rule-strong' : 'bg-ink-3';
}
