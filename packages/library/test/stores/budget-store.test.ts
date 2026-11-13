// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X1: the project budget store. The cap is the project's (null: none);
 * spent sums the cost of the project's cloud calls, by project or through
 * its conversations' runs; setCap given a command's context commits with
 * the command's audit row.
 */
import {
  createCommandBus,
  defineCommand,
  idSchema,
  moneySchema,
  newId,
  ok,
  systemClock,
  unwrap,
  type CloudCallRecord,
  type RunId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createCommandUnitOfWork,
  createLibraryPorts,
  createProjectBudgetStore,
  createRepositories,
} from '../../src/index';
import { openTestDb } from '../helpers';

const usd = (micros: number) => ({ currency: 'USD', micros });

function call(cost: number, runId?: RunId): CloudCallRecord {
  return {
    id: newId<'CloudCall'>(),
    module: 'agent',
    provider: 'anthropic',
    model: 'claude',
    reasoning: 'off',
    local: false,
    bytesSent: 10,
    bytesReceived: 10,
    inputTokens: 1,
    outputTokens: 1,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    costUsd: cost / 1_000_000,
    latencyMs: 5,
    outcome: 'ok',
    attempt: 1,
    startedAt: 1,
    ...(runId ? { runId } : {}),
  };
}

describe('project budget store', () => {
  it('reads the cap and sums the spend of the project’s runs', async () => {
    const db = openTestDb({ file: false });
    const repos = createRepositories(db);
    const ports = createLibraryPorts(db);
    const store = createProjectBudgetStore(db);
    const project = unwrap(repos.projects.create({ name: 'Goa', budgetCap: usd(2_000_000) }));
    const other = unwrap(repos.projects.create({ name: 'Delhi' }));
    const chat = unwrap(repos.conversations.create({ projectId: project.id }));
    const elsewhere = unwrap(repos.conversations.create({ projectId: other.id }));
    const run = newId<'AgentRun'>();
    const otherRun = newId<'AgentRun'>();
    unwrap(await ports.conversations.linkRun(chat.id, run));
    unwrap(await ports.conversations.linkRun(elsewhere.id, otherRun));
    for (const record of [call(150_000, run), call(50_000, run), call(999, otherRun), call(7)]) {
      unwrap(await ports.cloudCalls.record(record));
    }
    expect(unwrap(await store.get(project.id))).toEqual({
      projectId: project.id,
      cap: usd(2_000_000),
      spent: usd(200_000),
    });
    expect(unwrap(await store.get(other.id))).toEqual({ projectId: other.id, cap: null, spent: usd(999) });
    expect(moneySchema.safeParse(unwrap(await store.get(project.id)).spent).success).toBe(true);
    const missing = await store.get(newId<'Project'>());
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('sets the cap with the command, refusing another currency or a negative cap', async () => {
    const db = openTestDb({ file: false });
    const repos = createRepositories(db);
    const commands = createCommandUnitOfWork(db);
    const store = createProjectBudgetStore(db, { commands });
    const project = unwrap(repos.projects.create({ name: 'Goa' }));
    const setCap = defineCommand({
      name: 'project.setBudgetCap',
      payload: z.object({ projectId: idSchema<'Project'>(), cap: moneySchema.nullable() }),
      sideEffect: 'write',
      handle: commands.handle(async ({ projectId, cap }, context) => {
        const before = unwrap(await store.get(projectId)).cap;
        const saved = await store.setCap(projectId, cap, context);
        if (!saved.ok) return saved;
        expect(unwrap(await store.get(projectId)).cap).toEqual(before); // staged, not yet written
        return ok({
          result: saved.value,
          inverse: { name: 'project.setBudgetCap', payload: { projectId, cap: before } },
        });
      }),
    });
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    bus.register(setCap);
    const ui = { source: 'ui' as const, actor: 'user' };
    unwrap(await bus.dispatch(setCap, { projectId: project.id, cap: usd(5_000_000) }, ui));
    expect(unwrap(await store.get(project.id)).cap).toEqual(usd(5_000_000));
    unwrap(await bus.undo(project.id, ui));
    expect(unwrap(await store.get(project.id)).cap).toBeNull();
    const euro = await bus.dispatch(
      setCap,
      { projectId: project.id, cap: { currency: 'EUR', micros: 1 } },
      ui,
    );
    expect(!euro.ok && euro.error.code).toBe('core.validation');
    const negative = await store.setCap(project.id, usd(-1), undefined as never);
    expect(!negative.ok && negative.error.code).toBe('core.validation');
    // Without a context it writes at once (start-up, tests).
    unwrap(await store.setCap(project.id, null, undefined as never));
    expect(unwrap(await store.get(project.id)).cap).toBeNull();
  });
});

describe('cloud calls by project', () => {
  it('counts a call the models logger tagged with its project, and drops an unknown project', async () => {
    const db = openTestDb({ file: false });
    const repos = createRepositories(db);
    const ports = createLibraryPorts(db);
    const project = unwrap(repos.projects.create({ name: 'Goa' }));
    const tagged = { ...call(40_000), projectId: project.id };
    const unknown = { ...call(5), projectId: newId<'Project'>() };
    unwrap(await ports.cloudCalls.record(tagged));
    unwrap(await ports.cloudCalls.record(unknown));
    expect(unwrap(await createProjectBudgetStore(db).get(project.id)).spent).toEqual(usd(40_000));
    const rows = repos.cloudCalls.list();
    expect(rows.find((row) => row.id === tagged.id)?.projectId).toBe(project.id);
    expect(rows.find((row) => row.id === unknown.id)).not.toHaveProperty('projectId');
  });
});
