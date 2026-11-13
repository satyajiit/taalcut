// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent's read tools over the library (P2-L12): search, find similar,
 * one asset's profile, and import progress. All local, all reads. What the
 * user's disk or a model wrote (file names, descriptions, speech, on-screen
 * text) is marked untrusted for the agent. Locations and capture places
 * stay on this Mac: no tool output carries latitude or longitude. Since
 * LIB1-FIND a hit says what people in it are doing, where its clip was filmed
 * (in words) and its trip, and search filters by action, trip, country and city.
 */
import {
  defineTool,
  err,
  NO_TOOL_RETRY,
  ok,
  parseId,
  placeInWords,
  ValidationError,
  type ArtifactRef,
  type AsyncResult,
  type IndexingStatus,
  type SearchHit,
  type ShotId,
  type SourceId,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import type { LibrarySearchPort } from '../profile';
import {
  assetToolOutput,
  getAssetInput,
  getAssetOutput,
  type AssetContactSheetReader,
  type ContactSheetPictures,
} from './asset-tool';
import { describeAssetCall, describeSimilarCall } from './call-summaries';
import { compactHitsOutput, hitsOutput, summarizeSearchOutput, type hitSchema } from './compact-hits';
import { importProgressCard } from './import-card';
import {
  parseFilters,
  plainTime,
  toolFiltersSchema,
  toolIndexingStatus,
  toolIndexingStatusSchema,
} from './tool-schemas';

export { hitsOutput };
export type { AssetContactSheetReader, ContactSheetPictures };

export interface LibraryReadToolDeps {
  readonly db: LibraryDatabase;
  readonly search: LibrarySearchPort;
  /** The indexing pipeline's status (indexing.status), for one source or all. */
  readonly importStatus: (sourceId?: SourceId) => AsyncResult<IndexingStatus>;
  /** Reads the clip's cached Set-of-Mark contact sheet JPEG and upload-consent verdict for `library.getAsset`. */
  readonly contactSheet?: AssetContactSheetReader;
}

const local = { filesystem: { read: ['library' as const] }, network: 'none' as const };

/** Each shot's actions as its analysis lists them (fixed words first), for the hits. */
function actionsOf(db: LibraryDatabase, shotIds: readonly string[]): Map<string, string[]> {
  const rows = db.driver
    .prepare(
      `SELECT id, json_extract(analysis, '$.description.actions') AS actions FROM shots
       WHERE id IN (SELECT value FROM json_each(?)) AND json_valid(analysis)
         AND json_type(analysis, '$.description.actions') = 'array'`,
    )
    .all(JSON.stringify(shotIds));
  const found = new Map<string, string[]>();
  for (const row of rows) {
    const list: unknown = JSON.parse(String(row.actions));
    if (Array.isArray(list))
      found.set(
        String(row.id),
        list.filter((a): a is string => typeof a === 'string'),
      );
  }
  return found;
}

function toToolHit(hit: SearchHit, actions: ReadonlyMap<string, string[]>): z.input<typeof hitSchema> {
  return {
    shotId: hit.shot.id,
    assetId: hit.asset.id,
    fileName: hit.asset.name,
    start: plainTime(hit.shot.range.start),
    duration: plainTime(hit.shot.range.duration),
    description: hit.shot.description,
    actions: actions.get(hit.shot.id) ?? [],
    place: hit.asset.place ? placeInWords(hit.asset.place) : null,
    trip: hit.asset.trip
      ? { id: hit.asset.trip.id, name: hit.asset.trip.name, month: hit.asset.trip.month }
      : null,
    matchedBy: [...hit.matchedBy],
    score: hit.score,
    ...(hit.snippet ? { passage: hit.snippet.text } : {}),
  };
}

const toolHits = (db: LibraryDatabase, hits: readonly SearchHit[]) => {
  const actions = actionsOf(
    db,
    hits.map((hit) => hit.shot.id),
  );
  return hits.map((hit) => toToolHit(hit, actions));
};

/** An asset's best first shot: the first that is a best take, else its first. */
function bestFirstShot(db: LibraryDatabase, assetId: string): ShotId | undefined {
  const row = db.driver
    .prepare('SELECT id FROM shots WHERE asset_id = ? ORDER BY best_take DESC, index_in_asset LIMIT 1')
    .get(assetId);
  return row ? (row.id as ShotId) : undefined;
}

export function libraryReadTools(deps: LibraryReadToolDeps) {
  const search = defineTool({
    name: 'library.search',
    version: '1.1.0',
    description:
      "Searches the user's footage by meaning and keywords, in any of the app's languages: what is seen " +
      '(the frames), the descriptions, what is said and on-screen text. Returns shots with their file, ' +
      'start and length, why each matched, and a 0..1 score for ordering.',
    summary: "Finds shots in the user's footage by meaning and keywords.",
    tags: ['search', 'footage', 'shots', 'find'],
    input: z.object({
      query: z.string().trim().min(1).max(500).describe('What to look for, e.g. "sunset shots on the beach"'),
      filters: toolFiltersSchema.optional(),
      limit: z.int().min(1).max(30).default(12),
    }),
    output: hitsOutput,
    costClass: 'local',
    sideEffect: 'read',
    // The first search may wait for the embedding model to load.
    timeoutMs: 30_000,
    retry: { maxAttempts: 2, initialDelayMs: 1_000 },
    permission: local,
    run: async (input) => {
      const filters = parseFilters(input.filters);
      if (!filters.ok) return filters;
      const found = await deps.search.search(input.query, filters.value, input.limit);
      if (!found.ok) return found;
      return ok(
        compactHitsOutput({
          hits: toolHits(deps.db, found.value.hits),
          ...(found.value.degraded ? { degraded: found.value.degraded } : {}),
        }),
      );
    },
    summarize: summarizeSearchOutput,
  });

  const findSimilar = defineTool({
    name: 'library.findSimilar',
    version: '1.1.0',
    description:
      'Finds shots that look like a given shot (or an asset, by its best first shot): same kind of scene, ' +
      'framing and content. Leaves out the shot, its near-duplicates and, by default, the rest of its file.',
    summary: 'Finds shots that look like a given shot or asset.',
    tags: ['similar', 'search', 'shots'],
    input: z
      .object({
        shotId: ulidSchema('Shot').optional().describe('A shot id from library.search'),
        assetId: ulidSchema('Asset').optional().describe('Or an asset id: its best first shot is used'),
        filters: toolFiltersSchema.optional(),
        limit: z.int().min(1).max(30).default(12),
        excludeSameAsset: z.boolean().default(true),
      })
      .refine((i) => (i.shotId === undefined) !== (i.assetId === undefined), {
        message: 'Give exactly one of shotId and assetId',
      }),
    output: hitsOutput,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: local,
    run: async (input) => {
      const filters = parseFilters(input.filters);
      if (!filters.ok) return filters;
      const given = input.shotId ? parseId<'Shot'>(input.shotId) : undefined;
      if (given && !given.ok) return given;
      const shotId = given?.value ?? (input.assetId ? bestFirstShot(deps.db, input.assetId) : undefined);
      if (!shotId)
        return err(
          ValidationError(
            { field: 'assetId' },
            { detail: 'the asset has no shots (audio, or not yet split)' },
          ),
        );
      const found = await deps.search.findSimilar(shotId, filters.value, input.limit, input.excludeSameAsset);
      return found.ok ? ok(compactHitsOutput({ hits: toolHits(deps.db, found.value.hits) })) : found;
    },
    describeCall: (_input, output) => describeSimilarCall(output),
  });

  const getAsset = defineTool({
    name: 'library.getAsset',
    version: '1.1.0',
    description:
      "One file's profile: kind, length, size, orientation, language, quality and index state; with " +
      '`include`, its shots (descriptions, objects, place, shot type, motion, quality, on-screen text, ' +
      'speech), its transcript (long ones are stored as an artifact) and where its copies are.',
    summary: "One file's profile: facts, shots, transcript and copies.",
    tags: ['asset', 'profile', 'transcript', 'shots'],
    input: getAssetInput,
    output: getAssetOutput,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: local,
    run: (input, ctx) =>
      assetToolOutput(deps.db, input, ctx.artifacts, {
        ...(deps.contactSheet ? { contactSheet: deps.contactSheet } : {}),
        signal: ctx.signal,
      }),
    images: (output) =>
      output.contactSheet?.pictures.footage === 'shown' && output.contactSheet.image
        ? [output.contactSheet.image as ArtifactRef]
        : [],
    describeCall: (_input, output) => describeAssetCall(output),
  });

  const importStatus = defineTool({
    name: 'library.importStatus',
    version: '1.1.0',
    description:
      'How importing and indexing are going, for one source or all: assets done, in progress, waiting and ' +
      'failed, per stage, with an estimate of the time left. Shown to the user as a progress card.',
    summary: 'How importing and indexing are going, per source.',
    tags: ['import', 'indexing', 'progress', 'source'],
    input: z.object({
      sourceId: ulidSchema('Source').optional().describe('A source id from library.listSources'),
    }),
    output: toolIndexingStatusSchema,
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: local,
    run: async (input) => {
      const sourceId = input.sourceId ? parseId<'Source'>(input.sourceId) : undefined;
      if (sourceId && !sourceId.ok) return sourceId;
      const status = await deps.importStatus(sourceId?.value);
      if (!status.ok) return status;
      const plain = toolIndexingStatus(status.value);
      return ok(
        sourceId ? { ...plain, sources: plain.sources.filter((s) => s.sourceId === sourceId.value) } : plain,
      );
    },
    resultCard: async (output, ctx) => ok(importProgressCard(deps.db, output, ctx)),
  });

  return [search, findSimilar, getAsset, importStatus] as const;
}
