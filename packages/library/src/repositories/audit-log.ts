// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The command audit log (PRD V2) in core's AuditEntry shape: the synchronous
 * repository behind core's AuditLogStore port (ports/stores.ts) and the
 * command unit of work (ports/unit-of-work.ts). Every write commits before it
 * returns, so a command the bus acknowledges survives a crash (P1-D5).
 */
import {
  auditEntrySchema,
  err,
  ok,
  ValidationError,
  type AuditEntry,
  type CommandId,
  type CommandInvocation,
  type NewAuditEntry,
  type ProjectId,
  type Result,
} from '@taalcut/core';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { InvalidState } from '../errors';
import { commands, type CommandStatus } from '../schema/audit';
import { found, inTransaction, pageSize } from './shared';

export type CommandRow = typeof commands.$inferSelect;

export interface AuditLogRepository {
  /** Assigns the next sequence for the entry's project (or the app-wide scope) and commits. */
  append(entry: NewAuditEntry): Result<AuditEntry>;
  /** The entry with this idempotency key, undone or not, or null. */
  findByIdempotencyKey(key: string): Result<AuditEntry | null>;
  /** applied|redone → undone. InvalidState if already undone or not undoable. */
  markUndone(change: { readonly id: CommandId; readonly at: number }): Result<AuditEntry>;
  /** undone → redone, storing the inverse the redo produced. InvalidState otherwise. */
  markRedone(change: {
    readonly id: CommandId;
    readonly at: number;
    readonly inverse: CommandInvocation | null;
  }): Result<AuditEntry>;
  /** Oldest first. With `limit`, the newest `limit` entries (still oldest first). */
  listByProject(
    projectId: ProjectId | null,
    options?: { readonly limit?: number; readonly afterSeq?: number },
  ): Result<AuditEntry[]>;
  get(id: CommandId): Result<AuditEntry>;
  /** Highest sequence in the scope, 0 if empty. */
  lastSeq(projectId: ProjectId | null): number;
}

const scope = (projectId: ProjectId | null) =>
  projectId === null ? isNull(commands.projectId) : eq(commands.projectId, projectId);

function invalid(issues: { path: PropertyKey[]; message: string }[]) {
  const field = issues[0]?.path.map(String).join('.') || undefined;
  return ValidationError(field ? { field } : undefined, {
    detail: issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  });
}

/** A stored row as core's AuditEntry, validated: the database is outside the type system. */
export function toAuditEntry(row: CommandRow): Result<AuditEntry> {
  const parsed = auditEntrySchema.safeParse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    payload: row.payload,
    inverse: row.inverse,
    source: row.source,
    actor: row.actor,
    sideEffect: row.sideEffect,
    createdAt: row.createdAt,
    idempotencyKey: row.idempotencyKey,
    result: row.result,
    ...(row.groupId !== null ? { group: row.groupId } : {}),
    sequence: row.seq,
    undone: row.status === 'undone',
  });
  return parsed.success ? ok(parsed.data) : err(invalid(parsed.error.issues));
}

function collect(rows: readonly CommandRow[]): Result<AuditEntry[]> {
  const entries: AuditEntry[] = [];
  for (const row of rows) {
    const entry = toAuditEntry(row);
    if (!entry.ok) return entry;
    entries.push(entry.value);
  }
  return ok(entries);
}

export function createAuditLogRepository(db: LibraryDatabase): AuditLogRepository {
  const { orm } = db;
  const getRow = (id: CommandId) =>
    found(orm.select().from(commands).where(eq(commands.id, id)).get(), 'command', id);
  const lastSeq = (projectId: ProjectId | null) =>
    orm
      .select({ seq: sql<number>`coalesce(max(${commands.seq}), 0)` })
      .from(commands)
      .where(scope(projectId))
      .get()?.seq ?? 0;

  function transition(
    id: CommandId,
    to: 'undone' | 'redone',
    changes: Partial<CommandRow>,
  ): Result<AuditEntry> {
    return inTransaction(db, 'command', () => {
      const current = getRow(id);
      if (!current.ok) return current;
      const row = current.value;
      const allowed: readonly CommandStatus[] = to === 'undone' ? ['applied', 'redone'] : ['undone'];
      if (!allowed.includes(row.status) || (to === 'undone' && row.inverse === null)) {
        const state = to === 'undone' && row.inverse === null ? 'not_undoable' : row.status;
        return err(
          InvalidState({ entity: 'command', state }, { detail: `cannot mark ${row.status} as ${to}` }),
        );
      }
      const updated = orm
        .update(commands)
        .set({ status: to, ...changes })
        .where(eq(commands.id, id))
        .returning()
        .get()!;
      return toAuditEntry(updated);
    });
  }

  return {
    append(entry) {
      const checked = auditEntrySchema.safeParse({ ...entry, sequence: 1, undone: false });
      if (!checked.success) return err(invalid(checked.error.issues));
      // JSON null would become SQL NULL; commands always carry a payload.
      if (entry.payload == null) return err(ValidationError({ field: 'payload' }));
      // IMMEDIATE: the write lock is held from reading max(seq) to the insert.
      return inTransaction(db, 'command', () => {
        const row = orm
          .insert(commands)
          .values({
            id: entry.id,
            projectId: entry.projectId,
            seq: lastSeq(entry.projectId) + 1,
            name: entry.name,
            payload: entry.payload,
            inverse: entry.inverse ?? null,
            source: entry.source,
            actor: entry.actor,
            sideEffect: entry.sideEffect,
            status: 'applied',
            createdAt: entry.createdAt,
            idempotencyKey: entry.idempotencyKey,
            result: entry.result ?? null,
            groupId: entry.group ?? null,
          })
          .returning()
          .get();
        return toAuditEntry(row);
      });
    },
    findByIdempotencyKey(key) {
      const row = orm.select().from(commands).where(eq(commands.idempotencyKey, key)).get();
      return row ? toAuditEntry(row) : ok(null);
    },
    markUndone: ({ id, at }) => transition(id, 'undone', { undoneAt: at }),
    markRedone: ({ id, at, inverse }) => transition(id, 'redone', { redoneAt: at, inverse }),
    listByProject(projectId, options = {}) {
      const after = options.afterSeq ? gt(commands.seq, options.afterSeq) : undefined;
      const newest = orm
        .select()
        .from(commands)
        .where(and(scope(projectId), after))
        .orderBy(desc(commands.seq))
        .limit(pageSize(options.limit, 10_000, 10_000))
        .all();
      return collect(newest.reverse());
    },
    get: (id) => {
      const row = getRow(id);
      return row.ok ? toAuditEntry(row.value) : row;
    },
    lastSeq,
  };
}

/** Commands of one scope in sequence order, for the recovery report. */
export function newestCommands(
  db: LibraryDatabase,
  projectId: ProjectId | null,
  limit: number,
): CommandRow[] {
  return db.orm
    .select()
    .from(commands)
    .where(scope(projectId))
    .orderBy(desc(commands.seq))
    .limit(limit)
    .all()
    .sort((a, b) => a.seq - b.seq);
}
