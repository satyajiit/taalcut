// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's append-only run log (PRD 7.2 "Durability", P1-G2) with core's
 * EventLogStore semantics: entries are numbered per run, a writer states the
 * last seq it saw and gets core.conflict if another writer got there first,
 * and the run's summary row changes in the same transaction as its entries.
 * Entry data is the agent's; secrets in it are redacted before it is stored.
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  ValidationError,
  type AppendRunLogOptions,
  type NewRunLogEntry,
  type Result,
  type RunFilter,
  type RunId,
  type RunLogEntry,
  type RunSummary,
} from '@taalcut/core';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { agentEvents, agentRuns } from '../schema/audit';
import { redactSecrets } from '../secrets/redact';
import { inTransaction, pageSize } from './shared';

export interface RunLogRepository {
  /** Appends all entries or none, numbered expectedSeq + 1, + 2, …; core.conflict if the run moved on. */
  append(
    runId: RunId,
    entries: readonly NewRunLogEntry[],
    options: AppendRunLogOptions,
  ): Result<{ readonly lastSeq: number }>;
  /** Entries with seq >= fromSeq (default 1), in order. An unknown run is core.not_found. */
  read(runId: RunId, fromSeq?: number): Result<RunLogEntry[]>;
  getRun(runId: RunId): Result<RunSummary>;
  /** Newest first (by last update). Default limit 100. */
  listRuns(filter?: RunFilter): RunSummary[];
}

const isTime = (value: number) => Number.isSafeInteger(value) && value >= 0;

function checkEntries(entries: readonly NewRunLogEntry[]): Result<string[]> {
  const json: string[] = [];
  for (const [i, entry] of entries.entries()) {
    if (typeof entry.type !== 'string' || !entry.type.trim()) {
      return err(ValidationError({ field: `entries.${i}.type` }));
    }
    if (!isTime(entry.at)) return err(ValidationError({ field: `entries.${i}.at` }));
    try {
      json.push(JSON.stringify(redactSecrets(entry.data) ?? null));
    } catch (cause) {
      return err(ValidationError({ field: `entries.${i}.data` }, { detail: String(cause) }));
    }
  }
  return ok(json);
}

export function createRunLogRepository(db: LibraryDatabase): RunLogRepository {
  const { orm } = db;
  const summary = (runId: RunId) => orm.select().from(agentRuns).where(eq(agentRuns.runId, runId)).get();
  const getRun = (runId: RunId): Result<RunSummary> => {
    const run = summary(runId);
    return run ? ok(run) : err(NotFoundError({ entity: 'run', id: runId }));
  };

  return {
    append(runId, entries, options) {
      if (!Number.isSafeInteger(options.expectedSeq) || options.expectedSeq < 0) {
        return err(ValidationError({ field: 'expectedSeq' }));
      }
      const checked = checkEntries(entries);
      if (!checked.ok) return checked;
      return inTransaction(db, 'run', () => {
        const run = summary(runId);
        const lastSeq = run?.lastSeq ?? 0;
        if (lastSeq !== options.expectedSeq) {
          return err(
            ConflictError(
              { entity: 'run', id: runId },
              { detail: `expected ${options.expectedSeq}, at ${lastSeq}` },
            ),
          );
        }
        const insert = db.driver.prepare(
          'INSERT INTO agent_events (run_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)',
        );
        entries.forEach((entry, i) =>
          insert.run(runId, lastSeq + i + 1, entry.type, checked.value[i]!, entry.at),
        );
        const next = lastSeq + entries.length;
        const now = db.clock();
        const changes = {
          status: options.status ?? run?.status ?? 'running',
          lastSeq: next,
          updatedAt: entries.at(-1)?.at ?? run?.updatedAt ?? now,
          conversationId: run?.conversationId ?? options.conversationId ?? null,
        };
        if (run) orm.update(agentRuns).set(changes).where(eq(agentRuns.runId, runId)).run();
        else
          orm
            .insert(agentRuns)
            .values({ runId, startedAt: entries[0]?.at ?? now, ...changes })
            .run();
        return ok({ lastSeq: next });
      });
    },

    read(runId, fromSeq = 1) {
      const run = getRun(runId);
      if (!run.ok) return run;
      const rows = orm
        .select()
        .from(agentEvents)
        .where(and(eq(agentEvents.runId, runId), gte(agentEvents.seq, fromSeq)))
        .orderBy(asc(agentEvents.seq))
        .all();
      return ok(rows.map((row) => ({ seq: row.seq, at: row.createdAt, type: row.type, data: row.payload })));
    },

    getRun,

    listRuns(filter = {}) {
      return orm
        .select()
        .from(agentRuns)
        .where(
          and(
            filter.conversationId ? eq(agentRuns.conversationId, filter.conversationId) : undefined,
            filter.statuses ? inArray(agentRuns.status, [...filter.statuses]) : undefined,
          ),
        )
        .orderBy(desc(agentRuns.updatedAt), desc(agentRuns.runId))
        .limit(pageSize(filter.limit, 100, 1000))
        .all();
    },
  };
}
