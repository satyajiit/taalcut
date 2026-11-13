// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An exclusive engine's start. The app runs one jobs process, so a running
 * job whose lease belongs to another boot id was held by an earlier instance
 * that died (the supervisor restarts it). Waiting for that lease to expire
 * would stall the job for up to a lease after every restart; this hands it
 * back to the queue at once. The store adds one to the job's `interruptions`
 * in the same atomic change; the interrupted attempt is given back while that
 * is at most `freeRestarts` and counted after, so a job that keeps taking the
 * process down still runs out of attempts. The count lives in the job row, so
 * it survives the restarts it counts.
 */
import { ProcessRestartedError, toTaalcutError } from '@taalcut/core';
import { callStore, type RunContext } from './run';
import { summarize, type JobRecord, type Takeover } from './types';

export interface TakeoverOptions {
  readonly freeRestarts: number;
  readonly log: (message: string) => void;
}

/** Hands every running job leased by another boot id back to the queue. */
export async function takeOverLeases(ctx: RunContext, options: TakeoverOptions): Promise<void> {
  for (const job of await heldElsewhere(ctx)) {
    const previousOwner = job.leaseOwner!; // heldElsewhere keeps leased jobs only
    const taken = await callStore(() =>
      ctx.store.fail(job.id, previousOwner, ProcessRestartedError({ process: 'jobs' }), {
        retryAt: ctx.clock(),
        interruption: { free: options.freeRestarts },
      }),
    );
    if (!taken.ok) {
      // Paused, cancelled or otherwise changed since the list: nothing left to take over.
      options.log(`could not take over ${job.kind} ${job.id} from ${previousOwner}: ${taken.error.code}`);
      continue;
    }
    const restarts = taken.value.interruptions;
    const takeover: Takeover = { previousOwner, restarts, attemptCounted: restarts > options.freeRestarts };
    options.log(describe(taken.value, takeover));
    ctx.emit({ type: 'job.recovered', job: summarize(taken.value), takeover });
  }
}

async function heldElsewhere(ctx: RunContext): Promise<JobRecord[]> {
  try {
    const running = await ctx.store.list({ states: ['running'], limit: 10_000 });
    return running.filter((job) => job.leaseOwner !== null && job.leaseOwner !== ctx.owner);
  } catch (cause) {
    ctx.emit({ type: 'queue.store_error', error: toTaalcutError(cause) });
    return [];
  }
}

function describe(job: JobRecord, { previousOwner, restarts, attemptCounted }: Takeover): string {
  const what = `took over ${job.kind} ${job.id} from ${previousOwner} (restart ${restarts})`;
  if (job.state === 'failed') return `${what}: out of attempts, failed`;
  return `${what}: requeued, attempt ${attemptCounted ? 'counted' : 'given back'}`;
}
