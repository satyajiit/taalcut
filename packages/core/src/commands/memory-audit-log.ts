// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** An in-memory AuditLogStore for tests and for code that runs before the database exists. */
import { ConflictError, NotFoundError } from '../basics/errors';
import type { CommandId, ProjectId } from '../basics/ids';
import { err, ok } from '../basics/result';
import type { AuditEntry, AuditLogStore } from './audit-log';

export interface MemoryAuditLogStore extends AuditLogStore {
  /** Every entry, in append order. */
  entries(): readonly AuditEntry[];
}

export function createMemoryAuditLogStore(): MemoryAuditLogStore {
  const all: AuditEntry[] = [];
  const nextSequence = new Map<ProjectId | null, number>();

  const update = (id: CommandId, change: Partial<AuditEntry>) => {
    const index = all.findIndex((entry) => entry.id === id);
    if (index < 0) return err(NotFoundError({ entity: 'command', id }));
    all[index] = { ...all[index]!, ...change };
    return ok(undefined);
  };

  return {
    async append(entry) {
      // Like the database's unique index: a key is used once, so a second append can't apply a command twice.
      if (
        entry.idempotencyKey !== null &&
        all.some((stored) => stored.idempotencyKey === entry.idempotencyKey)
      ) {
        return err(
          ConflictError({ entity: 'command', id: entry.id }, { detail: 'idempotency key already used' }),
        );
      }
      const sequence = nextSequence.get(entry.projectId) ?? 1;
      nextSequence.set(entry.projectId, sequence + 1);
      const stored: AuditEntry = { ...entry, sequence, undone: false };
      all.push(stored);
      return ok(stored);
    },
    async findByIdempotencyKey(key) {
      return ok(all.find((entry) => entry.idempotencyKey === key) ?? null);
    },
    async markUndone({ id }) {
      return update(id, { undone: true });
    },
    async markRedone({ id, inverse }) {
      return update(id, { undone: false, inverse });
    },
    async listByProject(projectId, options = {}) {
      const entries = all.filter((entry) => entry.projectId === projectId);
      return ok(options.limit === undefined ? entries : entries.slice(-options.limit));
    },
    entries: () => [...all],
  };
}
