// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's append-only run log (PRD 7.2 "Durability", P1-G2): the agent
 * appends, library persists, and a crashed run resumes or replays from it.
 * The agent owns the entry types and their data; the store keeps them as
 * opaque JSON with a per-run sequence.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { ConflictError, NotFoundError } from '../basics/errors';
import { idSchema, type ConversationId, type RunId } from '../basics/ids';
import { err, ok, type AsyncResult } from '../basics/result';
import { createToken } from '../di/token';

export const RUN_STATUSES = ['running', 'paused', 'succeeded', 'failed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface NewRunLogEntry {
  /** Epoch ms. */
  readonly at: number;
  /** The agent's entry type, e.g. 'tool.called', 'approval.given'. */
  readonly type: string;
  /** JSON. */
  readonly data: unknown;
}

export interface RunLogEntry extends NewRunLogEntry {
  /** 1, 2, 3… within the run, assigned by the store. */
  readonly seq: number;
}

export const runLogEntrySchema: z.ZodType<RunLogEntry> = z.object({
  seq: z.int().positive(),
  at: z.int().nonnegative(),
  type: z.string().min(1),
  data: z.unknown(),
});

export interface RunSummary {
  readonly runId: RunId;
  readonly conversationId: ConversationId | null;
  readonly status: RunStatus;
  readonly lastSeq: number;
  readonly startedAt: number;
  readonly updatedAt: number;
}

export const runSummarySchema: z.ZodType<RunSummary> = z.object({
  runId: idSchema<'AgentRun'>(),
  conversationId: idSchema<'Conversation'>().nullable(),
  status: z.enum(RUN_STATUSES),
  lastSeq: z.int().nonnegative(),
  startedAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});

export interface AppendRunLogOptions {
  /** The last seq this writer saw: 0 for a new run. Anything else in the log by now is a conflict. */
  readonly expectedSeq: number;
  /** Updates the run's status in the same write (e.g. 'paused' with an approval request). */
  readonly status?: RunStatus;
  /** Recorded when the run is created. */
  readonly conversationId?: ConversationId;
}

export interface RunFilter {
  readonly conversationId?: ConversationId;
  readonly statuses?: readonly RunStatus[];
  /** Newest first. Default 100. */
  readonly limit?: number;
}

export interface EventLogStore {
  /**
   * Appends entries atomically with seq expectedSeq + 1, + 2, …, and resolves
   * once they are durable. Fails with core.conflict, writing nothing, if the
   * run's last seq isn't `expectedSeq` (another writer got there first).
   */
  append(
    runId: RunId,
    entries: readonly NewRunLogEntry[],
    options: AppendRunLogOptions,
  ): AsyncResult<{ readonly lastSeq: number }>;
  /** Entries with seq >= fromSeq (default 1), in order. An unknown run is core.not_found. */
  read(runId: RunId, fromSeq?: number): AsyncResult<readonly RunLogEntry[]>;
  /** Runs to resume after a crash: listRuns({ statuses: ['running', 'paused'] }). */
  listRuns(filter?: RunFilter): AsyncResult<readonly RunSummary[]>;
}

export const EventLogStoreToken = createToken<EventLogStore>('core.eventLogStore');

/** An in-memory EventLogStore for tests: the reference for the semantics above. */
export function createMemoryEventLogStore(): EventLogStore {
  const runs = new Map<RunId, { summary: RunSummary; entries: RunLogEntry[] }>();

  return {
    async append(runId, entries, { expectedSeq, status, conversationId }) {
      const run = runs.get(runId);
      const lastSeq = run?.summary.lastSeq ?? 0;
      if (lastSeq !== expectedSeq) {
        return err(
          ConflictError({ entity: 'run', id: runId }, { detail: `expected ${expectedSeq}, at ${lastSeq}` }),
        );
      }
      const stored = entries.map((entry, i) => ({ ...entry, seq: lastSeq + i + 1 }));
      const at = stored.at(-1)?.at ?? run?.summary.updatedAt ?? 0;
      const summary: RunSummary = {
        runId,
        conversationId: run?.summary.conversationId ?? conversationId ?? null,
        status: status ?? run?.summary.status ?? 'running',
        lastSeq: lastSeq + stored.length,
        startedAt: run?.summary.startedAt ?? stored[0]?.at ?? at,
        updatedAt: at,
      };
      runs.set(runId, { summary, entries: [...(run?.entries ?? []), ...stored] });
      return ok({ lastSeq: summary.lastSeq });
    },

    async read(runId, fromSeq = 1) {
      const run = runs.get(runId);
      if (!run) return err(NotFoundError({ entity: 'run', id: runId }));
      return ok(run.entries.filter((entry) => entry.seq >= fromSeq));
    },

    async listRuns(filter = {}) {
      const matches = [...runs.values()]
        .map((run) => run.summary)
        .filter((run) => !filter.conversationId || run.conversationId === filter.conversationId)
        .filter((run) => !filter.statuses || filter.statuses.includes(run.status))
        .sort((a, b) => b.updatedAt - a.updatedAt || (b.runId < a.runId ? -1 : 1));
      return ok(matches.slice(0, filter.limit ?? 100));
    },
  };
}
