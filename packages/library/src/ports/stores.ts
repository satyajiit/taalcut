// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's persistence ports (packages/core/SPEC.md sections 6 and 10) over the
 * synchronous repositories. Each write has committed (synchronous=FULL)
 * before its promise resolves.
 */
import {
  ok,
  type AsyncResult,
  type AuditLogStore,
  type CloudCallSink,
  type CommandContext,
  type EventLogStore,
  type ModelProfileStore,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { createAuditLogRepository } from '../repositories/audit-log';
import { createCloudCallRepository, createModelProfileStateRepository } from '../repositories/models';
import { createRunLogRepository } from '../repositories/run-log';
import { writeWith, type CommandStager } from './staging';

export function toVoid(result: Result<unknown>): Result<void> {
  return result.ok ? ok(undefined) : result;
}

/** Core's AuditLogStore. Writes commit on their own; see createCommandUnitOfWork to commit a command's changes with it. */
export function createAuditLogStore(db: LibraryDatabase): AuditLogStore {
  const repo = createAuditLogRepository(db);
  return {
    append: async (entry) => repo.append(entry),
    findByIdempotencyKey: async (key) => repo.findByIdempotencyKey(key),
    markUndone: async (change) => toVoid(repo.markUndone(change)),
    markRedone: async (change) => toVoid(repo.markRedone(change)),
    listByProject: async (projectId, options) => repo.listByProject(projectId, options),
  };
}

/** Core's EventLogStore: the agent's run log. */
export function createEventLogStore(db: LibraryDatabase): EventLogStore {
  const repo = createRunLogRepository(db);
  return {
    append: async (runId, entries, options) => repo.append(runId, entries, options),
    read: async (runId, fromSeq) => repo.read(runId, fromSeq),
    listRuns: async (filter) => ok(repo.listRuns(filter)),
  };
}

/** Core's CloudCallSink: exactly one row per call id. */
export function createCloudCallSink(db: LibraryDatabase): CloudCallSink {
  const repo = createCloudCallRepository(db);
  return { record: async (record) => toVoid(repo.record(record)) };
}

/**
 * Core's ModelProfileStore, whose `save` takes the command's context: a models command passes the context
 * its handler got, and the document commits with the command's audit row (`commands`) instead of before it.
 */
export interface LibraryModelProfileStore extends ModelProfileStore {
  save(state: unknown, context?: CommandContext): AsyncResult<void>;
}

/** Core's ModelProfileStore: one opaque JSON document; @taalcut/models validates what load returns. */
export function createModelProfileStore(
  db: LibraryDatabase,
  options: { readonly commands?: CommandStager } = {},
): LibraryModelProfileStore {
  const repo = createModelProfileStateRepository(db);
  return {
    load: async () => ok(repo.load()),
    save: async (state, context) =>
      writeWith(
        options.commands,
        context,
        () => repo.check(state),
        () => repo.save(state),
      ),
  };
}
