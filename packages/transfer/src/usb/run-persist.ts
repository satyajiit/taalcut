// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a run file is written. Run-level changes (running, paused, done) are
 * durable at once. Item changes are shown at once and written at most every
 * `usbRunSaveIntervalMs`: the ledger already has each item's outcome, so a
 * crash loses nothing a resumed run can't read back (item-pipeline).
 * After `close`, nothing is written: a stopped lan process leaves the run
 * file as it last saved it, for the next process to carry on. A pause,
 * resume or cancel then fails as `core.process_restarted` (retryable: the
 * next process takes it).
 */
import {
  createKeyedQueue,
  err,
  ok,
  ProcessRestartedError,
  toTaalcutError,
  type AsyncResult,
  type Clock,
  type TaalcutError,
} from '@taalcut/core';
import { DiskFull } from '../errors';
import { TRANSFER_LIMITS } from '../limits';
import { errnoOf } from './ledger';
import { recompute, saveRun, type RunRecord } from './run-store';
import type { RunTick } from './run-feed';
import type { Schedule } from './schedule';

export interface RunPersistDeps {
  readonly stateDir: string;
  readonly clock: Clock;
  readonly schedule: Schedule;
  readonly emit: (runId: string, kind: RunTick) => void;
  readonly log?: { info(line: string): void };
}

export interface RunPersist {
  /** Writes the run now (serialised per run) and then tells subscribers. Rejects when the write fails. */
  now(run: RunRecord): Promise<void>;
  /** As `now`, but a failure is a value: ENOSPC is `transfer.disk_full`; after `close`, `core.process_restarted`. */
  nowResult(run: RunRecord): AsyncResult<void>;
  /** As `now` from a place that can't return anything: a failure is logged. */
  nowLogged(run: RunRecord): void;
  /** An item moved: subscribers hear it now, the file catches up within the save interval. */
  touch(run: RunRecord): void;
  /** Drops the progress saves still due, waits for the saves in flight, and writes nothing after. */
  close(): Promise<void>;
}

export function createRunPersist(deps: RunPersistDeps): RunPersist {
  /** Each run's saves in order; the caller of a save gets its failure, and the next save still runs. */
  const saves = createKeyedQueue();
  const timers = new Map<string, { cancel(): void }>();
  let closed = false;

  function write(run: RunRecord): Promise<void> {
    // Checked when the save's turn comes, so one queued behind a save in flight at close is dropped too.
    return saves.run(run.id, () => (closed ? undefined : saveRun(deps.stateDir, run)));
  }

  function logFailure(run: RunRecord, cause: unknown): void {
    deps.log?.info(`usb run ${run.id} not saved ${errnoOf(cause) ?? toTaalcutError(cause).code}`);
  }

  async function now(run: RunRecord): Promise<void> {
    timers.get(run.id)?.cancel();
    timers.delete(run.id);
    run.updatedAt = Math.max(0, deps.clock.now());
    await write(run);
    deps.emit(run.id, 'now');
  }

  return {
    now,
    async nowResult(run) {
      if (closed) return err(ProcessRestartedError());
      try {
        await now(run);
        return ok(undefined);
      } catch (cause) {
        logFailure(run, cause);
        return err(saveFailure(cause));
      }
    },
    nowLogged(run) {
      now(run).catch((cause: unknown) => logFailure(run, cause));
    },
    touch(run) {
      run.updatedAt = Math.max(0, deps.clock.now());
      recompute(run);
      deps.emit(run.id, 'progress');
      if (closed || timers.has(run.id)) return;
      timers.set(
        run.id,
        deps.schedule(TRANSFER_LIMITS.usbRunSaveIntervalMs, () => {
          timers.delete(run.id);
          write(run).catch((cause: unknown) => logFailure(run, cause));
        }),
      );
    },
    async close() {
      closed = true;
      for (const timer of timers.values()) timer.cancel();
      timers.clear();
      await saves.settled();
    },
  };
}

/** A run file that can't be written: a full disk is the person's to fix, anything else is unknown. */
export function saveFailure(cause: unknown): TaalcutError {
  if (errnoOf(cause) === 'ENOSPC') return DiskFull();
  return toTaalcutError(cause);
}
