// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DeviceService: the hub, one catalogue per phone, and resumable imports through ImportSink.
 * The hub watches while a devices stream is open or a run needs the phone (running, or paused
 * until it comes back), so closing the Cable screen doesn't stop an import.
 */
import { existsSync } from 'node:fs';
import {
  err,
  newId,
  ok,
  ProcessRestartedError,
  NotFoundError,
  type AsyncResult,
  type Clock,
  type DeviceImportRunId,
  type DeviceRun,
  type DeviceSelection,
  type DeviceView,
  type DevicesState,
  type EventBus,
  type ImportSink,
} from '@taalcut/core';
import type { TransferMedia } from '../deps';
import type { DeviceBridge, DeviceItemsPage, DeviceService, DeviceSummary, UsbWatcher } from './bridge';
import { ensureCatalogue, loadSessionCatalogue, type Catalogue } from './device-catalogue';
import { itemKey } from './device-key';
import { createDeviceStreams } from './device-streams';
import { RunInProgress } from './errors';
import { createDeviceHub } from './hub';
import { accessError } from './hub-view';
import { createRunEngine } from './import-run';
import { pageItems, summarise } from './listing';
import { loadFreshness } from './ledger';
import { ensureFree, resolveSelection } from './selection';
import { itemFromDevice, recompute, type RunRecord } from './run-store';
import { defaultSchedule, type Schedule } from './schedule';
import { clearThumbs, createThumbPool, thumbPath } from './thumbs';

const EMPTY_TOTALS: RunRecord['totals'] = {
  items: 0,
  bytes: 0,
  done: 0,
  bytesDone: 0,
  imported: 0,
  duplicates: 0,
  inICloud: 0,
  rejected: 0,
  failed: 0,
  converted: 0,
};

export interface DeviceServiceDeps {
  readonly bridges: readonly DeviceBridge[];
  readonly watcher: UsbWatcher;
  readonly importSink: ImportSink;
  readonly media: TransferMedia;
  readonly events: Pick<EventBus, 'emit'>;
  readonly clock: Clock;
  readonly stateDir: string;
  readonly forgetAdbKey: () => Promise<boolean>;
  readonly schedule?: Schedule;
  readonly log?: { info(line: string): void };
  readonly diskFree?: (dir: string) => Promise<number>;
}

/** A run that needs the hub watching: pulling, or paused until the phone is back or unlocked. */
function needsHub(run: RunRecord): boolean {
  if (run.state === 'running') return true;
  return run.state === 'paused' && (run.pauseReason === 'device-gone' || run.pauseReason === 'locked');
}

export function createDeviceService(deps: DeviceServiceDeps): DeviceService {
  const schedule = deps.schedule ?? defaultSchedule;
  const hub = createDeviceHub({
    bridges: deps.bridges,
    watcher: deps.watcher,
    clock: deps.clock,
    schedule,
    ...(deps.log ? { log: deps.log } : {}),
  });
  const freshnessLog = deps.log ? { log: deps.log } : {};
  const cache = new Map<string, Catalogue>();
  const thumbs = createThumbPool(deps.log);
  const thumbSignal = new AbortController().signal;
  const streams = createDeviceStreams();
  /** Devices whose thumbs the open streams may have fetched; cleared when the last stream closes. */
  const thumbKeys = new Set<string>();
  /** Devices with an importFromDevice between its in-progress check and engine.add. */
  const starting = new Set<string>();
  /** The last state each run was announced in, so every transition reaches the bus once. */
  const announced = new Map<string, RunRecord['state']>();
  let heldForRuns = false;
  /** Closed (the lan process is stopping): no new run starts. */
  let closed = false;
  const engine = createRunEngine({
    clock: deps.clock,
    sink: deps.importSink,
    media: deps.media,
    stateDir: deps.stateDir,
    schedule,
    ...(deps.log ? { log: deps.log } : {}),
    ...(deps.diskFree ? { diskFree: deps.diskFree } : {}),
    open: (key, signal) => hub.open(key, signal),
    session: (key) => hub.session(key),
    view: (key) => hub.view(key),
    changed: () => runsChanged(),
  });
  hub.listen(() => {
    engine.onBus();
    for (const view of views()) deps.events.emit('transfer.device', view);
    streams.poke();
  });
  hub.onAccess((key, access) => {
    engine.noteAccess(key, access);
    streams.poke();
  });
  hub.onRemoved((key, locked) => {
    cache.delete(key);
    engine.noteRemoved(key, locked);
    streams.poke();
  });
  const ready = engine.load();

  /** Running and paused runs go out on every change (progress); others once per new state. */
  function runsChanged(): void {
    for (const run of engine.runs()) {
      const last = announced.get(run.id);
      announced.set(run.id, run.state);
      const live = run.state === 'running' || run.state === 'paused';
      // A finished run first seen at load was announced by the process that finished it.
      if (live || (last !== undefined && last !== run.state)) {
        deps.events.emit('transfer.deviceRun', engine.present(run));
      }
    }
    holdForRuns();
    streams.poke();
  }

  function holdForRuns(): void {
    const want = engine.runs().some(needsHub);
    if (want === heldForRuns) return;
    heldForRuns = want;
    if (want) hub.retain();
    else hub.release();
  }

  function views(): DeviceView[] {
    return hub.views().map((view) => {
      const open = engine.unfinished(view.key);
      return open ? { ...view, unfinishedRunId: open } : view;
    });
  }

  function snapshot(): DevicesState {
    const devices = views();
    const active = engine.runs().filter((run) => run.state === 'running' || run.state === 'paused');
    return { devices, runs: active.slice(0, 16).map((run) => engine.present(run)) };
  }

  return {
    devices(signal) {
      return watch(signal);
    },
    openDevice(deviceKey, signal) {
      return open(deviceKey, signal);
    },
    deviceItems(input, signal) {
      return items(input, signal);
    },
    deviceSummary(input) {
      return summary(input);
    },
    importFromDevice(input, signal) {
      return begin(input, signal);
    },
    async deviceRunItems(input) {
      await ready;
      const run = engine.runs().find((value) => value.id === input.runId);
      if (!run) return err(NotFoundError({ entity: 'deviceImportRun', id: input.runId }));
      const parsed = input.cursor ? Number(input.cursor) : 0;
      const start = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
      const end = start + input.limit;
      return ok({
        items: run.items.slice(start, end).map((item) => ({
          key: item.key,
          name: item.name,
          sizeBytes: item.sizeBytes,
          state: item.state,
          assetId: item.assetId ?? null,
          sourceId: run.sourceId,
          error: item.error ?? null,
        })),
        ...(end < run.items.length ? { nextCursor: String(end) } : {}),
      });
    },
    deviceRun(runId, signal) {
      return follow(runId, signal);
    },
    pauseDeviceImport: (runId) => engine.pause(runId),
    resumeDeviceImport: (runId) => engine.resume(runId),
    cancelDeviceImport: (runId) => engine.cancel(runId),
    async forgetUsbDebugKey() {
      return ok({ forgotten: await deps.forgetAdbKey() });
    },
    async close() {
      closed = true;
      thumbs.clear();
      await ready;
      await engine.close();
      heldForRuns = false;
      await hub.close();
    },
  };

  async function* watch(signal: AbortSignal): AsyncIterable<DevicesState> {
    await ready;
    if (signal.aborted) return;
    const stream = streams.open(signal);
    hub.retain();
    try {
      do {
        const failure = hub.failure();
        if (failure) throw failure;
        const state = snapshot();
        for (const device of state.devices) thumbKeys.add(device.key);
        stream.delivered();
        yield state;
      } while (await stream.next());
    } finally {
      stream.close();
      hub.release();
      if (streams.count() === 0) await dropThumbs();
    }
  }

  /** The device's stream has ended (SPEC: thumbs are cleared then). Stops if another stream opens. */
  async function dropThumbs(): Promise<void> {
    thumbs.clear();
    for (const key of [...thumbKeys]) {
      if (streams.count() > 0) return;
      thumbKeys.delete(key);
      const cleared = await clearThumbs(deps.stateDir, key);
      if (!cleared.ok) deps.log?.info(`usb ${key} thumbs not cleared ${cleared.error.code}`);
    }
  }

  async function open(deviceKey: string, signal: AbortSignal): AsyncResult<DeviceView> {
    await ready;
    hub.retain();
    try {
      const opened = await hub.open(deviceKey, signal);
      if (!opened.ok) return opened;
      const session = hub.session(deviceKey);
      if (
        session &&
        (session.access().state === 'ready' || session.ref.bridge === 'mtp' || session.rangedReads)
      ) {
        const listed = await loadSessionCatalogue(cache, deviceKey, session, signal);
        if (!listed.ok) {
          const current = views().find((item) => item.key === deviceKey) ?? opened.value;
          deps.events.emit('transfer.device', current);
          if (current.access !== 'ready') return ok(current);
          return listed;
        }
      }
      const view = views().find((item) => item.key === deviceKey) ?? opened.value;
      deps.events.emit('transfer.device', view);
      return ok(view);
    } finally {
      hub.release();
    }
  }

  async function items(
    input: {
      readonly deviceKey: string;
      readonly filter: Parameters<DeviceService['deviceItems']>[0]['filter'];
      readonly cursor?: string;
      readonly limit: number;
    },
    signal: AbortSignal,
  ): AsyncResult<DeviceItemsPage> {
    await ready;
    const resolved = await ensureCatalogue(hub, cache, input.deviceKey, signal);
    if (!resolved.ok) return resolved;
    const listed = resolved.value;
    const fresh = await loadFreshness(deps.stateDir, input.deviceKey, deps.importSink, freshnessLog);
    const page = pageItems(listed.items, input.filter, input.cursor, input.limit, fresh, (item) =>
      existsSync(thumbPath(deps.stateDir, input.deviceKey, itemKey(item.id))),
    );
    const session = hub.session(input.deviceKey);
    if (session && !starting.has(input.deviceKey) && !engine.unfinished(input.deviceKey)) {
      for (const row of page.items) {
        const raw = listed.byKey.get(row.key);
        if (!raw || row.thumb) continue;
        thumbs.fetch(session, raw.id, thumbPath(deps.stateDir, input.deviceKey, row.key), thumbSignal);
      }
    }
    return ok(page);
  }

  async function summary(input: {
    readonly deviceKey: string;
    readonly filter: Parameters<DeviceService['deviceSummary']>[0]['filter'];
  }): AsyncResult<DeviceSummary> {
    await ready;
    const listed = cache.get(input.deviceKey);
    if (!listed) return err(accessError(hub.view(input.deviceKey)));
    const fresh = await loadFreshness(deps.stateDir, input.deviceKey, deps.importSink, freshnessLog);
    return ok(summarise(listed.items, input.filter, fresh));
  }

  async function begin(
    input: { readonly deviceKey: string; readonly selection: DeviceSelection },
    signal: AbortSignal,
  ): AsyncResult<{ readonly runId: DeviceImportRunId }> {
    await ready;
    if (closed) return err(ProcessRestartedError());
    // One run per device: a second call waits for nothing and is refused, even mid-way through this one.
    if (starting.has(input.deviceKey) || engine.unfinished(input.deviceKey)) return err(RunInProgress());
    thumbs.clear();
    starting.add(input.deviceKey);
    try {
      return await prepare(input, signal);
    } finally {
      starting.delete(input.deviceKey);
    }
  }

  async function prepare(
    input: { readonly deviceKey: string; readonly selection: DeviceSelection },
    signal: AbortSignal,
  ): AsyncResult<{ readonly runId: DeviceImportRunId }> {
    const resolved = await ensureCatalogue(hub, cache, input.deviceKey, signal);
    if (!resolved.ok) return resolved;
    const view = hub.view(input.deviceKey);
    const session = hub.session(input.deviceKey);
    if (!view?.connected || view.access !== 'ready' || !session) return err(accessError(view));
    const catalogue = resolved.value;
    const fresh = await loadFreshness(deps.stateDir, input.deviceKey, deps.importSink, freshnessLog);
    const chosen = resolveSelection(catalogue.items, input.selection, fresh);
    const place = await deps.importSink.staging();
    if (!place.ok) return err(place.error);
    const bytes = chosen.reduce((sum, item) => sum + item.sizeBytes, 0);
    const free = deps.diskFree ? await deps.diskFree(place.value.dir) : place.value.freeBytes;
    const space = await ensureFree(bytes, free);
    if (!space.ok) return space;
    const now = deps.clock.now();
    const run: RunRecord = {
      id: newId<'DeviceImportRun'>(),
      deviceKey: input.deviceKey,
      deviceLabel: view.label,
      platform: view.platform,
      sessionId: newId<'TransferSession'>(),
      bridge: session.ref.bridge,
      state: 'running',
      sourceId: null,
      startedAt: now,
      updatedAt: now,
      items: chosen.map((item) => itemFromDevice(item, itemKey(item.id), newId<'TransferUpload'>())),
      totals: EMPTY_TOTALS,
    };
    recompute(run);
    engine.add(run);
    return ok({ runId: run.id });
  }

  async function* follow(runId: DeviceImportRunId, signal: AbortSignal): AsyncIterable<DeviceRun> {
    await ready;
    for await (const view of engine.watch(runId, signal)) {
      yield view;
      if (view.state === 'succeeded' || view.state === 'failed' || view.state === 'cancelled') return;
    }
  }
}
