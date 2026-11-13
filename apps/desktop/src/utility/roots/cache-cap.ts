// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The media cache's cap in the jobs process (UX2 rounds 3 and 4; media SPEC "Cap"). A put that leaves the cache over
 * its cap, or a start that finds it so, enqueues `media.enforceCacheCap` 30 s later (one run for a burst of puts:
 * media's cap trigger), with the cap as Settings has it then and the originals that aren't online (their files go
 * last). The run reads the disk again, asks the library before each file goes (the cache's `release`: the files of a
 * clip a window shows, and those a stage is reading, stay) and announces what went (`media.derivedEvicted`).
 *
 * A start's run needs no grace: which clips the windows show is main's list, in the library, which this process
 * reads before each file goes (main/open-clips.ts), so a restarted process has it before it runs anything.
 */
import {
  isTerminalJobState,
  type AsyncResult,
  type EventBus,
  type JobId,
  type JobQueue,
} from '@taalcut/core';
import { createCapTrigger, mediaEnforceCacheCapJob, type DerivedCache } from '@taalcut/media';

/** What the cap needs from the rest of the jobs process. */
export interface CacheCapPorts {
  readonly queue: () => JobQueue;
  /** The cap as Settings has it now (Settings › Storage may have changed it since the start). */
  readonly capBytes: () => AsyncResult<number>;
  /** The library's: false keeps the file (a window shows its clip, or a stage of it is fed, queued or running). */
  readonly release: (key: string) => boolean;
  readonly offlineHashes: () => readonly string[];
  /** Tests wait less than the app's 30 s. */
  readonly delayMs?: number;
}

export const CAP_DELAY_MS = 30_000;

export interface CacheCap {
  /** A put left the cache over its cap. */
  overCap(): void;
  /** At start: a run after the delay, which enforces a cache already over its cap (and does nothing else). */
  checkAtStart(): void;
  stop(): void;
}

export function createCacheCap(deps: {
  readonly cache: Pick<DerivedCache, 'usage'>;
  readonly events: EventBus;
  readonly ports: CacheCapPorts;
  /** The cap the cache holds puts to: as last read, and set anew before each run. */
  readonly capBytes: () => number;
  readonly setCap: (bytes: number) => void;
  readonly log: (message: string) => void;
}): CacheCap {
  const { cache, events, ports, log } = deps;

  async function run(): Promise<void> {
    const read = await ports.capBytes();
    if (read.ok) deps.setCap(read.value);
    else log(`the cache's cap wasn't read, so the last one holds: ${read.error.code}`);
    const capBytes = deps.capBytes();
    if (cache.usage().bytes <= capBytes) return;
    const queue = ports.queue();
    const queued = await queue.enqueue({
      kind: mediaEnforceCacheCapJob.kind,
      input: { capBytes, offlineHashes: [...ports.offlineHashes()], pinned: [] },
      priority: mediaEnforceCacheCapJob.priority,
    });
    if (!queued.ok) {
      log(`media.enforceCacheCap wasn't queued: ${queued.error.code}`);
      return;
    }
    await finished(queue, queued.value.id);
    const job = await queue.get(queued.value.id);
    if (job.ok && job.value.state === 'failed') log(`media.enforceCacheCap failed: ${job.value.error?.code}`);
  }

  /** Resolves once the job has finished, however it ended. */
  function finished(queue: JobQueue, id: JobId): Promise<void> {
    return new Promise((resolve) => {
      const off = events.on('job.stateChanged', ({ payload }) => {
        if (payload.jobId !== id || !isTerminalJobState(payload.to)) return;
        off();
        resolve();
      });
      void queue.get(id).then((job) => {
        if (job.ok && !isTerminalJobState(job.value.state)) return;
        off();
        resolve();
      });
    });
  }

  const trigger = createCapTrigger({ run, delayMs: ports.delayMs ?? CAP_DELAY_MS, log });

  return {
    overCap: () => trigger.overCap(),
    checkAtStart: () => trigger.overCap(),
    stop: () => trigger.stop(),
  };
}
