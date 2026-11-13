// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's agent tools (P1-G7, P2-L12): add a folder as a source
 * (wrapping the library.addSource command, so it is audited and undoable
 * like the button), list sources (shown as the sourcePicker card), list a
 * source's files, and the read tools in src/search (search, find similar,
 * one asset, import progress). File and folder names come from the user's
 * disk, so they are marked untrusted for the agent. No tool opens the Wi-Fi
 * import server: the sourcePicker card offers the phone instead.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  defineTool,
  defineToolModule,
  err,
  NO_TOOL_RETRY,
  ok,
  ValidationError,
  type AsyncResult,
  type IndexingStatus,
  type SourceId,
  type ToolModule,
  ulidSchema,
} from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { sourceViews, type LibrarySearchPort } from '../profile';
import { createSourceRepository, type Source } from '../repositories/sources';
import { sourcePickerCard } from '../search/import-card';
import {
  libraryReadTools,
  type AssetContactSheetReader,
  type ContactSheetPictures,
} from '../search/search-tools';
import { toolSourceView, toolSourceViewSchema } from '../search/tool-schemas';
import { ADD_SOURCE, type SourceInfo } from './commands';
import { normaliseFolderPath } from './folders';
import { listMediaFiles } from './media-files';

export type { AssetContactSheetReader, ContactSheetPictures };

export interface LibraryToolDeps {
  readonly db: LibraryDatabase;
  /** createLibrarySearch(…): hybrid search and find similar. */
  readonly search: LibrarySearchPort;
  /** The indexing pipeline's status (indexing.status), for one source or all. */
  readonly importStatus: (sourceId?: SourceId) => AsyncResult<IndexingStatus>;
  /** Reads the clip's cached Set-of-Mark contact sheet JPEG and upload-consent verdict for `library.getAsset`. */
  readonly contactSheet?: AssetContactSheetReader;
  /** What `~` means in a path the model gives. */
  readonly home?: string;
}

const fromDisk = <T extends z.ZodType>(schema: T) => schema.meta({ untrusted: 'file-system' });
const sourceSchema = z.object({
  id: ulidSchema('Source'),
  name: fromDisk(z.string()),
  path: fromDisk(z.string()),
  kind: z.enum(['wifi_import', 'usb_import', 'watched_folder']),
  status: z.enum(['online', 'offline', 'missing']),
});

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

interface IndexedFileRow {
  readonly assetId: string;
  readonly name: string;
  readonly path: string;
  readonly type: 'video' | 'image' | 'audio';
  readonly sizeBytes: number;
  readonly modifiedAt: number;
}

function listIndexedSourceFiles(db: LibraryDatabase, source: Source): IndexedFileRow[] {
  const rows = db.driver
    .prepare(
      `SELECT
         a.id AS assetId,
         a.original_filename AS name,
         a.kind AS kind,
         a.size_bytes AS sizeBytes,
         a.capture_time AS captureTime,
         a.created_at AS createdAt,
         loc.relative_path AS relativePath,
         loc.absolute_path_cached AS absolutePathCached,
         loc.mtime_ms AS mtimeMs,
         s.root_path AS locRootPath
       FROM (SELECT DISTINCT asset_id, source_id FROM library_asset_sources WHERE source_id = ?) las
       JOIN assets a ON a.id = las.asset_id
       LEFT JOIN asset_locations loc ON loc.id = (
         SELECT l2.id FROM asset_locations l2
         WHERE l2.asset_id = a.id
         ORDER BY (l2.source_id = las.source_id) DESC, (l2.storage = 'managed') DESC, l2.id ASC
         LIMIT 1
       )
       LEFT JOIN sources s ON s.id = loc.source_id
       WHERE a.trashed_at IS NULL
         AND a.detached_at IS NULL
         AND a.companion_of IS NULL`,
    )
    .all(source.id) as Record<string, unknown>[];

  return rows
    .map((row): IndexedFileRow => {
      const kind = String(row.kind ?? 'video');
      const type = kind === 'image' || kind === 'live_photo' ? 'image' : kind === 'audio' ? 'audio' : 'video';
      const rel = row.relativePath ? String(row.relativePath) : '';
      const locRoot = row.locRootPath ? String(row.locRootPath) : source.rootPath;
      const cached = row.absolutePathCached ? String(row.absolutePathCached) : '';
      const path = cached || (locRoot && rel ? join(locRoot, rel) : rel || String(row.name ?? ''));
      return {
        assetId: String(row.assetId),
        name: String(row.name ?? ''),
        path,
        type,
        sizeBytes: Math.max(0, Math.trunc(Number(row.sizeBytes ?? 0))),
        modifiedAt: Math.trunc(Number(row.mtimeMs ?? row.captureTime ?? row.createdAt ?? 0)),
      };
    })
    .sort((a, b) => byName.compare(a.name, b.name) || a.assetId.localeCompare(b.assetId));
}

/** Same folder, same key: `~/Trip`, `/Users/me/Trip/` and `/Users/me/./Trip` are one action. */
export function folderKey(path: string, home?: string): string {
  const folder = normaliseFolderPath(path, home) ?? path.trim();
  return createHash('sha256').update(folder).digest('hex').slice(0, 32);
}

export function libraryToolModule(deps: LibraryToolDeps): ToolModule {
  const sources = createSourceRepository(deps.db);

  const addSource = defineTool({
    name: 'library.addSource',
    version: '1.1.0',
    description:
      'Adds a folder on this Mac to the library as a source and starts scanning it; by default the folder ' +
      'is watched, so new files there join the library. The files stay where they are; nothing is copied ' +
      'or uploaded. Undoable. Returns the source and its scan job.',
    summary: 'Adds a folder on this Mac to the library and scans it.',
    tags: ['import', 'folder', 'source'],
    input: z.object({
      path: z.string().min(1).max(4096).describe('Absolute folder path, or one starting with ~/'),
      name: z.string().min(1).max(200).optional().describe('Name to show in the library'),
      watch: z.boolean().optional().describe('Keep watching the folder for new files (default true)'),
    }),
    output: sourceSchema.extend({
      /** The folder's first full scan; follow it with library.importStatus. */
      scan: z.object({ jobId: ulidSchema('Job') }).optional(),
    }),
    costClass: 'local',
    sideEffect: 'write',
    command: ADD_SOURCE,
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['user-selected'] }, network: 'none' },
    idempotencyKey: (input) => folderKey(input.path, deps.home),
    run: async (input, ctx) => {
      // The audit log stores the absolute path, exactly as the Add folder button would send it.
      const path = normaliseFolderPath(input.path, deps.home) ?? input.path;
      const done = await ctx.dispatch({
        path,
        ...(input.name ? { name: input.name } : {}),
        ...(input.watch !== undefined ? { watch: input.watch } : {}),
      });
      if (!done.ok) return done;
      // addSource only creates a folder source. Stock and generated kinds are not this tool's output.
      const info = done.value as SourceInfo & { scan?: { jobId: string } };
      if (info.kind !== 'wifi_import' && info.kind !== 'usb_import' && info.kind !== 'watched_folder') {
        return err(ValidationError({ field: 'source.kind' }));
      }
      const kind = info.kind;
      return ok({ ...info, kind });
    },
  });

  const listSources = defineTool({
    name: 'library.listSources',
    version: '1.1.0',
    description:
      'Lists the folders and phone imports in the library: ids, names, folder paths, whether each is ' +
      'watched, its scan state, and how many files it has and how many are missing. Shown to the user ' +
      'with buttons to add a folder or connect a phone.',
    summary: 'Lists the library sources with file counts and scan state.',
    tags: ['folder', 'source', 'browse'],
    input: z.object({}),
    output: z.object({ sources: z.array(toolSourceViewSchema) }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 5_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'] }, network: 'none' },
    run: async () => ok({ sources: sourceViews(deps.db).map(toolSourceView) }),
    // The card shows core's full views (scan errors with their fix), read again: the output is the model's.
    resultCard: async (_output, ctx) => ok(sourcePickerCard(sourceViews(deps.db), ctx)),
  });

  const listFiles = defineTool({
    name: 'library.listFiles',
    version: '1.0.0',
    description:
      'Lists the video, photo and audio files directly inside a source folder, sorted by name, ' +
      'with their type, size and modification time.',
    summary: 'Lists the video, photo and audio files in a source folder.',
    tags: ['files', 'folder', 'browse', 'video'],
    input: z.object({
      sourceId: z.string().describe('Id from library.addSource or library.listSources'),
      limit: z.number().int().min(1).max(200).default(20),
    }),
    output: z.object({
      files: z.array(
        z.object({
          assetId: z.string().optional(),
          name: fromDisk(z.string()),
          path: fromDisk(z.string()),
          type: z.enum(['video', 'image', 'audio']),
          sizeBytes: z.number().int().nonnegative(),
          modifiedAt: z.number().int(),
        }),
      ),
      total: z.number().int().nonnegative(),
    }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: { filesystem: { read: ['library'] }, network: 'none' },
    run: async (input) => {
      const source = sources.get(input.sourceId as SourceId);
      if (!source.ok) return source;
      const indexed = listIndexedSourceFiles(deps.db, source.value);
      const pagedIndexed = () => ok({ files: indexed.slice(0, input.limit), total: indexed.length });

      if (source.value.kind !== 'watched_folder' || !source.value.rootPath) {
        if (indexed.length > 0) return pagedIndexed();
        if (!source.value.rootPath) return ok({ files: [], total: 0 });
        const disk = await listMediaFiles(source.value.rootPath, input.limit, source.value.displayName);
        return disk.ok ? disk : ok({ files: [], total: 0 });
      }

      const disk = await listMediaFiles(source.value.rootPath, input.limit, source.value.displayName);
      if (!disk.ok) return indexed.length > 0 ? pagedIndexed() : disk;
      if (disk.value.total === 0 || indexed.length > disk.value.total) {
        return indexed.length > 0 ? pagedIndexed() : disk;
      }
      if (indexed.length === 0) return disk;
      const byPath = new Map(indexed.map((row) => [row.path, row.assetId]));
      const byLowerName = new Map(indexed.map((row) => [row.name.toLowerCase(), row.assetId]));
      return ok({
        files: disk.value.files.map((file) => {
          const assetId = byPath.get(file.path) ?? byLowerName.get(file.name.toLowerCase());
          return assetId ? { ...file, assetId } : file;
        }),
        total: disk.value.total,
      });
    },
  });

  return defineToolModule({
    id: 'library',
    tools: [addSource, listSources, listFiles, ...libraryReadTools(deps)],
  });
}
