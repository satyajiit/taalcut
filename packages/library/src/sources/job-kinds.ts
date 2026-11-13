// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's job kinds (SPEC, "Library job kinds"). Declared here so any
 * process can enqueue them (`enqueueInTransaction`); the jobs process
 * registers their handlers (createLibraryJobs).
 */
import { createHash } from 'node:crypto';
import { defineJobKind, idSchema, NO_RETRY, type JobPriority } from '@taalcut/core';
import { z } from 'zod';
import { JOB_PRIORITY_VALUES } from '../schema/jobs';

const count = z.int().nonnegative();
const blake3Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const scanSourceInputSchema = z.object({
  sourceId: idSchema<'Source'>(),
  mode: z.enum(['full', 'paths']),
  /** Relative to the source's root. */
  paths: z.array(z.string().min(1).max(4096)).max(1000).optional(),
  via: z.enum(['scan', 'watcher']).optional(),
});
export type ScanSourceInput = z.output<typeof scanSourceInputSchema>;

export const scanSourceOutputSchema = z.object({
  seen: count,
  added: count,
  moved: count,
  missing: count,
  placeholders: count,
  skipped: count,
  unchanged: count,
  failed: count,
  end: z.enum(['done', 'offline', 'missing', 'permission-denied', 'dataless', 'source-removed']),
});

/** The base of a scan's key; a queued scan with it is reused (enqueueScan). */
export function scanKey(input: Pick<ScanSourceInput, 'sourceId' | 'mode' | 'paths'>): string {
  const paths = [...(input.paths ?? [])].sort().join('\n');
  const digest = createHash('sha256').update(paths).digest('hex').slice(0, 16);
  return `scan:${input.sourceId}:${input.mode}:${digest}`;
}

export const scanSourceJob = defineJobKind({
  kind: 'library.scanSource',
  input: scanSourceInputSchema,
  output: scanSourceOutputSchema,
  resource: 'io',
  priority: 'normal',
  // Resumable: a full scan resumes after its saved cursor.
  resumable: true,
});

export const hashAssetJob = defineJobKind({
  kind: 'library.hashAsset',
  input: z.object({ assetId: idSchema<'Asset'>(), generation: count }),
  output: z.object({
    contentHash: blake3Hex,
    /** The asset with these bytes that this one was merged into (this asset no longer exists). */
    merged: idSchema<'Asset'>().optional(),
  }),
  resource: 'io',
  priority: 'normal',
});

export const findMissingFilesJob = defineJobKind({
  kind: 'library.findMissingFiles',
  input: z.object({
    searchIn: z.string().min(1).max(4096),
    sourceId: idSchema<'Source'>().optional(),
    assetIds: z.array(idSchema<'Asset'>()).min(1).max(1000).optional(),
  }),
  output: z.object({
    candidates: z
      .array(z.object({ locationId: idSchema<'AssetLocation'>(), path: z.string(), contentHash: blake3Hex }))
      .max(5000),
    /** Media files examined. */
    searched: count,
  }),
  resource: 'io',
  priority: 'low',
  retry: NO_RETRY,
});

export const sweepStagingJob = defineJobKind({
  kind: 'library.sweepStaging',
  input: z.object({}),
  output: z.object({ imported: count, removed: count }),
  resource: 'io',
  priority: 'low',
});

export const collectJob = defineJobKind({
  kind: 'library.collect',
  input: z.object({}),
  output: z.object({ assets: count, vectors: count, autos: count, templateAssets: count, styleAssets: count }),
  resource: 'io',
  priority: 'low',
});

/** Core's priorities as the jobs table stores them. */
export function priorityValue(priority: JobPriority): number {
  return JOB_PRIORITY_VALUES[priority];
}
