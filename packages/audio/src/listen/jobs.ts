// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1's job kinds (F7): listening runs in the jobs process, where its models and spectrogram graphs stay open, and
 * every other process reaches it through a JobRunner. `audio.listen.analyse` is one analysis (analysis/schema.ts);
 * `audio.listen.query` is a model question about up to 60 sources, by operation (analysis/queries.ts and the lanes'
 * LISTEN_EXTENSIONS.queries). Both run on the GPU lane `audio.listen`, one at a time, so one set of sessions serves
 * them. An analysis is idempotent by content hash only: without one, a file may have changed under its path.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  defineJobKind,
  err,
  ok,
  registerJob,
  type AsyncResult,
  type JobRegistration,
  type JobRunner,
  type JobRunOptions,
  type RetryPolicy,
} from '@taalcut/core';
import { z } from 'zod';
import { AUDIO_JOB_STAGES, reportStage } from '../jobs/kinds';
import type { AnalyseSoundRequest } from './analysis/analyse';
import type { ListenQueryOp } from './analysis/extensions';
import { listenSourceRefSchema, type ListenSourceRef } from './analysis/queries';
import {
  listenAnalyseInputSchema,
  soundAnalysisSchema,
  type ListenAnalyseInput,
  type SoundAnalysis,
} from './analysis/schema';
import { ListenBadInput } from './errors';

const RETRY: RetryPolicy = { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 500 } };

/** The jobs' share of the GPU: one listening job at a time (one set of sessions, the 8 GB rule). */
export const LISTEN_JOB_LANE = 'audio.listen';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const audioListenAnalyseJob = defineJobKind({
  kind: 'audio.listen.analyse',
  input: listenAnalyseInputSchema,
  output: soundAnalysisSchema,
  resource: 'gpu',
  lane: LISTEN_JOB_LANE,
  priority: 'low',
  retry: RETRY,
  timeoutMs: 600_000,
  resumable: true,
  idempotencyKey: (input) => {
    if (!input.contentHash) return `audio.listen.analyse:once:${randomUUID()}`;
    const { path: _path, install: _install, ...asked } = input;
    return `audio.listen.analyse:${digest(asked)}`;
  },
});

/** An operation's name ('describe', 'match', 'rank', 'compare', or a lane's). */
export const listenQueryOpSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*$/)
  .max(40);

export const listenQueryInputSchema = z.object({
  op: listenQueryOpSchema,
  /** EAR1-B2: an operation over shipped embeddings (the SFX bank) may take none; each op checks its own count. */
  sources: z.array(listenSourceRefSchema).max(60),
  /** Checked by the operation's own schema in the jobs process. */
  params: z.unknown(),
});
export type ListenQueryInput = z.output<typeof listenQueryInputSchema>;

/** The operation's result, as plain JSON: `runListenQuery` hands it back typed. */
export const listenQueryOutputSchema = z.object({ op: listenQueryOpSchema, result: z.unknown() });

export const audioListenQueryJob = defineJobKind({
  kind: 'audio.listen.query',
  input: listenQueryInputSchema,
  output: listenQueryOutputSchema,
  resource: 'gpu',
  lane: LISTEN_JOB_LANE,
  priority: 'normal',
  retry: RETRY,
  timeoutMs: 600_000,
  resumable: true,
  idempotencyKey: () => `audio.listen.query:once:${randomUUID()}`,
});

/** What the jobs need: the process's listen service (analysis/service.ts), or a fake in tests. */
export interface ListenJobDeps {
  analyse(request: AnalyseSoundRequest): AsyncResult<SoundAnalysis>;
  query(
    op: string,
    sources: readonly ListenSourceRef[],
    params: unknown,
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<unknown>;
}

export function createListenJobs(deps: ListenJobDeps): readonly JobRegistration[] {
  return [
    registerJob(audioListenAnalyseJob, async (input, context) => {
      reportStage(context, 0, AUDIO_JOB_STAGES.measuring);
      const analysed = await deps.analyse({ ...input, signal: context.signal });
      if (analysed.ok) reportStage(context, 1, AUDIO_JOB_STAGES.measuring);
      return analysed;
    }),
    registerJob(audioListenQueryJob, async (input, context) => {
      reportStage(context, 0, AUDIO_JOB_STAGES.measuring);
      const answered = await deps.query(input.op, input.sources, input.params, { signal: context.signal });
      if (!answered.ok) return answered;
      reportStage(context, 1, AUDIO_JOB_STAGES.measuring);
      return ok({ op: input.op, result: answered.value });
    }),
  ];
}

/** An analysis through the jobs queue (any process with a JobRunner). */
export function runListenAnalyse(
  runner: Pick<JobRunner, 'run'>,
  input: ListenAnalyseInput,
  options: JobRunOptions = {},
): AsyncResult<SoundAnalysis> {
  return runner.run(audioListenAnalyseJob, input, options);
}

/** One operation through the jobs queue: its params checked here first, its result typed as the operation's. */
export async function runListenQuery<P, R>(
  runner: Pick<JobRunner, 'run'>,
  op: ListenQueryOp<P, R>,
  sources: readonly ListenSourceRef[],
  params: P,
  options: JobRunOptions = {},
): AsyncResult<R> {
  const parsed = op.params.safeParse(params);
  if (!parsed.success)
    return err(ListenBadInput(undefined, { detail: z.prettifyError(parsed.error).slice(0, 500) }));
  const ran = await runner.run(audioListenQueryJob, { op: op.op, sources: [...sources], params }, options);
  if (!ran.ok) return ran;
  return ok(ran.value.result as R);
}
