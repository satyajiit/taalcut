// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What Settings → Usage and the developer trace viewer read, and where the
 * agent writes its traces (P1-G5). @taalcut/library implements both
 * (createLibraryPorts: `usage`, `traces`). Their reads have the shapes of
 * the `usage` and `traces` contracts, so usageRouter and tracesRouter serve
 * them as is.
 */
import type { RunId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { Span, Trace, TraceRunInput, TraceSummary } from '../settings/traces-contract';
import type { UsageListInput, UsagePage } from '../settings/usage-contract';
import type { UsageSummarize } from '../settings/usage-summary';

export interface UsageStore {
  /**
   * Cloud calls newest first, `limit` (1..500, default 100) at a time, with totals over the filtered rows.
   * Every filter in the input applies (round P3-3 added `from`, `provider`, `projectId`): a store must not
   * answer a page it didn't filter.
   */
  list(input?: UsageListInput): AsyncResult<UsagePage>;
  /** G8: the dashboard's aggregates. Optional until the library implements it (usage.summary answers not-implemented). */
  summary?: UsageSummarize;
}

export const UsageStoreToken = createToken<UsageStore>('core.usageStore');

export interface TraceStore {
  /** A run's header: on start, and again when its status changes or it ends (with the completeness gaps). */
  recordRun(run: TraceRunInput): AsyncResult<void>;
  /** A span when it opens (status 'running') and again when it closes. */
  recordSpan(runId: RunId, span: Span): AsyncResult<void>;
  /** Newest first. */
  runs(input?: { limit?: number }): AsyncResult<TraceSummary[]>;
  /** Unknown or expired runs: core.not_found. */
  get(input: { runId: RunId }): AsyncResult<Trace>;
}

export const TraceStoreToken = createToken<TraceStore>('core.traceStore');
