// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A JobRunner across processes. The jobs process serves `jobRunnerContract`
 * over its engine (jobRunnerRouter); main forwards it to the agent process,
 * whose tools use jobRunnerOverRpc as their JobRunner. A run is one
 * streaming call: progress items, then the output. Cancelling the call
 * (the tool's signal) cancels the job; failures arrive as TaalcutErrors.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { CancelledError, NotFoundError, ValidationError } from '../basics/errors';
import { idSchema } from '../basics/ids';
import { err, ok, type AsyncResult, type Result } from '../basics/result';
import { eventIterator, implementContract, ipc, type RpcClient } from '../ipc/contract';
import { fromRpcError, toRpcError, unwrapRpc } from '../ipc/errors';
import type { JobKind } from './job-kind';
import type { JobRegistration, JobRunner, JobRunOptions } from './job-runner';
import { JOB_PRIORITIES, jobKindSchema, jobProgressSchema, type JobProgress } from './job-types';

export const jobRunItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), progress: jobProgressSchema }),
  /** The last item: the job's output, which the caller validates with its kind's schema. */
  z.object({ type: z.literal('done'), output: z.unknown() }),
]);
export type JobRunItem = z.output<typeof jobRunItemSchema>;

/** The job runner's stream: the job's id once it is enqueued (or matched by its key), progress, then `done`. */
export const jobRunnerItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enqueued'), jobId: idSchema<'Job'>() }),
  ...jobRunItemSchema.options,
]);
export type JobRunnerItem = z.output<typeof jobRunnerItemSchema>;

export const jobRunnerContract = {
  /** Runs a registered kind by name. Unknown kind: core.not_found. */
  run: ipc
    .input(
      z.object({
        kind: jobKindSchema,
        input: z.unknown(),
        priority: z.enum(JOB_PRIORITIES).optional(),
        idempotencyKey: z.string().min(1).max(512).optional(),
        projectId: idSchema<'Project'>().nullable().optional(),
        /** JobRunOptions.parentJobId: the running job this one is part of; it runs in that job's slot. */
        parentJobId: idSchema<'Job'>().optional(),
      }),
    )
    .output(eventIterator(jobRunnerItemSchema)),
};

/**
 * Progress pushed from a callback, read as an async sequence until `done` settles; returns its value.
 * For routers that serve a long call as progress items then an output (the job runner, the render worker).
 * `send` queues another item in order with the progress (the runner's `enqueued`).
 */
export async function* progressUntil<T, E = never>(
  start: (push: (progress: JobProgress) => void, send: (item: E) => void) => Promise<T>,
): AsyncGenerator<JobRunItem | E, T> {
  const pending: (JobRunItem | E)[] = [];
  let wake: (() => void) | undefined;
  const send = (item: JobRunItem | E) => {
    pending.push(item);
    wake?.();
  };
  const push = (progress: JobProgress) => send({ type: 'progress', progress });
  let settled = false;
  const done = start(push, send).finally(() => {
    settled = true;
    wake?.();
  });
  while (!settled || pending.length > 0) {
    if (pending.length > 0) {
      yield pending.shift()!;
      continue;
    }
    await new Promise<void>((resolve) => (wake = resolve));
    wake = undefined;
  }
  return done;
}

/** Serves `runner` for the kinds registered in this process, looked up by name. */
export function jobRunnerRouter(runner: JobRunner, registrations: readonly Pick<JobRegistration, 'kind'>[]) {
  const byName = new Map(registrations.map(({ kind }) => [kind.kind, kind]));
  const os = implementContract(jobRunnerContract);
  return os.router({
    run: os.run.handler(async function* ({ input, signal }) {
      const kind = byName.get(input.kind);
      if (!kind) throw toRpcError(NotFoundError({ entity: 'job kind', id: input.kind }));
      const options: JobRunOptions = {
        ...(signal ? { signal } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}),
      };
      const result = yield* progressUntil<Result<unknown>, Extract<JobRunnerItem, { type: 'enqueued' }>>(
        (onProgress, send) =>
          runner.run(kind, input.input, {
            ...options,
            onProgress,
            onEnqueued: (jobId) => send({ type: 'enqueued', jobId }),
          }),
      );
      yield { type: 'done', output: unwrapRpc(result) };
    }),
  });
}

/** A JobRunner whose jobs run in another process (the agent process's runner). */
export function jobRunnerOverRpc(client: () => RpcClient<typeof jobRunnerContract>): JobRunner {
  return {
    async run<I, O>(kind: JobKind<I, O>, input: NoInfer<I>, options: JobRunOptions = {}): AsyncResult<O> {
      const { signal, onProgress, onEnqueued } = options;
      if (signal?.aborted) return err(CancelledError());
      const request = {
        kind: kind.kind,
        input,
        ...(options.priority ? { priority: options.priority } : {}),
        ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
        ...(options.parentJobId ? { parentJobId: options.parentJobId } : {}),
      };
      try {
        const stream = await client().run(request, signal ? { signal } : {});
        for await (const item of stream) {
          if (item.type === 'enqueued') {
            onEnqueued?.(item.jobId);
            continue;
          }
          if (item.type === 'progress') {
            onProgress?.(item.progress);
            continue;
          }
          const output = kind.output.safeParse(item.output);
          if (output.success) return ok(output.data);
          return err(ValidationError({ field: 'output' }, { detail: z.prettifyError(output.error) }));
        }
        return err(CancelledError());
      } catch (cause) {
        return err(fromRpcError(cause));
      }
    },
  };
}
