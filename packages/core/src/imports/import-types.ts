// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { publicErrorSchema } from '../basics/error-schema';

export const IMPORT_METHODS = [
  'files',
  'folder',
  'phone-wifi',
  'phone-cable',
  'camera',
  'dji',
  'insta360',
  'photos',
] as const;
export const importMethodSchema = z.enum(IMPORT_METHODS);
export type ImportMethod = z.output<typeof importMethodSchema>;
export const IMPORT_STAGES = ['receiving', 'checking', 'available', 'searchable', 'analysed'] as const;
export const IMPORT_SESSION_STATUSES = [
  'running',
  'paused',
  'interrupted',
  'completed',
  'partial',
  'cancelled',
  'failed',
] as const;
const count = z.int().nonnegative();
const itemId = z.string().min(1).max(200);

export const importItemSchema = z.object({
  id: itemId,
  name: z.string().min(1).max(1024),
  sizeBytes: count.nullable(),
  capturedAt: count.nullable(),
  thumbnailUrl: z.string().max(4096).nullable(),
  duplicate: z.boolean(),
  captureId: idSchema<'CaptureGroup'>().nullable(),
  required: z.boolean(),
  supported: z.boolean(),
  warning: z.string().max(200).nullable(),
});
export type ImportItem = z.output<typeof importItemSchema>;

export const captureGroupSchema = z.object({
  id: idSchema<'CaptureGroup'>(),
  kind: z.enum(['generic', 'dji', 'insta360', 'live_photo']),
  name: z.string().max(1024),
  members: z.array(
    z.object({ itemId, role: z.enum(['original', 'companion', 'preview']), required: z.boolean() }),
  ),
  missingRequired: z.array(z.string().max(1024)),
  complete: z.boolean(),
  warnings: z.array(z.string().max(200)),
});
export type CaptureGroup = z.output<typeof captureGroupSchema>;

export const importSelectionSchema = z.object({
  selectedIds: z.array(itemId).max(20000),
  selectAll: z.boolean(),
  excludedIds: z.array(itemId).max(20000),
  onlyNew: z.boolean(),
});
export const importDraftSchema = importSelectionSchema.extend({
  id: idSchema<'ImportDraft'>(),
  method: importMethodSchema,
  sourceLabel: z.string().max(1024),
  sourceId: idSchema<'Source'>().nullable(),
  storage: z.enum(['copy', 'reference']),
  destinationLabel: z.string().max(4096),
  allowNetwork: z.boolean(),
  watch: z.boolean(),
  recursive: z.boolean(),
  createdAt: count,
  updatedAt: count,
  sessionId: idSchema<'ImportSession'>().nullable(),
});
export type ImportDraft = z.output<typeof importDraftSchema>;

export const importCapabilitiesSchema = z.object({
  pause: z.boolean(),
  resume: z.boolean(),
  cancel: z.boolean(),
  retryFailed: z.boolean(),
  byteResume: z.boolean(),
});
export type ImportCapabilities = z.output<typeof importCapabilitiesSchema>;
export const importProgressSchema = z.object({
  totalItems: count.nullable(),
  completedItems: count,
  failedItems: count,
  skippedItems: count,
  archivedItems: count,
  receivedBytes: count,
  totalBytes: count.nullable(),
  bytesPerSecond: z.number().nonnegative().nullable(),
  etaSeconds: z.number().nonnegative().nullable(),
  currentFile: z.string().max(1024).nullable(),
});
export type ImportProgress = z.output<typeof importProgressSchema>;
export const importItemOutcomeSchema = z.object({
  itemId,
  name: z.string().max(1024),
  state: z.enum([
    'pending',
    'receiving',
    'checking',
    'imported',
    'duplicate',
    'archived',
    'failed',
    'cancelled',
  ]),
  receivedBytes: count,
  result: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('asset'), assetId: idSchema<'Asset'>(), sourceId: idSchema<'Source'>() }),
      z.object({ kind: z.literal('archived'), captureId: idSchema<'CaptureGroup'>(), complete: z.boolean() }),
    ])
    .nullable(),
  error: publicErrorSchema.nullable(),
});
export type ImportItemOutcome = z.output<typeof importItemOutcomeSchema>;
export const importSessionSchema = z.object({
  id: idSchema<'ImportSession'>(),
  draftId: idSchema<'ImportDraft'>().nullable(),
  method: importMethodSchema,
  sourceLabel: z.string().max(1024),
  sourceId: idSchema<'Source'>().nullable(),
  status: z.enum(IMPORT_SESSION_STATUSES),
  stage: z.enum(IMPORT_STAGES),
  progress: importProgressSchema,
  capabilities: importCapabilitiesSchema,
  createdAt: count,
  updatedAt: count,
  finishedAt: count.nullable(),
  safeToDisconnect: z.boolean(),
});
export type ImportSession = z.output<typeof importSessionSchema>;
export const importPreflightSchema = z.object({
  draftId: idSchema<'ImportDraft'>(),
  selectedItems: count,
  selectedCaptures: count,
  knownBytes: count,
  unknownSizeItems: count,
  availableBytes: count.nullable(),
  destinationLabel: z.string().max(4096),
  storage: z.enum(['copy', 'reference']),
  duplicateItems: count,
  unsupportedItems: count,
  missingRequired: z.array(z.string().max(1024)),
  warnings: z.array(z.string().max(200)),
  canStart: z.boolean(),
});
export type ImportPreflight = z.output<typeof importPreflightSchema>;
