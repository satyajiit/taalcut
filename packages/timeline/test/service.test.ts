// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** timelinesContract over a port: get, list, watch (current, then each revision) and findAlternates. */
import {
  connectRpc,
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  forwardCommandEvents,
  fromRpcError,
  newId,
  serveRpc,
  timelinesContract,
  timelinesRouter,
  type CommandOrigin,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { assemble } from '../src/assembly/assemble';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createTimelineCommands } from '../src/commands/commands';
import { createTimelineService } from '../src/service/service';
import { memoryTemplateReader } from '../src/service/templates';
import { world } from './fixtures/casting';
import { mainChannel } from './fixtures/ports';
import { createMemoryTimelineStore } from './fixtures/store';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

async function setup() {
  const { template, engine, profiles } = world({ slots: 4, perSlot: 4, distractors: 12, seed: 31 });
  const clock = createManualClock(5);
  const events = createEventBus({ clock });
  const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock });
  forwardCommandEvents(bus, events);
  const store = createMemoryTimelineStore();
  bus.register(
    ...createTimelineCommands({ store, events, clock, catalog: createMemoryShotCatalog(profiles) }).all,
  );
  const templates = memoryTemplateReader([template]);
  const service = createTimelineService({ store, events, engine, templates });
  const projectId = newId<'Project'>();
  const cast = await engine.cast({ projectId, template, mode: 'template', variants: 1, seed: 1 });
  if (!cast.ok) throw new Error(cast.error.code);
  const timeline = assemble(
    {
      projectId,
      template,
      variant: cast.value.variants[0]!,
      cast: {
        castId: cast.value.castId,
        mode: 'template',
        variantIndex: 0,
        variantCount: 1,
        configVersion: 'casting.v4',
      },
      timelineId: newId<'Timeline'>(),
      name: 'Variant 1',
      now: 1,
    },
    { item: () => newId<'TimelineItem'>() },
  );
  if (!timeline.ok) throw new Error(timeline.error.code);
  const created = await bus.dispatch('timeline.create', { projectId, timelines: [timeline.value] }, ui);
  if (!created.ok) throw new Error(created.error.code);
  const { port1, port2 } = mainChannel();
  serveRpc(timelinesRouter(service), port1, { context: {} });
  const client = connectRpc(timelinesContract, port2, { peer: 'agent' }).client;
  return { bus, service, client, timeline: timeline.value, projectId, template, store };
}

describe('the timelines service', () => {
  it('reads, lists and finds alternates over IPC', async () => {
    const { client, timeline, projectId } = await setup();
    expect((await client.get({ timelineId: timeline.id })).revision).toBe(1);
    expect(await client.listByProject({ projectId })).toMatchObject([{ id: timeline.id, clipCount: 4 }]);
    const slot = timeline.cast!.slots[1]!;
    const alternates = await client.findAlternates({
      timelineId: timeline.id,
      slotId: slot.slotId,
      limit: 3,
    });
    expect(alternates).toHaveLength(3);
    const used = timeline.cast!.slots.map((entry) => entry.pick!.shotId);
    for (const alternate of alternates) expect(used).not.toContain(alternate.shotId);
    const missing = await client.get({ timelineId: newId<'Timeline'>() }).catch(fromRpcError);
    expect(missing).toMatchObject({ code: 'timeline.not_found' });
  });

  it('watches: the current document, then every revision, until aborted', async () => {
    const { bus, client, timeline, projectId } = await setup();
    const controller = new AbortController();
    const stream = await client.watch({ timelineId: timeline.id }, { signal: controller.signal });
    const seen: Timeline[] = [];
    const reading = (async () => {
      for await (const next of stream) {
        seen.push(next);
        if (seen.length === 3) break;
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const clipId = timeline.cast!.slots[0]!.clipId!;
    await bus.dispatch('timeline.lockClip', { projectId, timelineId: timeline.id, clipId, locked: true }, ui);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await bus.undo(projectId, ui);
    await reading;
    controller.abort();
    expect(seen.map((doc) => doc.revision)).toEqual([1, 2, 3]);
  });

  it('ends a watch with timeline.not_found when the timeline goes', async () => {
    const { bus, service, timeline, projectId } = await setup();
    const controller = new AbortController();
    const iterator = service.watch(timeline.id, controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.revision).toBe(1);
    const pending = iterator.next();
    await bus.undo(projectId, ui);
    await expect(pending).rejects.toMatchObject({ code: 'timeline.not_found' });
  });

  it('does not miss a commit during the initial read', async () => {
    const { bus, service, timeline, projectId, store } = await setup();
    const reading = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const get = store.get.bind(store);
    vi.spyOn(store, 'get').mockImplementationOnce(async (id) => {
      const before = await get(id);
      reading.resolve();
      await release.promise;
      return before;
    });
    const controller = new AbortController();
    const iterator = service.watch(timeline.id, controller.signal)[Symbol.asyncIterator]();
    const first = iterator.next();
    await reading.promise;
    await bus.dispatch(
      'timeline.lockClip',
      {
        projectId,
        timelineId: timeline.id,
        clipId: timeline.cast!.slots[0]!.clipId!,
        locked: true,
      },
      ui,
    );
    release.resolve();
    expect((await first).value?.revision).toBe(1);
    expect((await iterator.next()).value?.revision).toBe(2);
    controller.abort();
    await iterator.next();
  });

  it('retains commits while the consumer is paused at the initial yield', async () => {
    const { bus, service, timeline, projectId } = await setup();
    const controller = new AbortController();
    const iterator = service.watch(timeline.id, controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value?.revision).toBe(1);
    await bus.dispatch(
      'timeline.lockClip',
      {
        projectId,
        timelineId: timeline.id,
        clipId: timeline.cast!.slots[0]!.clipId!,
        locked: true,
      },
      ui,
    );
    expect((await iterator.next()).value?.revision).toBe(2);
    controller.abort();
    await iterator.next();
  });

  it('answers findAlternates without casting wired, or without a template, with an error', async () => {
    const { store, timeline, service } = await setup();
    const bare = createTimelineService({ store, events: createEventBus({ clock: createManualClock(0) }) });
    const slotId = timeline.cast!.slots[0]!.slotId;
    const off = await bare.findAlternates({ timelineId: timeline.id, slotId, exclude: [], limit: 6 });
    expect(!off.ok && off.error.code).toBe('core.not_implemented');
    store.docs.set(timeline.id, { ...store.docs.get(timeline.id)!, template: null });
    const none = await service.findAlternates({ timelineId: timeline.id, slotId, exclude: [], limit: 6 });
    expect(!none.ok && none.error.code).toBe('timeline.template_not_found');
  });
});
