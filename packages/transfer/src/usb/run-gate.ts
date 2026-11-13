// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Decides whether a run may pull: the phone is open, and the volume has room. */
import {
  type AsyncResult,
  type Clock,
  type DeviceRun,
  type DeviceView,
  type TaalcutError,
} from '@taalcut/core';
import type { ImportSink } from '@taalcut/core';
import type { TransferMedia } from '../deps';
import type { BridgeSession } from './bridge';
import { terminalItem, type RunRecord } from './run-store';
import type { Schedule } from './schedule';
import { ensureFree } from './selection';

export interface RunHost {
  readonly clock: Clock;
  readonly sink: ImportSink;
  readonly media: TransferMedia;
  readonly stateDir: string;
  readonly schedule: Schedule;
  readonly log?: { info(line: string): void };
  readonly diskFree?: (dir: string) => Promise<number>;
  open(key: string, signal: AbortSignal): AsyncResult<DeviceView>;
  session(key: string): BridgeSession | null;
  view(key: string): DeviceView | null;
  changed(): void;
}

type PauseReason = NonNullable<DeviceRun['pauseReason']>;

interface Space {
  readonly ok: true;
  readonly dir: string;
}

interface SpaceStop {
  readonly ok: false;
  readonly reason: PauseReason;
  readonly error: TaalcutError;
}

export type RunSpace = Space | SpaceStop;

export function createRunGate(host: RunHost, away: Set<string>, persist: (run: RunRecord) => Promise<void>) {
  async function spaceFor(run: RunRecord): Promise<RunSpace> {
    const staging = await host.sink.staging();
    if (!staging.ok) {
      const reason = staging.error.code === 'transfer.disk_full' ? 'disk-full' : 'originals-offline';
      return { ok: false, reason, error: staging.error };
    }
    let free = staging.value.freeBytes;
    if (host.diskFree) free = await host.diskFree(staging.value.dir);
    const remaining = run.items
      .filter((item) => !terminalItem(item.state))
      .reduce((sum, item) => sum + item.sizeBytes, 0);
    const check = await ensureFree(remaining, free);
    if (!check.ok) return { ok: false, reason: 'disk-full', error: check.error };
    return { ok: true, dir: staging.value.dir };
  }

  async function park(run: RunRecord, reason: PauseReason): Promise<void> {
    run.state = 'paused';
    run.pauseReason = reason;
    await persist(run);
  }

  async function ensureOpen(run: RunRecord): Promise<boolean> {
    if (run.items.length === 0) {
      run.state = 'succeeded';
      delete run.pauseReason;
      delete run.error;
      await persist(run);
      return false;
    }
    // Not on the bus now: parked, and carried on when the hub sees it again (import-run's tryReturn).
    if (!host.view(run.deviceKey)?.connected) {
      away.add(run.deviceKey);
      await park(run, 'device-gone');
      return false;
    }
    const opened = await host.open(run.deviceKey, new AbortController().signal);
    if (run.state !== 'running') return false;
    const locked = opened.ok && (opened.value.access === 'locked' || opened.value.access === 'not-trusted');
    if (!opened.ok || opened.value.access !== 'ready' || !opened.value.connected) {
      if (!host.view(run.deviceKey)?.connected) away.add(run.deviceKey);
      await park(run, locked ? 'locked' : 'device-gone');
      return false;
    }
    run.bridge = opened.value.bridge;
    delete run.pauseReason;
    await persist(run);
    return run.state === 'running';
  }

  return { spaceFor, ensureOpen, park };
}
