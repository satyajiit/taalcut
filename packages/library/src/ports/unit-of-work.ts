// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Commands commit before they are acknowledged, atomically (P1-D5). Core's
 * command bus runs a handler, then appends to the audit log; on their own
 * those are two commits, and a crash between them leaves a change with no
 * audit row. Here a handler stages its writes instead of making them, and the
 * audit store commits them with the audit row in one SQLite transaction:
 *
 *   handle: async ({ projectId, name }, context) => {
 *     const before = projects.get(projectId);           // reads run now
 *     if (!before.ok) return before;
 *     const staged = commands.stage(context, () => projects.rename(projectId, name)); // writes wait
 *     if (!staged.ok) return staged;
 *     return ok({ result: { projectId, name }, inverse: … });
 *   }
 *
 * The same holds for undo and redo: the inverse's staged writes commit with
 * markUndone, the redo's with markRedone. The bus gives each dispatch, undo
 * and redo a fresh context and passes it to every handler it runs for that
 * step, so writes are tracked per context: pass on the one you received.
 *
 * A staged step is never dropped while its command can still be recorded.
 * When the bus won't record a step (its handler returned an error or threw,
 * the command is a read, or it is a rollback) it calls the audit store's
 * `discard`, which drops what that step staged; `handle(…)` does the same for
 * a handler run outside the bus. At most 256 steps wait at once; past that,
 * `stage` fails instead of losing a waiting step's writes.
 */
import {
  err,
  ok,
  toTaalcutError,
  type AuditLogStore,
  type CommandContext,
  type CommandHandler,
  type CommandId,
  type Result,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { UnitOfWorkFull } from '../errors';
import { createAuditLogRepository } from '../repositories/audit-log';
import { inTransaction } from '../repositories/shared';
import { toVoid } from './stores';

/** A synchronous write against this database, e.g. `() => projects.rename(id, name)`. */
export type StagedWrite = () => Result<unknown>;

export interface CommandUnitOfWork {
  /** Give this to the command bus (AuditLogStoreToken). */
  readonly auditLog: AuditLogStore;
  /**
   * Stages a write for the command, undo or redo running with `context`. It
   * runs when the bus records the step, in the same transaction as the audit
   * change. If that transaction fails nothing is applied, and writes the bus
   * then stages for its rollback are dropped: there is nothing to roll back.
   * `library.unit_of_work_full` (retryable) when 256 other steps are waiting.
   */
  stage(context: CommandContext, write: StagedWrite): Result<void>;
  /** Drops what `context` staged: its handler failed, so the bus won't record it. */
  discard(context: CommandContext): void;
  /** Wraps a handler so that whatever it staged is discarded when it returns an Err or throws. */
  handle<P, R>(handler: CommandHandler<P, R>): CommandHandler<P, R>;
}

/**
 * Runs `fn` in one IMMEDIATE transaction on the database's connection: a
 * command's writes and its audit change commit together or not at all. An Err
 * from `fn` (or a SQLite error) rolls everything back and is returned.
 */
export function withCommandTransaction<T>(db: LibraryDatabase, fn: () => Result<T>): Result<T> {
  return inTransaction(db, 'command', fn);
}

/** Steps whose staged writes may wait at once. */
export const MAX_PENDING_STEPS = 256;

export function createCommandUnitOfWork(db: LibraryDatabase): CommandUnitOfWork {
  const repo = createAuditLogRepository(db);
  const pending = new Map<CommandId, { context: CommandContext; writes: StagedWrite[] }>();
  const settled = new WeakSet<CommandContext>();

  /** The writes staged for the step recording `id`; its context is settled from now on. */
  function take(id: CommandId): StagedWrite[] {
    const step = pending.get(id);
    pending.delete(id);
    if (!step) return [];
    settled.add(step.context);
    return step.writes;
  }

  function discard(context: CommandContext): void {
    if (pending.get(context.commandId)?.context === context) pending.delete(context.commandId);
  }

  /** Records the audit change first (it assigns the sequence), then applies the staged writes. */
  function commit<T>(id: CommandId, record: () => Result<T>): Result<T> {
    const writes = take(id);
    return withCommandTransaction(db, () => {
      const recorded = record();
      if (!recorded.ok) return recorded;
      for (const write of writes) {
        const written = write();
        if (!written.ok) return written;
      }
      return recorded;
    });
  }

  return {
    auditLog: {
      append: async (entry) => commit(entry.id, () => repo.append(entry)),
      findByIdempotencyKey: async (key) => repo.findByIdempotencyKey(key),
      markUndone: async (change) => toVoid(commit(change.id, () => repo.markUndone(change))),
      markRedone: async (change) => toVoid(commit(change.id, () => repo.markRedone(change))),
      listByProject: async (projectId, options) => repo.listByProject(projectId, options),
      // The bus says when a step won't be recorded (a failed handler, a read, a rollback), so a handler
      // registered without `handle(…)` can't leave its staged writes waiting.
      discard,
    },
    stage(context, write) {
      if (settled.has(context)) return ok(undefined);
      let step = pending.get(context.commandId);
      if (step?.context !== context) {
        // A step under the same id but an older context (an earlier undo or redo of this command
        // that never recorded) is replaced; no other step is ever dropped.
        if (!step && pending.size >= MAX_PENDING_STEPS)
          return err(UnitOfWorkFull({ limit: MAX_PENDING_STEPS }));
        step = { context, writes: [] };
        pending.set(context.commandId, step);
      }
      step.writes.push(write);
      return ok(undefined);
    },
    discard,
    handle(handler) {
      return async (payload, context) => {
        try {
          const outcome = await handler(payload, context);
          if (!outcome.ok) discard(context);
          return outcome;
        } catch (cause) {
          discard(context);
          return err(toTaalcutError(cause));
        }
      };
    },
  };
}
