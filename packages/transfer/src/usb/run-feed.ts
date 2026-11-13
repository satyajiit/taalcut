// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Run snapshots: the current value first, then at most four progress updates a second. */
import type { Clock, DeviceRun } from '@taalcut/core';
import { TRANSFER_LIMITS } from '../limits';
import { createQueue } from '../session/queue';
import { toDeviceRun, type RunRecord } from './run-store';
import type { Schedule } from './schedule';

export type RunTick = 'now' | 'progress';

interface FeedHost {
  readonly clock: Clock;
  readonly schedule: Schedule;
  changed(): void;
  get(id: string): RunRecord | undefined;
  inflight(id: string): number;
}

interface Sub {
  queue: ReturnType<typeof createQueue<DeviceRun>>;
  pending: DeviceRun | null;
  timer: { cancel(): void } | null;
  last: number;
}

export function createRunFeed(host: FeedHost) {
  const subs = new Map<string, Sub[]>();
  const samples = new Map<string, { at: number; bytes: number }[]>();
  let devicesTimer: { cancel(): void } | null = null;
  let devicesLast = 0;

  function present(run: RunRecord): DeviceRun {
    const view = toDeviceRun(run);
    if (run.state !== 'running') {
      samples.delete(run.id);
      return view;
    }
    const extra = Math.max(0, host.inflight(run.id));
    const bytesDone = Math.min(run.totals.bytes, run.totals.bytesDone + extra);
    const at = host.clock.now();
    let recent = samples.get(run.id) ?? [];
    if (recent.length > 0 && bytesDone < recent[recent.length - 1]!.bytes) recent = [];
    while (recent.length > 1 && recent[1]!.at < at - 5000) recent.shift();
    const first = recent[0];
    if (!recent.length || recent[recent.length - 1]!.at < at) recent.push({ at, bytes: bytesDone });
    samples.set(run.id, recent);
    if (!first || at === first.at) return { ...view, totals: { ...run.totals, bytesDone } };
    const rate = Math.floor((Math.max(0, bytesDone - first.bytes) * 1000) / (at - first.at));
    const left = Math.max(0, run.totals.bytes - bytesDone);
    return {
      ...view,
      totals: { ...run.totals, bytesDone },
      bytesPerSecond: rate,
      ...(rate > 0 ? { etaMs: Math.floor((left * 1000) / rate) } : {}),
    };
  }

  function emit(id: string, kind: RunTick): void {
    const run = host.get(id);
    if (!run) return;
    const snap = present(run);
    const immediate = kind === 'now' || run.state !== 'running';
    for (const sub of subs.get(id) ?? []) deliver(sub, snap, immediate);
    ping(immediate);
  }

  function deliver(sub: Sub, snap: DeviceRun, immediate: boolean): void {
    const due = host.clock.now() - sub.last >= TRANSFER_LIMITS.progressMinIntervalMs;
    if (!immediate && !due) {
      sub.pending = snap;
      if (sub.timer) return;
      const wait = TRANSFER_LIMITS.progressMinIntervalMs - (host.clock.now() - sub.last);
      sub.timer = host.schedule(Math.max(0, wait), () => {
        sub.timer = null;
        const next = sub.pending;
        sub.pending = null;
        if (!next) return;
        sub.last = host.clock.now();
        sub.queue.push(next);
        ping(false);
      });
      return;
    }
    sub.timer?.cancel();
    sub.timer = null;
    sub.pending = null;
    sub.last = host.clock.now();
    sub.queue.push(snap);
  }

  function ping(force: boolean): void {
    if (force) {
      devicesTimer?.cancel();
      devicesTimer = null;
      devicesLast = host.clock.now();
      host.changed();
      return;
    }
    const elapsed = host.clock.now() - devicesLast;
    if (elapsed >= TRANSFER_LIMITS.progressMinIntervalMs) {
      devicesLast = host.clock.now();
      host.changed();
      return;
    }
    if (devicesTimer) return;
    devicesTimer = host.schedule(TRANSFER_LIMITS.progressMinIntervalMs - elapsed, () => {
      devicesTimer = null;
      devicesLast = host.clock.now();
      host.changed();
    });
  }

  function watch(runId: string, signal: AbortSignal): AsyncIterable<DeviceRun> {
    const run = host.get(runId);
    return (async function* watched(): AsyncGenerator<DeviceRun> {
      if (!run) return;
      const queue = createQueue<DeviceRun>();
      const sub: Sub = { queue, pending: null, timer: null, last: 0 };
      const list = subs.get(runId) ?? [];
      list.push(sub);
      subs.set(runId, list);
      const stop = (): void => {
        sub.timer?.cancel();
        queue.close();
        subs.set(
          runId,
          (subs.get(runId) ?? []).filter((entry) => entry !== sub),
        );
      };
      signal.addEventListener('abort', stop, { once: true });
      queue.push(present(run));
      try {
        for (;;) {
          const next = await queue.next();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        signal.removeEventListener('abort', stop);
        stop();
      }
    })();
  }

  return { present, emit, watch };
}
