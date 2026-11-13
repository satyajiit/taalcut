// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's UsageStore and TraceStore ports (createLibraryPorts: `usage`,
 * `traces`). Settings → Usage (its request log and, G8, its dashboard summary) and
 * the developer trace viewer read them through core's usageRouter and
 * tracesRouter; the agent writes traces.
 */
import { ok, type TraceStore, type UsageStore, type UsageSummarize } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createTraceRepository } from '../repositories/traces';
import { createUsageRepository } from '../repositories/usage';
import { summarizeUsage } from '../usage/usage-summary';

/** The ports and their tokens now live in core; re-exported for existing imports. */
export { TraceStoreToken, UsageStoreToken, type TraceStore, type UsageStore } from '@taalcut/core';

/** The library's UsageStore serves the summary (core keeps it optional for other implementations). */
export type LibraryUsageStore = UsageStore & { readonly summary: UsageSummarize };

export function createUsageStore(db: LibraryDatabase): LibraryUsageStore {
  const repo = createUsageRepository(db);
  return { list: async (input) => repo.list(input), summary: async (input) => summarizeUsage(db, input) };
}

/** Keeps the newest `maxRuns` runs (default 500). */
export function createTraceStore(db: LibraryDatabase, options: { maxRuns?: number } = {}): TraceStore {
  const repo = createTraceRepository(db, options);
  return {
    recordRun: async (run) => repo.recordRun(run),
    recordSpan: async (runId, span) => repo.recordSpan(runId, span),
    runs: async (input) => ok(repo.runs(input)),
    get: async ({ runId }) => repo.get(runId),
  };
}
