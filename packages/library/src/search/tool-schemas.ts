// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library tools' model-facing schemas: plain zod that JSON Schema can
 * represent (the tool registry exports every input and output with
 * `unrepresentable: 'throw'`). Core's ids are `z.custom` and its times and
 * ranges transform, so the tools mirror them here — ids as ULID strings,
 * times as `{ value, rate: { num, den } }` — and convert at the boundary:
 * filters are parsed with core's `libraryFiltersSchema` inside `run`, and
 * outputs are mapped to these shapes.
 */
import {
  ASSET_KINDS,
  AVAILABILITIES,
  err,
  IMPORT_STATES,
  INDEX_MILESTONES,
  libraryFiltersSchema,
  ok,
  ORIENTATIONS,
  SHOT_ACTION_LIMITS,
  SHOT_ACTIONS,
  SOURCE_KINDS,
  SOURCE_STATUSES,
  ValidationError,
  type IndexingStatus,
  type LibraryFilters,
  type RationalTime,
  type Result,
  type SourceView,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';

/** A media time: `value` units at `rate.num / rate.den` per second (e.g. 48 at 24/1 is 2 s). */
export const plainTimeSchema = z.object({
  value: z.int(),
  rate: z.object({ num: z.int().positive(), den: z.int().positive() }),
});

export function plainTime(time: RationalTime): z.output<typeof plainTimeSchema> {
  return { value: time.value, rate: { num: time.rate.num, den: time.rate.den } };
}

const score = z.number().min(0).max(1);
const epochMs = z.int().nonnegative();

/** core's libraryFiltersSchema, mirrored in plain zod for the model. */
export const toolFiltersSchema = z.object({
  kinds: z.array(z.enum(ASSET_KINDS)).max(4).optional(),
  orientations: z.array(z.enum(ORIENTATIONS)).max(3).optional(),
  minDuration: plainTimeSchema.optional().describe('Shortest shot to return'),
  maxDuration: plainTimeSchema.optional().describe('Longest shot to return'),
  minQuality: score.optional().describe('0..1, the shot quality score'),
  capturedFrom: epochMs.optional().describe('Capture time from (epoch ms)'),
  capturedTo: epochMs.optional().describe('Capture time to (epoch ms)'),
  sourceIds: z.array(ulidSchema('Source')).max(50).optional(),
  languages: z
    .array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/))
    .max(8)
    .optional()
    .describe('Spoken languages, BCP 47 (en, hi, es, pt-BR)'),
  hasSpeech: z.boolean().optional(),
  availability: z.array(z.enum(AVAILABILITIES)).max(4).optional(),
  bestTakesOnly: z.boolean().optional().describe('Default true: one shot per near-duplicate group'),
  includeTrashed: z.boolean().optional(),
  indexStates: z
    .array(z.enum(['waiting', 'indexing', 'done', 'failed']))
    .max(4)
    .optional(),
  actions: z
    .array(z.string().min(1).max(SHOT_ACTION_LIMITS.chars))
    .min(1)
    .max(10)
    .optional()
    .describe(
      `Shots where people are doing any of these, lowercase -ing words: ${SHOT_ACTIONS.join(', ')}; or another short -ing phrase`,
    ),
  tripIds: z
    .array(ulidSchema('Trip'))
    .min(1)
    .max(20)
    .optional()
    .describe("Clips from any of these trips: trip ids from library.getAsset's trip"),
  countries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .min(1)
    .max(20)
    .optional()
    .describe('Clips filmed in any of these countries, ISO codes (IN, PT, BR), known from their location'),
  cityIds: z
    .array(z.int().positive())
    .min(1)
    .max(20)
    .optional()
    .describe("Clips filmed in or near any of these cities: city ids from library.getAsset's place"),
});

/** The model's filters as core's LibraryFilters (ids and times checked by core). */
export function parseFilters(
  filters: z.output<typeof toolFiltersSchema> | undefined,
): Result<LibraryFilters | undefined> {
  if (filters === undefined) return ok(undefined);
  const parsed = libraryFiltersSchema.safeParse(filters);
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'filters' }, { detail: parsed.error.message }));
}

const count = z.int().nonnegative();
const countsSchema = z.object({
  assets: count,
  done: count,
  active: count,
  waiting: count,
  failed: count,
  /** Round IX: assets search finds by what they show and say (counted across the others). */
  searchable: count.optional(),
});

/** core's indexingStatusSchema, mirrored. */
export const toolIndexingStatusSchema = z.object({
  paused: z.boolean(),
  overall: countsSchema,
  sources: z
    .array(
      z.object({
        sourceId: ulidSchema('Source'),
        state: z.enum(IMPORT_STATES),
        counts: countsSchema,
        stages: z
          .array(
            z.object({
              stage: z.string(),
              done: count,
              left: count,
              failed: count,
              milestone: z.enum(INDEX_MILESTONES).optional(),
            }),
          )
          .max(16),
        etaMs: count.nullable(),
        jobIds: z.array(ulidSchema('Job')).max(64),
        updatedAt: count,
      }),
    )
    .max(200),
  etaMs: count.nullable(),
  updatedAt: count,
});

export function toolIndexingStatus(status: IndexingStatus): z.output<typeof toolIndexingStatusSchema> {
  return {
    paused: status.paused,
    overall: { ...status.overall },
    sources: status.sources.map((s) => ({
      sourceId: s.sourceId,
      state: s.state,
      counts: { ...s.counts },
      stages: s.stages.map((stage) => ({ ...stage })),
      etaMs: s.etaMs,
      jobIds: [...s.jobIds],
      updatedAt: s.updatedAt,
    })),
    etaMs: status.etaMs,
    updatedAt: status.updatedAt,
  };
}

const fromDisk = <T extends z.ZodType>(schema: T) => schema.meta({ untrusted: 'file-system' });

/** core's sourceViewSchema, mirrored; a scan error is reduced to its code. */
export const toolSourceViewSchema = z.object({
  id: ulidSchema('Source'),
  kind: z.enum(SOURCE_KINDS),
  name: fromDisk(z.string()),
  status: z.enum(SOURCE_STATUSES),
  path: fromDisk(z.string().nullable()),
  watch: z.boolean(),
  scan: z.object({
    state: z.enum(['idle', 'scanning', 'error']),
    lastScanAt: epochMs.nullable(),
    errorCode: z.string().optional(),
  }),
  assets: count,
  missing: count,
  createdAt: epochMs,
});

export function toolSourceView(view: SourceView): z.output<typeof toolSourceViewSchema> {
  return {
    id: view.id,
    kind: view.kind,
    name: view.name,
    status: view.status,
    path: view.path,
    watch: view.watch,
    scan: {
      state: view.scan.state,
      lastScanAt: view.scan.lastScanAt,
      ...(view.scan.error ? { errorCode: view.scan.error.code } : {}),
    },
    assets: view.assets,
    missing: view.missing,
    createdAt: view.createdAt,
  };
}
