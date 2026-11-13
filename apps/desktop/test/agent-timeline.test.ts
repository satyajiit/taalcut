// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent process's `timelines` namespace and timeline commands: not served
 * until a TimelineStore is registered, then served over a port and the
 * commands on the bus. Phase 3 reads and commands are served once the port
 * each needs is registered (speech analyses, the library's originals, the
 * template store for the energy curve).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel } from 'node:worker_threads';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClockToken,
  CommandBusToken,
  connectRpc,
  createCommandBus,
  createContainer,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  err,
  EventBusToken,
  fromRpcError,
  InterchangeMediaSourceToken,
  newId,
  NotFoundError,
  ok,
  serveRpc,
  SpeechCleanupSourceToken,
  TemplateStoreToken,
  TIMELINE_COMMANDS,
  TimelineStoreToken,
  timelinesContract,
  type TimelineStore,
} from '@taalcut/core';
import { createMemoryTemplateStore } from '@taalcut/templates/test-support';
import { CASTING_CONFIG, type CastingEngine } from '@taalcut/timeline';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { UtilityConfigToken } from '../src/shared/tokens';
import { CastingEngineToken } from '../src/utility/roots/agent-casting';
import { registerExportFileSink } from '../src/utility/roots/agent-interchange';
import { registerTimelineCommands, timelinesNamespace } from '../src/utility/roots/agent-timeline';

const ports: { close(): void }[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const port of ports.splice(0)) port.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function container(store?: TimelineStore) {
  const clock = createManualClock(0);
  const root = createContainer()
    .value(ClockToken, clock)
    .value(EventBusToken, createEventBus({ clock }))
    .value(CommandBusToken, createCommandBus({ store: createMemoryAuditLogStore(), clock }));
  if (store) root.value(TimelineStoreToken, store);
  return root;
}

function client(root: ReturnType<typeof container>) {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRpc({ timelines: timelinesNamespace(root) }, port1, { context: {} });
  return connectRpc({ timelines: timelinesContract }, port2).client.timelines;
}

const emptyStore: TimelineStore = {
  create: async () => ok({} as never),
  put: async () => ok({} as never),
  get: async () => ok({} as never),
  listByProject: async () => ok([]),
  remove: async () => ok(undefined),
};

describe('agent timelines wiring', () => {
  it('answers core.not_implemented and registers nothing without a TimelineStore', async () => {
    const root = container();
    registerTimelineCommands(root);
    expect(root.resolve(CommandBusToken).list()).toEqual([]);
    const listed = await client(root)
      .listByProject({ projectId: newId<'Project'>() })
      .catch((error: unknown) => error);
    expect(fromRpcError(listed).code).toBe('core.not_implemented');
  });

  it('serves the namespace and registers the timeline and music commands once the store is there', async () => {
    const root = container(emptyStore);
    registerTimelineCommands(root);
    const names = root
      .resolve(CommandBusToken)
      .list()
      .map((command) => command.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'timeline.create',
        'timeline.swapClip',
        'timeline.restore',
        'music.choosePath',
      ]),
    );
    expect(await client(root).listByProject({ projectId: newId<'Project'>() })).toEqual([]);
  });
});

/** A store that has no timelines: every read is core.not_found. */
const missingStore: TimelineStore = {
  ...emptyStore,
  get: async (timelineId) => err(NotFoundError({ entity: 'timeline', id: timelineId })),
};

async function utilityConfig(): Promise<UtilityConfig> {
  const userData = await mkdtemp(join(tmpdir(), 'taalcut-agent-timeline-'));
  folders.push(userData);
  return {
    process: 'agent',
    dbPath: join(userData, 'library.sqlite'),
    userData,
    resourcesPath: userData,
    packaged: false,
    componentManifest: '',
  };
}

const codeOf = async (call: Promise<unknown>) =>
  fromRpcError(await call.catch((error: unknown) => error)).code;

describe('agent timelines wiring, Phase 3', () => {
  it('lists the pro export formats, and plans cleanup only once audio serves speech analyses', async () => {
    const root = container(missingStore);
    const timelines = client(root);
    expect((await timelines.interchangeFormats()).map((format) => [format.id, format.version])).toEqual([
      ['otio', '0.18.1'],
      ['fcpxml', '1.14'],
    ]);
    const timelineId = newId<'Timeline'>();
    expect(await codeOf(timelines.planCleanup({ timelineId }))).toBe('core.not_implemented');

    const served = container(missingStore).value(SpeechCleanupSourceToken, { get: async () => ok(null) });
    expect(await codeOf(client(served).planCleanup({ timelineId }))).toBe('timeline.not_found');
  });

  it('exports through the registered writers once the library serves the originals', async () => {
    const payload = {
      projectId: newId<'Project'>(),
      timelineId: newId<'Timeline'>(),
      format: 'otio' as const,
    };
    const origin = { source: 'ui', actor: 'user' } as const;

    const without = container(missingStore).value(UtilityConfigToken, await utilityConfig());
    registerExportFileSink(without);
    registerTimelineCommands(without);
    const refused = await without
      .resolve(CommandBusToken)
      .dispatch(TIMELINE_COMMANDS.exportInterchange, payload, origin);
    expect(!refused.ok && refused.error.code).toBe('core.not_implemented');

    const served = container(missingStore)
      .value(UtilityConfigToken, await utilityConfig())
      .value(InterchangeMediaSourceToken, { resolve: async () => ok(new Map()) });
    registerExportFileSink(served);
    registerTimelineCommands(served);
    const read = await served
      .resolve(CommandBusToken)
      .dispatch(TIMELINE_COMMANDS.exportInterchange, payload, origin);
    expect(!read.ok && read.error.code).toBe('timeline.not_found');
  });
});

/** Casting that never runs: the energy reads need one registered, and these timelines are never found. */
const idleEngine: CastingEngine = {
  config: CASTING_CONFIG,
  cast: async () => err(NotFoundError({ entity: 'timeline', id: 'none' })),
  hookVariants: async () => ok([]),
  alternates: async () => ok([]),
};

describe('agent timelines wiring, energy curve (P3-V12)', () => {
  const curve = {
    sections: [
      {
        fromSlotId: newId<'TemplateSlot'>(),
        toSlotId: newId<'TemplateSlot'>(),
        energy: 0.8,
        beatsPerClip: 1 as const,
        align: 'beat' as const,
      },
    ],
  };
  const payload = {
    projectId: newId<'Project'>(),
    timelineId: newId<'Timeline'>(),
    templateBaseVersion: 1,
    curve,
    picks: [],
  };
  const origin = { source: 'ui', actor: 'user' } as const;

  it('plans and applies an energy curve only once the template store is there', async () => {
    const without = container(missingStore).value(CastingEngineToken, idleEngine);
    registerTimelineCommands(without);
    expect(await codeOf(client(without).planEnergyCurve({ timelineId: payload.timelineId, curve }))).toBe(
      'core.not_implemented',
    );
    const refused = await without
      .resolve(CommandBusToken)
      .dispatch(TIMELINE_COMMANDS.applyEnergyCurve, payload, origin);
    expect(!refused.ok && refused.error.code).toBe('core.not_implemented');

    const clock = createManualClock(0);
    const served = container(missingStore)
      .value(CastingEngineToken, idleEngine)
      .value(TemplateStoreToken, createMemoryTemplateStore(clock));
    registerTimelineCommands(served);
    expect(await codeOf(client(served).planEnergyCurve({ timelineId: payload.timelineId, curve }))).toBe(
      'timeline.not_found',
    );
    const read = await served
      .resolve(CommandBusToken)
      .dispatch(TIMELINE_COMMANDS.applyEnergyCurve, payload, origin);
    expect(!read.ok && read.error.code).toBe('timeline.not_found');
  });
});
