// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Events across processes (P1-C5): a jobs process emits on its bus; main
 * bridges it into its own bus over a MessagePortMain-style port; the renderer
 * subscribes to main over a DOM-style port.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  bridgeEvents,
  connectRpc,
  createEventBus,
  createManualClock,
  eventsContract,
  eventsRouter,
  newId,
  serveRpc,
  systemClock,
  unwrap,
  type EventBus,
  type EventType,
  type TaalcutEvent,
} from '@taalcut/core';
import { channel, mainChannel, tick } from './helpers/ports';

/** jobs process → main → renderer. */
async function wire(exposedToRenderer?: readonly EventType[]) {
  const jobsBus = createEventBus({ clock: systemClock });
  const mainBus = createEventBus({ clock: systemClock });

  const jobsPorts = mainChannel();
  const jobsServer = serveRpc(eventsRouter(jobsBus), jobsPorts.port1, { context: {} });
  const jobs = connectRpc(eventsContract, jobsPorts.port2, { peer: 'jobs' });
  const bridge = unwrap(await bridgeEvents(jobs.client, mainBus));

  const rendererPorts = channel();
  serveRpc(eventsRouter(mainBus, { exposed: exposedToRenderer }), rendererPorts.port1, { context: {} });
  const renderer = connectRpc(eventsContract, rendererPorts.port2, { peer: 'main' }).client;
  return { jobsBus, mainBus, jobsServer, bridge, renderer };
}

/** Reads events into an array until stopped. */
function collect(stream: AsyncIterable<TaalcutEvent>, onEvent?: (event: TaalcutEvent) => void) {
  const events: TaalcutEvent[] = [];
  const done = (async () => {
    for await (const event of stream) {
      events.push(event);
      onEvent?.(event);
    }
  })();
  return { events, done };
}

const progressPayload = (fraction: number) => ({
  jobId: newId<'Job'>(),
  kind: 'media.probe',
  projectId: null,
  progress: { fraction, completed: fraction * 100, total: 100, unit: 'frames' as const },
});

describe('events across processes', () => {
  it('delivers a job progress event to the renderer within 100 ms of emission, two hops away', async () => {
    const { jobsBus, renderer } = await wire();
    const controller = new AbortController();
    const received = new Map<number, number>();
    const stream = await renderer.subscribe({ types: ['job.progress'] }, { signal: controller.signal });
    const reader = collect(stream, (event) => {
      if (event.type === 'job.progress')
        received.set(event.payload.progress.fraction ?? -1, performance.now());
    });

    const latencies: number[] = [];
    for (let i = 1; i <= 20; i++) {
      const fraction = i / 20;
      const sentAt = performance.now();
      jobsBus.emit('job.progress', progressPayload(fraction));
      while (!received.has(fraction) && performance.now() - sentAt < 1_000) await tick(0);
      latencies.push((received.get(fraction) ?? Number.POSITIVE_INFINITY) - sentAt);
    }
    controller.abort();
    await reader.done.catch(() => undefined);

    expect(Math.max(...latencies)).toBeLessThan(100);
    expect(reader.events).toHaveLength(20);
    expect(reader.events[0]).toMatchObject({
      type: 'job.progress',
      payload: { progress: { fraction: 0.05 } },
    });
  });

  it('keeps the emitter’s timestamp and lets main limit what reaches the renderer', async () => {
    const { jobsBus, mainBus, renderer } = await wire(['job.progress']);
    const controller = new AbortController();
    const reader = collect(await renderer.subscribe(undefined, { signal: controller.signal }));
    const inMain: TaalcutEvent[] = [];
    mainBus.onAny((event) => inMain.push(event));

    jobsBus.publish({ type: 'job.progress', at: 1_234, payload: progressPayload(0.5) });
    jobsBus.emit('library.changed', { projectId: null, entity: 'asset', change: 'created', ids: ['a1'] });
    await tick(30);
    controller.abort();
    await reader.done.catch(() => undefined);

    expect(inMain.map((event) => event.type)).toEqual(['job.progress', 'library.changed']);
    expect(reader.events.map((event) => [event.type, event.at])).toEqual([['job.progress', 1_234]]);
  });

  it('ends the bridge with core.process_restarted when the other process dies, and quietly on stop()', async () => {
    const { jobsServer, bridge } = await wire();
    jobsServer.close();
    const ended = await bridge.done;
    expect(!ended.ok && ended.error.code).toBe('core.process_restarted');

    const stopped = await wire();
    stopped.bridge.stop();
    expect(await stopped.bridge.done).toEqual({ ok: true, value: undefined });
  });

  it('fails to bridge from a connection that is already closed', async () => {
    const bus: EventBus = createEventBus({ clock: createManualClock() });
    const { port1, port2 } = mainChannel();
    serveRpc(eventsRouter(bus), port1, { context: {} });
    const connection = connectRpc(eventsContract, port2, { peer: 'jobs' });
    connection.close();
    const result = await bridgeEvents(connection.client, bus, { types: ['job.progress'] });
    expect(!result.ok && result.error.code).toBe('core.cancelled');
  });
});
