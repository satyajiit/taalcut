// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The run file read back from disk is untrusted: this zod schema is the
 * only way in. The shape is what `saveRun` writes; totals are recomputed.
 */
import { z } from 'zod';
import { DEVICE_RUN_PAUSE_REASONS, DEVICE_RUN_STATES, idSchema, publicErrorSchema } from '@taalcut/core';

export const ITEM_STATES = [
  'queued',
  'pulling',
  'checking',
  'importing',
  'imported',
  'duplicate',
  'in-icloud',
  'rejected',
  'failed',
  'cancelled',
] as const;

const nullableNumber = z.number().nullable().default(null);
const nullableText = z.string().nullable().default(null);

const flagsSchema = z
  .object({
    livePhotoGroup: z.string().optional(),
    highFrameRate: z.boolean().optional(),
    timeLapse: z.boolean().optional(),
    prores: z.boolean().optional(),
    burst: z.boolean().optional(),
  })
  .default({});

export const runItemSchema = z.object({
  key: z.string(),
  itemId: z.string(),
  name: z.string(),
  kind: z.enum(['video', 'image']),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: nullableNumber,
  modifiedAt: nullableNumber,
  width: nullableNumber,
  height: nullableNumber,
  durationMs: nullableNumber,
  type: nullableText,
  album: nullableText,
  folder: nullableText,
  flags: flagsSchema,
  availability: z.enum(['local', 'cloud-only', 'unknown']).default('unknown'),
  uploadId: idSchema<'TransferUpload'>(),
  state: z.enum(ITEM_STATES).default('queued'),
  assetId: idSchema<'Asset'>().optional(),
  converted: z.boolean().default(false),
  error: publicErrorSchema.optional(),
});

export const runFileSchema = z.object({
  id: idSchema<'DeviceImportRun'>(),
  deviceKey: z.string(),
  deviceLabel: z.string().default('Phone'),
  platform: z.enum(['ios', 'android', 'other']).default('other'),
  sessionId: idSchema<'TransferSession'>(),
  bridge: z.enum(['image-capture', 'adb', 'mtp']).nullable().default(null),
  state: z.enum(DEVICE_RUN_STATES),
  pauseReason: z.enum(DEVICE_RUN_PAUSE_REASONS).optional(),
  sourceId: idSchema<'Source'>().nullable().default(null),
  startedAt: z.number().default(0),
  updatedAt: z.number().default(0),
  items: z.array(runItemSchema),
  error: publicErrorSchema.optional(),
});
