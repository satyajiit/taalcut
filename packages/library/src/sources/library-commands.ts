// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library's commands (core's LIBRARY_COMMANDS and payloads; handlers
 * here, agent process). Writes are staged on the command's unit of work so
 * they commit with its audit row; reads (`rescanSource`, `findMissing`) only
 * enqueue a job, at once, since a read is never recorded. `reindexAssets`
 * belongs to the indexing pipeline.
 */
import { stat } from 'node:fs/promises';
import {
  createCommitAnnouncer,
  defineCommand,
  defineSetting,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  ok,
  type AssetId,
  type CommandContext,
  type CommandHandler,
  type CommitAnnouncer,
  type SettingsStore,
} from '@taalcut/core';
import { inArray, isNotNull, isNull, and } from 'drizzle-orm';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import type { ContentHasher } from '../hashing/content-hasher';
import type { CommandUnitOfWork, StagedWrite } from '../ports/unit-of-work';
import { createAssetRepository } from '../repositories/media-library';
import { inTransaction } from '../repositories/shared';
import { createSourceRepository } from '../repositories/sources';
import { assets } from '../schema/library';
import { createStockCommands, type StockCommandPorts } from '../stock/stock-commands';
import { createSourceCommands } from './commands';
import { enqueueInTransaction, enqueueScan } from './enqueue';
import { FolderNotAllowed, folderParams, NotAFolder } from './errors';
import { normaliseFolderPath, type FolderPolicy } from './folders';
import { findMissingFilesJob } from './job-kinds';
import { createRelinkCommands } from './relink-commands';
import type { VolumeProbe } from './volumes';

const C = LIBRARY_COMMANDS;
const P = libraryCommandPayloads;

/** Where Wi-Fi imports go; null means the app's default (`~/Movies/Taalcut/Originals`). New imports only. */
export const ORIGINALS_ROOT_SETTING = defineSetting<string | null>(
  'library.originalsRoot',
  z.string().min(1).max(4096).nullable(),
  null,
);

export interface LibraryCommandDeps {
  readonly db: LibraryDatabase;
  readonly folders: FolderPolicy;
  /** createLibraryPorts(db).commands: staged writes commit with the audit row. */
  readonly commands?: Pick<CommandUnitOfWork, 'stage' | 'handle'>;
  /** The library's SettingsStore (createLibraryPorts(db).settings): `set` with a context stages. */
  readonly settings: Pick<SettingsStore, 'get' | 'set'>;
  /** The originals root while the setting is unset. */
  readonly defaultOriginalsRoot: string;
  readonly hasher: ContentHasher;
  readonly volumes?: VolumeProbe;
  /**
   * Stock import. Without `http` the command refuses (`library.stock_unavailable`)
   * rather than enqueueing a job the jobs process will not run.
   */
  readonly stock?: StockCommandPorts;
}

/** The originals root now: the setting, or the default. */
export async function originalsRootOf(deps: Pick<LibraryCommandDeps, 'settings' | 'defaultOriginalsRoot'>) {
  const set = await deps.settings.get(ORIGINALS_ROOT_SETTING);
  return (set.ok ? set.value : null) ?? deps.defaultOriginalsRoot;
}

export function createLibraryCommands(deps: LibraryCommandDeps) {
  const { db } = deps;
  const announcer: CommitAnnouncer = createCommitAnnouncer();
  const sources = createSourceRepository(db);
  const assetRepo = createAssetRepository(db);
  const guard = <P, R>(handler: CommandHandler<P, R>): CommandHandler<P, R> =>
    deps.commands ? deps.commands.handle(handler) : handler;
  const write = (context: CommandContext, change: StagedWrite) =>
    deps.commands ? deps.commands.stage(context, change) : inTransaction(db, 'library', change);

  const { addSource, removeSource } = createSourceCommands({
    sources,
    folders: deps.folders,
    db,
    announcer,
    ...(deps.commands ? { commands: deps.commands } : {}),
    ...(deps.volumes ? { volumes: deps.volumes } : {}),
    originalsRoot: () => originalsRootOf(deps),
  });

  const renameSource = defineCommand({
    name: C.renameSource,
    payload: P[C.renameSource],
    sideEffect: 'write',
    handle: guard(async (payload, context) => {
      const source = sources.get(payload.sourceId);
      if (!source.ok) return source;
      const before = source.value.displayName;
      const staged = write(context, () => sources.update(payload.sourceId, { displayName: payload.name }));
      if (!staged.ok) return staged;
      announcer.note(context, {
        projectId: null,
        entity: 'source',
        change: 'updated',
        ids: [payload.sourceId],
      });
      return ok({
        result: { sourceId: payload.sourceId, name: payload.name },
        inverse: { name: C.renameSource, payload: { sourceId: payload.sourceId, name: before } },
      });
    }),
  });

  const setSourceWatch = defineCommand({
    name: C.setSourceWatch,
    payload: P[C.setSourceWatch],
    sideEffect: 'write',
    handle: guard(async (payload, context) => {
      const source = sources.get(payload.sourceId);
      if (!source.ok) return source;
      const before = source.value.watch;
      if (before === payload.watch) return ok({ result: { sourceId: payload.sourceId, watch: before } });
      const staged = write(context, () => sources.update(payload.sourceId, { watch: payload.watch }));
      if (!staged.ok) return staged;
      announcer.note(context, {
        projectId: null,
        entity: 'source',
        change: 'updated',
        ids: [payload.sourceId],
      });
      return ok({
        result: { sourceId: payload.sourceId, watch: payload.watch },
        inverse: { name: C.setSourceWatch, payload: { sourceId: payload.sourceId, watch: before } },
      });
    }),
  });

  const rescanSource = defineCommand({
    name: C.rescanSource,
    payload: P[C.rescanSource],
    sideEffect: 'read',
    handle: async (payload) => {
      const source = sources.get(payload.sourceId);
      if (!source.ok) return source;
      const queued = inTransaction(db, 'job', () =>
        enqueueScan(db, { sourceId: payload.sourceId, mode: 'full' }),
      );
      return queued.ok ? ok({ result: { jobId: queued.value.job.id } }) : queued;
    },
  });

  const findMissing = defineCommand({
    name: C.findMissing,
    payload: P[C.findMissing],
    sideEffect: 'read',
    handle: async (payload) => {
      const folder = normaliseFolderPath(payload.searchIn, deps.folders.home);
      if (!folder) return err(FolderNotAllowed(folderParams(payload.searchIn)));
      const queued = enqueueInTransaction(db, {
        kind: findMissingFilesJob,
        input: { ...payload, searchIn: folder },
      });
      return queued.ok ? ok({ result: { jobId: queued.value.job.id } }) : queued;
    },
  });

  /** The ids among `ids` that exist and are (trashed = true) or aren't (false) in the trash. */
  const inTrash = (ids: readonly AssetId[], trashed: boolean): AssetId[] =>
    db.orm
      .select({ id: assets.id })
      .from(assets)
      .where(
        and(inArray(assets.id, [...ids]), trashed ? isNotNull(assets.trashedAt) : isNull(assets.trashedAt)),
      )
      .all()
      .map((row) => row.id);

  const trashOrRestore = (trash: boolean) =>
    guard(async (payload: { assetIds: AssetId[] }, context: CommandContext) => {
      const changing = inTrash(payload.assetIds, !trash);
      if (changing.length === 0) return ok({ result: { assetIds: [] as AssetId[] } });
      const staged = write(context, () => (trash ? assetRepo.trash(changing) : assetRepo.restore(changing)));
      if (!staged.ok) return staged;
      announcer.note(context, {
        projectId: null,
        entity: 'asset',
        change: trash ? 'deleted' : 'created',
        ids: changing,
      });
      return ok({
        result: { assetIds: changing },
        inverse: { name: trash ? C.restoreAssets : C.trashAssets, payload: { assetIds: changing } },
      });
    });

  const trashAssets = defineCommand({
    name: C.trashAssets,
    payload: P[C.trashAssets],
    sideEffect: 'write',
    handle: trashOrRestore(true),
  });
  const restoreAssets = defineCommand({
    name: C.restoreAssets,
    payload: P[C.restoreAssets],
    sideEffect: 'write',
    handle: trashOrRestore(false),
  });

  const setOriginalsRoot = defineCommand({
    name: C.setOriginalsRoot,
    payload: P[C.setOriginalsRoot],
    sideEffect: 'write',
    handle: guard(async (payload, context) => {
      const path = normaliseFolderPath(payload.path, deps.folders.home);
      if (!path) return err(FolderNotAllowed(folderParams(payload.path)));
      const info = await stat(path).catch(() => undefined);
      if (info && !info.isDirectory()) return err(NotAFolder(folderParams(path)));
      const clash = sources
        .list({ kinds: ['watched_folder'] })
        .find(
          (s) =>
            path === s.rootPath || path.startsWith(`${s.rootPath}/`) || s.rootPath.startsWith(`${path}/`),
        );
      const isProtected = deps.folders.protectedRoots.some(
        (root) => path === root || path.startsWith(`${root}/`),
      );
      if (clash || isProtected) {
        const detail = clash ? `Overlaps the watched folder ${clash.id}.` : "Inside Taalcut's own data.";
        return err(FolderNotAllowed(folderParams(path), { detail }));
      }
      const before = await originalsRootOf(deps);
      const set = await deps.settings.set(ORIGINALS_ROOT_SETTING, path, context);
      if (!set.ok) return set;
      return ok({ result: { path }, inverse: { name: C.setOriginalsRoot, payload: { path: before } } });
    }),
  });

  const relink = createRelinkCommands({ db, hasher: deps.hasher, guard, write, announcer });
  // The job row and the import record commit with the audit row (review M2), like addSource's scan.
  const stock = createStockCommands(db, {
    ...deps.stock,
    ...(deps.commands ? { commands: deps.commands } : {}),
  });

  const all = [
    addSource,
    removeSource,
    renameSource,
    setSourceWatch,
    rescanSource,
    findMissing,
    relink.relinkLocations,
    relink.restoreLocations,
    trashAssets,
    restoreAssets,
    setOriginalsRoot,
    stock.importStock,
    stock.discardStockImport,
  ] as const;
  return {
    ...relink,
    ...stock,
    addSource,
    removeSource,
    renameSource,
    setSourceWatch,
    rescanSource,
    findMissing,
    trashAssets,
    restoreAssets,
    setOriginalsRoot,
    all,
    /** Sends `library.changed` once each committed library command's write settles. */
    announce: (
      bus: Parameters<CommitAnnouncer['attach']>[0],
      events: Parameters<CommitAnnouncer['attach']>[1],
    ) => announcer.attach(bus, events),
  };
}
