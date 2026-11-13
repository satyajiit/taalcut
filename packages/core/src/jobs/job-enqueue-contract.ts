// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Enqueue a job without waiting for it, from another process: the agent's
 * `render.export` command starts the export job and returns at once. The
 * jobs process serves `jobEnqueueContract` over its JobQueue
 * (UTILITY_CONTRACTS.jobs.queue); main forwards it to the agent
 * (MAIN_SERVICE_CONTRACTS.agent.queue). The renderer can't enqueue: it is
 * not in the app contract.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type JobId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { implementContract, ipc, type RpcClient } from '../ipc/contract';
import { callRpc, unwrapRpc } from '../ipc/errors';
import type { JobQueue } from './job-queue';
import {
  jobRequestSchema,
  publicJobSnapshotSchema,
  type JobRequest,
  type PublicJobSnapshot,
} from './job-types';

export const jobEnqueueContract = {
  /** Validated against the kind's input in the jobs process; an idempotency key returns the live job. */
  enqueue: ipc.input(jobRequestSchema).output(publicJobSnapshotSchema),
  /** Cancels a job by id, as the queue's own cancel does (render.cancel's export job). */
  cancel: ipc.input(z.object({ id: idSchema<'Job'>() })).output(publicJobSnapshotSchema),
};

export interface JobEnqueuer {
  enqueue(request: JobRequest): AsyncResult<PublicJobSnapshot>;
  /** Optional so in-process fakes needn't have it; jobEnqueuerOverRpc always does. */
  cancel?(id: JobId): AsyncResult<PublicJobSnapshot>;
}

export const JobEnqueuerToken = createToken<JobEnqueuer>('core.jobEnqueuer');

/** Serves `queue` from the jobs process's JobQueue. The error leaves without its detail. */
export function jobEnqueueRouter(queue: Pick<JobQueue, 'enqueue' | 'cancel'>) {
  const os = implementContract(jobEnqueueContract);
  return os.router({
    enqueue: os.enqueue.handler(async ({ input }) => unwrapRpc(await queue.enqueue(input))),
    cancel: os.cancel.handler(async ({ input }) => unwrapRpc(await queue.cancel(input.id))),
  });
}

/** A JobEnqueuer in another process (the agent). `client` is read per call, so a restart is picked up. */
export function jobEnqueuerOverRpc(client: () => RpcClient<typeof jobEnqueueContract>): JobEnqueuer {
  return {
    enqueue: (request) => callRpc(client().enqueue(request)),
    cancel: (id) => callRpc(client().cancel({ id })),
  };
}
