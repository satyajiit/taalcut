// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Core's ports as library implements them (packages/core/SPEC.md section 10). */
import {
  ConflictError,
  createMemoryEventLogStore,
  newId,
  NotFoundError,
  unwrap,
  ValidationError,
  type EventLogStore,
  type JobRecord,
  type RunId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createAuditLogStore,
  createJobRepository,
  createLibraryPorts,
  defineSetting,
  type LibraryPorts,
} from '../../src/index';
import { auditEntry, cloudCall } from '../fixtures/records';
import { fakeClock, openTestDb } from '../helpers';

function setup(): {
  ports: LibraryPorts;
  db: ReturnType<typeof openTestDb>;
  clock: ReturnType<typeof fakeClock>;
} {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  return { ports: createLibraryPorts(db), db, clock };
}

function job(overrides: Partial<JobRecord> = {}): JobRecord {
  const t = Date.UTC(2026, 9, 12);
  return {
    id: newId<'Job'>(),
    kind: 'media.probe',
    state: 'queued',
    priority: 'normal',
    resource: 'io',
    projectId: null,
    idempotencyKey: null,
    parentId: null,
    attempt: 1,
    maxAttempts: 3,
    progress: null,
    error: null,
    createdAt: t,
    updatedAt: t,
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: null,
    input: { path: '/a.mov' },
    ...overrides,
  };
}

describe('EventLogStore', () => {
  /** The same script against core's reference implementation and library's. */
  async function script(store: EventLogStore) {
    const run = 'run-1' as RunId;
    unwrap(await store.append(run, [{ at: 1, type: 'run.started', data: {} }], { expectedSeq: 0 }));
    unwrap(
      await store.append(run, [{ at: 2, type: 'tool.called', data: { tool: 'probe' } }], { expectedSeq: 1 }),
    );
    const stale = await store.append(run, [{ at: 3, type: 'x', data: null }], { expectedSeq: 1 });
    unwrap(await store.append(run, [], { expectedSeq: 2, status: 'paused' }));
    return {
      stale: !stale.ok && ConflictError.is(stale.error),
      entries: unwrap(await store.read(run)),
      fromTwo: unwrap(await store.read(run, 2)).map((e) => e.seq),
      runs: unwrap(await store.listRuns({ statuses: ['running', 'paused'] })),
      missing: (await store.read('nope' as RunId)).ok,
    };
  }

  it('behaves like core’s reference implementation', async () => {
    const { ports } = setup();
    expect(await script(ports.eventLog)).toEqual(await script(createMemoryEventLogStore()));
  });
});

describe('JobStore (core)', () => {
  it('round-trips a record and lists newest first', async () => {
    const { ports } = setup();
    const nullInput = job({ input: null, createdAt: 0, updatedAt: 0 });
    expect(unwrap(await ports.jobStore.insert(nullInput)).job.input).toBeNull();
    const first = job({
      priority: 'high',
      progress: { fraction: 0.5, completed: 5, total: 10, unit: 'items' },
    });
    expect(unwrap(await ports.jobStore.insert(first))).toEqual({ job: first, created: true });
    expect(unwrap(await ports.jobStore.get(first.id))).toEqual(first);
    const later = job({ createdAt: first.createdAt + 1, updatedAt: first.createdAt + 1, priority: 'low' });
    unwrap(await ports.jobStore.insert(later));
    expect(unwrap(await ports.jobStore.list()).map((j) => j.id)).toEqual([later.id, first.id, nullInput.id]);
    expect(unwrap(await ports.jobStore.list({ states: ['running'] }))).toEqual([]);
    expect(
      unwrap(await ports.jobStore.list({ projectId: null, kind: 'media.probe', limit: 1 })),
    ).toHaveLength(1);
    const missing = await ports.jobStore.get(newId<'Job'>());
    expect(!missing.ok && NotFoundError.is(missing.error)).toBe(true);
  });

  it('shares an idempotency key only among live jobs', async () => {
    const { ports } = setup();
    const first = job({ idempotencyKey: 'probe:/a.mov' });
    unwrap(await ports.jobStore.insert(first));
    const again = unwrap(await ports.jobStore.insert(job({ idempotencyKey: 'probe:/a.mov' })));
    expect(again).toEqual({ job: first, created: false });
    const failed = {
      ...first,
      state: 'failed' as const,
      error: { code: 'x.y', messageKey: 'e', retryable: false },
    };
    unwrap(await ports.jobStore.update(failed, 'queued'));
    expect(unwrap(await ports.jobStore.insert(job({ idempotencyKey: 'probe:/a.mov' }))).created).toBe(true);
  });

  it('updates only from the expected state', async () => {
    const { ports } = setup();
    const queued = job();
    unwrap(await ports.jobStore.insert(queued));
    const running = { ...queued, state: 'running' as const, startedAt: 5, output: { ok: true } };
    expect(unwrap(await ports.jobStore.update(running, 'queued'))).toEqual(running);
    const stale = await ports.jobStore.update({ ...queued, state: 'cancelled' }, 'queued');
    expect(!stale.ok && ConflictError.is(stale.error)).toBe(true);
    const unknown = await ports.jobStore.update(job(), 'queued');
    expect(!unknown.ok && NotFoundError.is(unknown.error)).toBe(true);
    const invalid = await ports.jobStore.insert({ ...job(), kind: 'Not A Kind' });
    expect(!invalid.ok && ValidationError.is(invalid.error)).toBe(true);
  });

  it('reads rows the lease engine wrote', async () => {
    const { ports, db } = setup();
    const leases = createJobRepository(db);
    const { job: row } = unwrap(
      leases.enqueue({ kind: 'media.probe', payload: { path: '/b.mov' }, resourceClass: 'cpu', priority: 7 }),
    );
    unwrap(leases.claimNext({ owner: 'w', leaseMs: 1000 }));
    unwrap(leases.heartbeat(row.id, 'w', { leaseMs: 1000, progress: 0.25, progressDetail: { step: 2 } }));
    expect(unwrap(await ports.jobStore.get(row.id))).toMatchObject({
      state: 'running',
      priority: 'high',
      attempt: 1,
      progress: { fraction: 0.25 },
      input: { path: '/b.mov' },
    });
  });
});

describe('CloudCallSink, ModelProfileStore, AcknowledgementStore, SettingsStore', () => {
  it('records each call once', async () => {
    const { ports, db } = setup();
    const call = cloudCall();
    unwrap(await ports.cloudCalls.record(call));
    unwrap(await ports.cloudCalls.record(call));
    expect(db.driver.prepare('SELECT count(*) AS n FROM cloud_calls').get()?.n).toBe(1);
    expect((await ports.cloudCalls.record({ ...call, attempt: 0 })).ok).toBe(false);
  });

  it('loads what was saved, undefined before', async () => {
    const { ports } = setup();
    expect(unwrap(await ports.modelProfiles.load())).toBeUndefined();
    unwrap(await ports.modelProfiles.save({ version: 1, active: 'balanced' }));
    expect(unwrap(await ports.modelProfiles.load())).toEqual({ version: 1, active: 'balanced' });
  });

  it('remembers acknowledgements per terms version', async () => {
    const { ports, clock } = setup();
    const store = ports.acknowledgements;
    expect(unwrap(await store.has('login.chatgpt', 'v1'))).toBe(false);
    expect(unwrap(await store.latest('login.chatgpt'))).toBeNull();
    const record = unwrap(await store.record({ featureId: 'login.chatgpt', termsVersion: 'v1' }));
    expect(record).toEqual({
      featureId: 'login.chatgpt',
      termsVersion: 'v1',
      acknowledgedAt: clock.now(),
      context: null,
    });
    expect(unwrap(await store.has('login.chatgpt', 'v1'))).toBe(true);
    expect(unwrap(await store.has('login.chatgpt', 'v2'))).toBe(false);
    expect(unwrap(await store.latest('login.chatgpt'))).toEqual(record);
    expect((await store.record({ featureId: '', termsVersion: 'v1' })).ok).toBe(false);
  });

  it('types settings by key and falls back to the default', async () => {
    const { ports, db } = setup();
    const theme = defineSetting('ui.theme', z.enum(['system', 'light', 'dark']), 'system');
    const budget = defineSetting('budget.monthly', z.object({ usd: z.number().positive() }), { usd: 20 });
    expect(unwrap(await ports.settings.get(theme))).toBe('system');
    expect(unwrap(await ports.settings.set(theme, 'dark'))).toBe('dark');
    expect(unwrap(await ports.settings.get(theme))).toBe('dark');
    const bad = await ports.settings.set(budget, { usd: -1 });
    expect(!bad.ok && bad.error.params).toEqual({ field: 'budget.monthly' });
    db.driver.prepare(`UPDATE settings SET value = '"neon"' WHERE key = 'ui.theme'`).run();
    expect(unwrap(await ports.settings.get(theme))).toBe('system');
    unwrap(await ports.settings.reset(theme));
    expect(unwrap(await ports.settings.get(theme))).toBe('system');
    expect(() => defineSetting('Bad Key', z.string(), '')).toThrow();
    expect(() => defineSetting('ok', z.number(), 'not a number' as never)).toThrow();
  });
});

describe('AuditLogStore (core)', () => {
  it('maps the repository to the port', async () => {
    const { db } = setup();
    const store = createAuditLogStore(db);
    const entry = unwrap(await store.append(auditEntry({ idempotencyKey: 'k' })));
    expect(unwrap(await store.findByIdempotencyKey('k'))).toEqual(entry);
    unwrap(await store.markUndone({ id: entry.id, at: 1 }));
    unwrap(await store.markRedone({ id: entry.id, at: 2, inverse: null }));
    expect(unwrap(await store.listByProject(null))).toMatchObject([{ undone: false, inverse: null }]);
    expect((await store.markRedone({ id: entry.id, at: 3, inverse: null })).ok).toBe(false);
  });
});
