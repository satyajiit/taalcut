// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Library command names and payloads (P2-L1 to P2-L3), so the renderer and
 * ⌘K dispatch them typed. Handlers stay in @taalcut/library (as with
 * modelCommandPayloads); `library.addSource` and `library.removeSource` move
 * here from there, `addSource` gaining `watch`.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { spokenLanguageSchema } from '../analysis/transcript';
import { idSchema } from '../basics/ids';
import { indexStageNameSchema } from './indexing';
import { LOCATION_STATES } from './library-types';
import { stockItemRefSchema } from './stock';

export const LIBRARY_COMMANDS = {
  addSource: 'library.addSource',
  removeSource: 'library.removeSource',
  renameSource: 'library.renameSource',
  setSourceWatch: 'library.setSourceWatch',
  /** read: starts a scan, changes nothing itself. */
  rescanSource: 'library.rescanSource',
  /** read: starts the find-missing job; its candidates are applied with relinkLocations. */
  findMissing: 'library.findMissing',
  relinkLocations: 'library.relinkLocations',
  /** internal: relinkLocations' inverse. */
  restoreLocations: 'library.restoreLocations',
  trashAssets: 'library.trashAssets',
  restoreAssets: 'library.restoreAssets',
  /** write, not undoable: analysis is redone. */
  reindexAssets: 'library.reindexAssets',
  /** New imports only; existing originals stay where they are. */
  setOriginalsRoot: 'library.setOriginalsRoot',
  /** P3-V18: write; fetches a stock item into the library. Result { importId, jobId, assetId | null }. */
  importStock: 'library.importStock',
  /** internal: importStock's inverse. */
  discardStockImport: 'library.discardStockImport',
  /**
   * LIB1-LANG: write, undoable. The language a clip's speech is in, as the person says (null: back to detection). It
   * wins over detection from then on, and the clip's language and transcript are redone in it.
   */
  setAssetLanguage: 'library.setAssetLanguage',
} as const;

/** The job a stock import runs (agent process: fetch, verify, import). */
export const LIBRARY_JOB_KINDS = { stockImport: 'library.stockImport' } as const;

const sourceId = idSchema<'Source'>();
const assetIds = z.array(idSchema<'Asset'>()).min(1).max(1000);
const absolutePath = z.string().min(1).max(4096);
const label = z.string().trim().min(1).max(200);

export const libraryCommandPayloads = {
  [LIBRARY_COMMANDS.addSource]: z.object({
    /** Absolute, or starting with ~/. Resolved with realpath by the handler. */
    path: absolutePath,
    /** Shown in the library. Default: the folder's name. */
    name: label.optional(),
    /** Only when undo of a removal puts a source back under its old id. */
    sourceId: sourceId.optional(),
    watch: z.boolean().default(true),
  }),
  [LIBRARY_COMMANDS.removeSource]: z.object({ sourceId }),
  [LIBRARY_COMMANDS.renameSource]: z.object({ sourceId, name: label }),
  [LIBRARY_COMMANDS.setSourceWatch]: z.object({ sourceId, watch: z.boolean() }),
  [LIBRARY_COMMANDS.rescanSource]: z.object({ sourceId }),
  [LIBRARY_COMMANDS.findMissing]: z.object({
    searchIn: absolutePath,
    sourceId: sourceId.optional(),
    assetIds: assetIds.optional(),
  }),
  [LIBRARY_COMMANDS.relinkLocations]: z.object({
    items: z
      .array(
        z.object({
          locationId: idSchema<'AssetLocation'>(),
          path: absolutePath,
          /** The BLAKE3 the find-missing job verified; must equal the asset's. */
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      )
      .min(1)
      .max(500),
  }),
  [LIBRARY_COMMANDS.restoreLocations]: z.object({
    items: z
      .array(
        z.object({
          locationId: idSchema<'AssetLocation'>(),
          sourceId,
          relativePath: z.string().min(1).max(4096),
          state: z.enum(LOCATION_STATES),
        }),
      )
      .min(1)
      .max(500),
  }),
  [LIBRARY_COMMANDS.trashAssets]: z.object({ assetIds }),
  [LIBRARY_COMMANDS.restoreAssets]: z.object({ assetIds }),
  [LIBRARY_COMMANDS.reindexAssets]: z.object({
    assetIds,
    /** Default: every stage after library.hash. */
    stages: z.array(indexStageNameSchema).max(16).optional(),
  }),
  [LIBRARY_COMMANDS.setOriginalsRoot]: z.object({ path: absolutePath }),
  [LIBRARY_COMMANDS.importStock]: z.object({
    importId: idSchema<'StockImport'>(),
    item: stockItemRefSchema,
    /** The project it was asked for, if any. */
    projectId: idSchema<'Project'>().nullable().default(null),
  }),
  [LIBRARY_COMMANDS.discardStockImport]: z.object({
    importId: idSchema<'StockImport'>(),
    projectId: idSchema<'Project'>().nullable().default(null),
  }),
  [LIBRARY_COMMANDS.setAssetLanguage]: z.object({
    assetId: idSchema<'Asset'>(),
    language: spokenLanguageSchema.nullable(),
  }),
};
