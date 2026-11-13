// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** `indexing.*` over a port: status, pause (kept across restarts, jobs paused), resume, prioritise, retry. */
import { EventEmitter } from 'node:events';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { connectRpc, createEventBus, indexingContract, serveRpc, unwrap } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createIndexingPipeline, indexingRouter } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { stubStages } from './stages';

const open: MessagePort[] = [];
afterEach(() => {
  for (const port of open.splice(0)) port.close();
});

/** Electron's MessagePortMain over a worker_threads port (as core's tests do). */
class PortMain extends EventEmitter {
  private started = false;
  constructor(private readonly inner: MessagePort) {
    super();
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    this.inner.on('message', (data: unknown) => this.emit('message', { data, ports: [] }));
  }
  postMessage(message: unknown): void {
    this.inner.postMessage(message);
  }
  close(): void {
    this.inner.close();
  }
}

async function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const stub = stubStages(db);
  const queue = createTestQueue(db, events, stub.handlers);
  const make = () => createIndexingPipeline({ db, queue, events, stages: stub.stages, log: () => {} });
  const pipeline = make();
  await pipeline.start({ poll: false });
  const { port1, port2 } = new MessageChannel();
  open.push(port1, port2);
  serveRpc(indexingRouter(pipeline), new PortMain(port1), { context: {} });
  const client = connectRpc(indexingContract, new PortMain(port2), { peer: 'jobs' }).client;
  return { db, queue, pipeline, client, make };
}

describe('indexingRouter', () => {
  it('pauses and resumes indexing, keeping the choice across restarts', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image', 'image']);
    await t.pipeline.tick();
    await t.pipeline.idle();
    expect(unwrap(await t.queue.list({ states: ['queued'] }))).toHaveLength(2);

    const paused = await t.client.pause();
    expect(paused.paused).toBe(true);
    expect(unwrap(await t.queue.list({ states: ['paused'] }))).toHaveLength(2);
    await t.pipeline.tick();
    await t.pipeline.idle();
    expect(await t.queue.runNext()).toBeNull();
    expect(t.make().status().paused).toBe(true); // a restarted jobs process stays paused

    expect((await t.client.resume()).paused).toBe(false);
    expect(unwrap(await t.queue.list({ states: ['queued'] }))).toHaveLength(2);
    expect(await t.client.prioritise({ assetIds: [assets[1]!] })).toEqual({ boosted: 1 });
    await runPipeline(t.pipeline, t.queue);
    expect(t.queue.ran[0]).toBe(`test.hashAsset ${assets[1]}`);
    const status = await t.client.status();
    expect(status.overall).toMatchObject({ assets: 2, done: 2 });
    expect(await t.client.retryFailed({})).toEqual({ requeued: 0 });
  });
});
