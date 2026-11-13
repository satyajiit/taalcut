// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** One import run per device: pull oldest-first, pause, and resume after a crash. */
import {
  createSerialQueue,
  err,
  NotFoundError,
  ok,
  toTaalcutError,
  type AsyncResult,
  type DeviceImportRunId,
  type DeviceRun,
  type TransferDeviceId,
} from '@taalcut/core';
import { DiskFull } from '../errors';
import type { DeviceAccess } from './bridge';
import { importItem, type ItemControl } from './item-pipeline';
import { errnoOf, loadFreshness } from './ledger';
import { deviceIdFor, loadRuns, terminalItem, type RunRecord } from './run-store';
import { createRunFeed } from './run-feed';
import { createRunGate, type RunHost } from './run-gate';
import { createRunPersist } from './run-persist';
import { publicError } from './text';

export type { RunHost };

/** `run.state` is narrowed to `running` inside the pump; cancel mutates it from outside. */
function recordedState(run: RunRecord): RunRecord['state'] {
  return run.state;
}

/** Waits for the hub to see the phone again: cable out, or a lock mid-run. */
function waitsForPhone(run: RunRecord): boolean {
  return run.state === 'paused' && (run.pauseReason === 'device-gone' || run.pauseReason === 'locked');
}

function runNotFound(runId: DeviceImportRunId) {
  return NotFoundError({ entity: 'deviceImportRun', id: runId });
}

/**
 * The lan process is stopping: every live run is paused in memory, as the next process's `load` marks it, so its
 * pump ends at its next step and no device event restarts it. Nothing is saved after this, so the file keeps its
 * last save (a save in flight may already hold the pause: the same state), and the next process offers the run.
 */
function stopRuns(runs: Iterable<RunRecord>, attempts: Iterable<AbortController>): void {
  for (const run of runs) {
    if (run.state !== 'running' && !waitsForPhone(run)) continue;
    run.state = 'paused';
    run.pauseReason = 'person';
  }
  for (const attempt of attempts) attempt.abort();
}

export function createRunEngine(host: RunHost) {
  const runs = new Map<string, RunRecord>();
  const attempts = new Map<string, AbortController>();
  const inflight = new Map<string, number>();
  const deviceIds = new Map<string, TransferDeviceId>();
  const away = new Set<string>();
  const needUnplug = new Set<string>();
  const pumping = new Set<string>();
  const settled = new Map<string, Promise<void>>();
  const again = new Set<string>();
  const returning = new Set<string>();
  const pending = new Set<string>();
  /** Device ids are made one at a time, so two calls for one phone never both make one. */
  const idTurns = createSerialQueue();
  const feed = createRunFeed({
    clock: host.clock,
    schedule: host.schedule,
    changed: () => host.changed(),
    get: (id) => runs.get(id),
    inflight: (id) => inflight.get(id) ?? 0,
  });
  const saves = createRunPersist({
    stateDir: host.stateDir,
    clock: host.clock,
    schedule: host.schedule,
    emit: (id, kind) => feed.emit(id, kind),
    ...(host.log ? { log: host.log } : {}),
  });

  async function idFor(key: string): Promise<TransferDeviceId> {
    const cached = deviceIds.get(key);
    if (cached) return cached;
    // This caller gets the failure; the next device's id is still made.
    const id = await idTurns.run(() => deviceIdFor(host.stateDir, key));
    deviceIds.set(key, id);
    return id;
  }

  const gate = createRunGate(host, away, (run) => saves.now(run));

  function startPump(run: RunRecord): void {
    if (run.state !== 'running') return;
    if (pumping.has(run.id)) {
      again.add(run.id);
      return;
    }
    pumping.add(run.id);
    const done = pump(run).finally(() => {
      pumping.delete(run.id);
      settled.delete(run.id);
      if (!again.has(run.id)) return;
      again.delete(run.id);
      startPump(run);
    });
    settled.set(run.id, done);
  }

  /** Never rejects: whatever goes wrong ends as the run's state (or a log line when even that can't be saved). */
  async function pump(run: RunRecord): Promise<void> {
    try {
      await pumpItems(run);
    } catch (cause) {
      // A run that already ended (its last save failed) keeps its ending.
      if (run.state === 'running' || run.state === 'paused') {
        if (errnoOf(cause) === 'ENOSPC') {
          run.state = 'paused';
          run.pauseReason = 'disk-full';
        } else {
          run.state = 'failed';
          delete run.pauseReason;
          run.error = publicError(toTaalcutError(cause));
        }
      }
      saves.nowLogged(run);
    }
  }

  async function pumpItems(run: RunRecord): Promise<void> {
    if (!(await gate.ensureOpen(run))) return;
    const freshness = await loadFreshness(host.stateDir, run.deviceKey, host.sink, {
      ...(host.log ? { log: host.log } : {}),
    });
    while (run.state === 'running') {
      again.delete(run.id);
      const item = run.items.find((entry) => !terminalItem(entry.state));
      if (!item) {
        run.state = 'succeeded';
        delete run.pauseReason;
        delete run.error;
        await saves.now(run);
        return;
      }
      const space = await gate.spaceFor(run);
      if (run.state !== 'running') return;
      if (!space.ok) {
        await gate.park(run, space.reason);
        return;
      }
      const view = host.view(run.deviceKey);
      const session = host.session(run.deviceKey);
      if (!session || !view?.bridge || view.access !== 'ready') {
        await gate.park(
          run,
          view?.access === 'locked' || view?.access === 'not-trusted' ? 'locked' : 'device-gone',
        );
        if (!view?.connected) away.add(run.deviceKey);
        return;
      }
      const attempt = new AbortController();
      attempts.set(run.id, attempt);
      inflight.set(run.id, 0);
      const control: ItemControl = {
        pauseReason: () => (run.state === 'paused' ? (run.pauseReason ?? 'person') : null),
        cancelled: () => run.state === 'cancelled',
      };
      const step = await importItem(run, item, {
        stateDir: host.stateDir,
        stagingDir: space.dir,
        media: host.media,
        sink: host.sink,
        clock: host.clock,
        ...(host.log ? { log: host.log } : {}),
        deviceId: await idFor(run.deviceKey),
        bridge: view.bridge,
        iCloudPhotos: view.iCloudPhotos === true,
        session,
        freshness,
        signal: attempt.signal,
        control,
        onBytes: (received) => {
          inflight.set(run.id, received);
          feed.emit(run.id, 'progress');
        },
        touch: () => saves.touch(run),
      });
      attempts.delete(run.id);
      inflight.delete(run.id);
      if (recordedState(run) === 'cancelled' || step.status === 'cancelled') {
        await finishCancel(run);
        return;
      }
      if (step.status === 'paused') {
        if (run.state === 'running' && step.reason === 'person') continue;
        if (item.state === 'pulling' || item.state === 'checking') item.state = 'queued';
        if (run.state === 'running') await gate.park(run, step.reason);
        else await saves.now(run);
        const current = host.view(run.deviceKey);
        if (waitsForPhone(run) && current?.connected) needUnplug.add(run.deviceKey);
        if (!current?.connected) away.add(run.deviceKey);
        return;
      }
    }
  }

  async function finishCancel(run: RunRecord): Promise<void> {
    run.state = 'cancelled';
    delete run.pauseReason;
    for (const item of run.items) {
      if (!terminalItem(item.state)) item.state = 'cancelled';
    }
    await saves.now(run);
  }

  /** Called from hub events, which can't take a failure back: a failed open or save is logged. */
  function carryOn(run: RunRecord): void {
    tryReturn(run).catch((cause: unknown) => {
      host.log?.info(`usb run ${run.id} not resumed ${errnoOf(cause) ?? toTaalcutError(cause).code}`);
    });
  }

  async function tryReturn(run: RunRecord): Promise<void> {
    if (returning.has(run.id)) {
      pending.add(run.id);
      return;
    }
    returning.add(run.id);
    try {
      const view = host.view(run.deviceKey);
      const blocked =
        run.pauseReason === 'device-gone' && (needUnplug.has(run.deviceKey) || !away.has(run.deviceKey));
      if (waitsForPhone(run) && view?.connected && !blocked) {
        const opened = await host.open(run.deviceKey, new AbortController().signal);
        if (waitsForPhone(run) && opened.ok && opened.value.access === 'ready' && opened.value.connected) {
          away.delete(run.deviceKey);
          needUnplug.delete(run.deviceKey);
          run.state = 'running';
          delete run.pauseReason;
          await saves.now(run);
          startPump(run);
        }
      }
    } finally {
      returning.delete(run.id);
    }
    if (pending.delete(run.id)) carryOn(run);
  }

  function onBus(): void {
    for (const run of runs.values()) {
      if (waitsForPhone(run)) carryOn(run);
    }
  }

  function pauseFromOutside(run: RunRecord, reason: NonNullable<RunRecord['pauseReason']>): void {
    run.state = 'paused';
    run.pauseReason = reason;
    attempts.get(run.id)?.abort();
    saves.nowLogged(run);
  }

  return {
    /**
     * A new lan process: runs the last one left running (or waiting for the
     * phone) wait for the person's "Carry on" (transfer SPEC, "Crash or
     * quit"). Only a run paused in this process resumes by itself.
     */
    async load(): Promise<void> {
      const loaded = await loadRuns(host.stateDir);
      if (!loaded.ok) {
        host.log?.info(`usb runs unread ${loaded.error.code}`);
        return;
      }
      for (const bad of loaded.value.unreadable)
        host.log?.info(`usb run file unread ${bad.file} ${bad.code}`);
      for (const left of loaded.value.leftovers)
        host.log?.info(`usb run temp not removed ${left.file} ${left.code}`);
      for (const run of loaded.value.runs) {
        runs.set(run.id, run);
        if (run.state === 'running' || waitsForPhone(run)) {
          run.state = 'paused';
          run.pauseReason = 'person';
          saves.nowLogged(run);
        }
      }
      host.changed();
    },
    runs: (): RunRecord[] => [...runs.values()],
    present: (run: RunRecord): DeviceRun => feed.present(run),
    add(run: RunRecord): void {
      runs.set(run.id, run);
      host.changed();
      startPump(run);
    },
    async pause(runId: DeviceImportRunId): AsyncResult<DeviceRun> {
      const run = runs.get(runId);
      if (!run) return err(runNotFound(runId));
      if (run.state !== 'running') return ok(feed.present(run));
      run.state = 'paused';
      run.pauseReason = 'person';
      attempts.get(run.id)?.abort();
      const saved = await saves.nowResult(run);
      await settled.get(run.id);
      return saved.ok ? ok(feed.present(run)) : saved;
    },
    async resume(runId: DeviceImportRunId): AsyncResult<DeviceRun> {
      const run = runs.get(runId);
      if (!run) return err(runNotFound(runId));
      if (run.state !== 'paused') {
        if (run.state === 'running') startPump(run);
        return ok(feed.present(run));
      }
      if (run.pauseReason === 'disk-full' || run.pauseReason === 'originals-offline') {
        const space = await gate.spaceFor(run);
        if (!space.ok) return err(space.reason === 'disk-full' ? DiskFull() : space.error);
      }
      run.state = 'running';
      delete run.pauseReason;
      const saved = await saves.nowResult(run);
      if (!saved.ok) {
        run.state = 'paused';
        run.pauseReason = saved.error.code === 'transfer.disk_full' ? 'disk-full' : 'person';
        return saved;
      }
      startPump(run);
      return ok(feed.present(run));
    },
    async cancel(runId: DeviceImportRunId): AsyncResult<DeviceRun> {
      const run = runs.get(runId);
      if (!run) return err(runNotFound(runId));
      if (run.state === 'succeeded' || run.state === 'failed' || run.state === 'cancelled')
        return ok(feed.present(run));
      run.state = 'cancelled';
      delete run.pauseReason;
      for (const item of run.items) {
        if (!terminalItem(item.state)) item.state = 'cancelled';
      }
      attempts.get(run.id)?.abort();
      const saved = await saves.nowResult(run);
      await settled.get(run.id);
      return saved.ok ? ok(feed.present(run)) : saved;
    },
    watch: (runId: DeviceImportRunId, signal: AbortSignal): AsyncIterable<DeviceRun> =>
      feed.watch(runId, signal),
    noteRemoved(key: string, locked: boolean): void {
      away.add(key);
      needUnplug.delete(key);
      for (const run of runs.values()) {
        if (run.deviceKey !== key) continue;
        if (run.state === 'running') pauseFromOutside(run, locked ? 'locked' : 'device-gone');
        else if (run.state === 'paused' && locked && run.pauseReason === 'device-gone') {
          run.pauseReason = 'locked';
          saves.nowLogged(run);
        }
      }
    },
    noteAccess(key: string, access: DeviceAccess): void {
      if (access.state === 'locked' || access.state === 'not-trusted') {
        for (const run of runs.values()) {
          if (run.deviceKey === key && run.state === 'running') pauseFromOutside(run, 'locked');
        }
        return;
      }
      if (access.state === 'ready') onBus();
    },
    onBus,
    /**
     * The lan process is stopping: runs stop, the progress saves still due are dropped, and a save in flight
     * lands before this resolves; nothing is written after. Doesn't wait for a hung import: the process exits.
     */
    async close(): Promise<void> {
      stopRuns(runs.values(), attempts.values());
      await saves.close();
    },
    hasRunning: (): boolean => [...runs.values()].some((run) => run.state === 'running'),
    unfinished: (key: string): DeviceImportRunId | null =>
      [...runs.values()].find(
        (run) => run.deviceKey === key && (run.state === 'running' || run.state === 'paused'),
      )?.id ?? null,
  };
}
