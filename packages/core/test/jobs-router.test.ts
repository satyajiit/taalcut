// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** jobsRouter: the jobs process serves jobsContract from its JobQueue. */
import { describe, expect, it } from 'vitest';
import {
  connectRpc,
  err,
  fromRpcError,
  jobsContract,
  jobsRouter,
  newId,
  NotFoundError,
  ok,
  powerContract,
  powerRouter,
  serveRpc,
  type JobId,
  type JobQueue,
  type JobSnapshot,
  type PowerSnapshot,
} from '@taalcut/core';
import { mainChannel } from './helpers/ports';

function snapshot(id: JobId, state: JobSnapshot['state']): JobSnapshot {
  return {
    id,
    kind: 'demo.wait',
    state,
    priority: 'normal',
    resource: 'cpu',
    projectId: null,
    idempotencyKey: null,
    parentId: null,
    attempt: 1,
    maxAttempts: 3,
    progress: null,
    error: null,
    createdAt: 1,
    updatedAt: 2,
    startedAt: null,
    finishedAt: null,
    nextAttemptAt: null,
  };
}

describe('jobsRouter', () => {
  it('maps each procedure to the queue and its errors to TaalcutErrors', async () => {
    const known = newId<'Job'>();
    const calls: string[] = [];
    const answer = (name: string, state: JobSnapshot['state']) => async (id: JobId) => {
      calls.push(name);
      return id === known ? ok(snapshot(id, state)) : err(NotFoundError({ entity: 'job', id }));
    };
    const queue: JobQueue = {
      enqueue: () => Promise.reject(new Error('not over IPC')),
      get: answer('get', 'queued'),
      list: async () => ok([snapshot(known, 'queued')]),
      pause: answer('pause', 'paused'),
      resume: answer('resume', 'queued'),
      cancel: answer('cancel', 'cancelled'),
      retry: answer('retry', 'queued'),
    };
    const { port1, port2 } = mainChannel();
    serveRpc(jobsRouter(queue), port1, { context: {} });
    const client = connectRpc(jobsContract, port2, { peer: 'jobs' }).client;

    expect((await client.get({ id: known })).id).toBe(known);
    expect(await client.list()).toHaveLength(1);
    expect((await client.pause({ id: known })).state).toBe('paused');
    expect((await client.resume({ id: known })).state).toBe('queued');
    expect((await client.cancel({ id: known })).state).toBe('cancelled');
    expect((await client.retry({ id: known })).state).toBe('queued');
    const missing = await client.get({ id: newId<'Job'>() }).catch(fromRpcError);
    expect(missing).toMatchObject({ code: 'core.not_found' });
    expect(calls).toEqual(['get', 'pause', 'resume', 'cancel', 'retry', 'get']);
  });
});

describe('powerRouter', () => {
  it('hands each snapshot from main to the jobs process and rejects unknown states', async () => {
    const seen: PowerSnapshot[] = [];
    const { port1, port2 } = mainChannel();
    serveRpc(
      powerRouter((snapshot) => seen.push(snapshot)),
      port1,
      { context: {} },
    );
    const client = connectRpc(powerContract, port2, { peer: 'jobs' }).client;
    expect(await client.update({ onBattery: true, thermalState: 'serious' })).toEqual({ applied: true });
    const bad = await client.update({ onBattery: false, thermalState: 'hot' as 'fair' }).catch(fromRpcError);
    expect(bad).toMatchObject({ code: 'core.validation' });
    expect(seen).toEqual([{ onBattery: true, thermalState: 'serious' }]);
  });
});
