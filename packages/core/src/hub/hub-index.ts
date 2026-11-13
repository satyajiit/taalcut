// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The hub's index (docs/template-hub.md section 4): one entry per accepted template version, built by the hub
 * repository's CI and fetched by the app with its ETag. `hub.browse` reads it from the cache. Ids and times are
 * the template file's own (hubIdSchema, hubTimeSchema), so the index converts to JSON Schema too and a row's id
 * is exactly what its file may hold.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { FORMAT_IDS, languageTagSchema, sha256Schema } from '../templates/template-parts';
import { hubIdSchema, hubTimeSchema } from './hub-parts';
import { HUB_FORMAT_VERSION, hubHandleSchema, hubTagSchema } from './hub-template';

const hubId = hubIdSchema;

export const hubIndexEntrySchema = z.object({
  id: hubId,
  version: z.int().min(1),
  /** Untrusted (the author's): plain text. */
  name: z.string().max(80),
  description: z.string().max(280),
  handle: hubHandleSchema,
  language: languageTagSchema.nullable(),
  tags: z.array(hubTagSchema).max(8),
  formatId: z.enum(FORMAT_IDS).nullable(),
  trendFreshness: z.iso.date().nullable(),
  forkedFrom: z.object({ id: hubId, version: z.int().min(1) }).nullable(),
  duration: hubTimeSchema,
  slotCount: z.int().min(1),
  bpm: z.number().nullable(),
  /** The slot lengths in canvas frames, for a list row's strip. */
  slotStrip: z.array(z.int().positive()).max(200),
  /** sha256 of the file: a fork checks it (hub.integrity). */
  sha256: sha256Schema,
  createdAt: z.int().nonnegative(),
  updatedAt: z.int().nonnegative(),
});
export type HubIndexEntry = z.output<typeof hubIndexEntrySchema>;

export const hubIndexSchema = z.object({
  formatVersion: z.literal(HUB_FORMAT_VERSION),
  generatedAt: z.int().nonnegative(),
  templates: z.array(hubIndexEntrySchema).max(100_000),
});
export type HubIndex = z.output<typeof hubIndexSchema>;
