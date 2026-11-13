// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  newId,
  NotFoundError,
  unwrap,
  ValidationError,
  type ConversationId,
  type RunId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { Conflict, createRepositories, InvalidState, toAuditEntry } from '../../src/index';
import { auditEntry } from '../fixtures/records';
import { fakeClock, openTestDb } from '../helpers';

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  return { db, clock, repos: createRepositories(db) };
}

describe('AuditLogRepository', () => {
  it('numbers commands per project, and separately for the app-wide scope', () => {
    const { repos } = setup();
    const p1 = unwrap(repos.projects.create({ name: 'One' })).id;
    const p2 = unwrap(repos.projects.create({ name: 'Two' })).id;
    const sequences = [p1, p1, p2, null, p1, null].map(
      (projectId) => unwrap(repos.auditLog.append(auditEntry({ projectId }))).sequence,
    );
    expect(sequences).toEqual([1, 2, 1, 1, 3, 2]);
    expect(unwrap(repos.auditLog.listByProject(p1)).map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect(unwrap(repos.auditLog.listByProject(null))).toHaveLength(2);
    expect(unwrap(repos.auditLog.listByProject(p1, { afterSeq: 1 })).map((e) => e.sequence)).toEqual([2, 3]);
    // With a limit: the newest entries, still oldest first.
    expect(unwrap(repos.auditLog.listByProject(p1, { limit: 2 })).map((e) => e.sequence)).toEqual([2, 3]);
    expect(repos.auditLog.lastSeq(p2)).toBe(1);
  });

  it('stores every field of core’s AuditEntry, including the idempotency key and result', () => {
    const { repos } = setup();
    const input = auditEntry({
      source: 'agent',
      actor: 'agent:run-1',
      sideEffect: 'destructive',
      idempotencyKey: 'tool:42',
      result: { renamed: true },
    });
    const entry = unwrap(repos.auditLog.append(input));
    expect(entry).toEqual({ ...input, sequence: 1, undone: false });
    expect(unwrap(repos.auditLog.get(input.id))).toEqual(entry);
    expect(unwrap(repos.auditLog.findByIdempotencyKey('tool:42'))).toEqual(entry);
    expect(unwrap(repos.auditLog.findByIdempotencyKey('tool:43'))).toBeNull();
    const sameId = repos.auditLog.append({ ...input, idempotencyKey: null });
    expect(!sameId.ok && Conflict.is(sameId.error)).toBe(true);
    const sameKey = repos.auditLog.append(auditEntry({ idempotencyKey: 'tool:42' }));
    expect(!sameKey.ok && Conflict.is(sameKey.error)).toBe(true);
  });

  it('moves applied → undone → redone → undone, storing the redo’s inverse', () => {
    const { repos } = setup();
    const { id } = unwrap(repos.auditLog.append(auditEntry()));
    expect(repos.auditLog.markRedone({ id, at: 1, inverse: null }).ok).toBe(false);
    expect(unwrap(repos.auditLog.markUndone({ id, at: 2 })).undone).toBe(true);
    const twice = repos.auditLog.markUndone({ id, at: 3 });
    expect(!twice.ok && InvalidState.is(twice.error) && twice.error.params).toEqual({
      entity: 'command',
      state: 'undone',
    });
    const inverse = { name: 'project.rename', payload: { name: 'newer' } };
    expect(unwrap(repos.auditLog.markRedone({ id, at: 4, inverse }))).toMatchObject({
      undone: false,
      inverse,
    });
    expect(unwrap(repos.auditLog.markUndone({ id, at: 5 })).undone).toBe(true);
  });

  it("won't undo a command without an inverse", () => {
    const { repos } = setup();
    const { id } = unwrap(repos.auditLog.append(auditEntry({ inverse: null, sideEffect: 'external' })));
    const result = repos.auditLog.markUndone({ id, at: 1 });
    expect(!result.ok && result.error.params).toEqual({ entity: 'command', state: 'not_undoable' });
    const missing = repos.auditLog.markUndone({ id: newId<'Command'>(), at: 1 });
    expect(!missing.ok && NotFoundError.is(missing.error)).toBe(true);
  });

  it('validates entries against core’s schema and joins an outer transaction', () => {
    const { repos, db } = setup();
    for (const bad of [
      { actor: '' },
      { name: 'Not A Name' },
      { sideEffect: 'read' as never },
      { payload: null },
    ]) {
      const result = repos.auditLog.append(auditEntry(bad));
      expect(!result.ok && ValidationError.is(result.error)).toBe(true);
    }
    expect(() =>
      db.transaction(() => {
        unwrap(repos.auditLog.append(auditEntry()));
        throw new Error('handler failed');
      }),
    ).toThrow('handler failed');
    expect(unwrap(repos.auditLog.listByProject(null))).toEqual([]);
  });

  it('rejects a stored row that no longer fits core’s schema', () => {
    const { db, repos } = setup();
    const { id } = unwrap(repos.auditLog.append(auditEntry()));
    db.driver.prepare("UPDATE commands SET side_effect = 'read' WHERE id = ?").run(id);
    expect(repos.auditLog.get(id).ok).toBe(false);
    expect(repos.auditLog.listByProject(null).ok).toBe(false);
    expect(toAuditEntry({ ...unwrap(repos.projects.create({ name: 'p' })), seq: 0 } as never).ok).toBe(false);
  });
});

describe('RunLogRepository', () => {
  const run = 'run-1' as RunId;
  const entry = (type: string, at = 1) => ({ at, type, data: { type } });

  it('appends per run with an optimistic check and keeps a summary', () => {
    const { repos } = setup();
    const conversationId = unwrap(repos.conversations.create({})).id;
    expect(
      unwrap(repos.runLog.append(run, [entry('run.started', 10)], { expectedSeq: 0, conversationId })),
    ).toEqual({
      lastSeq: 1,
    });
    unwrap(
      repos.runLog.append(run, [entry('tool.called', 20), entry('tool.result', 30)], { expectedSeq: 1 }),
    );
    const stale = repos.runLog.append(run, [entry('x')], { expectedSeq: 1 });
    expect(!stale.ok && ConflictError.is(stale.error)).toBe(true);
    expect(unwrap(repos.runLog.read(run, 2)).map((e) => [e.seq, e.type])).toEqual([
      [2, 'tool.called'],
      [3, 'tool.result'],
    ]);
    expect(unwrap(repos.runLog.getRun(run))).toEqual({
      runId: run,
      conversationId,
      status: 'running',
      lastSeq: 3,
      startedAt: 10,
      updatedAt: 30,
    });
    unwrap(repos.runLog.append(run, [], { expectedSeq: 3, status: 'paused' }));
    expect(unwrap(repos.runLog.getRun(run))).toMatchObject({ status: 'paused', lastSeq: 3, updatedAt: 30 });
  });

  it('lists runs newest first, by status and conversation', () => {
    const { repos } = setup();
    const chat = unwrap(repos.conversations.create({})).id;
    const runs = ['a', 'b', 'c'].map((id) => id as RunId);
    runs.forEach((id, i) => unwrap(repos.runLog.append(id, [entry('run.started', i)], { expectedSeq: 0 })));
    unwrap(
      repos.runLog.append(runs[0]!, [entry('run.finished', 9)], { expectedSeq: 1, status: 'succeeded' }),
    );
    unwrap(repos.runLog.append('d' as RunId, [], { expectedSeq: 0, conversationId: chat }));
    expect(repos.runLog.listRuns({ statuses: ['running', 'paused'] }).map((r) => r.runId)).toEqual([
      'd',
      'c',
      'b',
    ]);
    expect(repos.runLog.listRuns({ conversationId: chat }).map((r) => r.runId)).toEqual(['d']);
    expect(repos.runLog.listRuns({ limit: 1 }).map((r) => r.runId)).toEqual(['d']);
  });

  it('validates entries, writes nothing on failure, and redacts secrets in data', () => {
    const { repos } = setup();
    for (const bad of [
      { at: -1, type: 't', data: 1 },
      { at: 1, type: ' ', data: 1 },
      { at: 1, type: 't', data: 1n },
    ]) {
      expect(repos.runLog.append(run, [bad], { expectedSeq: 0 }).ok).toBe(false);
    }
    expect(repos.runLog.append(run, [], { expectedSeq: -1 }).ok).toBe(false);
    const unknownChat = repos.runLog.append(run, [entry('x')], {
      expectedSeq: 0,
      conversationId: 'nope' as ConversationId,
    });
    expect(unknownChat.ok).toBe(false);
    const missing = repos.runLog.read(run);
    expect(!missing.ok && NotFoundError.is(missing.error)).toBe(true);
    unwrap(
      repos.runLog.append(
        run,
        [{ at: 1, type: 'tool.called', data: { headers: { authorization: 'Bearer x' } } }],
        {
          expectedSeq: 0,
        },
      ),
    );
    unwrap(repos.runLog.append(run, [{ at: 2, type: 'empty', data: undefined }], { expectedSeq: 1 }));
    expect(unwrap(repos.runLog.read(run)).map((e) => e.data)).toEqual([
      { headers: { authorization: '[redacted]' } },
      null,
    ]);
  });
});
