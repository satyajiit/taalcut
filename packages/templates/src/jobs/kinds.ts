// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates job kinds (SPEC "Job kinds"), plain data the agent process
 * enqueues and the jobs process runs: fetching a reference (network) and the
 * breakdown (gpu). Ids are ULID strings here so the kinds export as JSON.
 */
import {
  defineJobKind,
  NO_RETRY,
  REFERENCE_INPUTS,
  REFERENCE_PLATFORMS,
  sha256Schema,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import { BREAKDOWN_CONFIG, BREAKDOWN_PIPELINE_VERSION } from '../breakdown/config';
import { breakdownDraftSchema } from '../breakdown/draft';
import { sha256Hex } from '../store/change-key';
import { SOURCE_FETCH_LIMITS } from '../intake/source-profile';

/** RationalTime without the rate's reducing transform, so it exports to JSON Schema. */
export const plainTimeSchema = z.object({
  value: z.int(),
  rate: z.object({ num: z.int().positive(), den: z.int().positive() }),
});
const soundSchema = z
  .object({ title: z.string().max(200).nullable(), artist: z.string().max(200).nullable() })
  .nullable();

export const fetchReferenceJobInputSchema = z.object({
  experimentId: ulidSchema('Experiment'),
  url: z.string().min(1).max(2048),
});
export const fetchReferenceJobOutputSchema = z.object({
  /** Relative to the experiment. */
  file: z.string().min(1).max(512),
  bytes: z.int().nonnegative(),
  platform: z.enum(REFERENCE_PLATFORMS),
  url: z.string().max(2048),
  duration: plainTimeSchema,
  sound: soundSchema,
  /** REF1: without an account, or with the Instagram session after that failed. Absent from a fetch before REF1. */
  source: z.enum(['anonymous', 'session']).optional(),
  /** REF1: false for a silent reel. Absent from a fetch before REF1. */
  hasAudio: z.boolean().optional(),
});
export type FetchReferenceJobOutput = z.output<typeof fetchReferenceJobOutputSchema>;

export const templatesFetchReferenceJob = defineJobKind({
  kind: 'templates.fetchReference',
  input: fetchReferenceJobInputSchema,
  output: fetchReferenceJobOutputSchema,
  resource: 'network',
  priority: 'high',
  // Sites break and networks drop: one more try on retryable errors.
  retry: { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 5_000 } },
  timeoutMs: 5 * 60_000,
  resumable: false,
  idempotencyKey: (input) => sha256Hex(`${input.url}\n${input.experimentId}`),
});

export const sourceFetchJobOutputSchema = fetchReferenceJobOutputSchema.extend({
  metadata: z
    .object({
      title: z.string().max(200).optional(),
      channel: z.string().max(200).optional(),
      channelUrl: z.string().max(2048).optional(),
      uploaderId: z.string().max(200).optional(),
    })
    .optional(),
});
export type SourceFetchJobOutput = z.output<typeof sourceFetchJobOutputSchema>;

/** Long source intake has independent limits and never enters the reference-breakdown pipeline. */
export const sourceFetchJob = defineJobKind({
  kind: 'templates.fetchSource',
  input: fetchReferenceJobInputSchema,
  output: sourceFetchJobOutputSchema,
  resource: 'network',
  priority: 'high',
  retry: { maxAttempts: 2, backoff: { kind: 'fixed', delayMs: 5000 } },
  timeoutMs: SOURCE_FETCH_LIMITS.timeoutMs + 60_000,
  resumable: true,
  idempotencyKey: (input) => sha256Hex(`source\n${input.url}\n${input.experimentId}`),
});

export const breakdownJobInputSchema = z.object({
  experimentId: ulidSchema('Experiment'),
  /** A download in the experiment (relative) or the user's own file (absolute, read in place). */
  reference: z.object({ kind: z.enum(['scratch', 'file']), path: z.string().min(1).max(4096) }),
  input: z.enum(REFERENCE_INPUTS),
  platform: z.enum(REFERENCE_PLATFORMS).nullable(),
  url: z.string().max(2048).nullable(),
  sound: soundSchema,
  fingerprint: sha256Schema,
});
export type BreakdownJobInput = z.output<typeof breakdownJobInputSchema>;

export const templatesBreakdownJob = defineJobKind({
  kind: 'templates.breakdown',
  input: breakdownJobInputSchema,
  output: breakdownDraftSchema,
  resource: 'gpu',
  priority: 'high',
  retry: NO_RETRY,
  timeoutMs: 15 * 60_000,
  // Starting again is safe while the experiment exists; the handler says so when it doesn't.
  resumable: true,
  idempotencyKey: (input) =>
    sha256Hex(`${input.fingerprint}\n${BREAKDOWN_PIPELINE_VERSION}\n${BREAKDOWN_CONFIG.version}`),
});

export const templateJobKinds = [templatesFetchReferenceJob, templatesBreakdownJob, sourceFetchJob] as const;
