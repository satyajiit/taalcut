// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `sandbox.run` job kind: how the agent process's sandbox starts a child
 * in the jobs process (children never start in the agent process). Only the
 * agent's programs, offline, within the default limits; the reference
 * fetcher has its own job (templates.fetchReference) in the jobs process.
 */
import {
  AGENT_SANDBOX_PROGRAMS,
  DEFAULT_SANDBOX_LIMITS,
  defineJobKind,
  idSchema,
  NO_RETRY,
  ok,
  registerJob,
  type ExperimentSandbox,
  type JobRegistration,
} from '@taalcut/core';
import { z } from 'zod';
import { MAX_INPUTS } from './validate';

const limits = DEFAULT_SANDBOX_LIMITS;

export const sandboxLimitsSchema = z
  .object({
    cpuSeconds: z.int().min(1).max(limits.cpuSeconds),
    wallMs: z.int().min(100).max(limits.wallMs),
    diskBytes: z.int().min(1).max(limits.diskBytes),
    maxFileBytes: z.int().min(1).max(limits.maxFileBytes),
    threads: z.int().min(1).max(limits.threads),
  })
  .partial();

export const sandboxRunRequestSchema = z.object({
  program: z.enum(AGENT_SANDBOX_PROGRAMS),
  args: z.array(z.string().max(8192)).max(512),
  inputs: z.array(z.string().min(1).max(4096)).max(MAX_INPUTS).optional(),
  limits: sandboxLimitsSchema.optional(),
  network: z.literal('none').optional(),
});

export const sandboxRunResultSchema = z.object({
  exitCode: z.int(),
  stdout: z.string().meta({ untrusted: 'sandbox' }),
  stderrTail: z.string().meta({ untrusted: 'sandbox' }),
  durationMs: z.number().nonnegative(),
  written: z.array(z.object({ path: z.string(), bytes: z.int().nonnegative() })),
});

export const sandboxRunJob = defineJobKind({
  kind: 'sandbox.run',
  input: z.object({ experimentId: idSchema<'Experiment'>(), request: sandboxRunRequestSchema }),
  output: sandboxRunResultSchema,
  resource: 'cpu',
  priority: 'high',
  retry: NO_RETRY,
  // The request's wall clock plus 10 s; requests can't raise it above the default.
  timeoutMs: limits.wallMs + 10_000,
  resumable: false,
});

/** The jobs process registers this with its exec-mode sandbox. */
export function createSandboxJobs(sandbox: ExperimentSandbox): JobRegistration[] {
  return [
    registerJob(sandboxRunJob, async (input, context) => {
      const result = await sandbox.run(input.experimentId, input.request, {
        signal: context.signal,
        onProgress: (progress) => context.progress(progress),
      });
      return result.ok ? ok({ ...result.value, written: [...result.value.written] }) : result;
    }),
  ];
}
