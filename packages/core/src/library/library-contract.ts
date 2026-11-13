// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.library, owner agent (libraryRouter in @taalcut/library):
 * browse, search and similar shots, one asset in full, its transcript,
 * sources and storage; P3-V18's stock search and credit lines. Reads only;
 * changes are LIBRARY_COMMANDS.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { spokenLanguageSchema, transcriptSegmentSchema } from '../analysis/transcript';
import { idSchema } from '../basics/ids';
import { ipc } from '../ipc/contract';
import {
  ACTION_COUNTS_MAX,
  actionCountSchema,
  assetDetailSchema,
  assetSummarySchema,
  libraryFiltersSchema,
  libraryStorageSchema,
  searchResultSchema,
  sourceViewSchema,
} from './library-types';
import { placeQueries } from './places';
import { creditsSchema, stockSearchInputSchema, stockSearchPageSchema } from './stock';

const assetId = z.object({ assetId: idSchema<'Asset'>() });

export const LIBRARY_SORTS = ['captured', 'added', 'duration', 'quality'] as const;

export const libraryContract = {
  browse: ipc
    .input(
      z.object({
        filters: libraryFiltersSchema.optional(),
        sort: z.enum(LIBRARY_SORTS).default('captured'),
        direction: z.enum(['asc', 'desc']).default('desc'),
        cursor: z.string().max(200).optional(),
        limit: z.int().min(1).max(200).default(60),
      }),
    )
    .output(
      z.object({
        items: z.array(assetSummarySchema),
        total: z.int().nonnegative(),
        nextCursor: z.string().optional(),
      }),
    ),
  search: ipc
    .input(
      z.object({
        query: z.string().trim().min(1).max(500),
        filters: libraryFiltersSchema.optional(),
        limit: z.int().min(1).max(100).default(30),
      }),
    )
    .output(searchResultSchema),
  findSimilar: ipc
    .input(
      z.object({
        shotId: idSchema<'Shot'>(),
        filters: libraryFiltersSchema.optional(),
        excludeSameAsset: z.boolean().default(true),
        limit: z.int().min(1).max(100).default(30),
      }),
    )
    .output(searchResultSchema),
  asset: ipc.input(assetId).output(assetDetailSchema),
  /** Segments with word timings; null when the asset has no transcript. */
  transcript: ipc
    .input(
      assetId.extend({
        fromSegment: z.int().nonnegative().default(0),
        limit: z.int().min(1).max(2000).default(500),
      }),
    )
    .output(
      z
        .object({
          language: spokenLanguageSchema,
          segments: z.array(transcriptSegmentSchema),
          nextSegment: z.int().nonnegative().optional(),
        })
        .nullable(),
    ),
  sources: ipc.output(z.array(sourceViewSchema)),
  storage: ipc.output(libraryStorageSchema),
  /** P3-V18: stock video and sound effects; refused under Local only (core.local_only 'stock'). */
  stockSearch: ipc.input(stockSearchInputSchema).output(stockSearchPageSchema),
  /** The credit lines these assets need (render writes the same into CREDITS.txt). */
  credits: ipc.input(z.object({ assetIds: z.array(idSchema<'Asset'>()).max(400) })).output(creditsSchema),
  /** LIB1-PLACE: every trip, and the countries and cities the library has clips in (places.ts). */
  ...placeQueries,
  /** LIB1-FIND: the actions the library's shots show, with how many clips show each, most first (the action filter). */
  actions: ipc.output(z.object({ actions: z.array(actionCountSchema).max(ACTION_COUNTS_MAX) })),
};
