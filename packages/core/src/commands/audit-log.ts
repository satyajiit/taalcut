// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The audit log port. packages/library implements it on the commands table
 * (id, project_id, name, payload JSON, inverse JSON, source, actor,
 * side_effect, created_at, sequence, undone); core ships an in-memory one for
 * tests. The command bus acknowledges a command only after `append` resolves.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type CommandId, type ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import {
  COMMAND_SOURCES,
  commandGroupSchema,
  commandNameSchema,
  type CommandContext,
  type CommandInvocation,
  type CommandSource,
  type SideEffect,
} from './definition';

export interface AuditEntry {
  readonly id: CommandId;
  /** null for app-wide commands; they have their own history. */
  readonly projectId: ProjectId | null;
  readonly name: string;
  /** The validated payload, as JSON. */
  readonly payload: unknown;
  /** How to reverse it, as JSON; null when the command can't be undone. */
  readonly inverse: CommandInvocation | null;
  readonly source: CommandSource;
  readonly actor: string;
  /** Never 'read': read commands are not audited. */
  readonly sideEffect: Exclude<SideEffect, 'read'>;
  /** Epoch milliseconds. */
  readonly createdAt: number;
  /** Unique across the log when set (see DispatchOptions). */
  readonly idempotencyKey: string | null;
  /** The handler's result, as JSON: what a repeated dispatch with the same key gets back. */
  readonly result: unknown;
  /** EDT1: the history step it joined (DispatchOptions.group); absent or null on its own. */
  readonly group?: string | null;
  /** 1, 2, 3… per project (and for the app-wide history), assigned by the store. */
  readonly sequence: number;
  readonly undone: boolean;
}

export type NewAuditEntry = Omit<AuditEntry, 'sequence' | 'undone'>;

export interface AuditLogStore {
  /**
   * Persists the entry with the next sequence for its project. Resolves only once it is durable. An
   * entry whose idempotency key is already in the log is refused (a conflict), never stored twice.
   */
  append(entry: NewAuditEntry): AsyncResult<AuditEntry>;
  /** The entry committed with this idempotency key, undone or not, or null. */
  findByIdempotencyKey(key: string): AsyncResult<AuditEntry | null>;
  markUndone(change: { readonly id: CommandId; readonly at: number }): AsyncResult<void>;
  /** Redo runs the command again, which may produce a new inverse; store it. */
  markRedone(change: {
    readonly id: CommandId;
    readonly at: number;
    readonly inverse: CommandInvocation | null;
  }): AsyncResult<void>;
  /** Oldest first. With `limit`, only the newest `limit` entries (still oldest first). */
  listByProject(
    projectId: ProjectId | null,
    options?: { readonly limit?: number },
  ): AsyncResult<readonly AuditEntry[]>;
  /**
   * The bus won't record the step that ran with `context`: its handler returned an error or threw, the command is
   * a read (never appended), or it was a rollback after the store refused a step. A store that stages a handler's
   * writes until the audit change commits (the library's unit of work) drops what was staged for it. Optional: a
   * store that doesn't stage has nothing to drop.
   */
  discard?(context: CommandContext): void;
}

export const AuditLogStoreToken = createToken<AuditLogStore>('core.auditLogStore');

export const commandInvocationSchema: z.ZodType<CommandInvocation> = z.object({
  name: commandNameSchema,
  payload: z.unknown(),
});

/** For IPC and for validating rows read back from storage. */
export const auditEntrySchema: z.ZodType<AuditEntry> = z.object({
  id: idSchema<'Command'>(),
  projectId: idSchema<'Project'>().nullable(),
  name: commandNameSchema,
  payload: z.unknown(),
  inverse: commandInvocationSchema.nullable(),
  source: z.enum(COMMAND_SOURCES),
  actor: z.string().min(1),
  sideEffect: z.enum(['write', 'destructive', 'external']),
  createdAt: z.int().nonnegative(),
  idempotencyKey: z.string().min(1).max(512).nullable(),
  result: z.unknown(),
  group: commandGroupSchema.nullable().optional(),
  sequence: z.int().positive(),
  undone: z.boolean(),
});
