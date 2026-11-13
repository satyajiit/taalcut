// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Migration 39 (EDT1-CTX): a command's history step, `commands.group_id`. The audit log stores and reads it back,
 * so a restarted bus undoes an agent turn whole; a command without one reads as before. Down drops the column.
 */
import {
  createCommandBus,
  createManualClock,
  defineCommand,
  newId,
  ok,
  unwrap,
  type CommandOrigin,
  type NewAuditEntry,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAuditLogRepository } from '../src/repositories/audit-log';
import { openTestDb } from './helpers';

const columns = (db: ReturnType<typeof openTestDb>) =>
  db.driver
    .prepare(`SELECT name FROM pragma_table_info('commands')`)
    .all()
    .map((row) => row.name);

const entry = (group?: string): NewAuditEntry => ({
  id: newId<'Command'>(),
  projectId: null,
  name: 'settings.set',
  payload: { value: 1 },
  inverse: { name: 'settings.set', payload: { value: 0 } },
  source: 'agent',
  actor: 'agent:run',
  sideEffect: 'write',
  createdAt: 1,
  idempotencyKey: null,
  result: null,
  ...(group !== undefined ? { group } : {}),
});

describe('migration 39: command groups', () => {
  it('adds group_id, stores and reads a group, and goes down and up again', () => {
    const db = openTestDb({ targetVersion: 38 });
    expect(columns(db)).not.toContain('group_id');
    unwrap(db.migrateTo(39));
    expect(columns(db)).toContain('group_id');

    const log = createAuditLogRepository(db);
    const grouped = unwrap(log.append(entry('turn:1')));
    const alone = unwrap(log.append(entry()));
    expect(grouped.group).toBe('turn:1');
    expect(alone).not.toHaveProperty('group');
    expect(unwrap(log.listByProject(null)).map((stored) => stored.group ?? null)).toEqual(['turn:1', null]);
    expect(() => db.driver.prepare(`UPDATE commands SET group_id = '' WHERE id = ?`).run(alone.id)).toThrow(
      /CHECK/,
    );

    unwrap(db.migrateTo(38));
    expect(columns(db)).not.toContain('group_id');
    unwrap(db.migrateTo(39));
    expect(unwrap(createAuditLogRepository(db).listByProject(null)).every((stored) => !stored.group)).toBe(
      true,
    );
  });

  it('lets a restarted bus undo a whole group from the stored log', async () => {
    const db = openTestDb();
    const log = createAuditLogRepository(db);
    const store = {
      append: async (next: NewAuditEntry) => log.append(next),
      findByIdempotencyKey: async (key: string) => log.findByIdempotencyKey(key),
      markUndone: async (change: Parameters<typeof log.markUndone>[0]) => {
        const marked = log.markUndone(change);
        return marked.ok ? ok(undefined) : marked;
      },
      markRedone: async (change: Parameters<typeof log.markRedone>[0]) => {
        const marked = log.markRedone(change);
        return marked.ok ? ok(undefined) : marked;
      },
      listByProject: async (projectId: null, options?: { limit?: number }) =>
        log.listByProject(projectId, options),
    };
    let value = 0;
    const set = defineCommand({
      name: 'settings.set',
      payload: z.object({ value: z.number() }),
      sideEffect: 'write',
      project: () => null,
      handle: ({ value: next }) => {
        const before = value;
        value = next;
        return ok({ result: null, inverse: { name: 'settings.set', payload: { value: before } } });
      },
    });
    const agent: CommandOrigin = { source: 'agent', actor: 'agent:run' };
    const first = createCommandBus({ store, clock: createManualClock(1) });
    first.register(set);
    for (const next of [1, 2, 3])
      unwrap(await first.dispatch(set, { value: next }, agent, { group: 'turn:1' }));

    const restarted = createCommandBus({ store, clock: createManualClock(2) });
    restarted.register(set);
    expect(unwrap(await restarted.undo(null, { source: 'ui', actor: 'user' }))).toMatchObject({ steps: 3 });
    expect(value).toBe(0);
  });
});
